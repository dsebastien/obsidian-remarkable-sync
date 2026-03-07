import type { SyncStore } from '../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../domain/sync-state'

export interface PluginSettings {
    targetFolder: string
    saveImages: boolean
    imageFormat: 'png' | 'jpeg'
    syncStore: SyncStore
}

export const DEFAULT_SETTINGS: PluginSettings = {
    targetFolder: '',
    saveImages: true,
    imageFormat: 'png',
    syncStore: DEFAULT_SYNC_STORE
}
