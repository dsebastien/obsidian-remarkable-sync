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
