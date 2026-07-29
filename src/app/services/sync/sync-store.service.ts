import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSyncState, SyncStore } from '../../domain/sync-state'
import { DEFAULT_SYNC_STORE, findOrphanedSyncIds } from '../../domain/sync-state'
import { log } from '../../../utils/log'

export interface SyncStoreService {
    getState(remarkableId: string): NotebookSyncState | undefined
    updateState(
        remarkableId: string,
        lastModifiedCloud: number,
        syncedPageCount: number
    ): Promise<void>
    /**
     * Remove sync-state entries whose notebook is no longer in the cloud
     * listing (deleted on the device/cloud). Vault files are never touched.
     * @param presentIds the notebook ids present in the fresh cloud listing
     * @returns the number of pruned entries
     */
    pruneMissing(presentIds: readonly string[]): Promise<number>
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
        syncedPageCount: number
    ): Promise<void> {
        await plugin.updateSettings((draft) => {
            draft.syncStore.notebooks[remarkableId] = {
                remarkableId,
                lastSyncedAt: Date.now(),
                lastModifiedCloud,
                syncedPageCount
            }
        })
        log('Sync state updated', 'debug', { remarkableId })
    }

    async function pruneMissing(presentIds: readonly string[]): Promise<number> {
        const orphanedIds = findOrphanedSyncIds(plugin.settings.syncStore, new Set(presentIds))
        if (orphanedIds.length === 0) {
            return 0
        }
        await plugin.updateSettings((draft) => {
            for (const id of orphanedIds) {
                delete draft.syncStore.notebooks[id]
            }
        })
        log('Pruned orphaned sync state entries', 'debug', orphanedIds)
        return orphanedIds.length
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

    return { getState, updateState, pruneMissing, clearAll, getStore }
}
