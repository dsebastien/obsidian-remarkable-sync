import { deviceScreenFor } from '../../domain/device-screen'
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
 *
 * `.content` format 1 has no `cPages`: it pairs the flat `pages` array with
 * `redirectionPageMap` by position instead. Reading only `cPages` gave every
 * layer of such a document no source page, so no annotated copy was written
 * at all (issue #47). Older format 1 files of a PDF or EPUB carry no
 * `redirectionPageMap` at all: no page was inserted, so page `i` annotates
 * source page `i`. A notebook has no source and never gets a mapping.
 */
export function extractSourcePageMap(
    content:
        | (Pick<RemarkableDocumentContent, 'cPages' | 'pages' | 'redirectionPageMap'> &
              Partial<Pick<RemarkableDocumentContent, 'fileType'>>)
        | null
): Map<string, number> {
    const map = new Map<string, number>()
    const cPages = content?.cPages?.pages ?? []
    if (cPages.length > 0) {
        for (const page of cPages) {
            if (page.redir && isSourcePageIndex(page.redir.value)) {
                map.set(page.id, page.redir.value)
            }
        }
        return map
    }

    const pageIds = content?.pages ?? []
    const sourceBacked = 'pdf' === content?.fileType || 'epub' === content?.fileType
    const redirections =
        content?.redirectionPageMap ?? (sourceBacked ? pageIds.map((_, i) => i) : [])
    for (let i = 0; i < pageIds.length; i++) {
        const pageId = pageIds[i]
        const sourceIndex = redirections[i]
        if (pageId && isSourcePageIndex(sourceIndex)) {
            map.set(pageId, sourceIndex)
        }
    }
    return map
}

/** A usable index into the source file's pages; a negative one marks an inserted page. */
function isSourcePageIndex(value: unknown): value is number {
    return 'number' === typeof value && Number.isInteger(value) && value >= 0
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
 * Group a document's per-page asset files by the page they belong to.
 *
 * The device (firmware 3.27+) stores each placed image beside its page:
 * `<documentId>/<pageId>/<fileName>`. The page's .rm file names the file but
 * not the folder, so the folder is what ties an asset to a page. Issue #36.
 *
 * Deliberately does NOT filter by file extension. The .rm file is the
 * authorization: `resolveImages` looks each asset up by the exact name the
 * page declared, so a file nothing declares is never read, and a format we
 * have not seen before cannot be silently dropped on the floor. An extension
 * allowlist here reintroduced the original bug, since an asset the table did
 * not list resolved to no data, which made a capture-only page look blank and
 * deleted it from the output.
 *
 * Non-asset entries are harmless: `.content` and `.metadata` sit at the
 * archive root and fail the two-segment test, and `<documentId>/<pageId>.rm`
 * is grouped under the document id, which is never a page id. Both end up in
 * map keys nothing ever reads.
 */
export function extractPageAssets(
    files: Map<string, ArrayBuffer>
): Map<string, Map<string, ArrayBuffer>> {
    const assetsByPageId = new Map<string, Map<string, ArrayBuffer>>()

    for (const [path, data] of files) {
        const segments = path.split('/')
        // Need at least `<pageId>/<fileName>` to attribute the asset.
        if (segments.length < 2) continue

        const fileName = segments[segments.length - 1]
        const pageId = segments[segments.length - 2]
        if (!fileName || !pageId) continue

        let pageAssets = assetsByPageId.get(pageId)
        if (!pageAssets) {
            pageAssets = new Map<string, ArrayBuffer>()
            assetsByPageId.set(pageId, pageAssets)
        }
        pageAssets.set(fileName, data)
    }

    return assetsByPageId
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
        const assetsByPageId = extractPageAssets(files)

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
                const page = parseRmFile(rmData, pageId, i, assetsByPageId.get(pageId))
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
            ...(sourceDocument ? { sourceDocument } : {}),
            // The screen sets the scale from .rm units to PDF points, so a
            // document written on a Paper Pro is not placed as if it came from
            // a reMarkable 2.
            deviceScreen: deviceScreenFor(
                content?.customZoomPageWidth,
                content?.customZoomPageHeight
            )
        }
    } catch (error) {
        log(`Failed to parse document ${documentId}`, 'error', error)
        return null
    }
}
