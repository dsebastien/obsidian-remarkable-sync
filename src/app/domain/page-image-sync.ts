import type { PageOcrState } from './sync-state'

/**
 * Pure decision logic for per-page incremental image sync.
 *
 * reMarkable exposes no per-page mtime (cPages carries only id + idx), so the
 * only per-page change signal is the hash of the rendered page image. Two
 * hashes are tracked per page: `srcHash` (latest render — the OCR change
 * signal) and `imgHash` (bytes actually written to the vault file — the
 * image-skip signal). They diverge when a sync runs with "save images" off:
 * srcHash advances, imgHash must not, or a stale file would be marked current.
 */

/** The image-file facts (`imgHash`/`pageIndex`) of a page's next state. */
export type PageImageState = Pick<PageOcrState, 'imgHash' | 'pageIndex'>

/**
 * Whether a page's rendered image must be (re)written to the vault.
 *
 * Skip the write ONLY when the file exists, was written for THIS page at THIS
 * index, and its bytes hash to the current render. The existence check covers
 * user-deleted images; the imgHash check covers files never written or written
 * from older ink; the pageIndex check covers device page insert/delete/reorder
 * — an index shift points this pageId at a path holding a DIFFERENT page's
 * old image, which hash equality alone would wrongly skip.
 */
export function shouldWritePageImage(
    prev: PageOcrState | undefined,
    srcHash: string,
    pageIndex: number,
    fileExists: boolean
): boolean {
    return !fileExists || !prev || prev.imgHash !== srcHash || prev.pageIndex !== pageIndex
}

/**
 * Image-file facts to persist for a page after this sync's write decision.
 * Written → record what is on disk now. Not written (skip, "save images"
 * off) → carry the prior facts forward: the file, if any, still holds the
 * previously written bytes.
 */
export function pageImageState(
    prev: PageOcrState | undefined,
    srcHash: string,
    pageIndex: number,
    wrote: boolean
): PageImageState {
    if (wrote) {
        return { imgHash: srcHash, pageIndex }
    }
    return { imgHash: prev?.imgHash, pageIndex: prev?.pageIndex }
}

/**
 * Per-page state a non-OCR sync persists so the image-write skip works on
 * later syncs too. The prior `ocrHash` — OCR progress — is preserved only
 * while the page is unchanged; a changed page's OCR is stale, so it resets to
 * '' (not yet OCR'd) and a later OCR-enabled sync re-OCRs it.
 */
export function nonOcrPageState(
    pageId: string,
    srcHash: string,
    prev: PageOcrState | undefined,
    image: PageImageState
): PageOcrState {
    const ocrHash = prev && prev.srcHash === srcHash ? prev.ocrHash : ''
    return { pageId, srcHash, ocrHash, ...image }
}

/**
 * Whether a page's stored OCR is current, i.e. the page was actually OCR'd
 * before (non-empty `ocrHash` — entries written by non-OCR syncs have an
 * empty one) and its rendered image is unchanged. Current → skip the OCR
 * request and the note rewrite.
 */
export function isPageOcrCurrent(prev: PageOcrState | undefined, srcHash: string): boolean {
    // Not a type predicate on purpose: a false result does NOT imply prev is
    // undefined (the page may exist but be changed or never OCR'd), and a
    // predicate would wrongly narrow prev to undefined after an early-continue.
    return prev !== undefined && prev.srcHash === srcHash && prev.ocrHash !== ''
}
