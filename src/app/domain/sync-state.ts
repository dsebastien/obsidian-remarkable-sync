/**
 * State tracked per page within a notebook. Lets a later sync skip pages
 * whose rendered source image has not changed — no image rewrite (vault file
 * mtime untouched) and no re-OCR of unchanged pages.
 */
export interface PageOcrState {
    readonly pageId: string
    /** Hash of the rendered page image bytes from the latest sync (OCR change signal). */
    readonly srcHash: string
    /**
     * Hash of the OCR markdown produced for that image. Empty string when the
     * page has not been OCR'd (entry persisted by a sync with OCR disabled).
     */
    readonly ocrHash: string
    /**
     * Hash of the image bytes actually written to the page's vault file — the
     * image-skip signal. Unlike srcHash it only advances on a real write, so a
     * sync with "save images" off can't mark a stale file current. Absent for
     * entries from before per-page image tracking (forces one rewrite).
     */
    readonly imgHash?: string
    /**
     * 0-based page index the image file was written at (the file name derives
     * from it). Pages reordered/inserted/deleted on the device shift later
     * indexes, pointing the same pageId at a different file — an index
     * mismatch therefore forces a rewrite. Absent alongside imgHash.
     */
    readonly pageIndex?: number
}

/**
 * Sync state tracked per notebook
 */
export interface NotebookSyncState {
    readonly remarkableId: string
    readonly lastSyncedAt: number // epoch ms, 0 = never synced
    readonly lastModifiedCloud: number // epoch ms from cloud
    readonly syncedPageCount: number
    /**
     * Per-page state keyed by pageId. Optional/absent for notebooks synced
     * before per-page tracking existed (backward compatible). Populated by
     * both OCR and non-OCR syncs so unchanged page images are never rewritten.
     */
    readonly pages?: Record<string, PageOcrState>
}

/**
 * Persistent store for all notebook sync states
 */
export interface SyncStore {
    readonly notebooks: Record<string, NotebookSyncState> // keyed by remarkableId
}

/**
 * Derived sync status for UI display
 */
export type SyncStatus = 'synced' | 'needs-sync' | 'never-synced'

/**
 * Derive the sync status from a notebook's sync state
 */
export function deriveSyncStatus(state: NotebookSyncState | undefined): SyncStatus {
    if (!state || state.lastSyncedAt === 0) {
        return 'never-synced'
    }
    if (state.lastSyncedAt >= state.lastModifiedCloud) {
        return 'synced'
    }
    return 'needs-sync'
}

/**
 * Decide whether a notebook needs syncing during an all-notebook sync.
 *
 * Compares the cloud's current `lastModified` (epoch ms, as the string the cloud
 * listing returns) against the `lastModifiedCloud` we persisted on the last
 * successful sync. A notebook whose cloud mtime has not advanced is skipped so we
 * do not re-download/re-render unchanged notebooks. Never-synced notebooks, and
 * notebooks whose cloud mtime cannot be parsed, sync (fail toward syncing).
 */
export function notebookNeedsSync(
    currentLastModified: string,
    state: NotebookSyncState | undefined
): boolean {
    if (!state || state.lastSyncedAt === 0) {
        return true // never synced
    }
    const currentMod = parseInt(currentLastModified, 10)
    if (!Number.isFinite(currentMod) || currentMod === 0) {
        return true // unparseable cloud mtime → sync to be safe
    }
    return currentMod > state.lastModifiedCloud
}

export const DEFAULT_SYNC_STORE: SyncStore = {
    notebooks: {}
}
