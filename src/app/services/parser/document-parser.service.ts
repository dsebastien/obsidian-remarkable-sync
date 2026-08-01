import { log } from '../../../utils/log'
import { parseRmFile } from './rm-file-parser'
import type { Notebook, Page, SourceDocument } from '../../domain/notebook'
import type {
    RemarkableDocumentMetadata,
    RemarkableDocumentContent
} from '../../domain/remarkable-types'

/**
 * Map each page ID to the index of the source-file page it annotates.
 *
 * Only meaningful for source-backed documents. Pages inserted on the device
 * carry no `redir` and are deliberately absent from the result, so callers can
 * tell "annotates source page 0" from "has no source page" rather than
 * defaulting the latter to 0 and drawing on the wrong page.
 */
export function extractSourcePageMap(
    content: RemarkableDocumentContent | null
): Map<string, number> {
    const map = new Map<string, number>()
    for (const page of content?.cPages?.pages ?? []) {
        if (page.redir && 'number' === typeof page.redir.value) {
            map.set(page.id, page.redir.value)
        }
    }
    return map
}

/**
 * Find the original file a document was built from, if it has one.
 *
 * The blob is named `<documentId>.pdf` (or `.epub`) alongside the `.content`
 * and `.metadata` files. It was previously downloaded and then discarded,
 * which is why annotated books synced as ink floating on blank pages.
 */
export function extractSourceDocument(
    files: Map<string, ArrayBuffer>,
    content: RemarkableDocumentContent | null
): SourceDocument | undefined {
    const fileType = content?.fileType
    if ('pdf' !== fileType && 'epub' !== fileType) {
        return undefined
    }

    const suffix = `.${fileType}`
    for (const [path, data] of files) {
        // Only the top-level blob, never anything nested under the page folder
        if (path.endsWith(suffix) && !path.includes('/')) {
            return { kind: fileType, data }
        }
    }

    log(`Document claims fileType "${fileType}" but carries no ${suffix} blob`, 'warn')
    return undefined
}

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

        const sourceDocument = extractSourceDocument(files, content)
        const sourcePageMap = extractSourcePageMap(content)

        // Parse each page's .rm file
        const pages: Page[] = []
        for (let i = 0; i < pageIds.length; i++) {
            const pageId = pageIds[i]
            if (!pageId) continue

            const rmData = rmFilesByPageId.get(pageId)
            if (!rmData) {
                // Normal for a source-backed document: pages the user never
                // annotated simply have no layer. Only worth a warning when
                // there is no source file to fall back on.
                if (!sourceDocument) {
                    log(`No .rm file found for page ${pageId}`, 'warn')
                }
                continue
            }

            try {
                const page = parseRmFile(rmData, pageId, i)
                const sourcePageIndex = sourcePageMap.get(pageId)
                pages.push(undefined === sourcePageIndex ? page : { ...page, sourcePageIndex })
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
            pages,
            ...(sourceDocument ? { sourceDocument } : {})
        }
    } catch (error) {
        log(`Failed to parse document ${documentId}`, 'error', error)
        return null
    }
}
