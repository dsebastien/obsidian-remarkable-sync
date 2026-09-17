import { test, expect, describe } from 'bun:test'
import { computeStrokesBounds, computePageBounds } from './stroke-bounds'
import { PenType, StrokeColor } from '../../domain/notebook'
import type { Page, PageImage, Stroke, StrokePoint } from '../../domain/notebook'

function makePoint(x: number, y: number, width = 0): StrokePoint {
    return { x, y, speed: 0, width, direction: 0, pressure: 0 }
}

function makeStroke(
    penType: PenType,
    points: StrokePoint[],
    thickness = 1,
    color = StrokeColor.Black
): Stroke {
    return { penType, color, thickness, points }
}

describe('computeStrokesBounds', () => {
    test('returns null for empty stroke array', () => {
        expect(computeStrokesBounds([])).toBeNull()
    })

    test('returns null when only eraser strokes are present', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Eraser, [makePoint(0, 0)]),
            makeStroke(PenType.EraseArea, [makePoint(100, 100)])
        ]
        expect(computeStrokesBounds(strokes)).toBeNull()
    })

    test('returns null when strokes have no points', () => {
        const strokes: Stroke[] = [makeStroke(PenType.Fineliner, [])]
        expect(computeStrokesBounds(strokes)).toBeNull()
    })

    test('single zero-width point produces a half-pixel halo', () => {
        const strokes: Stroke[] = [makeStroke(PenType.Fineliner, [makePoint(10, 20, 0)])]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Minimum radius is clamped to 0.5 so bounds become a 1px box around the point.
        expect(bounds!.minX).toBe(9.5)
        expect(bounds!.maxX).toBe(10.5)
        expect(bounds!.minY).toBe(19.5)
        expect(bounds!.maxY).toBe(20.5)
    })

    test('expands bounds by per-point rendered radius', () => {
        // BallPoint multiplier is 0.5, thickness 2, point.width 4 → radius 2.0
        const strokes: Stroke[] = [makeStroke(PenType.BallPoint, [makePoint(0, 0, 4)], 2)]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.minX).toBe(-2)
        expect(bounds!.maxX).toBe(2)
        expect(bounds!.minY).toBe(-2)
        expect(bounds!.maxY).toBe(2)
    })

    test('aggregates across multiple strokes and points', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(-100, 50), makePoint(100, 50)]),
            makeStroke(PenType.Fineliner, [makePoint(0, 2000), makePoint(0, 3000)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Fineliner: multiplier 0.25, thickness 1, width 0 → radius clamped to 0.5
        expect(bounds!.minX).toBe(-100.5)
        expect(bounds!.maxX).toBe(100.5)
        expect(bounds!.minY).toBe(49.5)
        expect(bounds!.maxY).toBe(3000.5)
    })

    test('handles content extending below the standard page height (issue #3)', () => {
        // A user who scrolled while writing produces strokes well past PAGE_HEIGHT (1872).
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(0, 0), makePoint(0, 5000)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.maxY).toBeGreaterThan(1872)
    })

    test('handles negative Y values', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Fineliner, [makePoint(0, -50), makePoint(0, 50)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        expect(bounds!.minY).toBe(-50.5)
        expect(bounds!.maxY).toBe(50.5)
    })

    test('ignores eraser strokes when other strokes are present', () => {
        const strokes: Stroke[] = [
            makeStroke(PenType.Eraser, [makePoint(-9999, -9999)]),
            makeStroke(PenType.Fineliner, [makePoint(0, 0)])
        ]
        const bounds = computeStrokesBounds(strokes)
        expect(bounds).not.toBeNull()
        // Eraser bounds at -9999 must NOT extend the box.
        expect(bounds!.minX).toBeGreaterThan(-1)
        expect(bounds!.minY).toBeGreaterThan(-1)
    })
})

function makeImage(
    x: number,
    y: number,
    width: number,
    height: number,
    data: ArrayBuffer | null = new ArrayBuffer(4)
): PageImage {
    return { assetId: 'asset', fileName: 'capture.png', x, y, width, height, data }
}

function makePage(strokes: Stroke[], images: PageImage[]): Page {
    return { pageId: 'page', pageIndex: 0, strokes, images }
}

describe('computePageBounds', () => {
    test('returns null for a page with nothing on it', () => {
        expect(computePageBounds(makePage([], []))).toBeNull()
    })

    test('covers an image on a page with no strokes', () => {
        // Issue #36: a capture-only page used to have no bounds at all, so it
        // never rendered.
        const bounds = computePageBounds(makePage([], [makeImage(-100, 200, 400, 300)]))

        expect(bounds).toEqual({ minX: -100, maxX: 300, minY: 200, maxY: 500 })
    })

    test('unions strokes and images', () => {
        const strokes = [makeStroke(PenType.FinelinerV2, [makePoint(0, 0), makePoint(50, 50)])]
        const bounds = computePageBounds(makePage(strokes, [makeImage(-200, 100, 100, 900)]))

        expect(bounds!.minX).toBe(-200)
        expect(bounds!.maxX).toBeGreaterThanOrEqual(50)
        expect(bounds!.minY).toBeLessThanOrEqual(0)
        expect(bounds!.maxY).toBe(1000)
    })

    test('ignores an image whose PNG never arrived', () => {
        const page = makePage([], [makeImage(-100, 200, 400, 300, null)])

        expect(computePageBounds(page)).toBeNull()
    })

    test('falls back to stroke bounds when images have no data', () => {
        const strokes = [makeStroke(PenType.FinelinerV2, [makePoint(10, 20)])]
        const page = makePage(strokes, [makeImage(-999, -999, 10, 10, null)])
        const bounds = computePageBounds(page)

        expect(bounds!.minX).toBeGreaterThan(-999)
    })
})

describe('computePageBounds placement sanity', () => {
    test('ignores an implausible placement instead of sizing the canvas to it', () => {
        const strokes = [makeStroke(PenType.FinelinerV2, [makePoint(0, 0), makePoint(50, 50)])]
        const absurd = makeImage(-1e6, -1e6, 2e6, 2e6)
        const bounds = computePageBounds(makePage(strokes, [absurd]))

        expect(bounds).toEqual(computeStrokesBounds(strokes))
    })

    test('keeps a capture that merely sits outside the standard page', () => {
        // Scrolled pages legitimately carry content past the viewport, so the
        // sanity bound must not double as a page-fit check.
        const scrolled = makeImage(-700, 3000, 1400, 1800)
        const bounds = computePageBounds(makePage([], [scrolled]))

        expect(bounds).toEqual({ minX: -700, maxX: 700, minY: 3000, maxY: 4800 })
    })

    test('a page with no images has exactly the bounds it had before captures existed', () => {
        // Locks in the no-regression property for the users who have no
        // captures at all, which is almost all of them.
        const cases = [
            [makeStroke(PenType.FinelinerV2, [makePoint(0, 0), makePoint(100, 200)])],
            [makeStroke(PenType.BallPoint, [makePoint(-50, -20)], 3)],
            [makeStroke(PenType.Eraser, [makePoint(10, 10)])]
        ]

        for (const strokes of cases) {
            expect(computePageBounds(makePage(strokes, []))).toEqual(computeStrokesBounds(strokes))
        }
    })
})
