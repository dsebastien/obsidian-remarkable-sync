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

/**
 * Crop a region from image data for line segmentation
 */
export function cropImageData(
    sourceCanvas: OffscreenCanvas,
    y: number,
    height: number
): OffscreenCanvas {
    const width = sourceCanvas.width
    const croppedCanvas = new OffscreenCanvas(width, height)
    const ctx = croppedCanvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to create 2D context for cropping')
    }
    ctx.drawImage(sourceCanvas, 0, y, width, height, 0, 0, width, height)
    return croppedCanvas
}

/**
 * Check if a canvas region has any non-white pixels (i.e., has content)
 */
export function hasContent(canvas: OffscreenCanvas): boolean {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        return false
    }
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    // Check every 4th pixel for speed (sampling)
    for (let i = 0; i < data.length; i += 16) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        // If pixel is not fully white/transparent, there's content
        if (a !== undefined && a > 0 && (r !== 255 || g !== 255 || b !== 255)) {
            return true
        }
    }
    return false
}
