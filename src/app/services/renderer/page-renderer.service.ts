import type { Page } from '../../domain/notebook'
import { PAGE_WIDTH, PAGE_HEIGHT, ERASER_PEN_TYPES } from '../../domain/rm-constants'
import { renderStroke } from './stroke-renderer'
import { canvasToPng, canvasToJpeg } from '../../../utils/image-utils'
import { log } from '../../../utils/log'

/**
 * Render a page's strokes to an image
 */
export async function renderPage(
    page: Page,
    format: 'png' | 'jpeg' = 'png'
): Promise<ArrayBuffer | null> {
    // Check if page has any renderable strokes
    const hasContent = page.strokes.some((s) => !ERASER_PEN_TYPES.has(s.penType))
    if (!hasContent) {
        return null
    }

    try {
        const canvas = new OffscreenCanvas(PAGE_WIDTH, PAGE_HEIGHT)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            log('Failed to create OffscreenCanvas 2D context', 'error')
            return null
        }

        // White background
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

        // Render each stroke
        for (const stroke of page.strokes) {
            renderStroke(ctx, stroke)
        }

        if (format === 'jpeg') {
            return canvasToJpeg(canvas)
        }
        return canvasToPng(canvas)
    } catch (error) {
        log(`Failed to render page ${page.pageIndex}`, 'error', error)
        return null
    }
}

/**
 * Render a page and return the OffscreenCanvas
 */
export function renderPageToCanvas(page: Page): OffscreenCanvas | null {
    const hasContent = page.strokes.some((s) => !ERASER_PEN_TYPES.has(s.penType))
    if (!hasContent) {
        return null
    }

    const canvas = new OffscreenCanvas(PAGE_WIDTH, PAGE_HEIGHT)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return null
    }

    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

    for (const stroke of page.strokes) {
        renderStroke(ctx, stroke)
    }

    return canvas
}
