import { test, expect, describe } from 'bun:test'
import { extractTextLines, lineAt, decodeContentStream, snapPathToLines } from './pdf-text-lines'
import type { PathPoint } from './pdf-text-lines'

/** A minimal content stream: one show operator per line at a given size. */
const page = (lines: readonly { y: number; size: number }[]): string =>
    lines.map((l) => `BT /F1 ${l.size} Tf 72 ${l.y} Td (text) Tj ET`).join('\n')

describe('extractTextLines', () => {
    test('one band per line, ordered down the page', () => {
        const lines = extractTextLines(
            page([
                { y: 700, size: 12 },
                { y: 685, size: 12 }
            ])
        )
        expect(lines).toHaveLength(2)
        expect(lines[0]!.baseline).toBe(700)
        expect(lines[1]!.baseline).toBe(685)
    })

    /**
     * The reason band height is derived per line rather than assumed: a page
     * mixing a heading with body text has two different line heights, and one
     * fixed height would either overshoot the body or clip the heading.
     */
    test('band height follows each line, not a page-wide assumption', () => {
        const lines = extractTextLines(
            page([
                { y: 700, size: 24 },
                { y: 660, size: 8 }
            ])
        )
        const heading = lines[0]!
        const body = lines[1]!
        expect(heading.top - heading.bottom).toBeCloseTo(24, 5)
        expect(body.top - body.bottom).toBeCloseTo(8, 5)
    })

    test('the many show operators of one visual line collapse to one band', () => {
        // A justified line emits several Tj calls at the same baseline
        const stream = 'BT /F1 12 Tf 72 700 Td (a) Tj (b) Tj (c) Tj ET'
        expect(extractTextLines(stream)).toHaveLength(1)
    })

    test('T* advances by the leading', () => {
        const stream = 'BT /F1 12 Tf 14 TL 72 700 Td (a) Tj T* (b) Tj ET'
        const lines = extractTextLines(stream)
        expect(lines).toHaveLength(2)
        expect(lines[1]!.baseline).toBe(686)
    })

    test('Tm sets the position outright and scales the band', () => {
        const lines = extractTextLines('BT /F1 10 Tf 2 0 0 2 72 500 Tm (a) Tj ET')
        expect(lines[0]!.baseline).toBe(500)
        // font size 10 scaled by 2
        expect(lines[0]!.top - lines[0]!.bottom).toBeCloseTo(20, 5)
    })

    test('text between parentheses cannot be mistaken for operators', () => {
        // The string contains what look like operators and an escaped paren
        const stream = 'BT /F1 12 Tf 72 700 Td (BT ET Tj \\) T*) Tj ET'
        expect(extractTextLines(stream)).toHaveLength(1)
    })

    test('a page with no text yields no bands rather than throwing', () => {
        expect(extractTextLines('q 1 0 0 1 0 0 cm /Im0 Do Q')).toEqual([])
        expect(extractTextLines('')).toEqual([])
    })
})

describe('lineAt', () => {
    const lines = extractTextLines(
        page([
            { y: 700, size: 12 },
            { y: 660, size: 12 }
        ])
    )

    test('a y inside a band matches it', () => {
        expect(lineAt(lines, 702)?.baseline).toBe(700)
    })

    test('a y slightly off still matches, since highlighting is freehand', () => {
        expect(lineAt(lines, 714)?.baseline).toBe(700)
    })

    test('a y in open space between distant lines matches nothing', () => {
        expect(lineAt(lines, 730)).toBeNull()
    })

    /**
     * Slack is proportional to the line's own height. A fixed tolerance would
     * make the same stroke offset snap on one page and miss on another, since
     * type size and spacing differ from page to page.
     */
    test('a large line grants more slack than a small one', () => {
        const big = extractTextLines(page([{ y: 700, size: 40 }]))
        const small = extractTextLines(page([{ y: 700, size: 6 }]))
        // 12pt above the band top
        expect(lineAt(big, big[0]!.top + 12)).not.toBeNull()
        expect(lineAt(small, small[0]!.top + 12)).toBeNull()
    })

    test('the nearest line wins when two are in reach', () => {
        const tight = extractTextLines(
            page([
                { y: 700, size: 12 },
                { y: 690, size: 12 }
            ])
        )
        expect(lineAt(tight, 691)?.baseline).toBe(690)
    })

    test('no lines means no match', () => {
        expect(lineAt([], 700)).toBeNull()
    })
})

describe('decodeContentStream', () => {
    test('bytes decode without loss of the operator characters', () => {
        const bytes = new TextEncoder().encode('BT /F1 12 Tf ET')
        expect(decodeContentStream(bytes)).toBe('BT /F1 12 Tf ET')
    })

    test('binary that is not valid UTF-8 still decodes, since latin1 cannot fail', () => {
        const bytes = new Uint8Array([0xff, 0xfe, 0x42, 0x54])
        expect(decodeContentStream(bytes)).toContain('BT')
    })
})

describe('snapPathToLines', () => {
    // Three body lines, 12pt type on 15pt spacing
    const lines = extractTextLines(
        page([
            { y: 700, size: 12 },
            { y: 685, size: 12 },
            { y: 670, size: 12 }
        ])
    )

    /** Sample a path densely enough that segment midpoints land on lines. */
    const path = (fn: (t: number) => PathPoint, steps = 60): PathPoint[] =>
        Array.from({ length: steps + 1 }, (_, i) => fn(i / steps))

    test('a swipe along one line snaps to that line', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 300, y: 703 })),
            lines
        )
        expect(spans).not.toBeNull()
        expect(spans).toHaveLength(1)
        expect(spans![0]!.line.baseline).toBe(700)
        expect(spans![0]!.x0).toBeCloseTo(100, 0)
        expect(spans![0]!.x1).toBeCloseTo(400, 0)
    })

    test('a slightly wobbly swipe still snaps, since highlighting is freehand', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 300, y: 703 + Math.sin(t * 20) * 2 })),
            lines
        )
        expect(spans).toHaveLength(1)
    })

    test('a sweep down a paragraph snaps each line once', () => {
        // left to right on line 1, right to left on line 2, and so on
        const pts: PathPoint[] = []
        ;[703, 688, 673].forEach((y, row) => {
            for (let i = 0; i <= 20; i++) {
                const t = i / 20
                pts.push({ x: 100 + (row % 2 === 0 ? t : 1 - t) * 300, y })
            }
        })
        const spans = snapPathToLines(pts, lines)
        expect(spans).toHaveLength(3)
    })

    /**
     * The defect this test exists for: proximity to text is not intent. A
     * circled word is a freehand mark and snapping it to bands destroys it.
     */
    test('a circle around a word is not snapped', () => {
        const spans = snapPathToLines(
            path((t) => ({
                x: 200 + Math.cos(t * 2 * Math.PI) * 30,
                y: 700 + Math.sin(t * 2 * Math.PI) * 14
            })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('a vertical bracket beside a paragraph is not snapped', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 90, y: 706 - t * 40 })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('a scribble that crosses back over lines is not snapped', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 300, y: 688 + Math.sin(t * 6 * Math.PI) * 15 })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('a diagonal smear across a paragraph is not snapped', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 60, y: 706 - t * 40 })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('a mark mostly in the margin is not snapped', () => {
        // A long tail in open space, only clipping a line at the very end
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 20, y: 780 - t * 78 })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('a stroke nowhere near text is not snapped', () => {
        const spans = snapPathToLines(
            path((t) => ({ x: 100 + t * 300, y: 400 })),
            lines
        )
        expect(spans).toBeNull()
    })

    test('no text lines on the page means nothing snaps', () => {
        expect(
            snapPathToLines(
                path((t) => ({ x: 100 + t * 300, y: 703 })),
                []
            )
        ).toBeNull()
    })

    test('a degenerate path is rejected rather than throwing', () => {
        expect(snapPathToLines([], lines)).toBeNull()
        expect(snapPathToLines([{ x: 100, y: 703 }], lines)).toBeNull()
    })
})
