import type { Stroke } from '../../domain/notebook'
import {
    STROKE_COLOR_MAP,
    PEN_WIDTH_MULTIPLIER,
    HIGHLIGHTER_PEN_TYPES,
    ERASER_PEN_TYPES
} from '../../domain/rm-constants'

/**
 * Render a single stroke onto a canvas 2D context
 */
export function renderStroke(ctx: OffscreenCanvasRenderingContext2D, stroke: Stroke): void {
    if (ERASER_PEN_TYPES.has(stroke.penType)) {
        return
    }

    const points = stroke.points
    if (points.length === 0) {
        return
    }

    const colorHex = STROKE_COLOR_MAP[stroke.color] ?? '#000000'
    const widthMultiplier = PEN_WIDTH_MULTIPLIER[stroke.penType] ?? 1.0
    const isHighlighter = HIGHLIGHTER_PEN_TYPES.has(stroke.penType)

    if (isHighlighter) {
        ctx.save()
        ctx.globalAlpha = 0.3
        ctx.globalCompositeOperation = 'multiply'
    }

    ctx.strokeStyle = colorHex
    ctx.fillStyle = colorHex
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Draw stroke as a series of line segments with variable width
    if (points.length === 1) {
        const point = points[0]!
        const radius = (point.width * widthMultiplier * stroke.thickness) / 2
        ctx.beginPath()
        ctx.arc(point.x, point.y, Math.max(radius, 0.5), 0, Math.PI * 2)
        ctx.fill()
    } else {
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i]!
            const p2 = points[i + 1]!

            const width1 = p1.width * widthMultiplier * stroke.thickness
            const width2 = p2.width * widthMultiplier * stroke.thickness
            const avgWidth = (width1 + width2) / 2

            ctx.beginPath()
            ctx.lineWidth = Math.max(avgWidth, 0.5)
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
        }
    }

    if (isHighlighter) {
        ctx.restore()
    }
}
