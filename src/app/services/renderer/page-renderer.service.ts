import type { Page } from '../../domain/notebook'
import { PAGE_WIDTH, PAGE_HEIGHT } from '../../domain/rm-constants'
import { pageHasContent } from '../parser/rm-file-parser'
import { renderStroke } from './stroke-renderer'
import { computeStrokesBounds } from './stroke-bounds'
import { canvasToPng, canvasToJpeg, canvasToWebp } from '../../../utils/image-utils'
import { log } from '../../../utils/log'

/**
 * Pixels of empty padding kept between the outermost stroke and the canvas
 * edge when the canvas is grown beyond the default page size. Prevents stroke
 * tips from touching the image border.
 */
const EDGE_PADDING = 8

/**
 * Render a page and return the OffscreenCanvas.
 *
 * For pages whose strokes fit inside the standard reMarkable viewport
 * (PAGE_WIDTH × PAGE_HEIGHT) this produces the legacy 1404×1872 canvas. For
 * pages with scrolled content — the user wrote past the bottom of the
 * viewport on the device — the canvas grows downward to fit the full stroke
 * bounding box, instead of cropping. Same protection on the other three edges
 * for content that strays beyond the standard rectangle (issue #3).
 */
export function renderPageToCanvas(page: Page): OffscreenCanvas | null {
    if (!pageHasContent(page)) {
        return null
    }

    const bounds = computeStrokesBounds(page.strokes)
    if (!bounds) {
        // A content page with no drawable strokes: written entirely with the
        // keyboard, or carrying only text highlights. Its ink layer is a
        // blank standard page, not a render failure — returning null here
        // made every wholly typed notebook sync as "N pages failed".
        const canvas = new OffscreenCanvas(PAGE_WIDTH, PAGE_HEIGHT)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            return null
        }
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
        return canvas
    }

    // X is centered around 0 in stroke space; keep the canvas symmetric so
    // standard pages stay centered. Grow if any stroke reaches past
    // ±PAGE_WIDTH/2.
    const halfWidth = Math.max(
        PAGE_WIDTH / 2,
        Math.ceil(Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX))) + EDGE_PADDING
    )
    const canvasWidth = halfWidth * 2
    const xOffset = halfWidth

    // Y is top-anchored at 0. Strokes with negative Y land above the page
    // origin and need the context shifted down so they don't fall outside the
    // canvas. The shift is added on top of the standard bottom extent.
    const topExtra = bounds.minY < 0 ? Math.ceil(-bounds.minY) + EDGE_PADDING : 0
    const canvasHeight = Math.max(PAGE_HEIGHT, Math.ceil(bounds.maxY) + EDGE_PADDING + topExtra)

    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return null
    }

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, canvasWidth, canvasHeight)

    if (topExtra > 0) {
        ctx.translate(0, topExtra)
    }

    for (const stroke of page.strokes) {
        renderStroke(ctx, stroke, xOffset)
    }

    return canvas
}

/**
 * Whether this platform can render pages at all.
 *
 * Page rendering is built on `OffscreenCanvas`, which needs iOS 16.4+ in
 * Obsidian's mobile webview. Without this check every page simply fails to
 * render, which is reported as a generic render failure and tells the user
 * nothing about the cause.
 */
export function isPageRenderingSupported(): boolean {
    return 'undefined' !== typeof OffscreenCanvas
}

export const PAGE_RENDERING_UNSUPPORTED_MESSAGE =
    'This device cannot render notebook pages. Page rendering needs iOS 16.4 or later on iPhone and iPad.'

/**
 * Render a page's strokes to an image
 */
export async function renderPage(
    page: Page,
    format: 'png' | 'jpeg' | 'webp' = 'jpeg',
    quality = 0.85
): Promise<ArrayBuffer | null> {
    try {
        const canvas = renderPageToCanvas(page)
        if (!canvas) {
            return null
        }

        switch (format) {
            case 'jpeg':
                return canvasToJpeg(canvas, quality)
            case 'webp':
                return canvasToWebp(canvas, quality)
            case 'png':
                return canvasToPng(canvas)
        }
    } catch (error) {
        log(`Failed to render page ${page.pageIndex}`, 'error', error)
        return null
    }
}
