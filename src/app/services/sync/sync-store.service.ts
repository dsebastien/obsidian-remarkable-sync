import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSyncState, PageOcrState, SyncStore } from '../../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../../domain/sync-state'
import { log } from '../../../utils/log'

/** Optional notebook display metadata carried alongside sync state (provenance only). */
export interface NotebookMeta {
    readonly visibleName?: string
    readonly folderPath?: string
}

export interface SyncStoreService {
    getState(remarkableId: string): NotebookSyncState | undefined
    updateState(
        remarkableId: string,
        lastModifiedCloud: number,
        syncedPageCount: number,
        pages?: Record<string, PageOcrState>,
        meta?: NotebookMeta
    ): Promise<void>
    /**
     * Mark one page as routed to PA triage for `srcHash` (GP-125), without
     * touching any other page's state or the notebook's own fields. Used by
     * the idle-routing pass, which runs independently of (and does not want
     * to disturb) the OCR sync's own state writes.
     */
    markPageRouted(
        remarkableId: string,
        pageId: string,
        srcHash: string,
        routedAt: number
    ): Promise<void>
    clearAll(): Promise<void>
    getStore(): SyncStore
}

export function createSyncStoreService(plugin: RemarkableSyncPlugin): SyncStoreService {
    function getState(remarkableId: string): NotebookSyncState | undefined {
        return plugin.settings.syncStore.notebooks[remarkableId]
    }

    async function updateState(
        remarkableId: string,
        lastModifiedCloud: number,
        syncedPageCount: number,
        pages?: Record<string, PageOcrState>,
        meta?: NotebookMeta
    ): Promise<void> {
        await plugin.updateSettings((draft) => {
            // Preserve any existing per-page OCR state when the caller does not
            // supply a fresh map (non-OCR syncs must not wipe OCR progress).
            const prior = draft.syncStore.notebooks[remarkableId]
            const nextPages = pages ?? prior?.pages
            draft.syncStore.notebooks[remarkableId] = {
                remarkableId,
                lastSyncedAt: Date.now(),
                lastModifiedCloud,
                syncedPageCount,
                visibleName: meta?.visibleName ?? prior?.visibleName,
                folderPath: meta?.folderPath ?? prior?.folderPath,
                ...(nextPages ? { pages: nextPages } : {})
            }
        })
        log('Sync state updated', 'debug', { remarkableId })
    }

    async function markPageRouted(
        remarkableId: string,
        pageId: string,
        srcHash: string,
        routedAt: number
    ): Promise<void> {
        await plugin.updateSettings((draft) => {
            const page = draft.syncStore.notebooks[remarkableId]?.pages?.[pageId]
            if (!page) {
                return // state changed under us (e.g. cleared) — nothing to mark
            }
            page.routedSrcHash = srcHash
            page.routedAt = routedAt
        })
        log('Page marked routed to PA triage', 'debug', { remarkableId, pageId })
    }

    async function clearAll(): Promise<void> {
        await plugin.updateSettings((draft) => {
            draft.syncStore = DEFAULT_SYNC_STORE
        })
        log('Sync store cleared', 'debug')
    }

    function getStore(): SyncStore {
        return plugin.settings.syncStore
    }

    return { getState, updateState, markPageRouted, clearAll, getStore }
}
