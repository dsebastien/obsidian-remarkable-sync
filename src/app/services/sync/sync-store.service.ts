import { produce } from 'immer'
import type { Draft } from 'immer'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { NotebookSyncState, SyncStore } from '../../domain/sync-state'
import type { PluginSettings } from '../../types/plugin-settings.intf'
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
        plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
            draft.syncStore.notebooks[remarkableId] = {
                remarkableId,
                lastSyncedAt: Date.now(),
                lastModifiedCloud,
                syncedPageCount
            }
        })
        await plugin.saveSettings()
        log('Sync state updated', 'debug', { remarkableId })
    }

    async function clearAll(): Promise<void> {
        plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
            draft.syncStore = DEFAULT_SYNC_STORE
        })
        await plugin.saveSettings()
        log('Sync store cleared', 'debug')
    }

    function getStore(): SyncStore {
        return plugin.settings.syncStore
    }

    return { getState, updateState, clearAll, getStore }
}
