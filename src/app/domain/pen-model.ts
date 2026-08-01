import type { Stroke, StrokePoint } from './notebook'
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
 * rmc's pen formulas are written against its SVG output, whose units are PDF
 * points at 226 DPI. Our stroke geometry is in .rm units, so a width straight
 * out of those formulas is 226/72 times too small.
 *
 * Getting this wrong is very visible: without the conversion a brush stroke
 * renders as a hairline, and treating the recorded width as a width instead
 * (the previous behaviour) made it a solid slab.
 */
const POINTS_TO_RM_UNITS = 226 / 72

/** `direction` is a byte encoding the stylus tilt around a full turn. */
function directionToTilt(direction: number): number {
    return (direction * Math.PI * 2) / 255
}

/**
 * Per-pen width response, ported from rmc's pen model.
 *
 * The recorded per-point `width` is not a width in output units: every pen
 * divides it by 4 and combines it with pressure, tilt and speed. Treating it as
 * a width and applying a flat multiplier made brush strokes roughly three times
 * too heavy, which is what turned light sketchy strokes into solid slabs.
 *
 * `scale` is the stroke's `thickness_scale`.
 */
function penWidth(
    penType: PenType,
    scale: number,
    width: number,
    pressure: number,
    speed: number,
    direction: number
): number {
    const w = width / 4
    const tilt = directionToTilt(direction)

    switch (penType) {
        case PenType.Brush:
        case PenType.BrushV2:
            return 0.7 * ((1 + (1.4 * pressure) / 255) * w - 0.5 * tilt - speed / 4 / 50)

        case PenType.BallPoint:
        case PenType.BallPointV2:
            return 0.5 + pressure / 255 + w - 0.5 * (speed / 4 / 50)

        case PenType.Marker:
        case PenType.MarkerV2:
            return 0.9 * (w - 0.4 * tilt)

        case PenType.TiltPencil:
        case PenType.TiltPencilV2:
            return 0.7 * ((0.8 * scale + (0.5 * pressure) / 255) * w - 0.25 * tilt ** 1.8)

        case PenType.CalligraphyPen:
            return 0.9 * ((1 + pressure / 255) * w - 0.3 * tilt)

        case PenType.Fineliner:
        case PenType.FinelinerV2:
            return scale * 1.8

        case PenType.SharpPencil:
        case PenType.SharpPencilV2:
            return scale ** 2

        case PenType.Eraser:
            return scale * 2

        default:
            return scale
    }
}

/**
 * The colour a stroke should actually be drawn in.
 *
 * A stroke whose `color` is {@link StrokeColor.Highlight} is not really colour
 * 9: that value is a marker meaning "the real colour is on the stroke". Newer
 * firmware writes it as a per-stroke BGRA field, which is how a green
 * highlighter and an orange shading marker both arrive as "colour 9". Falling
 * back to the palette for those produced the wrong colour every time.
 */
export function strokeColour(stroke: Stroke): string {
    if (stroke.argb) {
        const hex = (n: number): string => n.toString(16).padStart(2, '0')
        return `#${hex(stroke.argb.red)}${hex(stroke.argb.green)}${hex(stroke.argb.blue)}`
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
        return fixed * POINTS_TO_RM_UNITS
    }

    const mid = (x: number, y: number): number => (x + y) / 2
    const computed = penWidth(
        stroke.penType,
        stroke.thickness,
        mid(a.width, b.width),
        mid(a.pressure, b.pressure),
        mid(a.speed, b.speed),
        mid(a.direction, b.direction)
    )

    return Math.max(computed * POINTS_TO_RM_UNITS, MIN_WIDTH)
}

/**
 * Full style for one segment.
 */
export function segmentStyle(stroke: Stroke, a: StrokePoint, b: StrokePoint): SegmentStyle {
    return {
        width: segmentWidth(stroke, a, b),
        colour: strokeColour(stroke),
        opacity: strokeOpacity(stroke)
    }
}

/**
 * Whether a stroke's colour is carried on the stroke rather than the palette.
 */
export function hasOwnColour(stroke: Stroke): boolean {
    return undefined !== stroke.argb || StrokeColor.Highlight === stroke.color
}
