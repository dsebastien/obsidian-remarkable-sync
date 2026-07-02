import { Notice } from 'obsidian'
import { log } from '../../../utils/log'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSummary } from '../../domain/notebook'
import { pageHasContent } from '../parser/rm-file-parser'
import { parseDocument } from '../parser/document-parser.service'
import { renderPage } from '../renderer/page-renderer.service'
import {
    buildNotebookMarkdownPath,
    buildPagePath,
    readNotebookMarkdown,
    vaultFileExists,
    writeNotebookMarkdown,
    writePageImage
} from '../output/markdown-writer.service'
import {
    isPageOcrCurrent,
    nonOcrPageState,
    pageImageState,
    shouldWritePageImage
} from '../../domain/page-image-sync'
import { ocrPageImage } from '../ocr/ocr.service'
import {
    assembleNotebookMarkdown,
    computeOcrHash,
    rewriteImagePlaceholders
} from '../../domain/ocr-markdown'
import type { OcrPageInput } from '../../domain/ocr-markdown'
import { hashBytes } from '../../../utils/hash'
import { sleep } from '../../../utils/sleep'
import type { PageOcrState } from '../../domain/sync-state'

export type PipelineStatus = 'idle' | 'downloading' | 'parsing' | 'rendering' | 'done' | 'error'

export interface PipelineProgress {
    status: PipelineStatus
    currentPage: number
    totalPages: number
    error?: string
}

export type ProgressCallback = (progress: PipelineProgress) => void

export interface NotebookPipelineService {
    processNotebook(notebook: NotebookSummary, onProgress: ProgressCallback): Promise<boolean>
}

export function createNotebookPipelineService(
    plugin: RemarkableSyncPlugin
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
                plugin.syncLogService.emit('error', `${notebook.visibleName}: download failed`)
                return false
            }

            // Step 2: Parse
            onProgress({ status: 'parsing', currentPage: 0, totalPages: 0 })
            const parsed = parseDocument(files, notebook.id)
            if (!parsed) {
                onProgress({
                    status: 'error',
                    currentPage: 0,
                    totalPages: 0,
                    error: 'Parse failed'
                })
                plugin.syncLogService.emit('error', `${notebook.visibleName}: parse failed`)
                return false
            }

            // Filter out blank pages
            const contentPages = parsed.pages.filter(pageHasContent)

            if (contentPages.length === 0) {
                new Notice(`${notebook.visibleName}: No pages with content found`)
                plugin.syncLogService.emit('info', `${notebook.visibleName}: no pages with content`)
                onProgress({ status: 'done', currentPage: 0, totalPages: 0 })
                // Record sync state for blank notebooks too, so an unattended
                // all-notebooks sync skips this (unchanged) notebook on the next
                // tick instead of re-downloading it every interval.
                const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
                await plugin.syncStoreService.updateState(notebook.id, lastModifiedCloud, 0)
                return true
            }

            const totalPages = contentPages.length

            // Per-page state from the previous sync, keyed by the rendered-image
            // hash (srcHash). An unchanged page skips both the image write and the
            // OCR request, so a re-sync touches only new/changed pages and RESUMES
            // only the pages still missing OCR — the syncStore IS the implicit
            // worklist (no queue).
            const ocrEnabled = settings.ocrEnabled
            const prevState = plugin.syncStoreService.getState(notebook.id)
            const prevPages = prevState?.pages ?? {}
            // Keep the notebook's mtime at its prior value until every page is OCR'd,
            // so a partial run stays "needs sync" and the next sync resumes it.
            const prevMtime = prevState?.lastModifiedCloud ?? 0
            const lastModifiedCloud = parseInt(notebook.lastModified, 10) || Date.now()
            const nextPages: Record<string, PageOcrState> = {}
            const mdPath = buildNotebookMarkdownPath(settings.targetFolder, notebook.visibleName)
            const interDelayMs = Math.max(0, settings.ocrRequestDelayMs)
            let allPagesOcrd = true
            let madeOcrRequest = false
            // Counts for the per-notebook sync-log summary.
            let ocrTranscribed = 0
            let ocrUnchanged = 0
            let ocrFailed = 0
            let imagesWritten = 0
            let imagesUnchanged = 0
            let renderFailed = 0

            // Step 3: Render (and, when enabled, OCR) each page — serially, one at a
            // time, never a parallel burst.
            for (let i = 0; i < contentPages.length; i++) {
                const page = contentPages[i]!
                const pageIndex = page.pageIndex

                onProgress({ status: 'rendering', currentPage: i + 1, totalPages })
                const imageData = await renderPage(
                    page,
                    settings.imageFormat,
                    settings.imageQuality
                )

                const prev = prevPages[page.pageId]

                if (!imageData) {
                    // Couldn't render → keep prior state/block, write nothing.
                    // (With OCR on, the held-back mtime retries it next sync.)
                    if (prev) {
                        nextPages[page.pageId] = prev
                    }
                    allPagesOcrd = false
                    ocrFailed++
                    renderFailed++
                    plugin.syncLogService.emit(
                        'error',
                        `${notebook.visibleName} p${pageIndex + 1}: render failed`
                    )
                    continue
                }

                if (!settings.saveImages && !ocrEnabled) {
                    // Nothing to write or transcribe; the empty-map persist guard
                    // below keeps any prior per-page state intact.
                    continue
                }

                const srcHash = hashBytes(imageData)
                // Built once per page; also the OCR figure-embed target below.
                const pagePath = settings.saveImages
                    ? buildPagePath(
                          settings.targetFolder,
                          notebook.folderPath,
                          notebook.visibleName,
                          pageIndex,
                          settings.imageFormat
                      )
                    : undefined
                let wroteImage = false

                if (pagePath !== undefined) {
                    // Per-page incremental image write: an unchanged page's vault
                    // file (and mtime) is left untouched. The change signal is the
                    // rendered-image hash — the cloud has no per-page mtime.
                    const exists = vaultFileExists(plugin.app.vault, pagePath)
                    if (shouldWritePageImage(prev, srcHash, pageIndex, exists)) {
                        await writePageImage(
                            plugin.app.vault,
                            settings.targetFolder,
                            notebook.folderPath,
                            notebook.visibleName,
                            pageIndex,
                            imageData,
                            settings.imageFormat
                        )
                        wroteImage = true
                        imagesWritten++
                    } else {
                        imagesUnchanged++
                    }
                }

                const imageState = pageImageState(prev, srcHash, pageIndex, wroteImage)

                if (!ocrEnabled) {
                    // Persist per-page state even without OCR so the image skip
                    // works on later syncs; an unchanged page keeps its prior
                    // ocrHash (OCR progress preserved).
                    nextPages[page.pageId] = nonOcrPageState(page.pageId, srcHash, prev, imageState)
                    continue
                }

                if (prev && isPageOcrCurrent(prev, srcHash)) {
                    // Already OCR'd and unchanged → skip (no request, no rewrite).
                    // imageState still refreshes when an index shift rewrote the file.
                    nextPages[page.pageId] = { ...prev, ...imageState }
                    ocrUnchanged++
                    continue
                }

                // Pace requests to stay under the OCR provider's rate limit.
                if (madeOcrRequest && interDelayMs > 0) {
                    await sleep(interDelayMs)
                }
                madeOcrRequest = true

                try {
                    const rawMarkdown = await ocrPageImage(
                        settings.mdserverOcrUrl,
                        imageData,
                        settings.imageFormat,
                        {
                            onRateLimit: ({ attempt, status }) => {
                                new Notice(
                                    `${notebook.visibleName}: rate limited (HTTP ${status}) — backing off, retrying page ${pageIndex + 1} (attempt ${attempt})`
                                )
                                plugin.syncLogService.emit(
                                    'info',
                                    `${notebook.visibleName} p${pageIndex + 1}: rate limited (HTTP ${status}) — retrying (attempt ${attempt})`
                                )
                            }
                        }
                    )
                    // Rewrite Mistral's broken img-N placeholders to embed THIS page's
                    // real saved image (one embed per page), so the stored body + its
                    // ocrHash never contain dead image refs. If images aren't being
                    // saved, the placeholders are dropped instead of left dangling.
                    const markdown = rewriteImagePlaceholders(rawMarkdown, pagePath)
                    const ocrHash = computeOcrHash(markdown)
                    nextPages[page.pageId] = {
                        pageId: page.pageId,
                        srcHash,
                        ocrHash,
                        ...imageState
                    }

                    // Persist incrementally: write this page's block into the note and
                    // record its ocrHash NOW. A crash/restart then loses nothing and
                    // the next sync resumes from the still-missing pages. Pass a copy
                    // of nextPages so immer's frozen snapshot doesn't freeze our live
                    // working map.
                    try {
                        const existing = await readNotebookMarkdown(plugin.app.vault, mdPath)
                        const update: OcrPageInput = {
                            pageId: page.pageId,
                            pageIndex,
                            label: `Page ${pageIndex + 1}`,
                            markdown,
                            srcHash,
                            ocrHash
                        }
                        const assembled = assembleNotebookMarkdown(existing, [update])
                        await writeNotebookMarkdown(plugin.app.vault, mdPath, assembled)
                        // Merge over the previous map: nextPages only holds pages
                        // reached so far, and updateState replaces the whole map —
                        // a crash mid-run must not drop the unreached pages' state.
                        await plugin.syncStoreService.updateState(
                            notebook.id,
                            prevMtime,
                            totalPages,
                            { ...prevPages, ...nextPages }
                        )
                        ocrTranscribed++
                        plugin.syncLogService.emit(
                            'success',
                            `${notebook.visibleName} p${pageIndex + 1}: transcribed`
                        )
                    } catch (writeError) {
                        // Persist failed → roll this page back so it retries next sync.
                        const reason =
                            writeError instanceof Error ? writeError.message : 'unknown error'
                        log(
                            `Failed to persist OCR page ${pageIndex + 1} for ${notebook.visibleName}`,
                            'error',
                            writeError
                        )
                        plugin.syncLogService.emit(
                            'error',
                            `${notebook.visibleName} p${pageIndex + 1}: failed to write note — ${reason}`
                        )
                        if (prev) {
                            // Roll OCR state back but keep the fresh image facts —
                            // an image written this run must not rewrite next run.
                            nextPages[page.pageId] = { ...prev, ...imageState }
                        } else {
                            delete nextPages[page.pageId]
                        }
                        allPagesOcrd = false
                        ocrFailed++
                    }
                } catch (error) {
                    // Fail-soft after retries: surface a clear per-page error and keep
                    // going (don't abort the notebook). Leave the prior block/state
                    // intact so the next sync retries just this page.
                    const reason = error instanceof Error ? error.message : 'unknown error'
                    log(
                        `OCR failed for ${notebook.visibleName} page ${pageIndex + 1}`,
                        'warn',
                        error
                    )
                    new Notice(
                        `${notebook.visibleName}: OCR failed for page ${pageIndex + 1} — will retry on next sync`
                    )
                    plugin.syncLogService.emit(
                        'error',
                        `${notebook.visibleName} p${pageIndex + 1}: OCR failed — ${reason}`
                    )
                    if (prev) {
                        // Keep prior OCR state but record the fresh image facts.
                        nextPages[page.pageId] = { ...prev, ...imageState }
                    }
                    allPagesOcrd = false
                    ocrFailed++
                }
            }

            onProgress({ status: 'done', currentPage: totalPages, totalPages })
            new Notice(`${notebook.visibleName}: Processed ${totalPages} pages`)

            const imageSummary = settings.saveImages
                ? `images: ${imagesWritten} new/changed, ${imagesUnchanged} unchanged` +
                  (renderFailed > 0 ? `, ${renderFailed} render-failed` : '')
                : undefined
            if (ocrEnabled) {
                const summaryStatus = ocrFailed > 0 ? 'error' : 'success'
                const ocrSummary = `${ocrTranscribed} transcribed, ${ocrUnchanged} unchanged, ${ocrFailed} failed`
                plugin.syncLogService.emit(
                    summaryStatus,
                    `${notebook.visibleName}: ${ocrSummary}${imageSummary ? `; ${imageSummary}` : ''}`
                )
            } else {
                plugin.syncLogService.emit(
                    renderFailed > 0 ? 'error' : 'success',
                    imageSummary
                        ? `${notebook.visibleName}: ${imageSummary}`
                        : `${notebook.visibleName}: rendered ${totalPages} pages`
                )
            }

            // Final sync-state write. Advance the cloud mtime only when OCR is off or
            // every page is OCR'd, so the notebook is considered "done"; otherwise keep
            // the prior mtime so the next sync re-enters and resumes the missing pages.
            // Persist the per-page map so the next sync skips unchanged images — but
            // never clobber existing state with an empty map (e.g. every page failed
            // to render, or neither images nor OCR are enabled).
            const finalMtime = ocrEnabled && !allPagesOcrd ? prevMtime : lastModifiedCloud
            const persistPages = Object.keys(nextPages).length > 0 ? { ...nextPages } : undefined
            await plugin.syncStoreService.updateState(
                notebook.id,
                finalMtime,
                totalPages,
                persistPages
            )

            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            log(`Pipeline failed for ${notebook.visibleName}`, 'error', error)
            plugin.syncLogService.emit('error', `${notebook.visibleName}: ${message}`)
            onProgress({ status: 'error', currentPage: 0, totalPages: 0, error: message })
            new Notice(`Error processing ${notebook.visibleName}: ${message}`)
            return false
        }
    }

    return { processNotebook }
}
