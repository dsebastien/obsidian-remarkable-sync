import { test, expect, describe, mock, beforeEach } from 'bun:test'
import {
    docIndexFilename,
    fetchBlob,
    fetchRootHash,
    isRetryableStatus,
    MAX_REQUEST_ATTEMPTS,
    parseIndex,
    parseIndexDetailed,
    RequestBudget,
    RequestBudgetExhaustedError,
    requestWithRetry,
    retryDelayMs,
    ROOT_INDEX_FILENAME
} from './sync-protocol'

interface RecordedRequest {
    url: string
    headers?: Record<string, string>
}

const recordedRequests: RecordedRequest[] = []

/**
 * Scripted outcomes consumed one per request: a status (with optional
 * headers) or an Error thrown as a network failure. Empty means 200.
 */
type Scripted = { status: number; headers?: Record<string, string> } | Error
const script: Scripted[] = []

void mock.module('obsidian', () => ({
    requestUrl: async (options: { url: string; headers?: Record<string, string> }) => {
        recordedRequests.push({ url: options.url, headers: options.headers })
        const next = script.shift()
        if (next instanceof Error) throw next
        return {
            status: next?.status ?? 200,
            headers: next?.headers ?? {},
            text: '',
            json: { hash: 'root-hash' },
            arrayBuffer: new ArrayBuffer(8)
        }
    }
}))

const noSleep = async (): Promise<void> => {}

describe('sync-protocol', () => {
    describe('fetchBlob rm-filename header', () => {
        beforeEach(() => {
            recordedRequests.length = 0
            script.length = 0
        })

        test('sends rm-filename and Authorization headers on /sync/v3/files/{hash}', async () => {
            await fetchBlob('token-abc', 'hash123', 'doc.metadata', 'https://sync.example')

            expect(recordedRequests.length).toBe(1)
            const req = recordedRequests[0]!
            expect(req.url).toBe('https://sync.example/sync/v3/files/hash123')
            expect(req.headers?.['rm-filename']).toBe('doc.metadata')
            expect(req.headers?.['Authorization']).toBe('Bearer token-abc')
        })

        test('ROOT_INDEX_FILENAME is "root.docSchema"', () => {
            expect(ROOT_INDEX_FILENAME).toBe('root.docSchema')
        })

        test('docIndexFilename appends ".docSchema" to the document id', () => {
            expect(docIndexFilename('uuid-1')).toBe('uuid-1.docSchema')
        })
    })

    describe('retry policy', () => {
        beforeEach(() => {
            recordedRequests.length = 0
            script.length = 0
        })

        test('only 429 and 5xx are retryable', () => {
            expect(isRetryableStatus(429)).toBe(true)
            expect(isRetryableStatus(503)).toBe(true)
            expect(isRetryableStatus(400)).toBe(false)
            expect(isRetryableStatus(401)).toBe(false)
            expect(isRetryableStatus(404)).toBe(false)
        })

        test('honours Retry-After in seconds and as an HTTP date, clamped', () => {
            expect(retryDelayMs(1, '3')).toBe(3000)
            const now = Date.parse('2026-09-23T10:00:00Z')
            expect(retryDelayMs(1, new Date(now + 5000).toUTCString(), now)).toBe(5000)
            expect(retryDelayMs(1, '99999')).toBe(30_000)
            expect(retryDelayMs(1, new Date(now - 3_600_000).toUTCString(), now)).toBe(0)
        })

        test('falls back to capped exponential backoff', () => {
            expect(retryDelayMs(1)).toBe(1000)
            expect(retryDelayMs(2)).toBe(2000)
            expect(retryDelayMs(3, 'garbage')).toBe(4000)
            expect(retryDelayMs(20)).toBe(30_000)
        })

        test('retries a 429 with its Retry-After, then succeeds', async () => {
            script.push({ status: 429, headers: { 'Retry-After': '2' } }, { status: 200 })
            const waits: number[] = []
            const response = await requestWithRetry(
                { url: 'https://x/a' },
                {
                    sleep: async (ms: number) => {
                        waits.push(ms)
                    }
                }
            )
            expect(response.status).toBe(200)
            expect(recordedRequests.length).toBe(2)
            expect(waits).toEqual([2000])
        })

        test('retries network errors and gives up after MAX_REQUEST_ATTEMPTS', async () => {
            for (let i = 0; i < MAX_REQUEST_ATTEMPTS; i++) script.push(new Error('offline'))
            const error = await requestWithRetry({ url: 'https://x/a' }, { sleep: noSleep }).catch(
                (e: unknown) => e
            )
            expect(error).toBeInstanceOf(Error)
            expect((error as Error).message).toBe('offline')
            expect(recordedRequests.length).toBe(MAX_REQUEST_ATTEMPTS)
        })

        test('does not retry a terminal status', async () => {
            script.push({ status: 404 })
            const response = await requestWithRetry({ url: 'https://x/a' }, { sleep: noSleep })
            expect(response.status).toBe(404)
            expect(recordedRequests.length).toBe(1)
        })

        test('fetchBlob survives a transient 429 instead of returning null', async () => {
            script.push({ status: 429, headers: { 'retry-after': '0' } }, { status: 200 })
            const blob = await fetchBlob('t', 'h', 'x.metadata', 'https://sync.example')
            expect(blob).not.toBeNull()
            expect(recordedRequests.length).toBe(2)
        })

        test('a persistent 429 gives up after MAX_REQUEST_ATTEMPTS and returns it', async () => {
            for (let i = 0; i < MAX_REQUEST_ATTEMPTS + 4; i++) script.push({ status: 429 })
            const budget = new RequestBudget({ maxConsecutiveFailures: 100 })
            const response = await requestWithRetry(
                { url: 'https://x/a' },
                { sleep: noSleep, budget }
            )
            expect(response.status).toBe(429)
            expect(recordedRequests.length).toBe(MAX_REQUEST_ATTEMPTS)
        })

        test('fetchRootHash still throws on 401 so the caller can refresh the token', async () => {
            script.push({ status: 401 })
            const error = await fetchRootHash('t', 'https://sync.example').catch((e: unknown) => e)
            expect(error).toMatchObject({ status: 401 })
        })
    })

    describe('failure budget', () => {
        beforeEach(() => {
            recordedRequests.length = 0
            script.length = 0
        })

        test('requests that exhaust their retries in a row stop the whole operation', async () => {
            for (let i = 0; i < 20; i++) script.push({ status: 503 })
            const budget = new RequestBudget({ maxConsecutiveFailures: 2 })
            const first = await requestWithRetry({ url: 'https://x/a' }, { sleep: noSleep, budget })
            expect(first.status).toBe(503)
            expect(recordedRequests.length).toBe(MAX_REQUEST_ATTEMPTS)
            expect(budget.exhaustedReason).toBeNull()

            await requestWithRetry({ url: 'https://x/b' }, { sleep: noSleep, budget })
            expect(recordedRequests.length).toBe(2 * MAX_REQUEST_ATTEMPTS)
            expect(budget.exhaustedReason).toContain('keeps failing')
            expect(budget.signal.aborted).toBe(true)

            // The next request of the same operation is not even attempted.
            const third = await requestWithRetry(
                { url: 'https://x/c' },
                { sleep: noSleep, budget }
            ).catch((e: unknown) => e)
            expect(third).toBeInstanceOf(RequestBudgetExhaustedError)
            expect(recordedRequests.length).toBe(2 * MAX_REQUEST_ATTEMPTS)
        })

        test('a transient failure that recovers does not count', async () => {
            for (let i = 0; i < 3; i++) script.push({ status: 503 }, { status: 200 })
            const budget = new RequestBudget({ maxConsecutiveFailures: 1 })
            for (const url of ['https://x/a', 'https://x/b', 'https://x/c']) {
                await requestWithRetry({ url }, { sleep: noSleep, budget })
            }
            expect(budget.exhaustedReason).toBeNull()
        })

        test('network errors that exhaust the retries count too', async () => {
            for (let i = 0; i < 10; i++) script.push(new Error('offline'))
            const budget = new RequestBudget({ maxConsecutiveFailures: 1 })
            const error = await requestWithRetry(
                { url: 'https://x/a' },
                { sleep: noSleep, budget }
            ).catch((e: unknown) => e)
            expect((error as Error).message).toBe('offline')
            expect(budget.exhaustedReason).toContain('keeps failing')
        })

        test('an answered request resets the consecutive failure count', async () => {
            const exhaust = (): void => {
                for (let i = 0; i < MAX_REQUEST_ATTEMPTS; i++) script.push({ status: 503 })
            }
            exhaust()
            script.push({ status: 404 })
            exhaust()
            const budget = new RequestBudget({ maxConsecutiveFailures: 2 })
            for (const url of ['https://x/a', 'https://x/b', 'https://x/c']) {
                await requestWithRetry({ url }, { sleep: noSleep, budget })
            }
            expect(budget.exhaustedReason).toBeNull()
        })

        test('a Retry-After beyond the backoff cap stops the operation at once', async () => {
            script.push({ status: 429, headers: { 'Retry-After': '120' } })
            const budget = new RequestBudget()
            const response = await requestWithRetry(
                { url: 'https://x/a' },
                { sleep: noSleep, budget }
            )
            expect(response.status).toBe(429)
            expect(recordedRequests.length).toBe(1)
            expect(budget.exhaustedReason).toContain('120 s')
        })

        test('a Retry-After of exactly the cap is waited out, not a stop', async () => {
            script.push({ status: 429, headers: { 'Retry-After': '30' } }, { status: 200 })
            const waits: number[] = []
            const budget = new RequestBudget()
            const response = await requestWithRetry(
                { url: 'https://x/a' },
                {
                    sleep: async (ms: number) => {
                        waits.push(ms)
                    },
                    budget
                }
            )
            expect(response.status).toBe(200)
            expect(waits).toEqual([30_000])
            expect(budget.exhaustedReason).toBeNull()
        })

        test('an HTTP-date Retry-After beyond the cap stops the operation', async () => {
            const later = new Date(Date.now() + 120_000).toUTCString()
            script.push({ status: 429, headers: { 'Retry-After': later } })
            const budget = new RequestBudget()
            await requestWithRetry({ url: 'https://x/a' }, { sleep: noSleep, budget })
            expect(recordedRequests.length).toBe(1)
            expect(budget.exhaustedReason).toContain('asked to wait')
        })

        test('stopping the budget cuts a real backoff wait short', async () => {
            const hadWindow = 'window' in globalThis
            if (!hadWindow)
                Object.defineProperty(globalThis, 'window', {
                    value: globalThis,
                    configurable: true
                })
            try {
                script.push({ status: 503, headers: { 'Retry-After': '20' } })
                const budget = new RequestBudget()
                const started = Date.now()
                const pending = requestWithRetry({ url: 'https://x/a' }, { budget }).catch(
                    (e: unknown) => e
                )
                setTimeout(() => budget.stop('another worker gave up'), 20)
                const error = await pending
                expect(error).toBeInstanceOf(RequestBudgetExhaustedError)
                expect(Date.now() - started).toBeLessThan(2000)
                expect(recordedRequests.length).toBe(1)
            } finally {
                if (!hadWindow) Reflect.deleteProperty(globalThis, 'window')
            }
        })

        test('a parent signal already aborted stops the budget before any request', async () => {
            const controller = new AbortController()
            controller.abort()
            const budget = new RequestBudget({ signal: controller.signal })
            const error = await requestWithRetry(
                { url: 'https://x/a' },
                { sleep: noSleep, budget }
            ).catch((e: unknown) => e)
            expect((error as Error).message).toContain('unloaded')
            expect(recordedRequests.length).toBe(0)
        })

        test('a budget without a deadline never times out', () => {
            let now = 0
            const budget = new RequestBudget({ deadlineMs: null, now: () => now })
            now = 1e12
            expect(budget.exhaustedReason).toBeNull()
        })

        test('fetchBlob stops requesting once the budget is spent', async () => {
            script.push({ status: 429, headers: { 'Retry-After': '120' } })
            const budget = new RequestBudget()
            expect(await fetchBlob('t', 'h1', 'a.metadata', 'https://s', budget)).toBeNull()
            expect(await fetchBlob('t', 'h2', 'b.metadata', 'https://s', budget)).toBeNull()
            expect(recordedRequests.length).toBe(1)
        })

        test('the deadline stops further attempts', async () => {
            let now = 0
            const budget = new RequestBudget({ deadlineMs: 1000, now: () => now })
            script.push({ status: 503 })
            const error = await requestWithRetry(
                { url: 'https://x/a' },
                {
                    sleep: async () => {
                        now = 1000
                    },
                    budget
                }
            ).catch((e: unknown) => e)
            expect(error).toBeInstanceOf(RequestBudgetExhaustedError)
            expect(recordedRequests.length).toBe(1)
        })

        test('an aborted signal stops retrying between attempts', async () => {
            const controller = new AbortController()
            const budget = new RequestBudget({ signal: controller.signal })
            script.push({ status: 503 })
            const error = await requestWithRetry(
                { url: 'https://x/a' },
                {
                    sleep: async () => {
                        controller.abort()
                    },
                    budget
                }
            ).catch((e: unknown) => e)
            expect(error).toBeInstanceOf(RequestBudgetExhaustedError)
            expect((error as Error).message).toContain('unloaded')
            expect(recordedRequests.length).toBe(1)
        })
    })

    describe('parseIndex', () => {
        test('parses entries with header lines', () => {
            const index = '3\n2\nabc123:80000000:folder-id-1:0:0\ndef456:0:doc-id-1:0:512\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[0]!.subfiles).toBe(0)
            expect(entries[0]!.size).toBe(0)
            expect(entries[1]!.hash).toBe('def456')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
            expect(entries[1]!.size).toBe(512)
        })

        test('parses legacy format without header lines', () => {
            const index = 'abc123:80000000:folder-id-1\ndef456:0:doc-id-1\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(2)
            expect(entries[0]!.hash).toBe('abc123')
            expect(entries[0]!.type).toBe('80000000')
            expect(entries[0]!.id).toBe('folder-id-1')
            expect(entries[1]!.type).toBe('0')
            expect(entries[1]!.id).toBe('doc-id-1')
        })

        test('handles empty input', () => {
            const entries = parseIndex('')
            expect(entries.length).toBe(0)
        })

        test('skips malformed lines', () => {
            const index = '3\n3\nabc123:80000000:folder-id:0:0\nbadline\nghi789:0:doc-id:0:0\n'
            const entries = parseIndex(index)
            expect(entries.length).toBe(2)
        })

        test('reports the lines it rejected', () => {
            const index = '3\n3\nabc123:80000000:folder-id:0:0\nbadline\n::x\nghi789:0:doc-id:0:0\n'
            const { entries, rejected } = parseIndexDetailed(index)
            expect(entries.length).toBe(2)
            expect(rejected).toBe(2)
            expect(parseIndexDetailed('3\nabc:0:doc:0:0\n').rejected).toBe(0)
        })

        test('parses document index entries with file paths', () => {
            const index =
                '3\n3\nabc:0:docid.metadata:0:100\ndef:0:docid.content:0:200\nghi:0:docid/page1.rm:0:500\n'
            const entries = parseIndex(index)

            expect(entries.length).toBe(3)
            expect(entries[0]!.id).toBe('docid.metadata')
            expect(entries[1]!.id).toBe('docid.content')
            expect(entries[2]!.id).toBe('docid/page1.rm')
        })
    })
})
