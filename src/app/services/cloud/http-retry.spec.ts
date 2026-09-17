import { describe, expect, test } from 'bun:test'
import {
    backoffDelayMs,
    DEFAULT_RETRY_OPTIONS,
    isRetryableStatus,
    parseRetryAfterMs,
    requestWithRetry,
    SyncRequestError,
    type RetryOptions
} from './http-retry'

/** Await a promise that must reject, and hand back what it rejected with. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
    try {
        await run
    } catch (error) {
        return error
    }
    throw new Error('expected the promise to reject')
}

function testOptions(overrides: Partial<RetryOptions> = {}): RetryOptions & { slept: number[] } {
    const slept: number[] = []
    return {
        ...DEFAULT_RETRY_OPTIONS,
        sleep: async (ms) => {
            slept.push(ms)
        },
        now: () => 1_000_000,
        ...overrides,
        slept
    }
}

function response(status: number, headers: Record<string, string> = {}) {
    return { status, headers, arrayBuffer: new ArrayBuffer(0) }
}

/** A `send` that walks through the given outcomes in order. */
function script(
    outcomes: ReadonlyArray<ReturnType<typeof response> | Error>
): () => Promise<ReturnType<typeof response>> {
    let i = 0
    return async () => {
        const outcome = outcomes[Math.min(i++, outcomes.length - 1)]!
        if (outcome instanceof Error) throw outcome
        return outcome
    }
}

describe('isRetryableStatus', () => {
    test('429 and 5xx retry, other statuses do not', () => {
        expect(isRetryableStatus(429)).toBe(true)
        expect(isRetryableStatus(500)).toBe(true)
        expect(isRetryableStatus(503)).toBe(true)
        expect(isRetryableStatus(599)).toBe(true)
        expect(isRetryableStatus(400)).toBe(false)
        expect(isRetryableStatus(401)).toBe(false)
        expect(isRetryableStatus(404)).toBe(false)
        expect(isRetryableStatus(200)).toBe(false)
    })
})

describe('parseRetryAfterMs', () => {
    test('reads delay-seconds', () => {
        expect(parseRetryAfterMs('3', 0)).toBe(3000)
        expect(parseRetryAfterMs(' 10 ', 0)).toBe(10_000)
    })

    test('reads an HTTP-date relative to now', () => {
        const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')
        expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:05 GMT', now)).toBe(5000)
    })

    test('a date in the past yields zero, never a negative delay', () => {
        const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT')
        expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:27:00 GMT', now)).toBe(0)
    })

    test('missing, empty or garbage falls back to undefined', () => {
        expect(parseRetryAfterMs(undefined, 0)).toBeUndefined()
        expect(parseRetryAfterMs('', 0)).toBeUndefined()
        expect(parseRetryAfterMs('soon', 0)).toBeUndefined()
        expect(parseRetryAfterMs('-5', 0)).toBeUndefined()
    })
})

describe('backoffDelayMs', () => {
    test('doubles from the base and is capped', () => {
        const options = testOptions({ baseDelayMs: 500, maxDelayMs: 3000 })
        expect(backoffDelayMs(1, options)).toBe(500)
        expect(backoffDelayMs(2, options)).toBe(1000)
        expect(backoffDelayMs(3, options)).toBe(2000)
        expect(backoffDelayMs(4, options)).toBe(3000)
        expect(backoffDelayMs(10, options)).toBe(3000)
    })
})

describe('requestWithRetry', () => {
    test('returns a 200 on the first attempt without sleeping', async () => {
        const options = testOptions()
        const result = await requestWithRetry('blob', script([response(200)]), options)
        expect(result.status).toBe(200)
        expect(options.slept).toEqual([])
    })

    test('retries a 429 with capped exponential backoff, then succeeds', async () => {
        const options = testOptions({ maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 150 })
        const result = await requestWithRetry(
            'blob',
            script([response(429), response(429), response(429), response(200)]),
            options
        )
        expect(result.status).toBe(200)
        expect(options.slept).toEqual([100, 150, 150])
    })

    test('honours Retry-After in seconds over the backoff', async () => {
        const options = testOptions({ baseDelayMs: 100 })
        await requestWithRetry(
            'blob',
            script([response(429, { 'Retry-After': '2' }), response(200)]),
            options
        )
        expect(options.slept).toEqual([2000])
    })

    test('matches the Retry-After header case-insensitively', async () => {
        const options = testOptions({ baseDelayMs: 100 })
        await requestWithRetry(
            'blob',
            script([response(503, { 'retry-after': '1' }), response(200)]),
            options
        )
        expect(options.slept).toEqual([1000])
    })

    test('caps an oversized Retry-After', async () => {
        const options = testOptions({ maxRetryAfterMs: 5000 })
        await requestWithRetry(
            'blob',
            script([response(429, { 'Retry-After': '3600' }), response(200)]),
            options
        )
        expect(options.slept).toEqual([5000])
    })

    test('a spent budget throws a retryable SyncRequestError carrying the last status', async () => {
        const options = testOptions({ maxAttempts: 3 })
        const run = requestWithRetry('blob abc', script([response(429)]), options)
        const failure = (await rejection(run)) as SyncRequestError
        expect(failure).toBeInstanceOf(SyncRequestError)
        expect(failure.status).toBe(429)
        expect(failure.retryable).toBe(true)
        expect(failure.attempts).toBe(3)
        expect(failure.message).toContain('blob abc')
        expect(failure.message).toContain('HTTP 429')
        expect(options.slept.length).toBe(2)
    })

    test('a terminal status throws at once without sleeping', async () => {
        const options = testOptions()
        const run = requestWithRetry('blob', script([response(404), response(200)]), options)
        const failure = (await rejection(run)) as SyncRequestError
        expect(failure).toBeInstanceOf(SyncRequestError)
        expect(failure.status).toBe(404)
        expect(failure.retryable).toBe(false)
        expect(failure.attempts).toBe(1)
        expect(options.slept).toEqual([])
    })

    test('401 is terminal so the caller can refresh the token itself', async () => {
        const options = testOptions()
        const failure = (await rejection(
            requestWithRetry('root', script([response(401)]), options)
        )) as SyncRequestError
        expect(failure.status).toBe(401)
        expect(failure.retryable).toBe(false)
    })

    test('a network error is retried and surfaces without a status', async () => {
        const options = testOptions({ maxAttempts: 2 })
        const offline = new Error('ECONNRESET')
        const failure = (await rejection(
            requestWithRetry('blob', script([offline]), options)
        )) as SyncRequestError
        expect(failure.status).toBeUndefined()
        expect(failure.retryable).toBe(true)
        expect(failure.attempts).toBe(2)
        expect(failure.cause).toBe(offline)
        expect(failure.message).toContain('network error')
        expect(options.slept.length).toBe(1)
    })

    test('a thrown error carrying a status is classified by that status', async () => {
        const options = testOptions()
        const thrown = Object.assign(new Error('Request failed, status 400'), { status: 400 })
        const failure = (await rejection(
            requestWithRetry('blob', script([thrown]), options)
        )) as SyncRequestError
        expect(failure.status).toBe(400)
        expect(failure.retryable).toBe(false)
        expect(options.slept).toEqual([])
    })

    test('recovers from a network error when the retry succeeds', async () => {
        const options = testOptions()
        const result = await requestWithRetry(
            'blob',
            script([new Error('offline'), response(200)]),
            options
        )
        expect(result.status).toBe(200)
        expect(options.slept.length).toBe(1)
    })
})
