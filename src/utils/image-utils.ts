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
export async function canvasToJpeg(canvas: OffscreenCanvas, quality = 0.9): Promise<ArrayBuffer> {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return blob.arrayBuffer()
}
