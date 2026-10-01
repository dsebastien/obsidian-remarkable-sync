import { mapSettledWithConcurrency } from '../../../utils/concurrency'
import { log } from '../../../utils/log'
import type { DocumentListing, NotebookSummary } from '../../domain/notebook'
import { describeListing, failedListing } from '../../domain/notebook'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'
import { parseCloudTimestamp } from '../../domain/sync-state'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { TokenFailure } from '../auth/remarkable-auth.service'
import {
    docIndexFilename,
    fetchBlob,
    fetchRootHash,
    parseIndex,
    parseIndexDetailed,
    RequestBudget,
    ROOT_INDEX_FILENAME
} from './sync-protocol'
import { resolveCloudUrls } from './cloud-urls'

/**
 * Requests in flight at once during a listing or a download. Each listed entry
 * costs two sequential requests, so this bounds the burst regardless of how
 * many documents the account holds.
 */
export const CLOUD_REQUEST_CONCURRENCY = 6

export const AUTHENTICATION_FAILED =
    'Authentication failed; reconnect to the reMarkable cloud in the settings'

export const SESSION_RENEWAL_FAILED =
    'Could not reach the reMarkable cloud to renew the session; try again later'

/**
 * Only a missing connection or a refused device token needs a reconnect. An
 * unreachable token endpoint (offline, 5xx, 429) passes on its own; asking an
 * offline user to reconnect would have them re-register every day.
 */
export function tokenFailureMessage(failure: TokenFailure): string {
    return failure === 'unreachable' ? SESSION_RENEWAL_FAILED : AUTHENTICATION_FAILED
}

/**
 * Resolve a document's folder path from its parent chain.
 *
 * Returns null when a folder in the chain exists in the cloud index but its
 * metadata could not be read. The path decides where the notebook is written,
 * so a shortened path would put it in the wrong vault folder and a later
 * successful sync would write a second copy elsewhere (issue #28). Only a
 * parent that is genuinely absent (not in the index, or deleted) ends the
 * chain early, which is the pre-existing behaviour for orphaned documents.
 */
export function resolveFolderPath(
    parentId: string,
    folderNames: ReadonlyMap<string, string>,
    folderParents: ReadonlyMap<string, string>,
    unreadableIds: ReadonlySet<string>
): string | null {
    const parts: string[] = []
    let current = parentId
    const visited = new Set<string>()
    while (current && current !== 'trash' && !visited.has(current)) {
        visited.add(current)
        if (unreadableIds.has(current)) {
            return null
        }
        const name = folderNames.get(current)
        if (name === undefined) {
            break
        }
        parts.unshift(name)
        current = folderParents.get(current) ?? ''
    }
    return parts.join('/')
}

/** Why a download failed, in words the user can act on. */
export interface DownloadFailure {
    readonly error: string
}

export interface RemarkableCloudService {
    listDocuments(): Promise<DocumentListing>
    /** Every file of the document, or why not: never a partial set. */
    downloadDocument(documentId: string): Promise<Map<string, ArrayBuffer> | DownloadFailure>
}

/** The network calls the service makes; replaced in tests by an in-memory cloud. */
export interface CloudTransport {
    readonly fetchRootHash: typeof fetchRootHash
    readonly fetchBlob: typeof fetchBlob
}

export type CloudServiceHost = Pick<
    RemarkableSyncPlugin,
    'settings' | 'authService' | 'unloadSignal'
>

export function createRemarkableCloudService(
    plugin: CloudServiceHost,
    transport: CloudTransport = { fetchRootHash, fetchBlob }
): RemarkableCloudService {
    // Cache: document/folder ID -> index hash (populated during listDocuments)
    let entryHashMap = new Map<string, string>()

    // Cache: entry index hash -> parsed metadata. The index hash changes
    // whenever anything in the entry changes, so an unchanged entry is never
    // fetched twice and a steady-state listing costs one request (the root).
    let metadataCache = new Map<string, RemarkableDocumentMetadata>()

    // Cache: entry index hashes whose content can never be read (no .metadata
    // in the index, or metadata that is not JSON). Content is addressed by
    // hash, so the same hash fails the same way every time; refetching it on
    // every listing only spends requests. A failed REQUEST is never cached:
    // it may succeed next time.
    let unreadableHashes = new Set<string>()

    // A notebook whose `lastModified` is not a plain integer counts as synced
    // forever (see `deriveSyncStatus`). Say so once a session, so a format
    // change in the cloud leaves a trace instead of silently stopping syncs.
    let warnedUnreadableTimestamp = false

    /**
     * Fetch metadata for a single entry (document or folder) by downloading
     * its index blob, finding the .metadata file hash, and parsing it.
     *
     * 'unreadable' when the content itself is unusable, which no retry of
     * the same hash can change; null when a request failed.
     */
    async function fetchEntryMetadata(
        userToken: string,
        indexHash: string,
        entryId: string,
        syncBaseUrl: string,
        budget: RequestBudget
    ): Promise<RemarkableDocumentMetadata | 'unreadable' | null> {
        const indexBlob = await transport.fetchBlob(
            userToken,
            indexHash,
            docIndexFilename(entryId),
            syncBaseUrl,
            budget
        )
        if (!indexBlob) return null

        const indexContent = new TextDecoder().decode(indexBlob)
        const fileEntries = parseIndex(indexContent)

        const metadataEntry = fileEntries.find((e) => e.id.endsWith('.metadata'))
        if (!metadataEntry) {
            log(`No metadata in the index of ${entryId}`, 'error')
            return 'unreadable'
        }

        const metadataBlob = await transport.fetchBlob(
            userToken,
            metadataEntry.hash,
            metadataEntry.id,
            syncBaseUrl,
            budget
        )
        if (!metadataBlob) return null

        try {
            const text = new TextDecoder().decode(metadataBlob)
            return JSON.parse(text) as RemarkableDocumentMetadata
        } catch {
            log(`Failed to parse metadata for ${entryId}`, 'error')
            return 'unreadable'
        }
    }

    /**
     * The root hash, refreshing the token once on a 401. On failure, the reason
     * to show: an authentication problem needs a reconnect, not a retry.
     */
    async function getRootHashWithRetry(
        budget: RequestBudget
    ): Promise<{ rootHash: string; userToken: string } | { failure: string }> {
        const { syncBaseUrl } = resolveCloudUrls(plugin.settings)
        const unreachable = { failure: 'Could not reach the reMarkable cloud' }
        const acquired = await plugin.authService.acquireUserToken()
        if ('failure' in acquired) {
            log(`No user token: ${acquired.failure}`, 'error')
            return { failure: tokenFailureMessage(acquired.failure) }
        }
        let userToken = acquired.token

        try {
            const rootHash = await transport.fetchRootHash(userToken, syncBaseUrl, budget)
            return rootHash ? { rootHash, userToken } : unreachable
        } catch {
            // 401 — try refreshing the token once
            log('Token rejected, refreshing...', 'debug')
        }

        const refreshed = await plugin.authService.forceRefreshUserToken()
        if ('failure' in refreshed) {
            log(`Token refresh failed: ${refreshed.failure}`, 'error')
            return { failure: tokenFailureMessage(refreshed.failure) }
        }
        userToken = refreshed.token
        try {
            const rootHash = await transport.fetchRootHash(userToken, syncBaseUrl, budget)
            return rootHash ? { rootHash, userToken } : unreachable
        } catch {
            log('Token rejected after a refresh', 'error')
            return { failure: AUTHENTICATION_FAILED }
        }
    }

    /** Report a total failure, and say so in the log. */
    function listingFailed(message: string): DocumentListing {
        log(`Could not list documents: ${message}`, 'warn')
        return failedListing(message)
    }

    /** One failure budget per listing or download (see `RequestBudget`). */
    function newBudget(kind: 'listing' | 'download'): RequestBudget {
        return new RequestBudget({
            signal: plugin.unloadSignal,
            // A large download still making progress must not be cut off; the
            // failure limit and unload still stop a dead one.
            ...(kind === 'download' ? { deadlineMs: null } : {})
        })
    }

    async function listDocuments(): Promise<DocumentListing> {
        const budget = newBudget('listing')
        try {
            const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

            // Step 1: Get root hash (with token refresh on 401)
            const result = await getRootHashWithRetry(budget)
            if ('failure' in result) {
                return listingFailed(budget.exhaustedReason ?? result.failure)
            }
            const { rootHash, userToken } = result

            // Step 2: Download and parse root index
            const rootBlob = await transport.fetchBlob(
                userToken,
                rootHash,
                ROOT_INDEX_FILENAME,
                syncBaseUrl,
                budget
            )
            if (!rootBlob) {
                return listingFailed(
                    budget.exhaustedReason ?? 'Could not download the reMarkable index'
                )
            }

            const rootContent = new TextDecoder().decode(rootBlob)
            // A line the parser rejects is an entry it cannot name: the listing
            // cannot be complete, or pruning would read it as deleted.
            const { entries: rootEntries, rejected: rejectedRootLines } =
                parseIndexDetailed(rootContent)
            if (rejectedRootLines > 0) {
                log(`${rejectedRootLines} unreadable line(s) in the reMarkable index`, 'warn')
            }

            // Cache entry hashes for later download
            entryHashMap = new Map()
            for (const entry of rootEntries) {
                entryHashMap.set(entry.id, entry.hash)
            }

            // Step 3: Fetch metadata, reusing anything whose hash is unchanged
            const nextCache = new Map<string, RemarkableDocumentMetadata>()
            const nextUnreadable = new Set<string>()
            const metadataResults = await mapSettledWithConcurrency(
                rootEntries,
                CLOUD_REQUEST_CONCURRENCY,
                async (entry) => {
                    if (unreadableHashes.has(entry.hash)) {
                        nextUnreadable.add(entry.hash)
                        return { entry, metadata: null }
                    }
                    const read =
                        metadataCache.get(entry.hash) ??
                        (await fetchEntryMetadata(
                            userToken,
                            entry.hash,
                            entry.id,
                            syncBaseUrl,
                            budget
                        ))
                    if ('unreadable' === read) {
                        nextUnreadable.add(entry.hash)
                        return { entry, metadata: null }
                    }
                    if (read) {
                        nextCache.set(entry.hash, read)
                    }
                    return { entry, metadata: read }
                }
            )
            metadataCache = nextCache
            unreadableHashes = nextUnreadable

            // An entry we could not read is NOT an entry that was deleted, and
            // the difference decides whether pruning is allowed to run.
            const unreadableIds = new Set<string>()
            metadataResults.forEach((result, index) => {
                if ('fulfilled' !== result.status || !result.value.metadata) {
                    unreadableIds.add(rootEntries[index]!.id)
                }
            })

            // Build folder name/parent maps
            const folderNames = new Map<string, string>()
            const folderParents = new Map<string, string>()

            for (const result of metadataResults) {
                if (result.status !== 'fulfilled' || !result.value.metadata) continue
                const { entry, metadata } = result.value
                if (metadata.deleted) continue
                if (metadata.type === 'CollectionType') {
                    folderNames.set(entry.id, metadata.visibleName)
                    folderParents.set(entry.id, metadata.parent)
                }
            }

            // Collect documents
            const notebooks: NotebookSummary[] = []
            let withheld = 0
            const withheldIds: string[] = []

            for (const result of metadataResults) {
                if (result.status !== 'fulfilled' || !result.value.metadata) continue
                const { entry, metadata } = result.value
                if (metadata.deleted) continue
                if (metadata.type !== 'DocumentType') continue
                if (metadata.parent === 'trash') continue

                const folderPath = resolveFolderPath(
                    metadata.parent,
                    folderNames,
                    folderParents,
                    unreadableIds
                )
                if (null === folderPath) {
                    withheldIds.push(entry.id)
                    // Withheld rather than written to a truncated path; counts
                    // as unreadable so the listing is reported incomplete.
                    log(
                        `Skipped ${metadata.visibleName}: a parent folder could not be read`,
                        'warn'
                    )
                    withheld++
                    continue
                }

                if (
                    !warnedUnreadableTimestamp &&
                    null === parseCloudTimestamp(metadata.lastModified)
                ) {
                    warnedUnreadableTimestamp = true
                    log(
                        `Unreadable lastModified timestamp on ${metadata.visibleName}; a notebook with one always counts as synced`,
                        'warn',
                        { lastModified: metadata.lastModified }
                    )
                }

                notebooks.push({
                    id: entry.id,
                    visibleName: metadata.visibleName,
                    parent: metadata.parent,
                    lastModified: metadata.lastModified,
                    pageCount: 0,
                    folderPath
                })
            }

            log(`Listed ${notebooks.length} documents`, 'debug')

            const described = describeListing(
                notebooks,
                unreadableIds.size + withheld + rejectedRootLines,
                // A rejected root line is an entry whose id is unknown.
                rejectedRootLines > 0 ? null : [...unreadableIds, ...withheldIds]
            )
            // When the budget stopped the listing, its reason says more than a
            // count of unreadable items.
            const stopped = budget.exhaustedReason
            const listing =
                stopped !== null && !described.complete
                    ? { ...described, error: stopped }
                    : described
            if (listing.error) {
                log(listing.error, 'warn')
            }
            return listing
        } catch (error) {
            log('Failed to list documents', 'error', error)
            const message = error instanceof Error ? error.message : 'Unknown error'
            return listingFailed(message)
        } finally {
            budget.dispose()
        }
    }

    async function downloadDocument(
        documentId: string
    ): Promise<Map<string, ArrayBuffer> | DownloadFailure> {
        const budget = newBudget('download')
        // A stopped budget's reason (rate limited, unloaded) says more than
        // the step that noticed it.
        const fail = (message = 'Download failed'): DownloadFailure => ({
            error: budget.exhaustedReason ?? message
        })
        try {
            const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

            // Look up document's index hash (fetch root if not cached)
            let indexHash = entryHashMap.get(documentId)
            let userToken: string | null = null
            if (!indexHash) {
                const result = await getRootHashWithRetry(budget)
                if ('failure' in result) return fail(result.failure)
                userToken = result.userToken

                const rootBlob = await transport.fetchBlob(
                    userToken,
                    result.rootHash,
                    ROOT_INDEX_FILENAME,
                    syncBaseUrl,
                    budget
                )
                if (!rootBlob) return fail()

                const rootContent = new TextDecoder().decode(rootBlob)
                const rootEntries = parseIndex(rootContent)
                for (const entry of rootEntries) {
                    entryHashMap.set(entry.id, entry.hash)
                }

                indexHash = entryHashMap.get(documentId)
                if (!indexHash) {
                    log(`Document ${documentId} not found in root index`, 'error')
                    return fail('The notebook is no longer in the reMarkable cloud')
                }
            } else {
                const acquired = await plugin.authService.acquireUserToken()
                if ('failure' in acquired) {
                    log(`No user token: ${acquired.failure}`, 'error')
                    return fail(tokenFailureMessage(acquired.failure))
                }
                userToken = acquired.token
            }

            // Download document index
            const indexBlob = await transport.fetchBlob(
                userToken,
                indexHash,
                docIndexFilename(documentId),
                syncBaseUrl,
                budget
            )
            if (!indexBlob) return fail()

            const indexContent = new TextDecoder().decode(indexBlob)
            // A line the parser rejects is a file it cannot name: processing
            // the rest would mark the notebook synced with that file absent.
            const { entries: fileEntries, rejected } = parseIndexDetailed(indexContent)
            if (rejected > 0) {
                log(
                    `${rejected} unreadable line(s) in the index of document ${documentId}`,
                    'error'
                )
                return fail()
            }

            // Download all files, a bounded number at a time
            const fileResults = await mapSettledWithConcurrency(
                fileEntries,
                CLOUD_REQUEST_CONCURRENCY,
                async (entry) => {
                    const data = await transport.fetchBlob(
                        userToken,
                        entry.hash,
                        entry.id,
                        syncBaseUrl,
                        budget
                    )
                    return { path: entry.id, data }
                }
            )

            const files = new Map<string, ArrayBuffer>()
            for (const result of fileResults) {
                if (result.status === 'fulfilled' && result.value.data) {
                    files.set(result.value.path, result.value.data)
                }
            }

            // A missing blob after retries means missing pages. Processing the
            // rest would mark the notebook synced with pages silently absent,
            // and nothing would ever retry them. Counted by file id, as the map
            // is: an id listed twice is one file, not a missing one.
            const expected = new Set(fileEntries.map((entry) => entry.id)).size
            if (files.size === 0 || files.size < expected) {
                log(
                    `Downloaded ${files.size} of ${expected} files for document ${documentId}`,
                    'error'
                )
                return fail()
            }

            log(`Downloaded ${files.size} files for document ${documentId}`, 'debug')
            return files
        } catch (error) {
            log(`Failed to download document ${documentId}`, 'error', error)
            return fail()
        } finally {
            budget.dispose()
        }
    }

    return {
        listDocuments,
        downloadDocument
    }
}
