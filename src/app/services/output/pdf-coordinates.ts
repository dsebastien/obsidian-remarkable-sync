import { PAGE_HEIGHT } from '../../domain/rm-constants'

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
 * Derived empirically against real device exports, because the obvious models
 * are all wrong. The rule is:
 *
 *   **the page width always spans `PAGE_HEIGHT` (1872) .rm units**, whatever
 *   the page's real dimensions.
 *
 * So the scale is `cropBox.width / 1872`. The denominator being the screen
 * *height* rather than its width looks like a mistake and is not: it is
 * equivalent to `(width / 1404) * (1404 / 1872)`, the naive width-fit scaled by
 * the screen aspect ratio.
 *
 * Confirmed three ways:
 *  - A4 595x841.9: an arrow drawn at a known word lands on that word.
 *  - US Letter 612x792: full-width writing maps to x 51..611 of 612.
 *  - Out of sample: a highlighter stroke drawn afterwards reaches y 2294,
 *    which the earlier height-fit model placed off the bottom of the page and
 *    this one places correctly at y 609..729 from the top.
 *
 * The implied page size in .rm units is therefore 1872 wide by
 * `1872 / aspect` tall (2649 for A4), so ink legitimately exceeds 1872 in y.
 */
export function pdfScaleForPage(box: PageBox): number {
    return box.width / PAGE_HEIGHT
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
    rotate: 0 | 90 | 180 | 270 = 0
): PdfPoint {
    const scale = pdfScaleForPage(box)

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
export function rmWidthToPdf(rmWidth: number, box: PageBox): number {
    return rmWidth * pdfScaleForPage(box)
}
