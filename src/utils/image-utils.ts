/**
 * Media types for the image assets a device places on a page.
 *
 * jpg and png are both first-class: reMarkable's 3.27 notes describe dragging
 * in "your jpg or png files".
 *
 * Used only as a decoding hint: `createImageBitmap` sniffs the container's
 * magic bytes and ignores a Blob type that disagrees with them, so an
 * unrecognised extension costs nothing. Which files are collected is decided
 * by the page's .rm file, not by this table (see `extractPageAssets`).
 */
const IMAGE_ASSET_MEDIA_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp'
}

/** Media type hint for an asset file name, or null when the extension is unknown */
export function imageAssetMediaType(fileName: string): string | null {
    const dot = fileName.lastIndexOf('.')
    if (dot < 0) return null
    const extension = fileName.slice(dot + 1).toLowerCase()
    return IMAGE_ASSET_MEDIA_TYPES[extension] ?? null
}

/**
 * Convert a canvas to PNG ArrayBuffer using OffscreenCanvas
 */
export async function canvasToPng(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return blob.arrayBuffer()
}

/**
 * Convert a canvas to JPEG ArrayBuffer
 */
export async function canvasToJpeg(canvas: OffscreenCanvas, quality = 0.85): Promise<ArrayBuffer> {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return blob.arrayBuffer()
}

/**
 * Convert a canvas to WebP ArrayBuffer
 */
export async function canvasToWebp(canvas: OffscreenCanvas, quality = 0.85): Promise<ArrayBuffer> {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality })
    return blob.arrayBuffer()
}
