import { test, expect, describe } from 'bun:test'
import { segmentWidth, strokeColour, strokeOpacity, hasOwnColour } from './pen-model'
import { PenType, StrokeColor } from './notebook'
import type { Stroke, StrokeArgb, StrokePoint } from './notebook'

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
        expect(strokeColour(stroke(PenType.FinelinerV2, StrokeColor.Cyan))).toBe('#8BD0E5')
    })

    /**
     * The defect this whole change exists for. Colour 9 is not a colour: it is
     * a marker meaning "the real value is on the stroke". Falling back to the
     * palette rendered a green highlighter as yellow.
     */
    test('a stroke carrying its own ARGB uses that, not the palette', () => {
        const green = stroke(PenType.HighlighterV2, StrokeColor.Highlight, {
            red: 0xac,
            green: 0xff,
            blue: 0x85,
            alpha: 255
        })
        expect(strokeColour(green)).toBe('#acff85')
    })

    test('the shading marker keeps its own colour too', () => {
        const shader = stroke(PenType.Shader, StrokeColor.Highlight, {
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
        const shader = stroke(PenType.Shader, StrokeColor.Highlight, {
            red: 0,
            green: 0,
            blue: 0,
            alpha: 115
        })
        expect(strokeOpacity(shader)).toBeCloseTo(115 / 255, 4)
    })

    test('fully opaque alpha reads as 1', () => {
        const hl = stroke(PenType.HighlighterV2, StrokeColor.Highlight, {
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
    test('highlighter and shader use a fixed nib, ignoring recorded width', () => {
        const hl = stroke(PenType.HighlighterV2, StrokeColor.Highlight)
        expect(segmentWidth(hl, pt(4), pt(4))).toBe(15)
        // a much larger recorded width must not change it
        expect(segmentWidth(hl, pt(400), pt(400))).toBe(15)

        expect(segmentWidth(stroke(PenType.Shader, StrokeColor.Highlight), pt(4), pt(4))).toBe(12)
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

    test('never returns a width too thin to draw', () => {
        expect(
            segmentWidth(stroke(PenType.BallPointV2, StrokeColor.Black), pt(0), pt(0))
        ).toBeGreaterThanOrEqual(0.5)
    })

    test('thickness scales the fixed nib too', () => {
        const hl: Stroke = { ...stroke(PenType.HighlighterV2, StrokeColor.Highlight), thickness: 2 }
        expect(segmentWidth(hl, pt(4), pt(4))).toBe(30)
    })
})

describe('hasOwnColour', () => {
    test('true for colour 9 and for any stroke carrying ARGB', () => {
        expect(hasOwnColour(stroke(PenType.HighlighterV2, StrokeColor.Highlight))).toBe(true)
        expect(hasOwnColour(stroke(PenType.Shader, StrokeColor.Highlight))).toBe(true)
    })

    test('false for palette colours', () => {
        expect(hasOwnColour(stroke(PenType.BallPointV2, StrokeColor.Black))).toBe(false)
        expect(hasOwnColour(stroke(PenType.FinelinerV2, StrokeColor.Cyan))).toBe(false)
    })
})
