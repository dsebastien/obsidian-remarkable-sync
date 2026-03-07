import { log } from '../../../utils/log'
import { parseRmFile } from './rm-file-parser'
import type { Notebook, Page } from '../../domain/notebook'
import type {
    RemarkableDocumentMetadata,
    RemarkableDocumentContent
} from '../../domain/remarkable-types'

/**
 * Parse downloaded reMarkable document files into a Notebook.
 * Accepts a Map of file paths to their contents (from sync protocol).
 */
export function parseDocument(
    files: Map<string, ArrayBuffer>,
    documentId: string
): Notebook | null {
    try {
        // Find and parse metadata
        let metadata: RemarkableDocumentMetadata | null = null
        let content: RemarkableDocumentContent | null = null

        for (const [path, data] of files) {
            if (path.endsWith('.metadata')) {
                const text = new TextDecoder().decode(data)
                metadata = JSON.parse(text) as RemarkableDocumentMetadata
            } else if (path.endsWith('.content')) {
                const text = new TextDecoder().decode(data)
                content = JSON.parse(text) as RemarkableDocumentContent
            }
        }

        if (!metadata) {
            log('No metadata found in document files', 'warn')
            return null
        }

        // Build a lookup map from page ID to .rm file data
        const rmFilesByPageId = new Map<string, ArrayBuffer>()
        const pageIds: string[] = []

        for (const [path, data] of files) {
            if (!path.endsWith('.rm')) continue
            // Extract the page ID: last path segment without the .rm extension
            const lastSlash = path.lastIndexOf('/')
            const pageId = path.slice(lastSlash + 1, -3)
            if (pageId) {
                rmFilesByPageId.set(pageId, data)
                if (!content?.pages) {
                    pageIds.push(pageId)
                }
            }
        }

        if (content?.pages) {
            pageIds.push(...content.pages)
        }

        // Parse each page's .rm file
        const pages: Page[] = []
        for (let i = 0; i < pageIds.length; i++) {
            const pageId = pageIds[i]
            if (!pageId) continue

            const rmData = rmFilesByPageId.get(pageId)
            if (!rmData) {
                log(`No .rm file found for page ${pageId}`, 'warn')
                continue
            }

            try {
                const page = parseRmFile(rmData, pageId, i)
                pages.push(page)
            } catch (error) {
                log(`Failed to parse page ${pageId}`, 'warn', error)
            }
        }

        return {
            id: documentId,
            visibleName: metadata.visibleName,
            parent: metadata.parent,
            lastModified: metadata.lastModified,
            pageCount: pages.length,
            pages
        }
    } catch (error) {
        log(`Failed to parse document ${documentId}`, 'error', error)
        return null
    }
}
