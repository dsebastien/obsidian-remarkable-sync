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
    /** Starred ("favorited") on the device — `pinned` in the cloud metadata. */
    readonly pinned: boolean
}

export function notebookDisplayPath(nb: NotebookSummary): string {
    return nb.folderPath ? `${nb.folderPath}/${nb.visibleName}` : nb.visibleName
}

/**
 * Normalize a user-entered cloud folder path for comparison against a
 * notebook's `folderPath` (which has no leading/trailing slash, e.g. "2026" or
 * "2026/Sub"). Strips surrounding slashes and whitespace. Returns '' for
 * root/all.
 */
export function normalizeFolder(folder: string): string {
    return folder.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Filter notebooks to those within `folder` (recursive — includes notebooks in
 * sub-folders of it). An empty/whitespace/root folder returns all notebooks.
 * Matching is exact on `folderPath` segments, so "2026" does not match "2026x".
 */
export function notebooksInFolder(
    notebooks: readonly NotebookSummary[],
    folder: string
): NotebookSummary[] {
    const norm = normalizeFolder(folder)
    if (norm === '') {
        return [...notebooks]
    }
    const prefix = `${norm}/`
    return notebooks.filter((nb) => nb.folderPath === norm || nb.folderPath.startsWith(prefix))
}

/**
 * Filter notebooks to those starred ("favorited") on the device, regardless of
 * folder — a star is explicit intent wherever the notebook lives.
 */
export function favoriteNotebooks(notebooks: readonly NotebookSummary[]): NotebookSummary[] {
    return notebooks.filter((nb) => nb.pinned)
}

/**
 * Pick the single most-recently-modified notebook (by cloud `lastModified`,
 * epoch ms as a string). Unparseable mtimes are treated as 0. Returns undefined
 * for an empty list.
 */
export function newestNotebook(notebooks: readonly NotebookSummary[]): NotebookSummary | undefined {
    let best: NotebookSummary | undefined
    let bestMod = -Infinity
    for (const nb of notebooks) {
        const parsed = parseInt(nb.lastModified, 10)
        const mod = Number.isFinite(parsed) ? parsed : 0
        if (best === undefined || mod > bestMod) {
            best = nb
            bestMod = mod
        }
    }
    return best
}
