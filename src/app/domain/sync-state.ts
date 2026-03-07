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

export const DEFAULT_SYNC_STORE: SyncStore = {
    notebooks: {}
}
