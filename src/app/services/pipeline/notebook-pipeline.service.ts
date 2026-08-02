import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSummary } from '../../domain/notebook'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import {
    PAGE_RENDERING_UNSUPPORTED_MESSAGE,
    isPageRenderingSupported,
    renderPage
} from '../renderer/page-renderer.service'
import {
    writeDocumentPdf,
    writeMarkdownNote,
    writePageImage
} from '../output/markdown-writer.service'
import { buildPdf } from '../output/pdf-writer.service'
import { annotateSourcePdf } from '../output/pdf-annotator.service'
import { renderAndWritePages } from '../output/document-output.service'

export type PipelineStatus = 'idle' | 'downloading' | 'parsing' | 'rendering' | 'done' | 'error'

export interface PipelineProgress {
    status: PipelineStatus
    currentPage: number
    totalPages: number
    /** Content pages that failed to render and were dropped from the output */
    failedPages?: number
    error?: string
}

export type ProgressCallback = (progress: PipelineProgress) => void

export interface NotebookPipelineService {
    processNotebook(notebook: NotebookSummary, onProgress: ProgressCallback): Promise<boolean>
}

/**
 * Injectable pipeline steps so the orchestration (progress reporting, failed
 * page counting, sync-state updates) can be tested without OffscreenCanvas or
 * a live vault.
 */
export interface PipelineDeps {
    parseDocument: typeof parseDocument
    renderPage: typeof renderPage
    writePageImage: typeof writePageImage
    writeDocumentPdf: typeof writeDocumentPdf
    writeMarkdownNote: typeof writeMarkdownNote
    buildPdf: typeof buildPdf
    annotateSourcePdf: typeof annotateSourcePdf
}

export function createNotebookPipelineService(
    plugin: RemarkableSyncPlugin,
    deps: PipelineDeps = {
        parseDocument,
        renderPage,
        writePageImage,
        writeDocumentPdf,
        writeMarkdownNote,
        buildPdf,
        annotateSourcePdf
    }
): NotebookPipelineService {
    async function processNotebook(
        notebook: NotebookSummary,
        onProgress: ProgressCallback
    ): Promise<boolean> {
        const { settings } = plugin

        if (!isPageRenderingSupported()) {
            onProgress({
                status: 'error',
                currentPage: 0,
                totalPages: 0,
                error: PAGE_RENDERING_UNSUPPORTED_MESSAGE
            })
            return false
        }

        try {
            // Step 1: Download
            onProgress({ status: 'downloading', currentPage: 0, totalPages: 0 })
            const files = await plugin.cloudService.downloadDocument(notebook.id)
            if (!files) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Download failed'
                })
                return false
            }

            // Step 2: Parse
            onProgress({ status: 'parsing', currentPage: 0, totalPages: 0 })
            const parsed = deps.parseDocument(files, notebook.id)
            if (!parsed) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Parse failed'
                })
                return false
            }

            // Filter out blank pages
            const contentPages = parsed.pages.filter(pageHasContent)

            if (contentPages.length === 0) {
                new Notice(`${notebook.visibleName}: No pages with content found`)
                onProgress({ status: 'done', currentPage: 0, totalPages: 0 })
                return true
            }

            // Step 3: Render each page and write the enabled outputs
            const { totalPages, failedPages } = await renderAndWritePages(
                {
                    pages: contentPages,
                    notebookName: notebook.visibleName,
                    folderPath: notebook.folderPath,
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
                },
                deps
            )

            onProgress({ status: 'done', currentPage: totalPages, totalPages, failedPages })
            if (failedPages > 0) {
                new Notice(
                    `${notebook.visibleName}: Processed ${totalPages - failedPages}/${totalPages} pages — ${failedPages} page${failedPages === 1 ? '' : 's'} failed to render`
                )
            } else {
                new Notice(`${notebook.visibleName}: Processed ${totalPages} pages`)
            }

            // Update sync state; only successfully rendered pages are counted
            const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
            await plugin.syncStoreService.updateState(
                notebook.id,
                lastModifiedCloud,
                totalPages - failedPages
            )

            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            log(`Pipeline failed for ${notebook.visibleName}`, 'error', error)
            onProgress({ status: 'error', currentPage: 0, totalPages: 0, error: message })
            new Notice(`Error processing ${notebook.visibleName}: ${message}`)
            return false
        }
    }

    return { processNotebook }
}
