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
export function retryDelayMs(attempt: number, retryAfter?: string, now: number = Date.now()): number {
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

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
    if (!headers) return undefined
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
    return key === undefined ? undefined : headers[key]
}

const defaultSleep = (ms: number): Promise<void> =>
    ms <= 0 ? Promise.resolve() : new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * `requestUrl` that retries transient failures (429, 5xx, network errors).
 *
 * Returns the final response whatever its status, so callers still decide what
 * a 401 or 404 means; throws only when the last attempt failed at the network
 * level. Before this, a 429 during a listing became `null`, the entry was
 * silently dropped, and the notebook looked deleted (issue #28).
 */
export async function requestWithRetry(
    params: RequestUrlParam,
    sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<RequestUrlResponse> {
    for (let attempt = 1; ; attempt++) {
        const isLast = attempt >= MAX_REQUEST_ATTEMPTS
        let response: RequestUrlResponse
        try {
            response = await requestUrl({ ...params, throw: false })
        } catch (error: unknown) {
            if (isLast) throw error
            const delay = retryDelayMs(attempt)
            log(`Request to ${params.url} failed, retrying in ${delay} ms`, 'debug', error)
            await sleep(delay)
            continue
        }

        if (isLast || !isRetryableStatus(response.status)) {
            return response
        }
        const delay = retryDelayMs(attempt, headerValue(response.headers, 'retry-after'))
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
    syncBaseUrl: string
): Promise<string | null> {
    try {
        const response = await requestWithRetry({
            url: `${syncBaseUrl}/sync/v3/root`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${userToken}`
            }
        })

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
    syncBaseUrl: string
): Promise<ArrayBuffer | null> {
    try {
        const response = await requestWithRetry({
            url: `${syncBaseUrl}/sync/v3/files/${hash}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${userToken}`,
                'rm-filename': rmFilename
            }
        })

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
 * Format with header:
 *   {schemaVersion}
 *   {numEntries}
 *   hash:type:id:subfiles:size
 *   ...
 * Also handles legacy format without header lines.
 */
export function parseIndex(content: string): IndexEntry[] {
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    const entries: IndexEntry[] = []

    let startLine = 0

    // Skip header lines (schema version and entry count are single numbers)
    if (lines.length > 0 && /^\d+$/.test(lines[0]!.trim())) {
        startLine = 1
        if (lines.length > 1 && /^\d+$/.test(lines[1]!.trim())) {
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
            }
        }
    }

    return entries
}
