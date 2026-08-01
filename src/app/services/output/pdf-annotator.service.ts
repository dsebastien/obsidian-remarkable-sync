import { PDFDocument, rgb } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { log } from '../../../utils/log'
import type { Page, Stroke } from '../../domain/notebook'
import {
    STROKE_COLOR_MAP,
    PEN_WIDTH_MULTIPLIER,
    HIGHLIGHTER_PEN_TYPES,
    ERASER_PEN_TYPES
} from '../../domain/rm-constants'
import { rmPointToPdf, rmWidthToPdf } from './pdf-coordinates'
import type { PageBox } from './pdf-coordinates'

/** Opacity used for highlighter strokes, matching the raster renderer. */
const HIGHLIGHTER_OPACITY = 0.3

/** Thinnest stroke worth drawing, in PDF points. */
const MIN_STROKE_WIDTH = 0.3

/**
 * Source PDFs beyond this size are refused rather than loaded. The source
 * bytes, pdf-lib's parsed object graph and the serialized output are all live
 * at once, which is a real risk on phones.
 */
export const MAX_SOURCE_PDF_BYTES = 80 * 1024 * 1024

export interface AnnotateResult {
    data: ArrayBuffer
    /** Layers drawn onto a source page */
    annotatedPages: number
    /** Layers skipped because they map to no source page, or one out of range */
    skippedPages: number
}

function hexToRgb(hex: string): ReturnType<typeof rgb> {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    return rgb(r, g, b)
}

/**
 * Draw one stroke onto a PDF page.
 *
 * Mirrors `stroke-renderer.ts`: eraser strokes are skipped, each segment takes
 * the average width of its two endpoints, and highlighters draw translucent.
 * The raster renderer uses a multiply blend as well, which PDF expresses via an
 * ExtGState; plain alpha is close enough and avoids reaching into pdf-lib's
 * resource dictionaries.
 */
function drawStroke(
    pdfPage: PDFPage,
    stroke: Stroke,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270
): void {
    if (ERASER_PEN_TYPES.has(stroke.penType)) {
        return
    }

    const points = stroke.points
    if (points.length < 2) {
        return
    }

    const colour = hexToRgb(STROKE_COLOR_MAP[stroke.color] ?? '#000000')
    const multiplier = PEN_WIDTH_MULTIPLIER[stroke.penType] ?? 1.0
    const opacity = HIGHLIGHTER_PEN_TYPES.has(stroke.penType) ? HIGHLIGHTER_OPACITY : 1

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const rmWidth = ((a.width + b.width) / 2) * multiplier * stroke.thickness

        pdfPage.drawLine({
            start: rmPointToPdf(a.x, a.y, box, rotate),
            end: rmPointToPdf(b.x, b.y, box, rotate),
            thickness: Math.max(rmWidthToPdf(rmWidth, box), MIN_STROKE_WIDTH),
            color: colour,
            opacity,
            lineCap: 1 // round, matching the canvas renderer
        })
    }
}

/**
 * Draw a document's annotation layers back onto its source PDF.
 *
 * Only pages carrying a `sourcePageIndex` are drawn: pages inserted on the
 * device have no counterpart in the source and are counted as skipped rather
 * than guessed onto page 0.
 *
 * `updateMetadata: false` keeps the source document's own title, author and
 * dates intact and stops pdf-lib restamping them, which also makes the output
 * byte-identical across runs.
 */
export async function annotateSourcePdf(
    sourceData: ArrayBuffer,
    pages: readonly Page[]
): Promise<AnnotateResult | null> {
    if (sourceData.byteLength > MAX_SOURCE_PDF_BYTES) {
        log(
            `Source PDF is ${Math.round(sourceData.byteLength / 1024 / 1024)} MB, above the ${MAX_SOURCE_PDF_BYTES / 1024 / 1024} MB limit; annotations not burned in`,
            'warn'
        )
        return null
    }

    let doc: PDFDocument
    try {
        doc = await PDFDocument.load(sourceData, { updateMetadata: false })
    } catch (error) {
        // Encrypted documents land here. `ignoreEncryption` would "succeed" and
        // then produce garbage, so it is deliberately not used.
        log('Could not read the source PDF; it may be encrypted', 'error', error)
        return null
    }

    const pageCount = doc.getPageCount()
    let annotatedPages = 0
    let skippedPages = 0

    for (const page of pages) {
        const index = page.sourcePageIndex
        if (undefined === index) {
            skippedPages++
            continue
        }
        if (index < 0 || index >= pageCount) {
            log(`Annotation layer targets source page ${index}, which does not exist`, 'warn')
            skippedPages++
            continue
        }

        const pdfPage = doc.getPage(index)
        const box = pdfPage.getCropBox()
        const rotate = (pdfPage.getRotation().angle % 360) as 0 | 90 | 180 | 270

        for (const stroke of page.strokes) {
            drawStroke(pdfPage, stroke, box, rotate)
        }
        annotatedPages++
    }

    try {
        const bytes = await doc.save({ useObjectStreams: false })
        const data = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(data).set(bytes)
        return { data, annotatedPages, skippedPages }
    } catch (error) {
        log('Failed to write the annotated PDF', 'error', error)
        return null
    }
}
