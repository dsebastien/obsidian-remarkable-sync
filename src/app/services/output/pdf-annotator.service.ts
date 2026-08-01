import { PDFDocument, PDFName, PDFNumber, PDFString, rgb } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { log } from '../../../utils/log'
import type { Highlight, Page, Stroke } from '../../domain/notebook'
import { STROKE_COLOR_MAP, ERASER_PEN_TYPES } from '../../domain/rm-constants'
import { segmentStyle, strokeColour, strokeOpacity } from '../../domain/pen-model'
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
    /** Text highlights embedded as real PDF annotations */
    highlights: number
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

    const colour = hexToRgb(strokeColour(stroke))
    const opacity = strokeOpacity(stroke)

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const rmWidth = segmentStyle(stroke, a, b).width

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
 * Add a text highlight as a real PDF `/Highlight` annotation.
 *
 * Deliberately an annotation rather than painted ink: a reader can select it,
 * see its text in a comment pane, and extract it. The device already knows
 * which characters were selected and supplies the rectangles covering them, so
 * nothing is inferred from geometry here.
 *
 * `/QuadPoints` lists four corners per rectangle in the order the PDF
 * specification requires: upper-left, upper-right, lower-left, lower-right.
 */
function addHighlightAnnotation(
    doc: PDFDocument,
    pdfPage: PDFPage,
    highlight: Highlight,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270
): boolean {
    if (highlight.rects.length === 0) {
        return false
    }

    const quads: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (const r of highlight.rects) {
        const topLeft = rmPointToPdf(r.x, r.y, box, rotate)
        const topRight = rmPointToPdf(r.x + r.width, r.y, box, rotate)
        const bottomLeft = rmPointToPdf(r.x, r.y + r.height, box, rotate)
        const bottomRight = rmPointToPdf(r.x + r.width, r.y + r.height, box, rotate)

        quads.push(
            topLeft.x,
            topLeft.y,
            topRight.x,
            topRight.y,
            bottomLeft.x,
            bottomLeft.y,
            bottomRight.x,
            bottomRight.y
        )

        for (const p of [topLeft, topRight, bottomLeft, bottomRight]) {
            minX = Math.min(minX, p.x)
            maxX = Math.max(maxX, p.x)
            minY = Math.min(minY, p.y)
            maxY = Math.max(maxY, p.y)
        }
    }

    const hex = STROKE_COLOR_MAP[highlight.color] ?? '#FFED75'
    const colour = hexToRgb(hex)

    const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Highlight',
        Rect: [minX, minY, maxX, maxY].map((n) => PDFNumber.of(n)),
        QuadPoints: quads.map((n) => PDFNumber.of(n)),
        C: [colour.red, colour.green, colour.blue].map((n) => PDFNumber.of(n)),
        CA: PDFNumber.of(HIGHLIGHTER_OPACITY),
        // The selected text itself, so readers can show and extract it
        Contents: PDFString.of(highlight.text),
        F: PDFNumber.of(4) // Print
    })

    pdfPage.node.addAnnot(doc.context.register(annot))
    void PDFName // kept for clarity that annotation keys are PDF names
    return true
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
    let highlights = 0

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

        // Text highlights first, so ink drawn afterwards sits above them
        for (const highlight of page.highlights ?? []) {
            if (addHighlightAnnotation(doc, pdfPage, highlight, box, rotate)) highlights++
        }

        for (const stroke of page.strokes) {
            drawStroke(pdfPage, stroke, box, rotate)
        }
        annotatedPages++
    }

    try {
        const bytes = await doc.save({ useObjectStreams: false })
        const data = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(data).set(bytes)
        return { data, annotatedPages, skippedPages, highlights }
    } catch (error) {
        log('Failed to write the annotated PDF', 'error', error)
        return null
    }
}
