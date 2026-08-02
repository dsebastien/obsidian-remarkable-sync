import { test, expect, describe } from 'bun:test'
import {
    segmentWidth,
    strokeColour,
    strokeOpacity,
    hasOwnColour,
    highlightColour,
    highlightOpacity
} from './pen-model'
import { PenType, StrokeColor } from './notebook'
import type { Highlight, Stroke, StrokeArgb, StrokePoint } from './notebook'

const pt = (width: number): StrokePoint => ({
    x: 0,
    y: 0,
    speed: 10,
    width,
    direction: 0,
    pressure: 128
})

const stroke = (penType: PenType, color: StrokeColor, argb?: StrokeArgb): Stroke => ({
    penType,
    color,
    thickness: 1,
    points: [pt(4), pt(4)],
    ...(argb ? { argb } : {})
})

describe('strokeColour', () => {
    test('a palette colour resolves through the map', () => {
        expect(strokeColour(stroke(PenType.BallPointV2, StrokeColor.Black))).toBe('#000000')
        expect(strokeColour(stroke(PenType.FinelinerV2, StrokeColor.Cyan))).toBe('#74D2E8')
    })

    /**
     * The defect this whole change exists for. Colour 9 is not a colour: it is
     * a marker meaning "the real value is on the stroke". Falling back to the
     * palette rendered a green highlighter as yellow.
     */
    test('a stroke carrying its own ARGB uses that, not the palette', () => {
        const green = stroke(PenType.HighlighterV2, StrokeColor.Argb, {
            red: 0xac,
            green: 0xff,
            blue: 0x85,
            alpha: 255
        })
        expect(strokeColour(green)).toBe('#acff85')
    })

    test('the shading marker keeps its own colour too', () => {
        const shader = stroke(PenType.Shader, StrokeColor.Argb, {
            red: 0xfe,
            green: 0xb2,
            blue: 0x00,
            alpha: 115
        })
        expect(strokeColour(shader)).toBe('#feb200')
    })

    test('an unmapped palette colour degrades to black rather than throwing', () => {
        expect(strokeColour(stroke(PenType.BallPointV2, 99 as StrokeColor))).toBe('#000000')
    })
})

describe('strokeOpacity', () => {
    test('alpha from the stroke wins over any default', () => {
        const shader = stroke(PenType.Shader, StrokeColor.Argb, {
            red: 0,
            green: 0,
            blue: 0,
            alpha: 115
        })
        expect(strokeOpacity(shader)).toBeCloseTo(115 / 255, 4)
    })

    test('fully opaque alpha reads as 1', () => {
        const hl = stroke(PenType.HighlighterV2, StrokeColor.Argb, {
            red: 0,
            green: 0,
            blue: 0,
            alpha: 255
        })
        expect(strokeOpacity(hl)).toBe(1)
    })

    test('without ARGB the pen default applies', () => {
        expect(strokeOpacity(stroke(PenType.Shader, StrokeColor.Black))).toBe(0.1)
        expect(strokeOpacity(stroke(PenType.HighlighterV2, StrokeColor.Yellow))).toBe(0.3)
    })

    test('an ordinary pen is opaque', () => {
        expect(strokeOpacity(stroke(PenType.BallPointV2, StrokeColor.Black))).toBe(1)
    })
})

describe('segmentWidth', () => {
    /**
     * Measured regression: multiplying the recorded width made a highlighter
     * about ten times too wide, roughly 47pt against an 11pt text line. These
     * pens draw at a fixed nib size.
     */
    test('the highlighter uses a fixed nib, ignoring recorded width', () => {
        const hl = stroke(PenType.HighlighterV2, StrokeColor.Argb)
        const nib = segmentWidth(hl, pt(4), pt(4))
        // a much larger recorded width must not change it
        expect(segmentWidth(hl, pt(400), pt(400))).toBe(nib)
        // librm_lines sets this pen to a constant 30 .rm units
        expect(nib).toBe(30)
    })

    /**
     * The shading marker is not a fixed nib, which we previously assumed. It
     * has its own width response with a floor, so a heavier recorded width
     * widens it.
     */
    test('the shader varies with recorded width, above a floor', () => {
        const sh = stroke(PenType.Shader, StrokeColor.Argb)
        const narrow = segmentWidth(sh, pt(4), pt(4))
        const wide = segmentWidth(sh, pt(400), pt(400))
        expect(wide).toBeGreaterThan(narrow)
        expect(narrow).toBeGreaterThanOrEqual(6)
    })

    test('ordinary pens scale with the recorded width', () => {
        const pen = stroke(PenType.BallPointV2, StrokeColor.Black)
        const narrow = segmentWidth(pen, pt(2), pt(2))
        const wide = segmentWidth(pen, pt(8), pt(8))
        expect(wide).toBeGreaterThan(narrow)
    })

    test('the two endpoint widths are averaged', () => {
        const pen = stroke(PenType.BallPointV2, StrokeColor.Black)
        expect(segmentWidth(pen, pt(2), pt(6))).toBe(segmentWidth(pen, pt(4), pt(4)))
    })

    /**
     * The measured regression: a flat multiplier made brush strokes about three
     * times too heavy, turning light sketchy strokes into solid slabs. Every
     * pen formula divides the recorded width by 4 before combining it with
     * pressure, tilt and speed.
     */
    test('the brush divides the recorded width rather than multiplying it', () => {
        const brush = stroke(PenType.BrushV2, StrokeColor.Grey)
        // Asserted in points on an A4 page, which is the unit that matters:
        // the previous flat multiplier put this near 28pt against an 11pt line.
        const pts = segmentWidth(brush, pt(40), pt(40)) * (595 / 1872)
        expect(pts).toBeLessThan(15)
    })

    test('pressure widens a brush stroke', () => {
        const brush = stroke(PenType.BrushV2, StrokeColor.Grey)
        const soft = { ...pt(20), pressure: 20 }
        const hard = { ...pt(20), pressure: 250 }
        expect(segmentWidth(brush, hard, hard)).toBeGreaterThan(segmentWidth(brush, soft, soft))
    })

    test('speed narrows a brush stroke', () => {
        const brush = stroke(PenType.BrushV2, StrokeColor.Grey)
        const slow = { ...pt(20), speed: 0 }
        const fast = { ...pt(20), speed: 400 }
        expect(segmentWidth(brush, fast, fast)).toBeLessThan(segmentWidth(brush, slow, slow))
    })

    test('the fineliner is a constant nib, independent of recorded width', () => {
        const fl = stroke(PenType.FinelinerV2, StrokeColor.Black)
        expect(segmentWidth(fl, pt(2), pt(2))).toBe(segmentWidth(fl, pt(90), pt(90)))
    })

    test('never returns a width too thin to draw', () => {
        expect(
            segmentWidth(stroke(PenType.BallPointV2, StrokeColor.Black), pt(0), pt(0))
        ).toBeGreaterThanOrEqual(0.5)
    })

    test('the fixed nib ignores thickness_scale, matching the device', () => {
        const one: Stroke = {
            ...stroke(PenType.HighlighterV2, StrokeColor.Argb),
            thickness: 1
        }
        const two: Stroke = {
            ...stroke(PenType.HighlighterV2, StrokeColor.Argb),
            thickness: 2
        }
        expect(segmentWidth(two, pt(4), pt(4))).toBe(segmentWidth(one, pt(4), pt(4)))
    })
})

describe('hasOwnColour', () => {
    test('true for colour 9 and for any stroke carrying ARGB', () => {
        expect(hasOwnColour(stroke(PenType.HighlighterV2, StrokeColor.Argb))).toBe(true)
        expect(hasOwnColour(stroke(PenType.Shader, StrokeColor.Argb))).toBe(true)
    })

    test('false for palette colours', () => {
        expect(hasOwnColour(stroke(PenType.BallPointV2, StrokeColor.Black))).toBe(false)
        expect(hasOwnColour(stroke(PenType.FinelinerV2, StrokeColor.Cyan))).toBe(false)
    })
})

describe('highlightColour', () => {
    const highlight = (color: StrokeColor, argb?: StrokeArgb): Highlight => ({
        text: 'marked',
        color,
        rects: [],
        ...(argb ? { argb } : {})
    })

    /**
     * Text highlights carry their own colour the same way strokes do, but the
     * condition is mirrored: a stroke has one when its colour id *is* 9, a
     * glyph range when its colour id is *below* 9. We read neither before, so
     * every text highlight took a palette colour it may not have had.
     */
    test('a recorded colour wins over the palette', () => {
        const green = highlight(StrokeColor.Green, {
            red: 0xac,
            green: 0xff,
            blue: 0x85,
            alpha: 255
        })
        expect(highlightColour(green)).toBe('#acff85')
    })

    test('without one, the palette applies', () => {
        expect(highlightColour(highlight(StrokeColor.Yellow))).toBe('#FFFF63')
    })

    test('an unmapped colour degrades to the highlighter yellow, not black', () => {
        expect(highlightColour(highlight(99 as StrokeColor))).toBe('#FFED75')
    })
})

describe('highlightOpacity', () => {
    test('recorded alpha is used', () => {
        expect(
            highlightOpacity({
                text: 't',
                color: StrokeColor.Green,
                rects: [],
                argb: { red: 0, green: 0, blue: 0, alpha: 115 }
            })
        ).toBeCloseTo(115 / 255, 4)
    })

    test('without one, the librm_lines highlighter blend of 0.25 applies', () => {
        expect(highlightOpacity({ text: 't', color: StrokeColor.Yellow, rects: [] })).toBe(0.25)
    })
})

/**
 * Widths in points on a US Letter page, to keep the model anchored to a size
 * that can be reasoned about against 11pt text.
 *
 * These are **not** verified against the device. An earlier version claimed
 * they were checked against reMarkable's own export; that file turned out to be
 * our own output. The nib figures come from librm_lines' source, the rest from
 * its formulas.
 */
describe('widths on a real page', () => {
    // the measured device scale, ~227 dpi
    const SCALE = 72 / (1404 / (157 / 25.4))
    /** A point as the parser produces it: already normalised. */
    const p = (width: number, pressure: number, speed: number, direction = 0): StrokePoint => ({
        x: 0,
        y: 0,
        width,
        pressure,
        speed,
        direction
    })

    test('the highlighter nib is librm_lines constant 30 units', () => {
        const hl = stroke(PenType.HighlighterV2, StrokeColor.Argb)
        const pts = segmentWidth(hl, p(4, 0.5, 10), p(4, 0.5, 10)) * SCALE
        // 30 units at ~227 dpi, a little under one 11pt line
        expect(pts).toBeCloseTo(9.51, 2)
    })

    /**
     * The device draws the sample's isolated shading-marker sweep at 4.51 pt,
     * measured as the width at half maximum on its own render. The previous
     * model collapsed to a constant 2.55 pt because a floor won on every point.
     */
    test('the shading marker is about as wide as the device draws it', () => {
        const sh = stroke(PenType.Shader, StrokeColor.Argb)
        const pts = segmentWidth(sh, p(9, 0.3, 10), p(9, 0.3, 10)) * SCALE
        expect(pts).toBeGreaterThan(3.5)
        expect(pts).toBeLessThan(6.5)
    })

    test('the shading marker still varies with the recorded width', () => {
        const sh = stroke(PenType.Shader, StrokeColor.Argb)
        const narrow = segmentWidth(sh, p(5, 0.3, 10), p(5, 0.3, 10))
        const wide = segmentWidth(sh, p(14, 0.3, 10), p(14, 0.3, 10))
        expect(wide).toBeGreaterThan(narrow)
    })

    test('the ballpoint is a plausible pen width for 11pt text', () => {
        const bp = stroke(PenType.BallPointV2, StrokeColor.Black)
        const typical = segmentWidth(bp, p(4, 0.5, 10), p(4, 0.5, 10)) * SCALE
        expect(typical).toBeGreaterThan(0.3)
        expect(typical).toBeLessThan(0.6)

        // and it responds the right way round
        const light = segmentWidth(bp, p(2, 0.25, 20), p(2, 0.25, 20))
        const heavy = segmentWidth(bp, p(6, 0.66, 2), p(6, 0.66, 2))
        expect(heavy).toBeGreaterThan(light)
    })

    /**
     * The regression that hid the paintbrush: feeding these formulas the raw
     * device values instead of the parser's normalised ones put the brush at
     * 4.2..26.9pt, several text lines thick.
     */
    test('the paintbrush stays a brush stroke, not a slab', () => {
        const br = stroke(PenType.BrushV2, StrokeColor.Grey)
        const wide = segmentWidth(br, p(5, 0.66, 2), p(5, 0.66, 2)) * SCALE
        expect(wide).toBeLessThan(3.7)
        expect(wide).toBeGreaterThan(0.5)
    })
})
