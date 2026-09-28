import type { DeviceScreen } from './device-screen'
import type { PageText } from './text'

/**
 * Pen types supported by the reMarkable tablet
 */
export enum PenType {
    BallPoint = 2,
    BallPointV2 = 15,
    Marker = 3,
    MarkerV2 = 16,
    Fineliner = 4,
    FinelinerV2 = 17,
    SharpPencil = 7,
    SharpPencilV2 = 13,
    TiltPencil = 1,
    TiltPencilV2 = 14,
    Brush = 0,
    BrushV2 = 12,
    Highlighter = 5,
    HighlighterV2 = 18,
    Eraser = 6,
    EraseArea = 8,
    CalligraphyPen = 21,
    /** Shading marker: wide, semi-transparent, carries its own ARGB */
    Shader = 23
}

/**
 * Stroke color values from the .rm file
 */
export enum StrokeColor {
    Black = 0,
    Grey = 1,
    White = 2,
    Yellow = 3,
    Green = 4,
    Pink = 5,
    Blue = 6,
    Red = 7,
    GreyOverlap = 8,
    /**
     * Not a colour in itself: a marker meaning "this item carries its own ARGB
     * value". Written by tools whose colour is freely chosen, such as the v2
     * highlighter and the shading marker. Named `ARGB` in librm_lines.
     */
    Argb = 9,
    Green2 = 10,
    Cyan = 11,
    Magenta = 12,
    Yellow2 = 13
}

/**
 * A single point in a stroke
 */
export interface StrokePoint {
    readonly x: number
    readonly y: number
    readonly speed: number
    readonly width: number
    readonly direction: number
    readonly pressure: number
}

/**
 * A colour carried by the stroke itself, rather than looked up in the palette.
 *
 * Channels are 0-255. `alpha` is genuine transparency: a shading marker records
 * roughly 45% here, which is why it looks light on the device.
 */
export interface StrokeArgb {
    readonly red: number
    readonly green: number
    readonly blue: number
    readonly alpha: number
}

/**
 * A single stroke drawn on a page
 */
export interface Stroke {
    readonly penType: PenType
    readonly color: StrokeColor
    readonly thickness: number
    readonly points: readonly StrokePoint[]
    /**
     * The stroke's own colour, present when `color` is
     * {@link StrokeColor.Argb}.
     *
     * Newer firmware writes a per-stroke BGRA value for tools whose colour is
     * freely chosen (the v2 highlighter and the shading marker) and sets
     * `color` to 9 as a marker meaning "the real colour is here". Verified
     * across 1,593 strokes: this field is present exactly when `color` is 9,
     * and absent for every palette colour.
     */
    readonly argb?: StrokeArgb
}

/**
 * A rectangle covered by a text highlight, in .rm page coordinates.
 */
export interface HighlightRect {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

/**
 * Text highlighted by selecting it on the device, as opposed to ink drawn with
 * the highlighter pen.
 *
 * The device records the actual selected text and the rectangles covering it,
 * so no geometry has to be inferred from stroke paths and the text is exact
 * rather than reconstructed.
 */
export interface Highlight {
    readonly text: string
    readonly color: StrokeColor
    readonly rects: readonly HighlightRect[]
    /**
     * The highlight's own colour, when the device recorded one.
     *
     * Present when `color` is below {@link StrokeColor.Argb}, which is the
     * mirror of the rule for strokes: a stroke carries its own colour when
     * `color` *is* 9. Either way the palette is not the answer.
     */
    readonly argb?: StrokeArgb
}

/**
 * A single page of a notebook, containing strokes
 */
/**
 * An image placed on a page, either dragged in from the desktop app
 * (firmware 3.27, "Add images to notebooks") or made with the capture tool
 * (firmware 3.28). Both write the same blocks.
 *
 * The device stores the pixels in a folder named after the page
 * (`<documentId>/<pageId>/<fileName>`) and records only the placement in the
 * page's .rm file. Issue #36.
 *
 * Known gaps: the placement is a quad of four (x, y, u, v) vertices and the
 * renderer reduces it to a bounding box, so a rotated or cropped capture draws
 * upright and uncropped (the parser warns when the quad is not canonical). The
 * per-declaration flags, observed as [17, 0] in every sample, are ignored.
 */
export interface PageImage {
    /**
     * Asset id from the .rm file, lowercase hex, no separators. Carried for
     * diagnostics; the parser has already used it to resolve `fileName`, and
     * nothing downstream reads it.
     */
    readonly assetId: string
    /** Image file name inside the page's asset folder */
    readonly fileName: string
    /** Placement rectangle in stroke coordinate space (x centered on 0) */
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
    /** Image bytes, resolved from the document archive. Null when the file is absent. */
    readonly data: ArrayBuffer | null
}

export interface Page {
    readonly pageId: string
    readonly pageIndex: number
    readonly strokes: readonly Stroke[]
    /**
     * Placed images. Absent on pages that have none, which is every page
     * written before firmware 3.27.
     */
    readonly images?: readonly PageImage[]
    /** Text highlights, present only on source-backed documents */
    readonly highlights?: readonly Highlight[]
    /**
     * Keyboard-typed text. Absent on pages that carry only ink, which includes
     * every handwritten page: handwriting is stroke data and is never text.
     */
    readonly text?: PageText
    /**
     * Index of the page in the source document this layer annotates.
     *
     * Only set for source-backed documents (a PDF imported onto the device).
     * Absent for notebook pages and for pages inserted on the device, which
     * have no counterpart in the source.
     */
    readonly sourcePageIndex?: number
}

/**
 * The original file a document was created from, kept so annotations can be
 * drawn back onto it. Notebooks have none.
 */
export interface SourceDocument {
    readonly kind: 'pdf' | 'epub'
    readonly data: ArrayBuffer
}

/**
 * A complete notebook with all its pages
 */
export interface Notebook {
    readonly id: string
    readonly visibleName: string
    readonly parent: string
    readonly lastModified: string
    readonly pageCount: number
    readonly pages: readonly Page[]
    /** Present only for documents backed by an imported file */
    readonly sourceDocument?: SourceDocument
    /**
     * The screen this was written on, which sets the scale from `.rm` units to
     * PDF points. Absent when the document does not record it.
     */
    readonly deviceScreen?: DeviceScreen
}

/**
 * Summary of a notebook for display in the panel (before downloading content)
 */
export interface NotebookSummary {
    readonly id: string
    readonly visibleName: string
    readonly parent: string
    readonly lastModified: string
    readonly pageCount: number
    readonly folderPath: string
}

/**
 * The outcome of a cloud listing, kept distinct from its contents.
 *
 * `listDocuments` used to answer with a bare array and return `[]` on every
 * failure, so "the cloud is unreachable" and "you have no notebooks" were the
 * same value. `pruneMissing` then read that empty array as "every notebook was
 * deleted" and erased the entire sync store, and the next run re-downloaded
 * the whole library. Shipped in 1.10.0, found in 2.1.0.
 *
 * So the outcome is now explicit, and `complete` is the flag that gates
 * anything destructive.
 */
export interface DocumentListing {
    /** What was successfully listed. Safe to display and to sync from. */
    readonly notebooks: NotebookSummary[]

    /**
     * True only when EVERY entry in the cloud index was read successfully.
     *
     * Required before pruning sync state: only a complete listing lets an
     * absent notebook be read as a deleted one. A partial listing is still
     * perfectly good for display and for syncing what it did return.
     */
    readonly complete: boolean

    /** A message to show the user, or null when the listing fully succeeded. */
    readonly error: string | null

    /**
     * Ids of the entries that were in the cloud index but could not be read,
     * or were withheld (a parent folder unreadable). Null when the ids are not
     * known: the listing failed outright, or index lines could not be parsed.
     * Empty for a complete listing.
     */
    readonly unreadableIds: readonly string[] | null
}

/**
 * Describe a listing that ran to completion, given how many entries could not
 * be read.
 *
 * Pure, and separated from the network plumbing on purpose: the rule that
 * decides whether destructive pruning may run is the part worth testing, and
 * it was previously buried inside a function that needs a live cloud to reach.
 */
export function describeListing(
    notebooks: NotebookSummary[],
    unreadable: number,
    unreadableIds: readonly string[] | null = null
): DocumentListing {
    if (unreadable > 0) {
        return {
            notebooks,
            complete: false,
            error: `${unreadable} item(s) could not be read from the reMarkable cloud`,
            unreadableIds
        }
    }
    return { notebooks, complete: true, error: null, unreadableIds: [] }
}

/**
 * Describe a listing that failed outright.
 *
 * Note it is NOT complete, even though it holds no notebooks. That distinction
 * is the entire point of this type.
 */
export function failedListing(message: string): DocumentListing {
    return { notebooks: [], complete: false, error: message, unreadableIds: null }
}

/** How a refresh went, for the panel's wording. */
export type ListingOutcome = 'complete' | 'partial' | 'failed'

/**
 * What the panel shows after a refresh, given what it showed before.
 *
 * - complete: the listing, as is.
 * - partial (some entries unreadable, some notebooks listed): the listing,
 *   plus the last known entry of every notebook that was UNREADABLE this time
 *   (all absent ones when the unreadable ids are unknown). Dropping them would
 *   look exactly like a deletion on the device.
 * - failed (nothing listed): the previous list.
 *
 * Every entry carried over from before is STALE: its name, folder and trash
 * state may have changed since, so it is shown but must never be synced. A
 * notebook moved to a folder that is now unreadable would otherwise be written
 * to its old folder, and to the new one on the next full listing (issue #28);
 * a notebook trashed on the device could be synced back into the vault.
 */
export function mergeListing(
    previous: readonly NotebookSummary[],
    listing: DocumentListing
): { notebooks: NotebookSummary[]; staleIds: Set<string>; outcome: ListingOutcome } {
    if (listing.complete) {
        return { notebooks: listing.notebooks, staleIds: new Set(), outcome: 'complete' }
    }
    if (listing.notebooks.length === 0) {
        return {
            notebooks: [...previous],
            staleIds: new Set(previous.map((nb) => nb.id)),
            outcome: 'failed'
        }
    }
    const listed = new Set(listing.notebooks.map((nb) => nb.id))
    const unreadable = listing.unreadableIds === null ? null : new Set(listing.unreadableIds)
    const kept = previous.filter(
        (nb) => !listed.has(nb.id) && (unreadable === null || unreadable.has(nb.id))
    )
    return {
        notebooks: [...listing.notebooks, ...kept],
        staleIds: new Set(kept.map((nb) => nb.id)),
        outcome: 'partial'
    }
}

/**
 * Ids of the notebooks a bulk sync should process: never a stale entry (see
 * `mergeListing`), and only those `include` accepts.
 *
 * Ids, not summaries: a bulk sync runs for minutes, and a refresh in between
 * can move or trash a notebook. Each id is resolved again when its turn comes
 * (`currentSyncTarget`).
 */
export function syncCandidates(
    notebooks: readonly NotebookSummary[],
    staleIds: ReadonlySet<string>,
    include: (nb: NotebookSummary) => boolean
): string[] {
    return notebooks.filter((nb) => !staleIds.has(nb.id) && include(nb)).map((nb) => nb.id)
}

/**
 * The entry to sync for `id` NOW: the current one from the panel's list, or
 * null when it is gone (deleted, trashed) or stale. Syncing a summary captured
 * earlier would write a notebook moved since into its old folder.
 */
export function currentSyncTarget(
    notebooks: readonly NotebookSummary[],
    staleIds: ReadonlySet<string>,
    id: string
): NotebookSummary | null {
    if (staleIds.has(id)) {
        return null
    }
    return notebooks.find((nb) => nb.id === id) ?? null
}

export function notebookDisplayPath(nb: NotebookSummary): string {
    return nb.folderPath ? `${nb.folderPath}/${nb.visibleName}` : nb.visibleName
}
