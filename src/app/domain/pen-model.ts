import type { Highlight, Stroke, StrokeArgb, StrokePoint } from './notebook'
import { PenType, StrokeColor } from './notebook'
import { STROKE_COLOR_MAP, FIXED_WIDTH_PENS, PEN_DEFAULT_OPACITY } from './rm-constants'

/**
 * How one segment of a stroke should be drawn.
 *
 * Shared by the canvas renderer and the PDF annotator so the pen behaviour
 * exists in one place. They previously duplicated it, which meant every fix had
 * to be made twice and the two could drift.
 */
export interface SegmentStyle {
    /** Width in .rm units */
    width: number
    /** CSS hex colour */
    colour: string
    /** 0-1 */
    opacity: number
}

const MIN_WIDTH = 0.5

/**
 * Alpha for a text highlight that carries no colour of its own.
 *
 * librm_lines blends the highlighter at 0.25.
 */
const HIGHLIGHT_DEFAULT_OPACITY = 0.25

/**
 * rmc's formulas are in points at 226 DPI, unlike librm_lines' which are
 * already in .rm units. Only the rmc-derived branch converts.
 */
const POINTS_TO_RM_UNITS = 226 / 72

/** Floor for the shading marker, so a degenerate stroke still draws. */
const SHADER_MIN_WIDTH = 6

/** `MAGIC_PENCIL_SIZE` in librm_lines. */
const MAGIC_PENCIL_SIZE = 44.6 * 2.3

/**
 * Divisor every librm_lines width formula ends with (`K` in that source).
 */
const WIDTH_DIVISOR = 5

/** `baseWidth` in librm_lines: the stroke's thickness scale over ten. */
function baseWidth(thickness: number): number {
    return thickness / 10
}

/**
 * The pen formulas below take the point fields **as our parser produces them**,
 * already normalised (`speed / 4`, `width / 4`, `pressure / 255`, and
 * `direction` as the tilt in radians).
 *
 * Both librm_lines and rmc are written against the device's raw fields, so
 * recovering the raw values first looks obviously right. It is wrong: raw
 * inputs put the ballpoint at 1.2..2.5pt and the paintbrush at 4.2..26.9pt on
 * this page, both far too heavy, and normalised inputs put them at 0.41..0.55
 * and up to 3.6, which is the right order for 11pt text.
 *
 * Note: an earlier version of this comment cited reMarkable's own export as
 * confirmation. That file was our own output, so it confirmed nothing. These
 * widths are **not** verified against the device.
 */
function mid(a: number, b: number): number {
    return (a + b) / 2
}

/**
 * Per-pen width response, in .rm units.
 *
 * Ported from `rm_pen_fill.cpp` in librm_lines, a C++ renderer for this format
 * written from funded research into how the device draws. It replaces an
 * earlier port of rmc's formulas, which were written against SVG output in
 * points and needed a unit conversion that was itself guesswork.
 *
 * The recorded per-point `width` is not a width in output units: each formula
 * combines it with pressure, tilt and speed and then divides by `K`.
 *
 * `thickness` is the stroke's `thickness_scale`.
 */
function penWidth(
    penType: PenType,
    thickness: number,
    width: number,
    pressure: number,
    speed: number,
    tilt: number
): number {
    const base = baseWidth(thickness)

    switch (penType) {
        // Ballpoint and marker share a formula; only their grain differs.
        case PenType.BallPoint:
        case PenType.BallPointV2:
        case PenType.Marker:
        case PenType.MarkerV2:
            return (
                ((0.5 + pressure / 100 + width / 4 - 0.5 * (speed / 4 / 50)) * 2 * 2.3) /
                WIDTH_DIVISOR
            )

        case PenType.TiltPencil:
        case PenType.TiltPencilV2: {
            const segment =
                20 *
                ((0.8 * base + (0.5 * pressure) / 255) * (width / 2.6) -
                    0.1 * tilt -
                    (0.6 * (speed / 4)) / 10)
            const max = base * MAGIC_PENCIL_SIZE + width / 2.6
            return Math.max(12, Math.min(segment, max)) / WIDTH_DIVISOR
        }

        /**
         * The shading marker, the wide translucent wash pen.
         *
         * librm_lines writes this as
         * `max(30, min(segmentWidth, maxWidth)) / K`, but with the point fields
         * as we hold them `segmentWidth` runs from about -16 to 13, so the
         * floor wins on every point of every stroke and the pen collapses to a
         * constant `30 / K`. Measured against the device's own render that is
         * half the width it should be: the device draws the isolated sweep at
         * 4.51 pt where the floor gives 2.55.
         *
         * `maxWidth` is the term that matches. It works out to 11.6..19.3 units
         * on the sample, bracketing the 12 to 14 the device draws, and it still
         * varies with the recorded width rather than being a fixed nib. The
         * floor is kept only to stop a degenerate stroke vanishing.
         */
        case PenType.Shader:
            return Math.max(SHADER_MIN_WIDTH, base * 64 + width / 1.2)

        /**
         * Pens librm_lines leaves unimplemented fall through to rmc's model
         * below rather than to librm_lines' own fallback, which is a plain
         * stroker at a constant `20 * baseWidth`. A constant would cost the
         * paintbrush and pencil their pressure and speed response entirely,
         * which is a worse answer than an approximate formula.
         */
        default:
            return rmcWidth(penType, thickness, width, pressure, speed, tilt) * POINTS_TO_RM_UNITS
    }
}

/**
 * rmc's width model, for the pens librm_lines does not implement.
 *
 * These are written against rmc's SVG output, whose units are points at 226
 * DPI, so the caller converts. They are approximations rather than a reading of
 * the device, and should be replaced pen by pen as better sources appear.
 */
function rmcWidth(
    penType: PenType,
    thickness: number,
    width: number,
    pressure: number,
    speed: number,
    tilt: number
): number {
    const w = width / 4

    switch (penType) {
        case PenType.Brush:
        case PenType.BrushV2:
            return 0.7 * ((1 + (1.4 * pressure) / 255) * w - 0.5 * tilt - speed / 4 / 50)

        case PenType.CalligraphyPen:
            return 0.9 * ((1 + pressure / 255) * w - 0.3 * tilt)

        case PenType.Fineliner:
        case PenType.FinelinerV2:
            return thickness * 1.8

        case PenType.SharpPencil:
        case PenType.SharpPencilV2:
            return thickness ** 2

        case PenType.Eraser:
            return thickness * 2

        default:
            return thickness
    }
}

/**
 * Colour for one segment of a stroke.
 *
 * Constant along the stroke today. An earlier version faded textured pens
 * toward the page by rmc's intensity curve, which is how rmc simulates brush
 * grain in SVG. That is not what the device's own PDF export does: it emits a
 * segment per point and colours it either the pen colour or plain white, a
 * binary drawn-or-not rather than a graded fade. Our fade, fed a pressure that
 * had already been normalised, collapsed to full fade and rendered every
 * paintbrush stroke in white on a white page.
 *
 * Kept as a per-segment call so grain can be reintroduced without touching
 * either renderer again.
 */
export function segmentColour(stroke: Stroke, _a: StrokePoint, _b: StrokePoint): string {
    return strokeColour(stroke)
}

/**
 * The colour a stroke should actually be drawn in.
 *
 * A stroke whose `color` is {@link StrokeColor.Argb} is not really colour
 * 9: that value is a marker meaning "the real colour is on the stroke". Newer
 * firmware writes it as a per-stroke BGRA field, which is how a green
 * highlighter and an orange shading marker both arrive as "colour 9". Falling
 * back to the palette for those produced the wrong colour every time.
 */
function argbToHex(argb: StrokeArgb): string {
    const hex = (n: number): string => n.toString(16).padStart(2, '0')
    return `#${hex(argb.red)}${hex(argb.green)}${hex(argb.blue)}`
}

/**
 * The colour a text highlight should be drawn in.
 *
 * Same rule as a stroke: the recorded colour wins over the palette. The device
 * writes one for highlights made with a chosen colour rather than a palette
 * entry.
 */
export function highlightColour(highlight: Highlight): string {
    if (highlight.argb) {
        return argbToHex(highlight.argb)
    }
    return STROKE_COLOR_MAP[highlight.color] ?? '#FFED75'
}

/** Alpha of a text highlight, 0-1. */
export function highlightOpacity(highlight: Highlight): number {
    return highlight.argb ? highlight.argb.alpha / 255 : HIGHLIGHT_DEFAULT_OPACITY
}

export function strokeColour(stroke: Stroke): string {
    if (stroke.argb) {
        return argbToHex(stroke.argb)
    }
    return STROKE_COLOR_MAP[stroke.color] ?? '#000000'
}

/**
 * Opacity for a stroke: its own alpha when the firmware supplied one,
 * otherwise the pen's default.
 */
export function strokeOpacity(stroke: Stroke): number {
    if (stroke.argb) {
        return stroke.argb.alpha / 255
    }
    return PEN_DEFAULT_OPACITY[stroke.penType] ?? 1
}

/**
 * Width of the segment between two points, in .rm units.
 *
 * Most pens scale with the recorded per-point width, which carries the pressure
 * and tilt response. Highlighters and the shading marker do not: the device
 * draws them at a fixed nib size, and multiplying their recorded width made
 * them many times too wide.
 */
export function segmentWidth(stroke: Stroke, a: StrokePoint, b: StrokePoint): number {
    const fixed = FIXED_WIDTH_PENS[stroke.penType]
    if (undefined !== fixed) {
        // Deliberately ignores thickness_scale: the device draws these at one
        // nib size, and folding the scale back in made the highlighter about
        // 1.6 text lines tall instead of one.
        return fixed
    }

    const computed = penWidth(
        stroke.penType,
        stroke.thickness,
        mid(a.width, b.width),
        mid(a.pressure, b.pressure),
        mid(a.speed, b.speed),
        mid(a.direction, b.direction)
    )

    return Math.max(computed, MIN_WIDTH)
}

/**
 * Full style for one segment.
 */
export function segmentStyle(stroke: Stroke, a: StrokePoint, b: StrokePoint): SegmentStyle {
    return {
        width: segmentWidth(stroke, a, b),
        colour: segmentColour(stroke, a, b),
        opacity: strokeOpacity(stroke)
    }
}

/**
 * Whether a stroke's colour is carried on the stroke rather than the palette.
 */
export function hasOwnColour(stroke: Stroke): boolean {
    return undefined !== stroke.argb || StrokeColor.Argb === stroke.color
}
