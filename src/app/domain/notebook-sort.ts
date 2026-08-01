import type { NotebookSummary } from './notebook'

export type SortField = 'name' | 'modified'
export type SortDirection = 'asc' | 'desc'

export interface SortMode {
    readonly field: SortField
    readonly direction: SortDirection
}

/**
 * The orderings offered in the panel, in the order they appear in the picker.
 */
export const SORT_MODES: readonly { value: string; label: string; mode: SortMode }[] = [
    {
        value: 'modified-desc',
        label: 'Recently modified',
        mode: { field: 'modified', direction: 'desc' }
    },
    {
        value: 'modified-asc',
        label: 'Oldest modified',
        mode: { field: 'modified', direction: 'asc' }
    },
    { value: 'name-asc', label: 'Name (A–Z)', mode: { field: 'name', direction: 'asc' } },
    { value: 'name-desc', label: 'Name (Z–A)', mode: { field: 'name', direction: 'desc' } }
]

export const DEFAULT_SORT_VALUE = 'modified-desc'

/**
 * Resolve a stored sort value, falling back to the default when it is missing
 * or no longer recognised.
 */
export function parseSortValue(value: string | undefined): SortMode {
    const found = SORT_MODES.find((m) => m.value === value)
    return (found ?? SORT_MODES[0]!).mode
}

/**
 * `lastModified` arrives as a string of epoch milliseconds. Anything
 * unparseable sorts as the oldest possible date rather than throwing off the
 * whole list.
 */
function modifiedTime(notebook: NotebookSummary): number {
    const parsed = parseInt(notebook.lastModified, 10)
    return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Compare names the way a person reads them: case-insensitive, and with digit
 * runs compared numerically so "Notebook 2" precedes "Notebook 10" instead of
 * following it.
 */
function compareNames(a: NotebookSummary, b: NotebookSummary): number {
    return a.visibleName.localeCompare(b.visibleName, undefined, {
        numeric: true,
        sensitivity: 'base'
    })
}

/**
 * Sort notebooks for display.
 *
 * Returns a new array: the panel keeps the unsorted list as it came from the
 * cloud, and re-sorts on each render.
 *
 * Ties fall back to name so the order is total. Without that, two notebooks
 * modified in the same millisecond could swap places between renders, which
 * looks like the list flickering.
 */
export function sortNotebooks(
    notebooks: readonly NotebookSummary[],
    mode: SortMode
): NotebookSummary[] {
    const factor = 'asc' === mode.direction ? 1 : -1

    return [...notebooks].sort((a, b) => {
        if ('name' === mode.field) {
            return compareNames(a, b) * factor
        }

        const diff = modifiedTime(a) - modifiedTime(b)
        return 0 !== diff ? diff * factor : compareNames(a, b)
    })
}
