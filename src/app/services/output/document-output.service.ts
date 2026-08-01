import type { Vault } from 'obsidian'
import { log } from '../../../utils/log'
import type { Page } from '../../domain/notebook'
import type { PluginSettings } from '../../types/plugin-settings.intf'
import { renderPage } from '../renderer/page-renderer.service'
import { buildPdf } from './pdf-writer.service'
import type { PdfPageImage } from './pdf-writer.service'
import { writeDocumentPdf, writePageImage } from './markdown-writer.service'

/**
 * Injectable steps so the loop can be tested without OffscreenCanvas or a
 * live vault.
 */
export interface DocumentOutputDeps {
    renderPage: typeof renderPage
    writePageImage: typeof writePageImage
    writeDocumentPdf: typeof writeDocumentPdf
    buildPdf: typeof buildPdf
}

export const DEFAULT_DOCUMENT_OUTPUT_DEPS: DocumentOutputDeps = {
    renderPage,
    writePageImage,
    writeDocumentPdf,
    buildPdf
}

export interface RenderAndWriteOptions {
    /** Content pages, already filtered for blanks */
    pages: readonly Page[]
    notebookName: string
    /** reMarkable folder hierarchy below the target folder, '' for imports */
    folderPath: string
    settings: PluginSettings
    vault: Vault
    onPageProgress: (currentPage: number, totalPages: number, failedPages: number) => void
}

export interface RenderAndWriteResult {
    totalPages: number
    /** Content pages that failed to render and were dropped from every output */
    failedPages: number
    pdfWritten: boolean
}

/**
 * A PDF can carry JPEG and PNG natively but has no WebP filter, so a WebP
 * setting embeds JPEG instead. Loose image files keep the chosen format.
 */
export function resolvePdfImageFormat(imageFormat: PluginSettings['imageFormat']): 'jpeg' | 'png' {
    return imageFormat === 'webp' ? 'jpeg' : imageFormat
}

/**
 * Render every content page and write the enabled outputs.
 *
 * Shared by cloud sync and local .rmdoc import so both honour the same
 * settings, the same failure accounting and the same file layout.
 *
 * A page renders once in the common case. The only double-render is WebP with
 * PDF output enabled, where the loose file and the embedded copy genuinely need
 * different encodings.
 */
export async function renderAndWritePages(
    options: RenderAndWriteOptions,
    deps: DocumentOutputDeps = DEFAULT_DOCUMENT_OUTPUT_DEPS
): Promise<RenderAndWriteResult> {
    const { pages, notebookName, folderPath, settings, vault, onPageProgress } = options

    const looseFormat = settings.imageFormat
    const pdfFormat = resolvePdfImageFormat(looseFormat)
    const wantImages = settings.saveImages
    const wantPdf = settings.savePdf
    const sameEncoding = looseFormat === pdfFormat

    const totalPages = pages.length
    let failedPages = 0
    const pdfPages: PdfPageImage[] = []

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!
        onPageProgress(i + 1, totalPages, failedPages)

        const imageData = wantImages
            ? await deps.renderPage(page, looseFormat, settings.imageQuality)
            : null

        let pdfData: ArrayBuffer | null = null
        if (wantPdf) {
            pdfData =
                wantImages && sameEncoding
                    ? imageData
                    : await deps.renderPage(page, pdfFormat, settings.imageQuality)
        }

        // With both outputs disabled nothing is written, but the page is still
        // rendered so render failures stay visible in the reported counts.
        const probeData =
            !wantImages && !wantPdf
                ? await deps.renderPage(page, looseFormat, settings.imageQuality)
                : null

        const failed =
            (wantImages && !imageData) ||
            (wantPdf && !pdfData) ||
            (!wantImages && !wantPdf && !probeData)

        if (failed) {
            // renderPage catches its own errors and returns null; a content page
            // that yields no image was dropped, so count it instead of letting
            // it disappear silently.
            failedPages++
            log(`Page ${page.pageIndex + 1} of ${notebookName} failed to render`, 'warn')
            continue
        }

        if (wantImages && imageData) {
            await deps.writePageImage(
                vault,
                settings.targetFolder,
                folderPath,
                notebookName,
                page.pageIndex,
                imageData,
                looseFormat
            )
        }

        if (wantPdf && pdfData) {
            pdfPages.push({ data: pdfData, format: pdfFormat })
        }
    }

    let pdfWritten = false
    if (wantPdf && pdfPages.length > 0) {
        const pdfData = await deps.buildPdf(pdfPages)
        if (pdfData) {
            await deps.writeDocumentPdf(
                vault,
                settings.targetFolder,
                folderPath,
                notebookName,
                pdfData
            )
            pdfWritten = true
        } else {
            log(`Failed to build the PDF for ${notebookName}`, 'error')
        }
    }

    return { totalPages, failedPages, pdfWritten }
}
