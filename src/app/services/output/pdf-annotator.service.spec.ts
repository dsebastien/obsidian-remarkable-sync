import { test, expect, describe } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import { annotateSourcePdf, MAX_SOURCE_PDF_BYTES } from './pdf-annotator.service'
import type { Page, Stroke } from '../../domain/notebook'
import { PenType, StrokeColor } from '../../domain/notebook'

/** A three-page A4 document standing in for an imported PDF. */
async function sourcePdf(pages = 3): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.setTitle('Original title')
    for (let i = 0; i < pages; i++) doc.addPage([595, 841.9])
    const bytes = await doc.save({ useObjectStreams: false })
    const out = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(out).set(bytes)
    return out
}

function stroke(penType = PenType.BallPointV2, color = StrokeColor.Black): Stroke {
    return {
        penType,
        color,
        thickness: 2,
        points: [
            { x: -100, y: 400, speed: 1, width: 4, direction: 0, pressure: 1 },
            { x: 0, y: 500, speed: 1, width: 4, direction: 0, pressure: 1 },
            { x: 100, y: 600, speed: 1, width: 4, direction: 0, pressure: 1 }
        ]
    }
}

const layer = (pageIndex: number, sourcePageIndex?: number, strokes = [stroke()]): Page => ({
    pageId: `p${pageIndex}`,
    pageIndex,
    strokes,
    ...(undefined === sourcePageIndex ? {} : { sourcePageIndex })
})

describe('annotateSourcePdf', () => {
    test('draws onto the mapped source page and keeps every page', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [layer(0, 0)])

        expect(result).not.toBeNull()
        expect(result!.annotatedPages).toBe(1)
        expect(result!.skippedPages).toBe(0)

        const doc = await PDFDocument.load(result!.data)
        expect(doc.getPageCount()).toBe(3)
    })

    test('preserves the source document metadata rather than restamping it', async () => {
        const source = await sourcePdf()
        const before = await PDFDocument.load(source)

        const result = await annotateSourcePdf(source, [layer(0, 0)])
        const after = await PDFDocument.load(result!.data)

        expect(after.getTitle()).toBe('Original title')
        // Whatever the source carried is carried through untouched. pdf-lib's
        // own metadata setters stamp a Producer, so the fixture has one; the
        // point is that annotating does not replace it.
        expect(after.getProducer()).toBe(before.getProducer())
        expect(after.getModificationDate()?.getTime()).toBe(before.getModificationDate()?.getTime())
    })

    test('is byte-identical across runs, so re-syncing does not churn', async () => {
        const source = await sourcePdf()
        const a = await annotateSourcePdf(source, [layer(0, 0)])
        await new Promise((r) => setTimeout(r, 1100))
        const b = await annotateSourcePdf(source, [layer(0, 0)])

        expect(new Uint8Array(a!.data)).toEqual(new Uint8Array(b!.data))
    })

    /**
     * A page inserted on the device has no counterpart in the source. Drawing
     * it anywhere would put ink on an unrelated page.
     */
    test('skips layers with no source page instead of guessing page 0', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [layer(0), layer(1)])

        expect(result!.annotatedPages).toBe(0)
        expect(result!.skippedPages).toBe(2)
    })

    test('skips a source page index beyond the end of the document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(2), [layer(0, 0), layer(1, 99)])

        expect(result!.annotatedPages).toBe(1)
        expect(result!.skippedPages).toBe(1)
    })

    test('annotates several pages of one document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [
            layer(0, 0),
            layer(1, 1),
            layer(2, 2)
        ])

        expect(result!.annotatedPages).toBe(3)
    })

    test('eraser strokes are skipped, matching the raster renderer', async () => {
        const source = await sourcePdf()
        const withEraser = await annotateSourcePdf(source, [
            layer(0, 0, [stroke(), stroke(PenType.Eraser)])
        ])
        const withoutEraser = await annotateSourcePdf(source, [layer(0, 0, [stroke()])])

        expect(new Uint8Array(withEraser!.data)).toEqual(new Uint8Array(withoutEraser!.data))
    })

    test('a highlighter produces different output from a ballpoint', async () => {
        const source = await sourcePdf()
        const ballpoint = await annotateSourcePdf(source, [layer(0, 0, [stroke()])])
        const highlighter = await annotateSourcePdf(source, [
            layer(0, 0, [stroke(PenType.HighlighterV2, 9 as StrokeColor)])
        ])

        expect(new Uint8Array(ballpoint!.data)).not.toEqual(new Uint8Array(highlighter!.data))
    })

    test('a single-point stroke draws nothing rather than throwing', async () => {
        const single: Stroke = {
            ...stroke(),
            points: [{ x: 0, y: 0, speed: 1, width: 4, direction: 0, pressure: 1 }]
        }
        const result = await annotateSourcePdf(await sourcePdf(), [layer(0, 0, [single])])

        expect(result).not.toBeNull()
        expect(result!.annotatedPages).toBe(1)
    })

    test('returns null for an unreadable or encrypted source', async () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer
        expect(await annotateSourcePdf(garbage, [layer(0, 0)])).toBeNull()
    })

    test('refuses a source above the size guard instead of exhausting memory', async () => {
        const huge = new ArrayBuffer(MAX_SOURCE_PDF_BYTES + 1)
        expect(await annotateSourcePdf(huge, [layer(0, 0)])).toBeNull()
    })

    test('no layers at all still returns a valid untouched document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [])

        expect(result!.annotatedPages).toBe(0)
        const doc = await PDFDocument.load(result!.data)
        expect(doc.getPageCount()).toBe(3)
    })
})
