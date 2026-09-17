import { log } from '../../../utils/log'
import { mapWithConcurrency } from '../../../utils/concurrency'
import type { NotebookSummary } from '../../domain/notebook'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'
import type { RemarkableSyncPlugin } from '../../plugin'
import { SyncRequestError } from './http-retry'
import {
    docIndexFilename,
    fetchBlob,
    fetchRootHash,
    parseIndex,
    ROOT_INDEX_FILENAME
} from './sync-protocol'
import { resolveCloudUrls } from './cloud-urls'

/**
 * How many sync requests a listing or a download keeps in flight at once.
 *
 * A listing costs two sequential requests per entry (index blob, then
 * metadata blob), so an account with 500 items is 1,000 requests. Mapping the
 * whole array into `Promise.allSettled` fired them all at once, on every
 * automatic sync tick and every panel refresh, which is how the cloud starts
 * answering 429. Issue #28.
 */
export const CLOUD_REQUEST_CONCURRENCY = 6

/**
 * A cloud operation that could not be completed correctly.
 *
 * Thrown rather than returned as a shorter list: a partial listing looks
 * exactly like a smaller account, and the callers act on that — they prune
 * sync state for every notebook not in the list, and they file notebooks
 * under the folder path the listing gave them.
 */
export class RemarkableCloudError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'RemarkableCloudError'
    }
}

/**
 * The two sync requests the service is built on. Injected so the listing and
 * download logic can be tested against scripted responses without going
 * through `requestUrl`.
 */
export interface CloudTransport {
    fetchRootHash(userToken: string, syncBaseUrl: string): Promise<string>
    fetchBlob(
        userToken: string,
        hash: string,
        rmFilename: string,
        syncBaseUrl: string
    ): Promise<ArrayBuffer>
}

const defaultTransport: CloudTransport = {
    fetchRootHash: (userToken, syncBaseUrl) => fetchRootHash(userToken, syncBaseUrl),
    fetchBlob: (userToken, hash, rmFilename, syncBaseUrl) =>
        fetchBlob(userToken, hash, rmFilename, syncBaseUrl)
}

export interface RemarkableCloudService {
    /**
     * List every document in the account, with its folder path resolved.
     *
     * Either returns the complete listing or throws a `RemarkableCloudError`.
     * It never returns a subset: an entry whose metadata could not be fetched,
     * or a notebook whose parent chain names a folder the root index does not
     * hold, aborts the whole listing. Entries whose metadata is genuinely
     * absent or unparseable are skipped with a warning, since a retry cannot
     * change what the index holds.
     */
    listDocuments(): Promise<NotebookSummary[]>
    /**
     * Download every file of a document. Returns null when any file could not
     * be fetched, so a document is never handed on with pages missing.
     */
    downloadDocument(documentId: string): Promise<Map<string, ArrayBuffer> | null>
}

interface CachedMetadata {
    readonly hash: string
    readonly metadata: RemarkableDocumentMetadata
}

interface EntryMetadata {
    readonly id: string
    readonly hash: string
    readonly metadata: RemarkableDocumentMetadata
}

export interface FolderInfo {
    readonly name: string
    readonly parent: string
}

/** Sentinel parent id the device uses for the trash. */
const TRASH_PARENT = 'trash'

type FolderPathResolution =
    | { readonly kind: 'resolved'; readonly path: string }
    | { readonly kind: 'trashed' }
    | { readonly kind: 'unresolved'; readonly folderId: string }

/**
 * Walk the parent chain up to the root, or to the trash.
 *
 * A folder id the chain cannot resolve is reported, never skipped: a
 * truncated path is what decides where the notebook's files are written, so
 * returning the part that resolved files the notebook in the wrong place.
 * Issue #28.
 */
export function resolveFolderPath(
    parentId: string,
    folders: ReadonlyMap<string, FolderInfo>
): FolderPathResolution {
    const parts: string[] = []
    let current = parentId
    const visited = new Set<string>()
    while (current !== '') {
        if (current === TRASH_PARENT) {
            return { kind: 'trashed' }
        }
        if (visited.has(current)) {
            // A cycle cannot be written by the device; treat it as the chain
            // ending here rather than looping forever.
            break
        }
        visited.add(current)
        const folder = folders.get(current)
        if (!folder) {
            return { kind: 'unresolved', folderId: current }
        }
        parts.unshift(folder.name)
        current = folder.parent
    }
    return { kind: 'resolved', path: parts.join('/') }
}

export function createRemarkableCloudService(
    plugin: RemarkableSyncPlugin,
    transport: CloudTransport = defaultTransport
): RemarkableCloudService {
    // Cache: document/folder ID -> index hash (populated during listDocuments)
    let entryHashMap = new Map<string, string>()

    // Cache: entry ID -> parsed metadata, keyed by the index hash it was read
    // from. The root index already carries the hash of every entry, so an
    // entry whose hash has not moved needs no request at all. On the interval
    // sync, where almost nothing changes between ticks, this takes the
    // steady-state listing from two requests per entry to one for the root.
    let metadataCache = new Map<string, CachedMetadata>()

    /**
     * Fetch metadata for a single entry (document or folder) by downloading
     * its index blob, finding the .metadata file hash, and parsing it.
     *
     * Returns null only when the metadata is genuinely absent or unreadable:
     * the index holds no `.metadata` file, or the file is not JSON. A blob
     * that cannot be fetched throws (`SyncRequestError`), and the caller must
     * not confuse the two.
     */
    async function fetchEntryMetadata(
        userToken: string,
        indexHash: string,
        entryId: string,
        syncBaseUrl: string
    ): Promise<RemarkableDocumentMetadata | null> {
        const indexBlob = await transport.fetchBlob(
            userToken,
            indexHash,
            docIndexFilename(entryId),
            syncBaseUrl
        )

        const indexContent = new TextDecoder().decode(indexBlob)
        const fileEntries = parseIndex(indexContent)

        const metadataEntry = fileEntries.find((e) => e.id.endsWith('.metadata'))
        if (!metadataEntry) {
            log(`Entry ${entryId} has no .metadata file; skipping it`, 'warn')
            return null
        }

        const metadataBlob = await transport.fetchBlob(
            userToken,
            metadataEntry.hash,
            metadataEntry.id,
            syncBaseUrl
        )

        try {
            const text = new TextDecoder().decode(metadataBlob)
            return JSON.parse(text) as RemarkableDocumentMetadata
        } catch {
            log(`Metadata of ${entryId} is not valid JSON; skipping it`, 'warn')
            return null
        }
    }

    /**
     * Resolve the root hash, refreshing the user token once on a 401. Any
     * other failure propagates as-is.
     */
    async function getRootHash(
        syncBaseUrl: string
    ): Promise<{ rootHash: string; userToken: string }> {
        let userToken = await plugin.authService.getUserToken()
        if (!userToken) {
            throw new RemarkableCloudError('Not authenticated')
        }

        try {
            const rootHash = await transport.fetchRootHash(userToken, syncBaseUrl)
            return { rootHash, userToken }
        } catch (error) {
            if (!(error instanceof SyncRequestError) || error.status !== 401) {
                throw error
            }
            log('Token rejected, refreshing...', 'debug')
            userToken = await plugin.authService.refreshAndGetUserToken()
            if (!userToken) {
                throw new RemarkableCloudError('Token refresh failed')
            }
            const rootHash = await transport.fetchRootHash(userToken, syncBaseUrl)
            return { rootHash, userToken }
        }
    }

    async function listDocuments(): Promise<NotebookSummary[]> {
        try {
            return await listDocumentsOrThrow()
        } catch (error) {
            if (error instanceof RemarkableCloudError) {
                throw error
            }
            const reason = error instanceof Error ? error.message : String(error)
            throw new RemarkableCloudError(`Could not list reMarkable documents: ${reason}`, {
                cause: error
            })
        }
    }

    async function listDocumentsOrThrow(): Promise<NotebookSummary[]> {
        const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

        // Step 1: Get root hash (with token refresh on 401)
        const { rootHash, userToken } = await getRootHash(syncBaseUrl)

        // Step 2: Download and parse root index
        const rootBlob = await transport.fetchBlob(
            userToken,
            rootHash,
            ROOT_INDEX_FILENAME,
            syncBaseUrl
        )
        const rootContent = new TextDecoder().decode(rootBlob)
        const rootEntries = parseIndex(rootContent)

        // Cache entry hashes for later download
        entryHashMap = new Map()
        for (const entry of rootEntries) {
            entryHashMap.set(entry.id, entry.hash)
        }

        // Step 3: Fetch metadata for every entry whose hash moved, a bounded
        // number at a time. The first failed request aborts the listing.
        let cacheHits = 0
        const fetched = await mapWithConcurrency(
            rootEntries,
            CLOUD_REQUEST_CONCURRENCY,
            async (entry): Promise<EntryMetadata | null> => {
                const cached = metadataCache.get(entry.id)
                if (cached && cached.hash === entry.hash) {
                    cacheHits++
                    return { id: entry.id, hash: entry.hash, metadata: cached.metadata }
                }
                const metadata = await fetchEntryMetadata(
                    userToken,
                    entry.hash,
                    entry.id,
                    syncBaseUrl
                )
                return metadata ? { id: entry.id, hash: entry.hash, metadata } : null
            }
        )
        const entries = fetched.filter((e): e is EntryMetadata => e !== null)

        // Replace the cache with what the root index holds now, so entries
        // deleted from the account do not accumulate.
        metadataCache = new Map(entries.map((e) => [e.id, { hash: e.hash, metadata: e.metadata }]))

        // Step 4: Build the folder map. Deleted folders keep their name on
        // purpose: a document that still points at one resolves to its real
        // path instead of a truncated one.
        const folders = new Map<string, FolderInfo>()
        for (const { id, metadata } of entries) {
            if (metadata.type === 'CollectionType') {
                folders.set(id, { name: metadata.visibleName, parent: metadata.parent })
            }
        }

        // Step 5: Collect documents
        const notebooks: NotebookSummary[] = []
        for (const { id, metadata } of entries) {
            if (metadata.deleted) continue
            if (metadata.type !== 'DocumentType') continue

            const resolution = resolveFolderPath(metadata.parent, folders)
            if (resolution.kind === 'trashed') continue
            if (resolution.kind === 'unresolved') {
                throw new RemarkableCloudError(
                    `Could not list reMarkable documents: "${metadata.visibleName}" (${id}) ` +
                        `is filed under folder ${resolution.folderId}, which the root index does not hold`
                )
            }

            notebooks.push({
                id,
                visibleName: metadata.visibleName,
                parent: metadata.parent,
                lastModified: metadata.lastModified,
                pageCount: 0,
                folderPath: resolution.path
            })
        }

        log(`Listed ${notebooks.length} documents`, 'debug', {
            entries: rootEntries.length,
            metadataFromCache: cacheHits
        })
        return notebooks
    }

    async function downloadDocument(documentId: string): Promise<Map<string, ArrayBuffer> | null> {
        try {
            const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

            // Look up document's index hash (fetch root if not cached)
            let indexHash = entryHashMap.get(documentId)
            let userToken: string | null = null
            if (!indexHash) {
                const result = await getRootHash(syncBaseUrl)
                userToken = result.userToken

                const rootBlob = await transport.fetchBlob(
                    userToken,
                    result.rootHash,
                    ROOT_INDEX_FILENAME,
                    syncBaseUrl
                )
                const rootContent = new TextDecoder().decode(rootBlob)
                const rootEntries = parseIndex(rootContent)
                for (const entry of rootEntries) {
                    entryHashMap.set(entry.id, entry.hash)
                }

                indexHash = entryHashMap.get(documentId)
                if (!indexHash) {
                    log(`Document ${documentId} not found in root index`, 'error')
                    return null
                }
            } else {
                userToken = await plugin.authService.getUserToken()
                if (!userToken) {
                    log('Not authenticated', 'error')
                    return null
                }
            }

            // Download document index
            const indexBlob = await transport.fetchBlob(
                userToken,
                indexHash,
                docIndexFilename(documentId),
                syncBaseUrl
            )
            const indexContent = new TextDecoder().decode(indexBlob)
            const fileEntries = parseIndex(indexContent)

            if (fileEntries.length === 0) {
                log(`Document ${documentId} has an empty index`, 'error')
                return null
            }

            // Download every file, a bounded number at a time. A file that
            // cannot be fetched fails the document: the index named it, so a
            // document without it would be handed on with pages missing.
            const token = userToken
            const downloaded = await mapWithConcurrency(
                fileEntries,
                CLOUD_REQUEST_CONCURRENCY,
                async (entry) => {
                    const data = await transport.fetchBlob(token, entry.hash, entry.id, syncBaseUrl)
                    return { path: entry.id, data }
                }
            )

            const files = new Map<string, ArrayBuffer>()
            for (const { path, data } of downloaded) {
                files.set(path, data)
            }

            log(`Downloaded ${files.size} files for document ${documentId}`, 'debug')
            return files
        } catch (error) {
            log(`Failed to download document ${documentId}`, 'error', error)
            return null
        }
    }

    return {
        listDocuments,
        downloadDocument
    }
}
