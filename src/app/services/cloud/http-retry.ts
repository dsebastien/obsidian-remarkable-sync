import { log } from '../../../utils/log'

/**
 * The shape of an HTTP response the retry loop needs: Obsidian's
 * `RequestUrlResponse` satisfies it, and so does a test stub.
 */
export interface RetryableResponse {
    readonly status: number
    readonly headers: Record<string, string>
}

export interface RetryOptions {
    /** Total attempts, including the first. */
    readonly maxAttempts: number
    /** Delay before the first retry when the server sends no `Retry-After`. */
    readonly baseDelayMs: number
    /** Ceiling on the computed backoff. */
    readonly maxDelayMs: number
    /** Ceiling on an honoured `Retry-After`; anything longer is not worth blocking a sync on. */
    readonly maxRetryAfterMs: number
    readonly sleep: (ms: number) => Promise<void>
    readonly now: () => number
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    maxRetryAfterMs: 30_000,
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    now: () => Date.now()
}

/**
 * A sync request that did not succeed, after retries where they applied.
 *
 * `retryable` says whether the failure was transient (rate limit, server
 * error, network) and simply outlived the retry budget, or terminal (a 4xx the
 * server will keep returning). `status` is absent for network-level failures.
 */
export class SyncRequestError extends Error {
    readonly status: number | undefined
    readonly retryable: boolean
    readonly attempts: number

    constructor(
        message: string,
        details: { status?: number; retryable: boolean; attempts: number; cause?: unknown }
    ) {
        super(message, details.cause === undefined ? undefined : { cause: details.cause })
        this.name = 'SyncRequestError'
        this.status = details.status
        this.retryable = details.retryable
        this.attempts = details.attempts
    }
}

/** 429 and every 5xx are worth another attempt; every other non-200 is not. */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599)
}

/**
 * Parse a `Retry-After` header into a delay in milliseconds.
 *
 * Accepts the delay-seconds form and the HTTP-date form. Returns `undefined`
 * for a missing or unparseable value so the caller falls back to backoff. A
 * date in the past yields 0, not a negative delay.
 */
export function parseRetryAfterMs(value: string | undefined, now: number): number | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (/^\d+$/.test(trimmed)) {
        return Number.parseInt(trimmed, 10) * 1000
    }
    // An HTTP-date always spells out a month and a weekday; without a letter
    // the value is a malformed number, which Date.parse would happily read as
    // a year.
    if (!/[A-Za-z]/.test(trimmed)) return undefined
    const at = Date.parse(trimmed)
    if (Number.isNaN(at)) return undefined
    return Math.max(0, at - now)
}

/** Exponential backoff for retry number `retry` (1-based), capped. */
export function backoffDelayMs(retry: number, options: RetryOptions): number {
    const exponent = Math.max(0, retry - 1)
    return Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** exponent)
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
    const wanted = name.toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === wanted) return value
    }
    return undefined
}

/**
 * Status carried by a thrown error. Obsidian's `requestUrl` throws on a
 * 4xx/5xx unless `throw: false` is passed; we pass it, so this path is only
 * for a stub or an older build that still throws.
 */
function statusOf(error: unknown): number | undefined {
    if (!error || typeof error !== 'object' || !('status' in error)) return undefined
    const status = (error as { status: unknown }).status
    return typeof status === 'number' ? status : undefined
}

/**
 * Send a request and retry it while the failure is transient.
 *
 * `send` must resolve for every HTTP status (call `requestUrl` with
 * `throw: false`) and may reject on network failure. A 200 is returned as-is.
 * A 429 or 5xx waits for `Retry-After` when the server sent one, otherwise a
 * capped exponential backoff, and tries again until the attempt budget is
 * spent. Any other status, and a spent budget, throw a `SyncRequestError`
 * that says which of the two happened.
 *
 * `label` names the request in logs and in the error message.
 */
export async function requestWithRetry<T extends RetryableResponse>(
    label: string,
    send: () => Promise<T>,
    options: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
    let attempt = 0
    for (;;) {
        attempt++
        let status: number | undefined
        let retryAfterMs: number | undefined
        let cause: unknown

        try {
            const response = await send()
            if (response.status === 200) {
                return response
            }
            status = response.status
            retryAfterMs = parseRetryAfterMs(
                headerValue(response.headers, 'retry-after'),
                options.now()
            )
        } catch (error) {
            cause = error
            status = statusOf(error)
        }

        const retryable = status === undefined || isRetryableStatus(status)
        const describeStatus = status === undefined ? 'network error' : `HTTP ${status}`

        if (!retryable) {
            throw new SyncRequestError(`${label}: ${describeStatus}`, {
                status,
                retryable: false,
                attempts: attempt,
                cause
            })
        }
        if (attempt >= options.maxAttempts) {
            throw new SyncRequestError(`${label}: ${describeStatus} after ${attempt} attempts`, {
                status,
                retryable: true,
                attempts: attempt,
                cause
            })
        }

        const delayMs =
            retryAfterMs === undefined
                ? backoffDelayMs(attempt, options)
                : Math.min(retryAfterMs, options.maxRetryAfterMs)
        log(
            `${label}: ${describeStatus}, retrying in ${delayMs} ms (attempt ${attempt} of ${options.maxAttempts})`,
            'debug'
        )
        await options.sleep(delayMs)
    }
}
