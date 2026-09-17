import type { Page, PageImage, Stroke } from '../../domain/notebook'
import {
    ERASER_PEN_TYPES,
    PAGE_HEIGHT,
    PAGE_WIDTH,
    PEN_WIDTH_MULTIPLIER
} from '../../domain/rm-constants'
import { log } from '../../../utils/log'

/**
 * How far beyond the standard page a capture may be placed before the
 * rectangle is treated as a misparse rather than a real placement. Generous on
 * purpose: a scrolled page can legitimately carry content well past the
 * viewport (issue #3).
 */
const MAX_PLACEMENT_PAGE_MULTIPLE = 8

export interface StrokesBounds {
    readonly minX: number
    readonly maxX: number
    readonly minY: number
    readonly maxY: number
}

/**
 * Compute the axis-aligned bounding box of all visible strokes in stroke
 * coordinate space.
 *
 * - X is centered around 0 in the .rm file format (range roughly
 *   -PAGE_WIDTH/2 .. +PAGE_WIDTH/2 for a non-scrolling page).
 * - Y is top-anchored at 0 and can extend well beyond PAGE_HEIGHT for pages
 *   that the user scrolled while writing on the device. Issue #3.
 *
 * Each point is expanded by its rendered radius (point.width *
 * widthMultiplier * stroke.thickness / 2) so that stroke edges aren't clipped
 * when the canvas is sized from these bounds.
 *
 * Returns null when the page has no renderable content (no strokes or only
 * eraser strokes).
 */
export function computeStrokesBounds(strokes: readonly Stroke[]): StrokesBounds | null {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let hasAnyPoint = false

    for (const stroke of strokes) {
        if (ERASER_PEN_TYPES.has(stroke.penType)) continue
        const widthMultiplier = PEN_WIDTH_MULTIPLIER[stroke.penType] ?? 1.0
        for (const p of stroke.points) {
            const radius = Math.max((p.width * widthMultiplier * stroke.thickness) / 2, 0.5)
            const xMin = p.x - radius
            const xMax = p.x + radius
            const yMin = p.y - radius
            const yMax = p.y + radius
            if (xMin < minX) minX = xMin
            if (xMax > maxX) maxX = xMax
            if (yMin < minY) minY = yMin
            if (yMax > maxY) maxY = yMax
            hasAnyPoint = true
        }
    }

    return hasAnyPoint ? { minX, maxX, minY, maxY } : null
}

/**
 * Compute the bounding box of everything drawable on a page: visible strokes
 * plus any placed images.
 *
 * Images share the stroke coordinate space, so a capture that sits lower or
 * wider than the writing has to widen the canvas the same way a scrolled
 * stroke does. Without this an image-only page has no bounds at all and never
 * renders. Issue #36.
 *
 * Returns null when the page has nothing to draw.
 *
 * One of three places that must agree on what a page holds, alongside
 * `pageHasContent` and `renderPageToCanvas`. Keep the image test here in step
 * with `pageHasContent`, or a page renders empty or vanishes.
 */
export function computePageBounds(page: Page): StrokesBounds | null {
    const strokeBounds = computeStrokesBounds(page.strokes)

    let minX = strokeBounds?.minX ?? Infinity
    let maxX = strokeBounds?.maxX ?? -Infinity
    let minY = strokeBounds?.minY ?? Infinity
    let maxY = strokeBounds?.maxY ?? -Infinity
    let hasContent = strokeBounds !== null

    for (const image of page.images ?? []) {
        if (!image.data) continue
        if (!isPlausiblePlacement(image)) {
            // Ignore it rather than sizing the canvas to it. The rectangle
            // comes from a vertex buffer we decode ourselves, so a wrong
            // offset yields a huge but finite float32. Feeding that to
            // OffscreenCanvas either allocates gigabytes and freezes the UI on
            // the main thread, or throws and drops the whole page, taking any
            // handwriting with it. Dropping just the image degrades to the
            // page as it rendered before captures existed.
            log(
                `Ignoring implausible image placement ${image.fileName}: ` +
                    `${Math.round(image.width)}x${Math.round(image.height)} at ` +
                    `${Math.round(image.x)},${Math.round(image.y)}`,
                'warn'
            )
            continue
        }
        if (image.x < minX) minX = image.x
        if (image.x + image.width > maxX) maxX = image.x + image.width
        if (image.y < minY) minY = image.y
        if (image.y + image.height > maxY) maxY = image.y + image.height
        hasContent = true
    }

    return hasContent ? { minX, maxX, minY, maxY } : null
}

/**
 * Whether a placement rectangle is within a sane distance of the page.
 *
 * The bound is deliberately generous. A capture can legitimately sit outside
 * the standard rectangle on a scrolled page, so this is not a page-fit check:
 * it only rejects values that cannot be a real placement.
 *
 * Exported so the renderer applies the same test it sized the canvas with. If
 * the two disagreed, a rejected placement would still be drawn onto a canvas
 * that was never sized for it.
 */
export function isPlausiblePlacement(image: PageImage): boolean {
    const maxWidth = PAGE_WIDTH * MAX_PLACEMENT_PAGE_MULTIPLE
    const maxHeight = PAGE_HEIGHT * MAX_PLACEMENT_PAGE_MULTIPLE

    if (image.width > maxWidth || image.height > maxHeight) return false
    if (Math.abs(image.x) > maxWidth || Math.abs(image.x + image.width) > maxWidth) return false
    if (Math.abs(image.y) > maxHeight || Math.abs(image.y + image.height) > maxHeight) return false

    return true
}
