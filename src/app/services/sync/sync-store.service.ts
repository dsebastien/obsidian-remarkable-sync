import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSyncState, SyncStore } from '../../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../../domain/sync-state'
import { log } from '../../../utils/log'

export interface SyncStoreService {
    getState(remarkableId: string): NotebookSyncState | undefined
    updateState(
        remarkableId: string,
        lastModifiedCloud: number,
        syncedPageCount: number
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

    async function clearAll(): Promise<void> {
        await plugin.updateSettings((draft) => {
            draft.syncStore = DEFAULT_SYNC_STORE
        })
        log('Sync store cleared', 'debug')
    }

    function getStore(): SyncStore {
        return plugin.settings.syncStore
    }

    return { getState, updateState, clearAll, getStore }
}
