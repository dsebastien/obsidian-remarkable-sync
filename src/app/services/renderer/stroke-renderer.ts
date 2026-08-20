import type { Stroke } from '../../domain/notebook'
import { HIGHLIGHTER_PEN_TYPES, ERASER_PEN_TYPES, PAGE_WIDTH } from '../../domain/rm-constants'
import { segmentStyle, strokeColour, strokeOpacity } from '../../domain/pen-model'

/**
 * The reMarkable coordinate system has its x-origin at the center of the page,
 * so raw x values range from approximately -PAGE_WIDTH/2 to +PAGE_WIDTH/2.
 * Callers pass an `xOffset` (typically canvas width / 2) so strokes are
 * centered horizontally on whatever-sized canvas the page-renderer chose. The
 * default keeps the legacy behavior for any caller that doesn't size its own
 * canvas.
 */
const DEFAULT_X_OFFSET = PAGE_WIDTH / 2

/**
 * Render a single stroke onto a canvas 2D context
 */
export function renderStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    stroke: Stroke,
    xOffset: number = DEFAULT_X_OFFSET
): void {
    if (ERASER_PEN_TYPES.has(stroke.penType)) {
        return
    }

    const points = stroke.points
    if (points.length === 0) {
        return
    }

    const colorHex = strokeColour(stroke)
    const opacity = strokeOpacity(stroke)
    const isHighlighter = HIGHLIGHTER_PEN_TYPES.has(stroke.penType)
    const translucent = opacity < 1

    if (isHighlighter || translucent) {
        ctx.save()
        ctx.globalAlpha = opacity
        if (isHighlighter) {
            // Multiply keeps what sits underneath readable. It must not
            // depend on the recorded alpha: a v2 highlighter records ARGB
            // alpha 255, and drawing that normally paints an opaque bar over
            // the ink it was meant to highlight — the same rule the PDF
            // annotator applies. The shading marker composites normally with
            // its own alpha, which is what the device does.
            ctx.globalCompositeOperation = 'multiply'
        }
    }

    ctx.strokeStyle = colorHex
    ctx.fillStyle = colorHex
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Draw stroke as a series of line segments with variable width
    if (points.length === 1) {
        const point = points[0]!
        const radius = segmentStyle(stroke, point, point).width / 2
        ctx.beginPath()
        ctx.arc(point.x + xOffset, point.y, Math.max(radius, 0.5), 0, Math.PI * 2)
        ctx.fill()
    } else {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i]!
            const p2 = points[i + 1]!

            const style = segmentStyle(stroke, p1, p2)
            ctx.beginPath()
            ctx.lineWidth = Math.max(style.width, 0.5)
            // Set per segment: textured pens fade with pressure and speed, so
            // hoisting this out of the loop would flatten the grain.
            ctx.strokeStyle = style.colour
            ctx.moveTo(p1.x + xOffset, p1.y)
            ctx.lineTo(p2.x + xOffset, p2.y)
            ctx.stroke()
        }
    }

    if (isHighlighter || translucent) {
        ctx.restore()
    }
}
