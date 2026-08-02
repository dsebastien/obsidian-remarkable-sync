import type { Vault } from 'obsidian'
import { log } from '../../../utils/log'
import type { DeviceScreen } from '../../domain/device-screen'
import type { Page, SourceDocument } from '../../domain/notebook'
import type { PluginSettings } from '../../types/plugin-settings.intf'
import { renderPage } from '../renderer/page-renderer.service'
import { buildPdf } from './pdf-writer.service'
import type { PdfPageImage } from './pdf-writer.service'
import { annotateSourcePdf } from './pdf-annotator.service'
import {
    ANNOTATED_SUFFIX,
    writeDocumentPdf,
    writeMarkdownNote,
    writePageImage
} from './markdown-writer.service'
import { buildHighlightsNote, hasHighlights } from './highlights-markdown'

/**
 * Injectable steps so the loop can be tested without OffscreenCanvas or a
 * live vault.
 */
export interface DocumentOutputDeps {
    renderPage: typeof renderPage
    writePageImage: typeof writePageImage
    writeDocumentPdf: typeof writeDocumentPdf
    writeMarkdownNote: typeof writeMarkdownNote
    buildPdf: typeof buildPdf
    annotateSourcePdf: typeof annotateSourcePdf
}

export const DEFAULT_DOCUMENT_OUTPUT_DEPS: DocumentOutputDeps = {
    renderPage,
    writePageImage,
    writeDocumentPdf,
    writeMarkdownNote,
    buildPdf,
    annotateSourcePdf
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
    /** The original file, for documents built from an imported PDF or EPUB */
    sourceDocument?: SourceDocument
    /**
     * The screen the document was written on, which sets the scale from `.rm`
     * units to PDF points. Omitted for a notebook, which has no source page to
     * line up with.
     */
    deviceScreen?: DeviceScreen
}

export interface RenderAndWriteResult {
    totalPages: number
    /** Content pages that failed to render and were dropped from every output */
    failedPages: number
    pdfWritten: boolean
    /** The source file was written through to the vault unmodified */
    sourceWritten: boolean
    /** An annotated copy of the source was written */
    annotatedWritten: boolean
    /** A markdown note listing the text highlights was written */
    highlightsNoteWritten: boolean
}

/** Suffix for the markdown note listing a document's text highlights. */
export const HIGHLIGHTS_SUFFIX = ' (highlights)'

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
    const {
        pages,
        notebookName,
        folderPath,
        settings,
        vault,
        onPageProgress,
        sourceDocument,
        deviceScreen
    } = options

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
    let sourceWritten = false
    let annotatedWritten = false
    let highlightsNoteWritten = false

    if (sourceDocument) {
        // A document built from an imported file. Assembling page images into a
        // PDF would throw the original away, which is the whole problem being
        // fixed here, so the source is written through instead and the ink is
        // drawn back onto it.
        if (wantPdf) {
            await deps.writeDocumentPdf(
                vault,
                settings.targetFolder,
                folderPath,
                notebookName,
                sourceDocument.data
            )
            sourceWritten = true

            if ('pdf' === sourceDocument.kind) {
                const annotated = await deps.annotateSourcePdf(
                    sourceDocument.data,
                    pages,
                    deviceScreen
                )
                if (annotated && annotated.annotatedPages > 0) {
                    await deps.writeDocumentPdf(
                        vault,
                        settings.targetFolder,
                        folderPath,
                        `${notebookName}${ANNOTATED_SUFFIX}`,
                        annotated.data
                    )
                    annotatedWritten = true
                    if (annotated.skippedPages > 0) {
                        log(
                            `${notebookName}: ${annotated.skippedPages} layer(s) had no source page and were left out of the annotated copy`,
                            'warn'
                        )
                    }
                } else if (!annotated) {
                    log(`${notebookName}: could not annotate the source PDF`, 'warn')
                }
            }
        }
    } else if (wantPdf && pdfPages.length > 0) {
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

    // Independent of the PDF toggle: the note is useful on its own, and the
    // text is the device's own record of what was selected.
    if (settings.saveHighlightsNote && hasHighlights(pages)) {
        await deps.writeMarkdownNote(
            vault,
            settings.targetFolder,
            folderPath,
            `${notebookName}${HIGHLIGHTS_SUFFIX}`,
            buildHighlightsNote({
                documentName: notebookName,
                pages,
                ...(annotatedWritten
                    ? { annotatedPath: `${notebookName}${ANNOTATED_SUFFIX}.pdf` }
                    : {})
            })
        )
        highlightsNoteWritten = true
    }

    return {
        totalPages,
        failedPages,
        pdfWritten,
        sourceWritten,
        annotatedWritten,
        highlightsNoteWritten
    }
}
