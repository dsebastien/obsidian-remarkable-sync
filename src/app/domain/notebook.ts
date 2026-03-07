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
    CalligraphyPen = 21
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
    GreyOverlap = 8
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
 * A single stroke drawn on a page
 */
export interface Stroke {
    readonly penType: PenType
    readonly color: StrokeColor
    readonly thickness: number
    readonly points: readonly StrokePoint[]
}

/**
 * A single page of a notebook, containing strokes
 */
export interface Page {
    readonly pageId: string
    readonly pageIndex: number
    readonly strokes: readonly Stroke[]
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
