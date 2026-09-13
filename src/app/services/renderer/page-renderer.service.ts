import type { Page, PageImage } from '../../domain/notebook'
import { PAGE_WIDTH, PAGE_HEIGHT, ERASER_PEN_TYPES } from '../../domain/rm-constants'
import { pageHasContent, pageHasNonImageContent } from '../parser/rm-file-parser'
import { renderStroke } from './stroke-renderer'
import { computePageBounds, isPlausiblePlacement } from './stroke-bounds'
import {
    canvasToPng,
    canvasToJpeg,
    canvasToWebp,
    imageAssetMediaType
} from '../../../utils/image-utils'
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
 *
 * Images placed by the capture tool count as content too, both for sizing the
 * canvas and for deciding the page is worth rendering (issue #36).
 *
 * Last of three places that must agree on what a page holds, after
 * `pageHasContent` and `computePageBounds`. This is the only one that learns
 * whether an image's bytes actually decode, which is why the blank-page check
 * lives here rather than in either of the others.
 */
export async function renderPageToCanvas(page: Page): Promise<OffscreenCanvas | null> {
    if (!pageHasContent(page)) {
        return null
    }

    const bounds = computePageBounds(page)
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

    // Captured images go down first so handwriting annotating them stays on
    // top, which is how they are layered on the device.
    const imagesDrawn = await drawPageImages(ctx, page.images ?? [], xOffset)

    // Mirrors what `renderStroke` actually paints: it returns early for
    // erasers and for strokes with no points.
    let strokesDrawn = 0
    for (const stroke of page.strokes) {
        if (ERASER_PEN_TYPES.has(stroke.penType) || stroke.points.length === 0) continue
        renderStroke(ctx, stroke, xOffset)
        strokesDrawn++
    }

    // Nothing landed on the canvas and the page had nothing but captures to
    // offer. `pageHasContent` and `computePageBounds` can only test that an
    // image has bytes; whether those bytes decode is not knowable until here.
    // Returning the canvas anyway wrote a blank white page into the vault and
    // counted it as a successful sync, which is worse than the failure it was
    // hiding. A page carrying typed text or highlights keeps its blank ink
    // layer, which is correct for it.
    if (imagesDrawn === 0 && strokesDrawn === 0 && !pageHasNonImageContent(page)) {
        log(`Page ${page.pageIndex + 1} had content but nothing could be drawn`, 'warn')
        return null
    }

    return canvas
}

/**
 * Whether this platform can decode the capture tool's image assets.
 *
 * `createImageBitmap` is the only way to get an image onto an `OffscreenCanvas`
 * without a DOM `Image`, which is unavailable inside the worker-style context
 * the renderer uses. Where it is missing, pages still render, just without
 * their captures, rather than failing outright.
 */
function canDecodeImages(): boolean {
    return 'undefined' !== typeof createImageBitmap
}

/**
 * Draw each captured image into its placement rectangle.
 *
 * A single image that fails to decode is skipped and logged; the rest of the
 * page still renders. Returns how many images actually reached the canvas, so
 * the caller can tell a drawn page from a blank one.
 */
async function drawPageImages(
    ctx: OffscreenCanvasRenderingContext2D,
    images: readonly PageImage[],
    xOffset: number
): Promise<number> {
    if (images.length === 0) {
        return 0
    }

    if (!canDecodeImages()) {
        log(`Skipping ${images.length} captured image(s): this device cannot decode them`, 'warn')
        return 0
    }

    let drawn = 0
    for (const image of images) {
        if (!image.data) continue
        // Same test the canvas was sized with.
        if (!isPlausiblePlacement(image)) continue
        try {
            const type = imageAssetMediaType(image.fileName) ?? 'image/png'
            const bitmap = await createImageBitmap(new Blob([image.data], { type }))
            try {
                ctx.drawImage(bitmap, image.x + xOffset, image.y, image.width, image.height)
                drawn++
            } finally {
                bitmap.close()
            }
        } catch (error) {
            log(`Failed to draw captured image ${image.fileName}`, 'warn', error)
        }
    }

    return drawn
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
 * Render a page's strokes and captured images to an image
 */
export async function renderPage(
    page: Page,
    format: 'png' | 'jpeg' | 'webp' = 'jpeg',
    quality = 0.85
): Promise<ArrayBuffer | null> {
    try {
        const canvas = await renderPageToCanvas(page)
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
