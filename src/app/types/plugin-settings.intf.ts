import { DEFAULT_SORT_VALUE } from '../domain/notebook-sort'
import type { SyncStore } from '../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../domain/sync-state'

export const MIN_AUTO_SYNC_INTERVAL_MINUTES = 5
export const MAX_AUTO_SYNC_INTERVAL_MINUTES = 240
export const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES = 30

export interface PluginSettings {
    targetFolder: string
    saveImages: boolean
    /**
     * Write one PDF per notebook, beside the per-page image folder.
     * Independent of `saveImages`: either, both or neither may be enabled.
     */
    savePdf: boolean
    /**
     * Write a markdown note listing the text highlights of a document.
     *
     * Only ever produces a file for documents that actually contain
     * highlights, so it is quiet on notebooks and un-highlighted PDFs.
     */
    saveHighlightsNote: boolean
    imageFormat: 'png' | 'jpeg' | 'webp'
    imageQuality: number
    useRmfakecloud: boolean
    rmfakecloudUrl: string
    autoSyncEnabled: boolean
    autoSyncIntervalMinutes: number
    /**
     * How the panel orders notebooks within each folder. One of the values in
     * `SORT_MODES`; an unrecognised value falls back to the default, so an old
     * or hand-edited setting cannot break the list.
     */
    panelSortOrder: string
    syncStore: SyncStore
}

export const DEFAULT_SETTINGS: PluginSettings = {
    targetFolder: '',
    saveImages: true,
    savePdf: false,
    saveHighlightsNote: false,
    imageFormat: 'jpeg',
    imageQuality: 0.85,
    useRmfakecloud: false,
    rmfakecloudUrl: '',
    autoSyncEnabled: false,
    autoSyncIntervalMinutes: DEFAULT_AUTO_SYNC_INTERVAL_MINUTES,
    panelSortOrder: DEFAULT_SORT_VALUE,
    syncStore: DEFAULT_SYNC_STORE
}
