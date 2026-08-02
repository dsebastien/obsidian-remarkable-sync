import { DEFAULT_DEVICE_SCREEN, pointsPerRmUnit } from '../../domain/device-screen'
import type { DeviceScreen } from '../../domain/device-screen'

/**
 * The rectangle of a PDF page that the device displays, in PDF points.
 * Matches the shape pdf-lib's `getCropBox()` returns.
 */
export interface PageBox {
    x: number
    y: number
    width: number
    height: number
}

/**
 * A point in PDF user space: origin bottom-left, y increasing upward.
 */
export interface PdfPoint {
    x: number
    y: number
}

/**
 * Maps .rm stroke coordinates onto a source PDF page.
 *
 * The scale depends on the **device**, not the page: a page is placed at its
 * true physical size, so a screen pixel is a document pixel and an 8.5 inch
 * page is 8.5 x dpi units across.
 * An earlier version
 * fitted the page width to a fixed 1872 .rm units, which is wrong, and wrong in
 * a way that hides on A4: A4 is 8.268 in wide, so it really spans 1878 units and
 * the fit was off by 0.3%, well inside what eyeballing a landmark can catch. US
 * Letter really spans 1931, where the same fit is off by 3.1%, which shows up as
 * ink drifting further down and further out the further it is from the origin.
 *
 * Measured against the device's own thumbnail render of the sample, using the
 * two text-highlight rectangles, whose .rm coordinates are known exactly:
 *
 * | axis | pt per .rm unit | implied dpi |
 * | ---- | --------------- | ----------- |
 * | x, from a band's width | 0.317147 | 227.02 |
 * | y, from the gap between two bands | 0.317162 | 227.01 |
 *
 * against 0.316980 for the physical figure used here, and 0.326923 for the old
 * page-width fit. The two axes agreeing to five decimals is what says the scale
 * is uniform and independent of the page.
 */
export function pdfScaleForPage(_box: PageBox, screen?: DeviceScreen): number {
    return pointsPerRmUnit(screen ?? DEFAULT_DEVICE_SCREEN)
}

/**
 * Convert a single .rm point to PDF user space on the given page.
 *
 * `.rm` x is centred on zero and y grows downward from the top of the page.
 * PDF y grows upward from the bottom, hence the flip.
 *
 * `rotate` honours the page's `/Rotate` entry. **Untested against real data**:
 * no document available carries a non-zero rotation, so this is written from
 * the specification rather than observation.
 */
export function rmPointToPdf(
    rmX: number,
    rmY: number,
    box: PageBox,
    rotate: 0 | 90 | 180 | 270 = 0,
    screen?: DeviceScreen
): PdfPoint {
    const scale = pdfScaleForPage(box, screen)

    // Position within the page, measured from its top-left corner
    const acrossFromLeft = box.width / 2 + rmX * scale
    const downFromTop = rmY * scale

    switch (rotate) {
        case 90:
            return { x: box.x + downFromTop, y: box.y + acrossFromLeft }
        case 180:
            return {
                x: box.x + box.width - acrossFromLeft,
                y: box.y + downFromTop
            }
        case 270:
            return {
                x: box.x + box.width - downFromTop,
                y: box.y + box.height - acrossFromLeft
            }
        case 0:
        default:
            return {
                x: box.x + acrossFromLeft,
                y: box.y + box.height - downFromTop
            }
    }
}

/**
 * Convert an .rm stroke width to PDF points on the given page.
 */
export function rmWidthToPdf(rmWidth: number, box: PageBox, screen?: DeviceScreen): number {
    return rmWidth * pdfScaleForPage(box, screen)
}
