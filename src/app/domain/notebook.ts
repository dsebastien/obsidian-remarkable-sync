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
export interface Page {
    readonly pageId: string
    readonly pageIndex: number
    readonly strokes: readonly Stroke[]
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

export function notebookDisplayPath(nb: NotebookSummary): string {
    return nb.folderPath ? `${nb.folderPath}/${nb.visibleName}` : nb.visibleName
}
