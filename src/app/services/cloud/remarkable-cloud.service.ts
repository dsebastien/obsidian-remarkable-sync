import { log } from '../../../utils/log'
import type { DocumentListing, NotebookSummary } from '../../domain/notebook'
import { describeListing, failedListing } from '../../domain/notebook'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'
import type { RemarkableSyncPlugin } from '../../plugin'
import {
    docIndexFilename,
    fetchBlob,
    fetchRootHash,
    parseIndex,
    ROOT_INDEX_FILENAME
} from './sync-protocol'
import { resolveCloudUrls } from './cloud-urls'

export interface RemarkableCloudService {
    listDocuments(): Promise<DocumentListing>
    downloadDocument(documentId: string): Promise<Map<string, ArrayBuffer> | null>
}

export function createRemarkableCloudService(plugin: RemarkableSyncPlugin): RemarkableCloudService {
    // Cache: document/folder ID -> index hash (populated during listDocuments)
    let entryHashMap = new Map<string, string>()

    /**
     * Fetch metadata for a single entry (document or folder) by downloading
     * its index blob, finding the .metadata file hash, and parsing it.
     */
    async function fetchEntryMetadata(
        userToken: string,
        indexHash: string,
        entryId: string,
        syncBaseUrl: string
    ): Promise<RemarkableDocumentMetadata | null> {
        const indexBlob = await fetchBlob(
            userToken,
            indexHash,
            docIndexFilename(entryId),
            syncBaseUrl
        )
        if (!indexBlob) return null

        const indexContent = new TextDecoder().decode(indexBlob)
        const fileEntries = parseIndex(indexContent)

        const metadataEntry = fileEntries.find((e) => e.id.endsWith('.metadata'))
        if (!metadataEntry) return null

        const metadataBlob = await fetchBlob(
            userToken,
            metadataEntry.hash,
            metadataEntry.id,
            syncBaseUrl
        )
        if (!metadataBlob) return null

        try {
            const text = new TextDecoder().decode(metadataBlob)
            return JSON.parse(text) as RemarkableDocumentMetadata
        } catch {
            log(`Failed to parse metadata for ${entryId}`, 'error')
            return null
        }
    }

    async function getRootHashWithRetry(): Promise<{ rootHash: string; userToken: string } | null> {
        const { syncBaseUrl } = resolveCloudUrls(plugin.settings)
        let userToken = await plugin.authService.getUserToken()
        if (!userToken) {
            log('Not authenticated', 'error')
            return null
        }

        try {
            const rootHash = await fetchRootHash(userToken, syncBaseUrl)
            if (!rootHash) return null
            return { rootHash, userToken }
        } catch {
            // 401 — try refreshing the token once
            log('Token rejected, refreshing...', 'debug')
            userToken = await plugin.authService.refreshAndGetUserToken()
            if (!userToken) {
                log('Token refresh failed', 'error')
                return null
            }
            const rootHash = await fetchRootHash(userToken, syncBaseUrl)
            if (!rootHash) return null
            return { rootHash, userToken }
        }
    }

    /** Report a total failure, and say so in the log. */
    function listingFailed(message: string): DocumentListing {
        log(`Could not list documents: ${message}`, 'warn')
        return failedListing(message)
    }

    async function listDocuments(): Promise<DocumentListing> {
        try {
            const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

            // Step 1: Get root hash (with token refresh on 401)
            const result = await getRootHashWithRetry()
            if (!result) {
                return listingFailed('Could not reach the reMarkable cloud')
            }
            const { rootHash, userToken } = result

            // Step 2: Download and parse root index
            const rootBlob = await fetchBlob(userToken, rootHash, ROOT_INDEX_FILENAME, syncBaseUrl)
            if (!rootBlob) {
                return listingFailed('Could not download the reMarkable index')
            }

            const rootContent = new TextDecoder().decode(rootBlob)
            const rootEntries = parseIndex(rootContent)

            // Cache entry hashes for later download
            entryHashMap = new Map()
            for (const entry of rootEntries) {
                entryHashMap.set(entry.id, entry.hash)
            }

            // Step 3: Fetch metadata for all entries in parallel
            const metadataResults = await Promise.allSettled(
                rootEntries.map(async (entry) => {
                    const metadata = await fetchEntryMetadata(
                        userToken,
                        entry.hash,
                        entry.id,
                        syncBaseUrl
                    )
                    return { entry, metadata }
                })
            )

            // An entry we could not read is NOT an entry that was deleted, and
            // the difference decides whether pruning is allowed to run.
            const unreadable = metadataResults.filter(
                (result) => 'fulfilled' !== result.status || !result.value.metadata
            ).length

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

            // Resolve folder path from parent chain
            const buildFolderPath = (parentId: string): string => {
                const parts: string[] = []
                let current = parentId
                const visited = new Set<string>()
                while (current && current !== '' && current !== 'trash' && !visited.has(current)) {
                    visited.add(current)
                    const name = folderNames.get(current)
                    if (name) {
                        parts.unshift(name)
                        current = folderParents.get(current) ?? ''
                    } else {
                        break
                    }
                }
                return parts.join('/')
            }

            // Collect documents
            const notebooks: NotebookSummary[] = []

            for (const result of metadataResults) {
                if (result.status !== 'fulfilled' || !result.value.metadata) continue
                const { entry, metadata } = result.value
                if (metadata.deleted) continue
                if (metadata.type !== 'DocumentType') continue
                if (metadata.parent === 'trash') continue

                notebooks.push({
                    id: entry.id,
                    visibleName: metadata.visibleName,
                    parent: metadata.parent,
                    lastModified: metadata.lastModified,
                    pageCount: 0,
                    folderPath: buildFolderPath(metadata.parent)
                })
            }

            log(`Listed ${notebooks.length} documents`, 'debug')

            const listing = describeListing(notebooks, unreadable)
            if (listing.error) {
                log(listing.error, 'warn')
            }
            return listing
        } catch (error) {
            log('Failed to list documents', 'error', error)
            const message = error instanceof Error ? error.message : 'Unknown error'
            return listingFailed(message)
        }
    }

    async function downloadDocument(documentId: string): Promise<Map<string, ArrayBuffer> | null> {
        try {
            const { syncBaseUrl } = resolveCloudUrls(plugin.settings)

            // Look up document's index hash (fetch root if not cached)
            let indexHash = entryHashMap.get(documentId)
            let userToken: string | null = null
            if (!indexHash) {
                const result = await getRootHashWithRetry()
                if (!result) return null
                userToken = result.userToken

                const rootBlob = await fetchBlob(
                    userToken,
                    result.rootHash,
                    ROOT_INDEX_FILENAME,
                    syncBaseUrl
                )
                if (!rootBlob) return null

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
            const indexBlob = await fetchBlob(
                userToken,
                indexHash,
                docIndexFilename(documentId),
                syncBaseUrl
            )
            if (!indexBlob) return null

            const indexContent = new TextDecoder().decode(indexBlob)
            const fileEntries = parseIndex(indexContent)

            // Download all files in parallel
            const fileResults = await Promise.allSettled(
                fileEntries.map(async (entry) => {
                    const data = await fetchBlob(userToken, entry.hash, entry.id, syncBaseUrl)
                    return { path: entry.id, data }
                })
            )

            const files = new Map<string, ArrayBuffer>()
            for (const result of fileResults) {
                if (result.status === 'fulfilled' && result.value.data) {
                    files.set(result.value.path, result.value.data)
                }
            }

            if (files.size === 0) {
                log(`No files downloaded for document ${documentId}`, 'error')
                return null
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
