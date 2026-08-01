import { test, expect, describe } from 'bun:test'
import { pdfScaleForPage, rmPointToPdf, rmWidthToPdf } from './pdf-coordinates'
import type { PageBox } from './pdf-coordinates'

const A4: PageBox = { x: 0, y: 0, width: 595.0, height: 841.9 }
const LETTER: PageBox = { x: 0, y: 0, width: 612.0, height: 792.0 }

describe('pdfScaleForPage', () => {
    test('A4 and US Letter match the values measured on real exports', () => {
        expect(pdfScaleForPage(A4)).toBeCloseTo(0.3178, 4)
        expect(pdfScaleForPage(LETTER)).toBeCloseTo(0.3269, 4)
    })

    test('the page width always spans 1872 rm units', () => {
        for (const box of [A4, LETTER, { x: 0, y: 0, width: 1000, height: 500 }]) {
            expect(1872 * pdfScaleForPage(box)).toBeCloseTo(box.width, 6)
        }
    })

    test('scale depends on width only, never on height', () => {
        const tall = { x: 0, y: 0, width: 595, height: 2000 }
        expect(pdfScaleForPage(tall)).toBe(pdfScaleForPage(A4))
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
     * The landmark that pinned the whole transform. On the real resume export
     * the leftmost ink point (an arrow tip) sits at rm (6.2, 835.5) and points
     * at "Senior IT Engineer", which the PDF text layer places at
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

        expect(841.9 - top.y).toBeCloseTo(609, 0) // y from top
        expect(841.9 - bottom.y).toBeCloseTo(729, 0)
        expect(top.x).toBeCloseTo(225, 0)
        expect(bottom.x).toBeCloseTo(468, 0)

        for (const p of [top, bottom]) {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x).toBeLessThanOrEqual(A4.width)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeLessThanOrEqual(A4.height)
        }
    })

    test('ink may exceed 1872 in y, since the page is 2649 rm units tall for A4', () => {
        const deepest = rmPointToPdf(0, 2649, A4)
        expect(deepest.y).toBeCloseTo(0, 0) // the very bottom of the page
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
    test('scales with the page', () => {
        expect(rmWidthToPdf(10, A4)).toBeCloseTo(3.178, 3)
        expect(rmWidthToPdf(10, LETTER)).toBeCloseTo(3.269, 3)
    })

    test('zero width stays zero', () => {
        expect(rmWidthToPdf(0, A4)).toBe(0)
    })
})
