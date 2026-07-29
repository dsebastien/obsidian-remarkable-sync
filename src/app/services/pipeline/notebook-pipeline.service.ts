import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSummary } from '../../domain/notebook'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import { renderPage } from '../renderer/page-renderer.service'
import { writePageImage } from '../output/markdown-writer.service'

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
}

export function createNotebookPipelineService(
    plugin: RemarkableSyncPlugin,
    deps: PipelineDeps = { parseDocument, renderPage, writePageImage }
): NotebookPipelineService {
    async function processNotebook(
        notebook: NotebookSummary,
        onProgress: ProgressCallback
    ): Promise<boolean> {
        const { settings } = plugin

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

            const totalPages = contentPages.length
            let failedPages = 0

            // Step 3: Render each page
            for (let i = 0; i < contentPages.length; i++) {
                const page = contentPages[i]!
                const pageIndex = page.pageIndex

                // Render page to image
                onProgress({ status: 'rendering', currentPage: i + 1, totalPages, failedPages })
                const imageData = await deps.renderPage(
                    page,
                    settings.imageFormat,
                    settings.imageQuality
                )

                if (!imageData) {
                    // renderPage catches its own errors and returns null; a
                    // content page that yields no image was dropped — count it
                    // so the failure is visible instead of silent.
                    failedPages++
                    log(`Page ${pageIndex + 1} of ${notebook.visibleName} failed to render`, 'warn')
                } else if (settings.saveImages) {
                    await deps.writePageImage(
                        plugin.app.vault,
                        settings.targetFolder,
                        notebook.folderPath,
                        notebook.visibleName,
                        pageIndex,
                        imageData,
                        settings.imageFormat
                    )
                }
            }

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
