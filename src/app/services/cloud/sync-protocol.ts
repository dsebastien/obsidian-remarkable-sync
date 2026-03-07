import { requestUrl } from 'obsidian'
import { log } from '../../../utils/log'

const SYNC_BASE_URL = 'https://internal.cloud.remarkable.com'

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

/**
 * Fetch the root index hash from the sync service.
 * Response is JSON with a `hash` property.
 * Throws with a status property on HTTP errors (e.g. 401).
 */
export async function fetchRootHash(userToken: string): Promise<string | null> {
    try {
        const response = await requestUrl({
            url: `${SYNC_BASE_URL}/sync/v3/root`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${userToken}`
            }
        })

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

/**
 * Fetch a file by its hash directly from the sync service.
 */
export async function fetchBlob(userToken: string, hash: string): Promise<ArrayBuffer | null> {
    try {
        const response = await requestUrl({
            url: `${SYNC_BASE_URL}/sync/v3/files/${hash}`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${userToken}`
            }
        })

        if (response.status !== 200) {
            log(`Failed to fetch blob ${hash}: ${response.status}`, 'error')
            return null
        }

        return response.arrayBuffer
    } catch (error: unknown) {
        const status =
            error && typeof error === 'object' && 'status' in error
                ? (error as { status: number }).status
                : undefined
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
