import { test, expect, describe } from 'bun:test'
import { pdfScaleForPage, rmPointToPdf, rmWidthToPdf } from './pdf-coordinates'
import type { PageBox } from './pdf-coordinates'

const A4: PageBox = { x: 0, y: 0, width: 595.0, height: 841.9 }
const LETTER: PageBox = { x: 0, y: 0, width: 612.0, height: 792.0 }

describe('pdfScaleForPage', () => {
    /**
     * Measured from the device's own thumbnail render of the sample, using the
     * two text-highlight rectangles whose .rm coordinates are known: 0.317147
     * pt per unit across a band's width and 0.317162 from the gap between two
     * bands, an implied 227.0 dpi on both axes.
     */
    test('the scale is the device resolution, about 227 dpi', () => {
        expect(pdfScaleForPage(A4)).toBeCloseTo(0.31698, 5)
        expect(72 / pdfScaleForPage(A4)).toBeCloseTo(227.14, 2)
    })

    /**
     * The defect this replaced: the scale used to be `width / 1872`, fitting
     * every page to a fixed 1872 units. A page is really placed at its physical
     * size, so its width in units depends on how many inches wide it is. A4 at
     * 8.268 in is 1877 units, which is only 0.3% from 1872 and is why the error
     * survived a landmark check; US Letter at 8.5 in is 1931, where the same
     * fit is off by 3.1%.
     */
    test('a page spans its physical width in rm units, not a fixed 1872', () => {
        expect(A4.width / pdfScaleForPage(A4)).toBeCloseTo(1877, 0)
        expect(LETTER.width / pdfScaleForPage(LETTER)).toBeCloseTo(1931, 0)
    })

    test('the scale is constant, independent of page size', () => {
        const tall = { x: 0, y: 0, width: 595, height: 2000 }
        const wide = { x: 0, y: 0, width: 1000, height: 500 }
        expect(pdfScaleForPage(tall)).toBe(pdfScaleForPage(A4))
        expect(pdfScaleForPage(wide)).toBe(pdfScaleForPage(LETTER))
    })
})

describe('rmPointToPdf', () => {
    test('rm x of zero is the horizontal centre of the page', () => {
        expect(rmPointToPdf(0, 0, A4).x).toBeCloseTo(297.5, 6)
    })

    test('rm y of zero is the top of the page', () => {
        expect(rmPointToPdf(0, 0, A4).y).toBeCloseTo(841.9, 6)
    })

    test('y flips: increasing rm y moves down the page', () => {
        const top = rmPointToPdf(0, 100, A4)
        const lower = rmPointToPdf(0, 200, A4)
        expect(lower.y).toBeLessThan(top.y)
    })

    test('negative rm x is left of centre, positive is right', () => {
        expect(rmPointToPdf(-100, 0, A4).x).toBeLessThan(297.5)
        expect(rmPointToPdf(100, 0, A4).x).toBeGreaterThan(297.5)
    })

    /**
     * The landmark that pinned the whole transform. On a real device export
     * the leftmost ink point (an arrow tip) sits at rm (6.2, 835.5) and points
     * at "a known heading", which the PDF text layer places at
     * x 215.9..295.6, PDF y 565.1..574.9.
     */
    test('the arrow tip lands on its target word (real export landmark)', () => {
        const p = rmPointToPdf(6.2, 835.5, A4)
        expect(p.x).toBeGreaterThan(295.6) // just right of the word
        expect(p.x).toBeLessThan(310)
        expect(p.y).toBeGreaterThan(560)
        expect(p.y).toBeLessThan(580)
    })

    /**
     * Out-of-sample check: a highlighter stroke drawn after the transform was
     * fixed. Its y reaches 2294, far past 1872, which the earlier height-fit
     * model placed off the bottom of the page.
     */
    test('the highlighter stroke lands on the page (out-of-sample)', () => {
        const top = rmPointToPdf(-229, 1916, A4)
        const bottom = rmPointToPdf(536, 2294, A4)

        expect(841.9 - top.y).toBeCloseTo(607, 0) // y from top
        expect(841.9 - bottom.y).toBeCloseTo(727, 0)
        expect(top.x).toBeCloseTo(225, 0)
        expect(bottom.x).toBeCloseTo(467, 0)

        for (const p of [top, bottom]) {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x).toBeLessThanOrEqual(A4.width)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeLessThanOrEqual(A4.height)
        }
    })

    test('ink may exceed 1872 in y, since A4 is 2656 rm units tall', () => {
        const deepest = rmPointToPdf(0, 841.9 / pdfScaleForPage(A4), A4)
        expect(deepest.y).toBeCloseTo(0, 6) // the very bottom of the page
        expect(841.9 / pdfScaleForPage(A4)).toBeCloseTo(2656, 0)
    })

    test('honours a crop box offset from the origin', () => {
        const offset: PageBox = { x: 20, y: 30, width: 595.0, height: 841.9 }
        const base = rmPointToPdf(100, 200, A4)
        const shifted = rmPointToPdf(100, 200, offset)

        expect(shifted.x).toBeCloseTo(base.x + 20, 6)
        expect(shifted.y).toBeCloseTo(base.y + 30, 6)
    })

    describe('rotation (written from spec, not verified against a real export)', () => {
        test('180 mirrors both axes', () => {
            const upright = rmPointToPdf(120, 300, A4, 0)
            const flipped = rmPointToPdf(120, 300, A4, 180)

            expect(flipped.x).toBeCloseTo(A4.width - (upright.x - A4.x) + A4.x, 6)
            expect(flipped.y).toBeCloseTo(A4.height - (upright.y - A4.y) + A4.y, 6)
        })

        test('90 and 270 swap the axes', () => {
            const p90 = rmPointToPdf(0, 400, A4, 90)
            const p270 = rmPointToPdf(0, 400, A4, 270)
            // down-the-page becomes across-the-page
            expect(p90.x).toBeCloseTo(400 * pdfScaleForPage(A4), 6)
            expect(p270.x).toBeCloseTo(A4.width - 400 * pdfScaleForPage(A4), 6)
        })

        test('every rotation is deterministic and finite', () => {
            for (const r of [0, 90, 180, 270] as const) {
                const p = rmPointToPdf(50, 50, A4, r)
                expect(Number.isFinite(p.x)).toBe(true)
                expect(Number.isFinite(p.y)).toBe(true)
            }
        })
    })
})

describe('rmWidthToPdf', () => {
    test('is the same on every page, since the scale is physical', () => {
        expect(rmWidthToPdf(10, A4)).toBeCloseTo(3.17, 2)
        expect(rmWidthToPdf(10, LETTER)).toBe(rmWidthToPdf(10, A4))
    })

    test('zero width stays zero', () => {
        expect(rmWidthToPdf(0, A4)).toBe(0)
    })
})
