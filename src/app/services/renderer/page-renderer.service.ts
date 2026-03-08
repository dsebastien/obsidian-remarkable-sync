import type { Page } from '../../domain/notebook'
import { PAGE_WIDTH, PAGE_HEIGHT } from '../../domain/rm-constants'
import { pageHasContent } from '../parser/rm-file-parser'
import { renderStroke } from './stroke-renderer'
import { canvasToPng, canvasToJpeg, canvasToWebp } from '../../../utils/image-utils'
import { log } from '../../../utils/log'

/**
 * Render a page and return the OffscreenCanvas
 */
export function renderPageToCanvas(page: Page): OffscreenCanvas | null {
    if (!pageHasContent(page)) {
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
