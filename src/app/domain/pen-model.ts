import type { Stroke, StrokePoint } from './notebook'
import { StrokeColor } from './notebook'
import {
    STROKE_COLOR_MAP,
    PEN_WIDTH_MULTIPLIER,
    FIXED_WIDTH_PENS,
    PEN_DEFAULT_OPACITY
} from './rm-constants'

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
        return fixed * stroke.thickness
    }

    const multiplier = PEN_WIDTH_MULTIPLIER[stroke.penType] ?? 1.0
    const averaged = (a.width + b.width) / 2
    return Math.max(averaged * multiplier * stroke.thickness, MIN_WIDTH)
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
