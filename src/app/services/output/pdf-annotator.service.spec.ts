import { test, expect, describe } from 'bun:test'
import { PDFDict, PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib'
import { annotateSourcePdf, MAX_SOURCE_PDF_BYTES } from './pdf-annotator.service'
import type { AnnotateFailure, AnnotateResult } from './pdf-annotator.service'
import { LOCKED_PDF_FIXTURES } from './fixtures/locked-pdfs'
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

/** Narrow an outcome to a success, failing the test with the reason otherwise. */
function ok(outcome: AnnotateResult | AnnotateFailure): AnnotateResult {
    if ('failure' in outcome) throw new Error(`annotation failed: ${outcome.failure}`)
    return outcome
}

/** The producer every locked fixture records in its information dictionary. */
const FIXTURE_PRODUCER = 'pdf-lib (https://github.com/Hopding/pdf-lib)'

/** A PDF locked once with qpdf; see `fixtures/locked-pdfs.ts`. */
function fixture(name: string): ArrayBuffer {
    const encoded = LOCKED_PDF_FIXTURES[name]
    if (!encoded) throw new Error(`no fixture named ${name}`)
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
}

describe('annotateSourcePdf', () => {
    /**
     * Regression: highlight text used to be embedded with `PDFString.of`,
     * which does no escaping — an unbalanced ')' or a backslash corrupted the
     * annotation dictionary, and non-ASCII text was written as raw UTF-8 that
     * readers decode as PDFDocEncoding. The hex-string encoding survives both.
     */
    test('hostile and non-ASCII highlight text survives a save/load round-trip', async () => {
        const text = 'a) \\ (b — café 😀'
        const highlighted: Page = {
            pageId: 'h0',
            pageIndex: 0,
            strokes: [],
            sourcePageIndex: 0,
            highlights: [
                {
                    text,
                    color: StrokeColor.Black,
                    rects: [{ x: -100, y: 100, width: 200, height: 30 }]
                }
            ]
        }

        const result = await annotateSourcePdf(await sourcePdf(), [highlighted])
        expect(ok(result).highlights).toBe(1)

        // The output must still be a readable PDF, and the text must survive
        // exactly. Under the old encoding the parser only recovered a
        // truncated, mangled string.
        const doc = await PDFDocument.load(ok(result).data)
        expect(doc.getPageCount()).toBe(3)
        const annots = doc.getPage(0).node.Annots()
        expect(annots?.size()).toBe(1)
        const dict = doc.context.lookup(annots!.get(0), PDFDict)
        const contents = dict.get(PDFName.of('Contents'))
        expect(contents).toBeInstanceOf(PDFHexString)
        expect((contents as PDFHexString).decodeText()).toBe(text)
    })

    test('draws onto the mapped source page and keeps every page', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [layer(0, 0)])

        expect(ok(result).annotatedPages).toBe(1)
        expect(ok(result).skippedPages).toBe(0)

        const doc = await PDFDocument.load(ok(result).data)
        expect(doc.getPageCount()).toBe(3)
    })

    test('preserves the source document metadata rather than restamping it', async () => {
        const source = await sourcePdf()
        const before = await PDFDocument.load(source)

        const result = await annotateSourcePdf(source, [layer(0, 0)])
        const after = await PDFDocument.load(ok(result).data)

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
        await new Promise((r) => window.setTimeout(r, 1100))
        const b = await annotateSourcePdf(source, [layer(0, 0)])

        expect(new Uint8Array(ok(a).data)).toEqual(new Uint8Array(ok(b).data))
    })

    /**
     * A page inserted on the device has no counterpart in the source. Drawing
     * it anywhere would put ink on an unrelated page.
     */
    test('skips layers with no source page instead of guessing page 0', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [layer(0), layer(1)])

        expect(ok(result).annotatedPages).toBe(0)
        expect(ok(result).skippedPages).toBe(2)
    })

    test('skips a source page index beyond the end of the document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(2), [layer(0, 0), layer(1, 99)])

        expect(ok(result).annotatedPages).toBe(1)
        expect(ok(result).skippedPages).toBe(1)
    })

    test('annotates several pages of one document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [
            layer(0, 0),
            layer(1, 1),
            layer(2, 2)
        ])

        expect(ok(result).annotatedPages).toBe(3)
    })

    test('eraser strokes are skipped, matching the raster renderer', async () => {
        const source = await sourcePdf()
        const withEraser = await annotateSourcePdf(source, [
            layer(0, 0, [stroke(), stroke(PenType.Eraser)])
        ])
        const withoutEraser = await annotateSourcePdf(source, [layer(0, 0, [stroke()])])

        expect(new Uint8Array(ok(withEraser).data)).toEqual(new Uint8Array(ok(withoutEraser).data))
    })

    test('a highlighter produces different output from a ballpoint', async () => {
        const source = await sourcePdf()
        const ballpoint = await annotateSourcePdf(source, [layer(0, 0, [stroke()])])
        const highlighter = await annotateSourcePdf(source, [
            layer(0, 0, [stroke(PenType.HighlighterV2, 9)])
        ])

        expect(new Uint8Array(ok(ballpoint).data)).not.toEqual(new Uint8Array(ok(highlighter).data))
    })

    test('a single-point stroke draws a dot, matching the raster renderer', async () => {
        const single: Stroke = {
            ...stroke(),
            points: [{ x: 0, y: 0, speed: 1, width: 4, direction: 0, pressure: 1 }]
        }
        const source = await sourcePdf()
        const withDot = await annotateSourcePdf(source, [layer(0, 0, [single])])
        const withNothing = await annotateSourcePdf(source, [layer(0, 0, [])])

        expect(ok(withDot).annotatedPages).toBe(1)
        // The tap must leave a mark: pen taps silently vanished before.
        expect(new Uint8Array(ok(withDot).data)).not.toEqual(new Uint8Array(ok(withNothing).data))
    })

    test('an unreadable source reports why', async () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer
        expect(await annotateSourcePdf(garbage, [layer(0, 0)])).toEqual({ failure: 'unreadable' })
    })

    test('refuses a source above the size guard instead of exhausting memory', async () => {
        const huge = new ArrayBuffer(MAX_SOURCE_PDF_BYTES + 1)
        expect(await annotateSourcePdf(huge, [layer(0, 0)])).toEqual({ failure: 'too-large' })
    })

    /**
     * Issue #47. Library databases lock their PDFs with an owner password to
     * restrict copying and printing. Such a file opens in any reader without
     * a prompt and the device annotates it normally, but upstream pdf-lib
     * refused it, so the original was written and the annotated copy never
     * appeared. The fixtures cover every revision of the standard security
     * handler a PDF without vendor DRM can use.
     */
    for (const name of [
        'owner-locked-rc4-40.pdf',
        'owner-locked-rc4-128.pdf',
        'owner-locked-aes-128.pdf',
        'owner-locked-aes-256.pdf'
    ]) {
        test(`annotates a source locked with an owner password only (${name})`, async () => {
            const result = ok(await annotateSourcePdf(fixture(name), [layer(0, 1)]))
            expect(result.annotatedPages).toBe(1)

            // The output is unlocked and still a complete, readable document.
            const doc = await PDFDocument.load(result.data)
            expect(doc.isEncrypted).toBe(false)
            expect(doc.getPageCount()).toBe(3)
            expect(doc.getProducer()).toBe(FIXTURE_PRODUCER)
        })

        /**
         * The source's trailer lives in a cross-reference stream, which the
         * decrypting parse garbles: `/Info` and `/ID` were lost, and only a
         * lenient reader that rebuilt the trailer from the dead stream still
         * found the metadata. Read from the saved file's own trailer, the way
         * a strict reader does.
         */
        test(`keeps the source's trailer when annotating a locked source (${name})`, async () => {
            const result = ok(await annotateSourcePdf(fixture(name), [layer(0, 1)]))
            const text = new TextDecoder('latin1').decode(result.data)

            const trailer = text.slice(text.lastIndexOf('trailer'))
            expect(trailer).toMatch(/\/Info \d+ 0 R/)
            expect(trailer).toMatch(/\/ID \[/)
            expect(trailer).not.toContain('/Encrypt')
            expect(text).not.toContain('/XRef')
        })
    }

    test('a source that needs a real password reports it, rather than guessing', async () => {
        const outcome = await annotateSourcePdf(fixture('user-locked-aes-256.pdf'), [layer(0, 0)])
        expect(outcome).toEqual({ failure: 'needs-password' })
    })

    test('no layers at all still returns a valid untouched document', async () => {
        const result = await annotateSourcePdf(await sourcePdf(), [])

        expect(ok(result).annotatedPages).toBe(0)
        const doc = await PDFDocument.load(ok(result).data)
        expect(doc.getPageCount()).toBe(3)
    })
})
