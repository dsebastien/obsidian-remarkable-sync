import { requestUrl } from 'obsidian'
import {
    DEFAULT_RETRY_OPTIONS,
    requestWithRetry,
    SyncRequestError,
    type RetryOptions
} from './http-retry'

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
 * Fetch the root index hash from the sync service.
 * Response is JSON with a `hash` property.
 *
 * Rate limits, server errors and network failures are retried (see
 * `requestWithRetry`). Every failure surfaces as a `SyncRequestError`; a 401
 * carries `status === 401` so the caller can refresh the user token once.
 */
export async function fetchRootHash(
    userToken: string,
    syncBaseUrl: string,
    retry: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<string> {
    const response = await requestWithRetry(
        'root hash',
        () =>
            requestUrl({
                url: `${syncBaseUrl}/sync/v3/root`,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${userToken}`
                },
                throw: false
            }),
        retry
    )

    const data = response.json as { hash?: string } | null
    const hash = data?.hash?.trim()
    if (!hash) {
        throw new SyncRequestError('root hash: empty response', {
            retryable: false,
            attempts: 1
        })
    }
    return hash
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
 *
 * Rate limits, server errors and network failures are retried (see
 * `requestWithRetry`). Every failure throws a `SyncRequestError` rather than
 * returning null: the index named this blob, so a blob that cannot be fetched
 * is a failed request, never an absent file, and callers must not treat it
 * as "nothing there".
 */
export async function fetchBlob(
    userToken: string,
    hash: string,
    rmFilename: string,
    syncBaseUrl: string,
    retry: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<ArrayBuffer> {
    const response = await requestWithRetry(
        `blob ${rmFilename}`,
        () =>
            requestUrl({
                url: `${syncBaseUrl}/sync/v3/files/${hash}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'rm-filename': rmFilename
                },
                throw: false
            }),
        retry
    )
    return response.arrayBuffer
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
