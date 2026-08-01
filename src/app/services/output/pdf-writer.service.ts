import { PDFDocument } from 'pdf-lib'
import { log } from '../../../utils/log'

/**
 * Dots per inch of the reMarkable page grid. PDF user space is 1/72 inch, so
 * this is what converts a rendered page's pixel size into PDF points.
 */
export const REMARKABLE_DPI = 226

/**
 * A rendered page ready to be placed on its own PDF page.
 */
export interface PdfPageImage {
    /** Encoded image bytes, as produced by the page renderer */
    data: ArrayBuffer
    /** JPEG and PNG are the only formats a PDF can carry natively */
    format: 'jpeg' | 'png'
}

/**
 * Convert a pixel measurement on the reMarkable grid to PDF points.
 */
export function pixelsToPoints(pixels: number): number {
    return (pixels / REMARKABLE_DPI) * 72
}

/**
 * Build a PDF containing one page per image, each page sized to its own image.
 *
 * Pages are sized from the image rather than forced to a fixed sheet: the page
 * renderer grows the canvas for content that scrolled past the bottom of the
 * device viewport, and a fixed MediaBox would either crop that or letterbox it.
 *
 * The output is deterministic. `updateMetadata: false` stops pdf-lib stamping
 * a creation date, modification date, producer and file ID, so re-processing an
 * unchanged notebook produces byte-identical output and never looks like a
 * change to Obsidian Sync, Git or Dropbox. `useObjectStreams: false` keeps the
 * object ordering stable for the same reason.
 */
export async function buildPdf(pages: readonly PdfPageImage[]): Promise<ArrayBuffer | null> {
    if (pages.length === 0) {
        log('Refusing to build a PDF with no pages', 'warn')
        return null
    }

    try {
        const doc = await PDFDocument.create({ updateMetadata: false })

        for (const page of pages) {
            const image =
                page.format === 'jpeg'
                    ? await doc.embedJpg(page.data)
                    : await doc.embedPng(page.data)

            const widthPt = pixelsToPoints(image.width)
            const heightPt = pixelsToPoints(image.height)

            const pdfPage = doc.addPage([widthPt, heightPt])
            pdfPage.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt })
        }

        const bytes = await doc.save({ useObjectStreams: false })

        // Copy into a standalone ArrayBuffer: pdf-lib returns a Uint8Array view
        // whose backing buffer is typed as ArrayBufferLike, and callers treat
        // the result as a plain ArrayBuffer.
        const output = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(output).set(bytes)
        return output
    } catch (error) {
        log('Failed to build PDF', 'error', error)
        return null
    }
}
