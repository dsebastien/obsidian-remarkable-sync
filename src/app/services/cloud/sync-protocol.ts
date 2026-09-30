import { requestUrl } from 'obsidian'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { log } from '../../../utils/log'

/**
 * Entry from a parsed index file (root index or document index)
 */
export interface IndexEntry {
    readonly hash: string
    readonly type: string
    readonly id: string
    readonly subfiles: number
    readonly size: number
}

/**
 * Extract HTTP status from an error thrown by Obsidian's requestUrl.
 */
function getHttpStatus(error: unknown): number | undefined {
    return error && typeof error === 'object' && 'status' in error
        ? (error as { status: number }).status
        : undefined
}

/** Attempts per request, the first included. */
export const MAX_REQUEST_ATTEMPTS = 4
const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

/**
 * 429 and 5xx are transient; anything else in the 4xx range is terminal and
 * retrying it only adds load.
 */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Honours `Retry-After` (delta-seconds or an HTTP date) when the server sends
 * one, otherwise capped exponential backoff. Always within [0, MAX_BACKOFF_MS]
 * so a hostile or broken header cannot park a sync for hours.
 */
export function retryDelayMs(
    attempt: number,
    retryAfter?: string,
    now: number = Date.now()
): number {
    const clamp = (ms: number): number => Math.min(MAX_BACKOFF_MS, Math.max(0, Math.round(ms)))
    const value = retryAfter?.trim()
    if (value) {
        if (/^\d+$/.test(value)) {
            return clamp(Number(value) * 1000)
        }
        const date = Date.parse(value)
        if (!Number.isNaN(date)) {
            return clamp(date - now)
        }
    }
    return clamp(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1))
}

function headerValue(
    headers: Record<string, string> | undefined,
    name: string
): string | undefined {
    if (!headers) return undefined
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
    return key === undefined ? undefined : headers[key]
}

/**
 * Requests in a row, across one operation, that failed even after all their
 * retries, after which the operation gives up. Counting individual attempts
 * instead would trip on a handful of transient errors spread over the six
 * parallel workers, each of which would have succeeded on its next try.
 */
export const MAX_CONSECUTIVE_FAILED_REQUESTS = 3

/** Wall-clock limit for one listing. Downloads have none (see `RequestBudget`). */
export const LISTING_DEADLINE_MS = 10 * 60_000

/**
 * Thrown instead of making a request once the operation's budget is spent.
 * `fetchBlob` and `fetchRootHash` turn it into a failed fetch like any other,
 * so the listing ends incomplete (no pruning) and the download fails.
 */
export class RequestBudgetExhaustedError extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'RequestBudgetExhaustedError'
    }
}

/**
 * The failure budget shared by every request of ONE listing or ONE download.
 *
 * Retries per request alone made an outage expensive: with the metadata cache
 * empty (after every reload), each of hundreds of entries spent its full retry
 * schedule, holding the panel spinner and the auto-sync lock for minutes to
 * hours before the listing came back incomplete anyway. The budget stops the
 * whole operation instead, when any of these holds:
 *
 * - `MAX_CONSECUTIVE_FAILED_REQUESTS` requests in a row exhausted their
 *   retries (any request that gets a final answer resets the count);
 * - the server asked for a longer wait (`Retry-After`) than the backoff cap:
 *   waiting less would only hit the limit again;
 * - the deadline passed, when one is set (listings only: a large download that
 *   is still making progress must not be cut off);
 * - the parent signal was aborted (the plugin unloaded).
 *
 * Stopping aborts the budget's own signal, so every other worker's backoff
 * wait ends at once instead of running its course.
 */
export class RequestBudget {
    private consecutiveFailures = 0
    private stopReason: string | null = null
    private readonly deadline: number | null
    private readonly controller = new AbortController()

    constructor(
        private readonly options: {
            /** Aborted when the plugin unloads. */
            readonly signal?: AbortSignal
            /** Null for no deadline. */
            readonly deadlineMs?: number | null
            readonly maxConsecutiveFailures?: number
            readonly now?: () => number
        } = {}
    ) {
        const deadlineMs =
            options.deadlineMs === undefined ? LISTING_DEADLINE_MS : options.deadlineMs
        this.deadline = deadlineMs === null ? null : this.now() + deadlineMs
        const parent = options.signal
        if (parent?.aborted) {
            this.stop(UNLOADED)
        } else if (parent) {
            this.detach = (): void => parent.removeEventListener('abort', onParentAbort)
            const onParentAbort = (): void => this.stop(UNLOADED)
            parent.addEventListener('abort', onParentAbort, { once: true })
        }
    }

    /** Removes the listener on the plugin-lifetime signal. */
    private detach: () => void = () => {}

    /**
     * Call when the operation ends. The unload signal lives as long as the
     * plugin, so a listener per listing or download would otherwise pile up
     * (one per auto-sync tick and per synced notebook).
     */
    dispose(): void {
        this.detach()
        this.detach = (): void => {}
    }

    private now(): number {
        return (this.options.now ?? Date.now)()
    }

    /** Why the operation stopped, or null while it may continue. */
    get exhaustedReason(): string | null {
        if (this.stopReason === null && this.deadline !== null && this.now() >= this.deadline) {
            this.stop('The reMarkable cloud took too long to answer')
        }
        return this.stopReason
    }

    /** Aborted as soon as the budget stops, for whatever reason. */
    get signal(): AbortSignal {
        return this.controller.signal
    }

    /** Throw when no further request may be made. */
    assertAvailable(): void {
        const reason = this.exhaustedReason
        if (reason !== null) {
            throw new RequestBudgetExhaustedError(reason)
        }
    }

    /** A request got a final answer (whatever its status). */
    recordAnswered(): void {
        this.consecutiveFailures = 0
    }

    /** A request failed after exhausting its retries. */
    recordFailedRequest(): void {
        this.consecutiveFailures++
        if (
            this.consecutiveFailures >=
            (this.options.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILED_REQUESTS)
        ) {
            this.stop('The reMarkable cloud keeps failing; try again later')
        }
    }

    stop(reason: string): void {
        if (this.stopReason !== null) return
        this.stopReason = reason
        this.controller.abort()
    }
}

const UNLOADED = 'Stopped: the plugin was unloaded'

/**
 * The wait a `Retry-After` header asks for, in ms, unclamped; null when there
 * is no usable header.
 */
export function requestedRetryAfterMs(
    retryAfter: string | undefined,
    now: number = Date.now()
): number | null {
    const value = retryAfter?.trim()
    if (!value) return null
    if (/^\d+$/.test(value)) return Number(value) * 1000
    const date = Date.parse(value)
    return Number.isNaN(date) ? null : Math.max(0, date - now)
}

/** A timer that an abort signal cuts short. */
export function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0 || signal?.aborted) return Promise.resolve()
    return new Promise((resolve) => {
        const onAbort = (): void => {
            window.clearTimeout(timer)
            resolve()
        }
        const timer = window.setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

export interface RetryOptions {
    /** Injected in tests; defaults to a timer the budget's signal cuts short. */
    readonly sleep?: (ms: number) => Promise<void>
    /** Shared by every request of one operation; a private one when omitted. */
    readonly budget?: RequestBudget
}

/**
 * `requestUrl` that retries transient failures (429, 5xx, network errors).
 *
 * Returns the final response whatever its status, so callers still decide what
 * a 401 or 404 means; throws when the last attempt failed at the network level
 * and, with a `RequestBudgetExhaustedError`, when the operation's budget is
 * spent (checked before every attempt). Before this, a 429 during a listing
 * became `null`, the entry was silently dropped, and the notebook looked
 * deleted (issue #28).
 */
export async function requestWithRetry(
    params: RequestUrlParam,
    options: RetryOptions = {}
): Promise<RequestUrlResponse> {
    const budget = options.budget ?? new RequestBudget()
    const sleep =
        options.sleep ?? ((ms: number): Promise<void> => sleepUnlessAborted(ms, budget.signal))
    for (let attempt = 1; ; attempt++) {
        budget.assertAvailable()
        const isLast = attempt >= MAX_REQUEST_ATTEMPTS
        let response: RequestUrlResponse
        try {
            response = await requestUrl({ ...params, throw: false })
        } catch (error: unknown) {
            if (isLast) {
                budget.recordFailedRequest()
                throw error
            }
            const delay = retryDelayMs(attempt)
            log(`Request to ${params.url} failed, retrying in ${delay} ms`, 'debug', error)
            await sleep(delay)
            continue
        }

        if (!isRetryableStatus(response.status)) {
            budget.recordAnswered()
            return response
        }
        const retryAfter = headerValue(response.headers, 'retry-after')
        const requested = requestedRetryAfterMs(retryAfter)
        if (requested !== null && requested > MAX_BACKOFF_MS) {
            // Retrying sooner than asked only hits the limit again.
            budget.stop(
                `The reMarkable cloud asked to wait ${Math.ceil(requested / 1000)} s; try again later`
            )
            return response
        }
        if (isLast) {
            budget.recordFailedRequest()
            return response
        }
        const delay = retryDelayMs(attempt, retryAfter)
        log(`HTTP ${response.status} from ${params.url}, retrying in ${delay} ms`, 'debug')
        await sleep(delay)
    }
}

/**
 * Fetch the root index hash from the sync service.
 * Response is JSON with a `hash` property.
 * Throws with a status property on HTTP errors (e.g. 401).
 */
export async function fetchRootHash(
    userToken: string,
    syncBaseUrl: string,
    budget?: RequestBudget
): Promise<string | null> {
    try {
        const response = await requestWithRetry(
            {
                url: `${syncBaseUrl}/sync/v3/root`,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${userToken}`
                }
            },
            { budget }
        )

        if (response.status === 401) {
            // The caller refreshes the token on a throw carrying the status.
            throw Object.assign(new Error('HTTP 401'), { status: 401 })
        }
        if (response.status !== 200) {
            log(`Failed to fetch root hash: ${response.status}`, 'error')
            return null
        }

        const data = response.json as { hash?: string }
        const hash = data.hash?.trim()
        if (!hash) {
            log('Empty root hash response', 'error')
            return null
        }

        return hash
    } catch (error: unknown) {
        const status = getHttpStatus(error)
        if (status === 401) {
            throw error
        }
        if (status) {
            log(`Failed to fetch root hash: HTTP ${status}`, 'error')
        } else {
            log('Failed to fetch root hash', 'error', error)
        }
        return null
    }
}

// Sync v3 `/files/{hash}` requires an `rm-filename` header whose value matches
// the blob's logical name; missing or wrong values return HTTP 400
// ({"message":"unexpected 'rm-filename' http header"}). Index blobs use the
// ".docSchema" extension; content blobs use their real filename from the index.
export const ROOT_INDEX_FILENAME = 'root.docSchema'
export function docIndexFilename(docId: string): string {
    return `${docId}.docSchema`
}

/**
 * Fetch a file by its hash directly from the sync service.
 *
 * `rmFilename` is the blob's logical name (e.g. `root.docSchema`,
 * `<uuid>.docSchema`, `<uuid>.metadata`). The server validates it and
 * returns HTTP 400 if missing or wrong.
 */
export async function fetchBlob(
    userToken: string,
    hash: string,
    rmFilename: string,
    syncBaseUrl: string,
    budget?: RequestBudget
): Promise<ArrayBuffer | null> {
    try {
        const response = await requestWithRetry(
            {
                url: `${syncBaseUrl}/sync/v3/files/${hash}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'rm-filename': rmFilename
                }
            },
            { budget }
        )

        if (response.status !== 200) {
            log(`Failed to fetch blob ${hash}: ${response.status}`, 'error')
            return null
        }

        return response.arrayBuffer
    } catch (error: unknown) {
        const status = getHttpStatus(error)
        if (status) {
            log(`Failed to fetch blob ${hash}: HTTP ${status}`, 'error')
        } else {
            log(`Failed to fetch blob ${hash}`, 'error', error)
        }
        return null
    }
}

/**
 * Parse an index file (root index or document index).
 * Schema 3:
 *   3
 *   {numEntries}
 *   hash:type:id:subfiles:size
 *   ...
 * Schema 4 replaces the count with an info line naming no file; its name is
 * `.` in the root index and the document id in a document index:
 *   4
 *   0:{. or docId}:{numEntries}:{totalSize}
 *   hash:type:id:subfiles:size
 *   ...
 * Also handles legacy format without header lines.
 */
// Schema 4's second header line: `0:{. or docId}:{numEntries}:{totalSize}`.
// Four fields, where an entry line has five and a 64-hex hash.
const INDEX_INFO_LINE = /^0:[^:]+:\d+:\d+$/

export function parseIndex(content: string): IndexEntry[] {
    return parseIndexDetailed(content).entries
}

/**
 * `parseIndex`, also counting the lines it could not read.
 *
 * A listing built from a root index with rejected lines is missing entries it
 * cannot name, so it must not count as complete: pruning would read those
 * notebooks as deleted.
 */
export function parseIndexDetailed(content: string): { entries: IndexEntry[]; rejected: number } {
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    const entries: IndexEntry[] = []
    let rejected = 0

    let startLine = 0

    // Skip header lines: the schema version, then the entry count (schema 3)
    // or the `0:name:count:size` info line (schema 4). Read as an entry, the
    // info line is a file named by its count with hash `0`, which the cloud
    // refuses: every listing came out incomplete and every download failed.
    if (lines.length > 0 && /^\d+$/.test(lines[0]!.trim())) {
        startLine = 1
        const second = lines[1]?.trim()
        if (second !== undefined && (/^\d+$/.test(second) || INDEX_INFO_LINE.test(second))) {
            startLine = 2
        }
    }

    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue

        const parts = line.split(':')
        if (parts.length >= 3) {
            const hash = parts[0]?.trim()
            const type = parts[1]?.trim()
            const id = parts[2]?.trim()
            if (hash && type !== undefined && id) {
                entries.push({
                    hash,
                    type,
                    id,
                    subfiles: parseInt(parts[3]?.trim() ?? '0', 10) || 0,
                    size: parseInt(parts[4]?.trim() ?? '0', 10) || 0
                })
                continue
            }
        }
        rejected++
    }

    return { entries, rejected }
}
