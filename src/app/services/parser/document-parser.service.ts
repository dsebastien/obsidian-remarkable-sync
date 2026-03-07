import { log } from '../../../utils/log'
import { parseRmFile } from './rm-file-parser'
import type { Notebook, Page } from '../../domain/notebook'
import type {
    RemarkableDocumentMetadata,
    RemarkableDocumentContent
} from '../../domain/remarkable-types'

/**
 * Extract ordered page IDs from a .content file.
 * Prefers cPages (firmware 3.x+, supports page reordering) over the flat pages array.
 */
export function extractPageOrder(content: RemarkableDocumentContent | null): string[] | null {
    if (!content) return null

    // Prefer cPages (firmware 3.x+) — sorted by idx.value gives display order
    const cPages = content.cPages?.pages
    if (cPages && cPages.length > 0) {
        const sorted = [...cPages].sort((a, b) => {
            const aIdx = a.idx?.value ?? ''
            const bIdx = b.idx?.value ?? ''
            return aIdx.localeCompare(bIdx)
        })
        return sorted.map((p) => p.id)
    }

    // Fall back to flat pages array (older firmware)
    if (content.pages && content.pages.length > 0) {
        return [...content.pages]
    }

    return null
}

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

        for (const [path, data] of files) {
            if (!path.endsWith('.rm')) continue
            // Extract the page ID: last path segment without the .rm extension
            const lastSlash = path.lastIndexOf('/')
            const pageId = path.slice(lastSlash + 1, -3)
            if (pageId) {
                rmFilesByPageId.set(pageId, data)
            }
        }

        // Determine page order: cPages > pages > file discovery order
        const pageIds = extractPageOrder(content) ?? [...rmFilesByPageId.keys()]

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
