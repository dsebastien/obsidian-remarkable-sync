import {
    BlendMode,
    LineCapStyle,
    LineJoinStyle,
    PDFDocument,
    PDFHexString,
    PDFNumber,
    popGraphicsState,
    pushGraphicsState,
    rgb,
    setLineJoin
} from 'pdf-lib'
import type { PDFPage, PDFRef } from 'pdf-lib'
import { log } from '../../../utils/log'
import { PenType } from '../../domain/notebook'
import type { Highlight, Page, Stroke } from '../../domain/notebook'
import { ERASER_PEN_TYPES, HIGHLIGHTER_PEN_TYPES } from '../../domain/rm-constants'
import {
    highlightColour,
    highlightOpacity,
    segmentStyle,
    strokeColour,
    strokeOpacity
} from '../../domain/pen-model'
import { rmPointToPdf, rmWidthToPdf } from './pdf-coordinates'
import type { PageBox } from './pdf-coordinates'
import type { DeviceScreen } from '../../domain/device-screen'

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
 * the average width and colour of its two endpoints, and wash pens draw with a
 * multiply blend so the page shows through, as the raster renderer does.
 */
function drawStroke(
    pdfPage: PDFPage,
    stroke: Stroke,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270,
    screen: DeviceScreen | undefined
): void {
    if (ERASER_PEN_TYPES.has(stroke.penType)) {
        return
    }

    const points = stroke.points
    if (0 === points.length) {
        return
    }

    if (1 === points.length) {
        // A pen tap. The raster renderer draws it as a dot; dropping it from
        // the PDF made the two outputs disagree.
        const point = points[0]!
        const style = segmentStyle(stroke, point, point)
        const centre = rmPointToPdf(point.x, point.y, box, rotate, screen)
        const radius = Math.max(rmWidthToPdf(style.width, box, screen), MIN_STROKE_WIDTH) / 2
        pdfPage.drawCircle({
            x: centre.x,
            y: centre.y,
            size: radius,
            color: hexToRgb(style.colour),
            opacity: strokeOpacity(stroke)
        })
        return
    }

    if (isWash(stroke.penType)) {
        drawWashPath(pdfPage, stroke, box, rotate, screen)
        return
    }

    const opacity = strokeOpacity(stroke)

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const style = segmentStyle(stroke, a, b)

        pdfPage.drawLine({
            start: rmPointToPdf(a.x, a.y, box, rotate, screen),
            end: rmPointToPdf(b.x, b.y, box, rotate, screen),
            thickness: Math.max(rmWidthToPdf(style.width, box, screen), MIN_STROKE_WIDTH),
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
    rotate: 0 | 90 | 180 | 270,
    screen: DeviceScreen | undefined
): void {
    const points = stroke.points
    const path = points
        .map((p, i) => {
            const { x, y } = rmPointToPdf(p.x, p.y, box, rotate, screen)
            return `${0 === i ? 'M' : 'L'} ${x.toFixed(3)} ${(-y).toFixed(3)}`
        })
        .join(' ')

    // The average over the stroke, not the first segment: the shading
    // marker's width varies with the recorded per-point data, and a single
    // path can only carry one width.
    let widthSum = 0
    for (let i = 0; i < points.length - 1; i++) {
        widthSum += segmentStyle(stroke, points[i]!, points[i + 1]!).width
    }
    const width = widthSum / (points.length - 1)

    // Round joins as well as caps: at highlighter widths a mitred corner throws
    // a spike off every turn of the hand.
    pdfPage.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round))
    pdfPage.drawSvgPath(path, {
        x: 0,
        y: 0,
        borderColor: hexToRgb(strokeColour(stroke)),
        borderWidth: Math.max(rmWidthToPdf(width, box, screen), MIN_STROKE_WIDTH),
        borderOpacity: strokeOpacity(stroke),
        // The highlighter is a flat nib: librm_lines gives it a flat cap and a
        // bevel join, and only the shader gets round caps.
        borderLineCap: PenType.Shader === stroke.penType ? LineCapStyle.Round : LineCapStyle.Butt,
        // Only the highlighter multiplies. The shader composites normally with
        // its own recorded alpha, which is a different look, and treating both
        // the same way was our own conflation.
        ...(PenType.Shader === stroke.penType ? {} : { blendMode: BlendMode.Multiply })
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
    rotate: 0 | 90 | 180 | 270,
    screen: DeviceScreen | undefined
): boolean {
    if (highlight.rects.length === 0) {
        return false
    }

    const quads: number[] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    /** Axis-aligned box per quad, for the appearance stream */
    const boxes: { x: number; y: number; width: number; height: number }[] = []

    for (const r of highlight.rects) {
        const topLeft = rmPointToPdf(r.x, r.y, box, rotate, screen)
        const topRight = rmPointToPdf(r.x + r.width, r.y, box, rotate, screen)
        const bottomLeft = rmPointToPdf(r.x, r.y + r.height, box, rotate, screen)
        const bottomRight = rmPointToPdf(r.x + r.width, r.y + r.height, box, rotate, screen)

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

        const corners = [topLeft, topRight, bottomLeft, bottomRight]
        const xs = corners.map((p) => p.x)
        const ys = corners.map((p) => p.y)
        // A quarter-turn maps a rectangle onto another rectangle, so the corner
        // bounds are the quad itself at every rotation we support.
        boxes.push({
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys)
        })

        for (const p of corners) {
            minX = Math.min(minX, p.x)
            maxX = Math.max(maxX, p.x)
            minY = Math.min(minY, p.y)
            maxY = Math.max(maxY, p.y)
        }
    }

    const colour = hexToRgb(highlightColour(highlight))
    const opacity = highlightOpacity(highlight)

    const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Highlight',
        Rect: [minX, minY, maxX, maxY].map((n) => PDFNumber.of(n)),
        QuadPoints: quads.map((n) => PDFNumber.of(n)),
        C: [colour.red, colour.green, colour.blue].map((n) => PDFNumber.of(n)),
        // The alpha lives in the appearance stream, so it must not be applied a
        // second time here.
        CA: PDFNumber.of(1),
        AP: doc.context.obj({
            N: highlightAppearance(doc, boxes, [minX, minY, maxX, maxY], colour, opacity)
        }),
        // The selected text itself, so readers can show and extract it.
        // A hex string, not a literal one: pdf-lib's PDFString.of does no
        // escaping, so a highlight containing an unbalanced ')' or a
        // backslash would corrupt the object, and non-ASCII text would be
        // written as raw UTF-8 bytes that readers interpret as PDFDocEncoding.
        // PDFHexString.fromText encodes as UTF-16BE with a BOM, which the PDF
        // specification defines for any text string.
        Contents: PDFHexString.fromText(highlight.text),
        F: PDFNumber.of(4) // Print
    })

    pdfPage.node.addAnnot(doc.context.register(annot))
    return true
}

/**
 * Build the appearance stream for a highlight annotation.
 *
 * Without one, a `/Highlight` is only a set of quads and every reader paints it
 * however it likes: each insets the band by its own margin, so the same file
 * shows a band a pixel or two off from one viewer to the next, and ours read
 * 7-10% larger than the device's by area. With an appearance stream the band is
 * exactly the rectangle we specify, everywhere.
 *
 * The multiply blend is what the device does. Its render of the sample shows the
 * highlighter as pure `#acff85`, which is the recorded colour multiplied over
 * white at full alpha rather than mixed with it.
 */
function highlightAppearance(
    doc: PDFDocument,
    boxes: readonly { x: number; y: number; width: number; height: number }[],
    bbox: readonly [number, number, number, number] | number[],
    colour: ReturnType<typeof rgb>,
    opacity: number
): PDFRef {
    const graphicsState = doc.context.obj({
        Type: 'ExtGState',
        BM: 'Multiply',
        ca: PDFNumber.of(opacity),
        CA: PDFNumber.of(opacity)
    })

    const n = (v: number): string => v.toFixed(4)
    const content = [
        '/GS0 gs',
        `${n(colour.red)} ${n(colour.green)} ${n(colour.blue)} rg`,
        ...boxes.map((b) => `${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)} re`),
        'f'
    ].join('\n')

    const stream = doc.context.flateStream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: bbox.map((v) => PDFNumber.of(v)),
        Resources: doc.context.obj({
            ExtGState: doc.context.obj({ GS0: doc.context.register(graphicsState) })
        }),
        // A transparency group, so the blend composites against the page rather
        // than against nothing.
        Group: doc.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' })
    })

    return doc.context.register(stream)
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
    pages: readonly Page[],
    screen?: DeviceScreen
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
        // Normalised into [0, 360): the specification allows negative
        // multiples of 90, and `-90 % 360` is `-90` in JavaScript.
        const rotate = (((pdfPage.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270

        // Text highlights first, so ink drawn afterwards sits above them
        for (const highlight of page.highlights ?? []) {
            if (addHighlightAnnotation(doc, pdfPage, highlight, box, rotate, screen)) highlights++
        }

        for (const stroke of page.strokes) {
            drawStroke(pdfPage, stroke, box, rotate, screen)
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
