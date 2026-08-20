import { unzipSync } from 'fflate/browser'
import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import {
    PAGE_RENDERING_UNSUPPORTED_MESSAGE,
    isPageRenderingSupported
} from '../renderer/page-renderer.service'
import { renderAndWritePages } from '../output/document-output.service'
import type { ProgressCallback } from '../pipeline/notebook-pipeline.service'

export interface RmdocImportService {
    processRmdocFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        onProgress: ProgressCallback
    ): Promise<boolean>
}

/**
 * Derive a notebook name from the .rmdoc file name.
 * Strips the .rmdoc extension.
 */
function deriveNotebookName(fileName: string): string {
    return fileName.replace(/\.rmdoc$/i, '')
}

/**
 * Extract files from a .rmdoc ZIP archive into the Map format
 * expected by parseDocument().
 *
 * Uses fflate's `browser` entry point deliberately: the default (`node`)
 * one starts with a top-level `require("module")`/`worker_threads`, which
 * throws on mobile and would stop the plugin from loading. The browser entry
 * pulls in no Node builtins at all.
 *
 * Synchronous by design — the async variant would pull in fflate's worker
 * machinery (`new Worker` over a blob URL), which the community-plugin
 * reviewer flags. A .rmdoc holds a single notebook, so inflating it inline is
 * cheap.
 */
export function extractRmdocFiles(fileBuffer: ArrayBuffer): Map<string, ArrayBuffer> {
    const unzipped = unzipSync(new Uint8Array(fileBuffer))
    const files = new Map<string, ArrayBuffer>()

    for (const [path, data] of Object.entries(unzipped)) {
        // Directory entries come back with a trailing slash and no content.
        if (path.endsWith('/')) continue
        // Copy out of the shared backing buffer; the view may cover only part
        // of it, and callers treat these as standalone ArrayBuffers.
        files.set(path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    }

    return files
}

export function createRmdocImportService(plugin: RemarkableSyncPlugin): RmdocImportService {
    async function processRmdocFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        onProgress: ProgressCallback
    ): Promise<boolean> {
        const { settings } = plugin
        const notebookName = deriveNotebookName(fileName)

        if (!isPageRenderingSupported()) {
            new Notice(PAGE_RENDERING_UNSUPPORTED_MESSAGE)
            onProgress({
                status: 'error',
                currentPage: 0,
                totalPages: 0,
                error: PAGE_RENDERING_UNSUPPORTED_MESSAGE
            })
            return false
        }

        try {
            // Step 1: Extract ZIP
            onProgress({ status: 'parsing', currentPage: 0, totalPages: 0 })
            let files: Map<string, ArrayBuffer>
            try {
                files = extractRmdocFiles(fileBuffer)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error'
                log(`Failed to extract .rmdoc file: ${fileName}`, 'error', error)
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: `Failed to extract archive: ${message}`
                })
                return false
            }

            if (files.size === 0) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Archive is empty'
                })
                return false
            }

            // Step 2: Parse
            // Use the file name as a synthetic document ID
            const documentId = `import-${notebookName}`
            const parsed = parseDocument(files, documentId)
            if (!parsed) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Failed to parse document'
                })
                return false
            }

            // Use the visibleName from metadata if available, otherwise fall back to file name
            const displayName = parsed.visibleName || notebookName

            // Filter out blank pages
            const contentPages = parsed.pages.filter(pageHasContent)

            // A source-backed document with no annotated pages still has its
            // original to write; skipping it here silently lost the source.
            const writesSourceOnly = undefined !== parsed.sourceDocument && settings.savePdf
            if (contentPages.length === 0 && !writesSourceOnly) {
                new Notice(`${displayName}: No pages with content found`)
                onProgress({ status: 'done', currentPage: 0, totalPages: 0 })
                return true
            }

            // Step 3: Render each page and write the enabled outputs
            const { totalPages, failedPages } = await renderAndWritePages({
                pages: contentPages,
                notebookName: displayName,
                folderPath: '', // No folder path for local imports
                settings,
                vault: plugin.app.vault,
                ...(parsed.sourceDocument ? { sourceDocument: parsed.sourceDocument } : {}),
                ...(parsed.deviceScreen ? { deviceScreen: parsed.deviceScreen } : {}),
                onPageProgress: (currentPage, total, failed) =>
                    onProgress({
                        status: 'rendering',
                        currentPage,
                        totalPages: total,
                        failedPages: failed
                    })
            })

            onProgress({ status: 'done', currentPage: totalPages, totalPages, failedPages })
            if (failedPages > 0) {
                new Notice(
                    `${displayName}: Imported ${totalPages - failedPages}/${totalPages} pages — ${failedPages} page${failedPages === 1 ? '' : 's'} failed to render`
                )
            } else {
                new Notice(`${displayName}: Imported ${totalPages} pages`)
            }
            log(`Imported ${displayName} (${totalPages} pages) from .rmdoc file`, 'info')

            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            log(`Import failed for ${notebookName}`, 'error', error)
            onProgress({ status: 'error', currentPage: 0, totalPages: 0, error: message })
            new Notice(`Error importing ${notebookName}: ${message}`)
            return false
        }
    }

    return { processRmdocFile }
}
