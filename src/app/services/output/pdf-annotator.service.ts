import {
    BlendMode,
    LineCapStyle,
    LineJoinStyle,
    PDFArray,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFRawStream,
    PDFString,
    decodePDFRawStream,
    popGraphicsState,
    pushGraphicsState,
    rgb,
    setLineJoin
} from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { log } from '../../../utils/log'
import { PenType } from '../../domain/notebook'
import type { Highlight, Page, Stroke } from '../../domain/notebook'
import {
    STROKE_COLOR_MAP,
    ERASER_PEN_TYPES,
    HIGHLIGHTER_PEN_TYPES
} from '../../domain/rm-constants'
import { segmentStyle, strokeColour, strokeOpacity } from '../../domain/pen-model'
import { rmPointToPdf, rmWidthToPdf } from './pdf-coordinates'
import { decodeContentStream, extractTextLines, snapPathToLines } from './pdf-text-lines'
import type { TextLine } from './pdf-text-lines'
import type { PageBox } from './pdf-coordinates'

/**
 * Whether a pen lays down translucent wash that the page must show through.
 *
 * These are drawn with a multiply blend rather than plain coverage. The device
 * composites them that way, and it matters even at full alpha: a v2 highlighter
 * records ARGB alpha 255, so drawing it normally paints an opaque bar over the
 * words it was meant to highlight.
 */
function isWash(penType: PenType): boolean {
    return HIGHLIGHTER_PEN_TYPES.has(penType) || PenType.Shader === penType
}

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
 * Read the text line bands of a page from its content stream.
 *
 * Returns an empty list on any failure, which makes the caller fall back to
 * drawing the raw stroke path. A page whose content cannot be read must still
 * render its ink.
 */
function readPageTextLines(
    doc: PDFDocument,
    pdfPage: PDFPage,
    rotate: 0 | 90 | 180 | 270
): readonly TextLine[] {
    // A content stream's text lines are bands of constant y in user space, which
    // only lines up with what the reader sees when the page is not rotated. With
    // /Rotate 90 or 270 the visible lines run the other way, so a "band" would be
    // drawn across the text rather than along it. Fall back to the raw path.
    if (0 !== rotate) return []

    try {
        const contents = pdfPage.node.Contents()
        if (!contents) return []

        // Contents is either one stream or an array of them, and a single
        // logical stream is often split across several objects.
        const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
        const parts: string[] = []

        for (const ref of refs) {
            const stream = doc.context.lookup(ref)
            if (!(stream instanceof PDFRawStream)) continue
            const decoded = decodePDFRawStream(stream).decode()
            const text = decodeContentStream(decoded)
            if (text) parts.push(text)
        }

        if (0 === parts.length) return []
        return extractTextLines(parts.join('\n'))
    } catch (error) {
        log('Could not read text lines for snapping', 'debug', error)
        return []
    }
}

/**
 * Draw a wash stroke as clean bands on the text lines it highlights.
 *
 * Only strokes whose path actually behaves like a line swipe are drawn this
 * way; `snapPathToLines` rejects circles, brackets and fluid shading, which
 * must keep the shape they were drawn in. Returns false when the stroke is not
 * a line highlight, and the caller draws the raw path.
 */
function drawSnappedHighlight(
    pdfPage: PDFPage,
    stroke: Stroke,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270,
    textLines: readonly TextLine[]
): boolean {
    const path = stroke.points.map((p) => rmPointToPdf(p.x, p.y, box, rotate))
    const spans = snapPathToLines(path, textLines)
    if (!spans || 0 === spans.length) {
        return false
    }

    const colour = hexToRgb(strokeColour(stroke))
    const opacity = strokeOpacity(stroke)

    for (const { line, x0, x1 } of spans) {
        pdfPage.drawRectangle({
            x: x0,
            y: line.bottom,
            width: x1 - x0,
            height: line.top - line.bottom,
            color: colour,
            opacity,
            blendMode: BlendMode.Multiply,
            borderWidth: 0
        })
    }

    return true
}

/**
 * Draw one stroke onto a PDF page.
 *
 * Mirrors `stroke-renderer.ts`: eraser strokes are skipped, each segment takes
 * the average width and colour of its two endpoints, and wash pens draw with a
 * multiply blend so the page shows through, as the raster renderer does.
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

    if (isWash(stroke.penType)) {
        drawWashPath(pdfPage, stroke, box, rotate)
        return
    }

    const opacity = strokeOpacity(stroke)

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const style = segmentStyle(stroke, a, b)

        pdfPage.drawLine({
            start: rmPointToPdf(a.x, a.y, box, rotate),
            end: rmPointToPdf(b.x, b.y, box, rotate),
            thickness: Math.max(rmWidthToPdf(style.width, box), MIN_STROKE_WIDTH),
            // Per segment, so textured pens keep their grain
            color: hexToRgb(style.colour),
            opacity,
            lineCap: LineCapStyle.Round // matching the canvas renderer
        })
    }
}

/**
 * Draw a freehand wash stroke as one continuous path.
 *
 * It has to be a single path rather than a segment per point pair. A multiply
 * blend composites each drawing operation separately, so a stroke drawn as
 * hundreds of overlapping segments multiplies itself at every overlap: the ink
 * darkens far past its real colour and the round caps show up as a string of
 * beads. Drawn as one path, the whole stroke composites once, which is what the
 * device does.
 *
 * Safe here precisely because these pens have a fixed nib and a single colour,
 * so nothing varies along the stroke that a single path would flatten. Textured
 * pens keep the per-segment loop for that reason.
 *
 * pdf-lib's SVG paths use the SVG y axis, so the y values are negated and the
 * path is placed at the origin.
 */
function drawWashPath(
    pdfPage: PDFPage,
    stroke: Stroke,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270
): void {
    const points = stroke.points
    const path = points
        .map((p, i) => {
            const { x, y } = rmPointToPdf(p.x, p.y, box, rotate)
            return `${0 === i ? 'M' : 'L'} ${x.toFixed(3)} ${(-y).toFixed(3)}`
        })
        .join(' ')

    const width = segmentStyle(stroke, points[0]!, points[1]!).width

    // Round joins as well as caps: at highlighter widths a mitred corner throws
    // a spike off every turn of the hand.
    pdfPage.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round))
    pdfPage.drawSvgPath(path, {
        x: 0,
        y: 0,
        borderColor: hexToRgb(strokeColour(stroke)),
        borderWidth: Math.max(rmWidthToPdf(width, box), MIN_STROKE_WIDTH),
        borderOpacity: strokeOpacity(stroke),
        borderLineCap: LineCapStyle.Round,
        blendMode: BlendMode.Multiply
    })
    pdfPage.pushOperators(popGraphicsState())
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

        // Text line positions, read once per page and only when a highlighter
        // stroke actually needs them.
        let textLines: readonly TextLine[] | null = null
        const linesForPage = (): readonly TextLine[] => {
            textLines ??= readPageTextLines(doc, pdfPage, rotate)
            return textLines
        }

        for (const stroke of page.strokes) {
            if (
                isWash(stroke.penType) &&
                drawSnappedHighlight(pdfPage, stroke, box, rotate, linesForPage())
            ) {
                continue
            }
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
