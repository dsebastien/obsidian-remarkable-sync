/**
 * Sync state tracked per notebook
 */
export interface NotebookSyncState {
    readonly remarkableId: string
    readonly lastSyncedAt: number // epoch ms, 0 = never synced
    readonly lastModifiedCloud: number // epoch ms from cloud
    readonly syncedPageCount: number
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
 * Parse a reMarkable `lastModified` value into epoch milliseconds.
 *
 * Strict on purpose. `parseInt` alone accepts anything that merely STARTS with
 * a digit, so an ISO-8601 `lastModified` would parse as the year (`2026`),
 * which compares as 1970 and makes every notebook look permanently up to date.
 * A value we cannot trust must be reported as such rather than guessed at.
 *
 * @returns epoch milliseconds, or null when the value is not a plain integer
 */
export function parseCloudTimestamp(value: string | undefined): number | null {
    if (!value || !/^\d+$/.test(value.trim())) {
        return null
    }
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Derive the sync status from a notebook's stored state and the timestamp the
 * cloud is reporting for it RIGHT NOW.
 *
 * Both sides of the comparison are cloud timestamps: what the cloud says today
 * against what the cloud said when we last synced. That is the whole point.
 * The previous rule compared `lastSyncedAt`, a local `Date.now()`, against a
 * server timestamp, which is a comparison between two unrelated clocks. It was
 * wrong in both directions. Because the stored `lastModifiedCloud` is always
 * older than the `Date.now()` written beside it, a synced notebook compared as
 * up to date forever and a genuine device edit was never noticed; and any
 * clock skew on the local machine flipped the result for reasons that have
 * nothing to do with the notebook.
 *
 * `lastSyncedAt` is now display only ("last synced 3 days ago") and is
 * deliberately not consulted here.
 *
 * An unparseable cloud timestamp leaves an already-synced notebook alone. We
 * cannot tell whether it changed, and re-downloading on every pass forever is
 * the worse of the two failures.
 */
export function deriveSyncStatus(
    state: NotebookSyncState | undefined,
    cloudLastModified: string | undefined
): SyncStatus {
    if (!state || state.lastSyncedAt === 0) {
        return 'never-synced'
    }

    const cloudNow = parseCloudTimestamp(cloudLastModified)
    if (null === cloudNow) {
        return 'synced'
    }

    return cloudNow > state.lastModifiedCloud ? 'needs-sync' : 'synced'
}

/**
 * Ids of sync-state entries whose notebook is no longer present in the given
 * cloud listing (deleted on the device/cloud).
 */
export function findOrphanedSyncIds(store: SyncStore, presentIds: ReadonlySet<string>): string[] {
    return Object.keys(store.notebooks).filter((id) => !presentIds.has(id))
}

export const DEFAULT_SYNC_STORE: SyncStore = {
    notebooks: {}
}
