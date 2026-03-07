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

        // Find page IDs from content file or from .rm files
        const pageIds: string[] = []
        if (content?.pages) {
            pageIds.push(...content.pages)
        } else {
            // Fallback: extract page IDs from .rm file paths
            for (const path of files.keys()) {
                const match = path.match(/([a-f0-9-]+)\.rm$/)
                if (match?.[1]) {
                    pageIds.push(match[1])
                }
            }
        }

        // Parse each page's .rm file
        const pages: Page[] = []
        for (let i = 0; i < pageIds.length; i++) {
            const pageId = pageIds[i]
            if (!pageId) continue

            // Find the .rm file for this page
            let rmData: ArrayBuffer | undefined
            for (const [path, data] of files) {
                if (path.includes(pageId) && path.endsWith('.rm')) {
                    rmData = data
                    break
                }
            }

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
