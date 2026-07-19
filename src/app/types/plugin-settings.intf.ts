import { produce } from 'immer'
import type { Draft } from 'immer'
import type { SyncStore } from '../domain/sync-state'
import { DEFAULT_SYNC_STORE } from '../domain/sync-state'
import { DEFAULT_TRIAGE_IDLE_MINUTES } from '../domain/triage-routing'
import { defaultTriageQueueDir } from '../services/triage/triage-queue.service'

export const MIN_AUTO_SYNC_INTERVAL_MINUTES = 5

/**
 * What auto-sync (and the manual scoped-sync command) picks up:
 * - 'newest' — the single most-recently-modified notebook in the source folder.
 * - 'favorites' — every notebook starred on the device, in any folder.
 */
export const AUTO_SYNC_MODES = ['newest', 'favorites'] as const
export type AutoSyncMode = (typeof AUTO_SYNC_MODES)[number]

/** The one validity check for a mode value, shared by load-merge and the UI. */
export function isAutoSyncMode(value: unknown): value is AutoSyncMode {
    return (AUTO_SYNC_MODES as readonly unknown[]).includes(value)
}

export interface PluginSettings {
    targetFolder: string
    saveImages: boolean
    imageFormat: 'png' | 'jpeg' | 'webp'
    imageQuality: number
    useRmfakecloud: boolean
    rmfakecloudUrl: string
    syncOnStartup: boolean
    autoSync: boolean
    autoSyncIntervalMinutes: number
    sourceFolder: string
    autoSyncMode: AutoSyncMode
    /** Transcribe each synced page to markdown via the local OCR endpoint. */
    ocrEnabled: boolean
    /** URL of the local md_capture_server `/ocr` endpoint (image in → markdown out). */
    mdserverOcrUrl: string
    /** Delay (ms) between per-page OCR requests, to stay under the provider's rate limit. */
    ocrRequestDelayMs: number
    /**
     * Internal: the version of the `img-N` placeholder → real-page-image migration
     * that has run. The migration re-runs once whenever the code version is higher
     * (e.g. when the embed placement changes). 0 = never run.
     */
    imgPlaceholderMigrationVersion: number
    syncStore: SyncStore
    /**
     * GP-125: route OCR'd pages that have had no further writing activity for
     * `triageIdleMinutes` into the same PA/triage intake voice notes use.
     */
    triageEnabled: boolean
    /** Idle threshold (minutes) — see `selectPagesToRoute`. */
    triageIdleMinutes: number
    /** Absolute host path to md_capture's `TRIAGE_QUEUE_DIR` (host-side, not a vault path). */
    triageQueueDir: string
    /** `chat_id` in each queued request — the PA's telegram chat. */
    triageChatId: number
}

export const DEFAULT_SETTINGS: PluginSettings = {
    targetFolder: '',
    saveImages: true,
    imageFormat: 'jpeg',
    imageQuality: 0.85,
    useRmfakecloud: false,
    rmfakecloudUrl: '',
    syncOnStartup: false,
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    sourceFolder: '/2026',
    autoSyncMode: 'newest',
    ocrEnabled: false,
    mdserverOcrUrl: 'http://localhost:1250/ocr',
    ocrRequestDelayMs: 400,
    imgPlaceholderMigrationVersion: 0,
    syncStore: DEFAULT_SYNC_STORE,
    triageEnabled: true,
    triageIdleMinutes: DEFAULT_TRIAGE_IDLE_MINUTES,
    triageQueueDir: defaultTriageQueueDir(),
    triageChatId: -5188649683
}

/**
 * Shape of settings as persisted on disk: any subset of the current fields,
 * plus legacy fields written by older releases.
 */
export type LoadedPluginSettings = Partial<PluginSettings> & {
    /**
     * Legacy (pre-`autoSyncMode`) toggle: true = auto-sync only the newest
     * notebook in the source folder, false = every notebook in it.
     */
    autoSyncNewestOnly?: boolean
}

/**
 * Merge persisted settings over the defaults, field by field, so a missing or
 * unknown key never clobbers a default (and new defaults reach old installs).
 * Migrates legacy fields: `autoSyncNewestOnly` → `autoSyncMode: 'newest'`
 * (the pre-favorites behaviors have no other equivalent in the new mode set).
 */
export function resolveSettings(loaded: LoadedPluginSettings | null): PluginSettings {
    if (!loaded) {
        return { ...DEFAULT_SETTINGS }
    }

    return produce(DEFAULT_SETTINGS, (draft: Draft<PluginSettings>) => {
        if (loaded.targetFolder !== undefined) {
            draft.targetFolder = loaded.targetFolder
        }
        if (loaded.saveImages !== undefined) {
            draft.saveImages = loaded.saveImages
        }
        if (loaded.imageFormat !== undefined) {
            draft.imageFormat = loaded.imageFormat
        }
        if (loaded.imageQuality !== undefined) {
            draft.imageQuality = loaded.imageQuality
        }
        if (loaded.useRmfakecloud !== undefined) {
            draft.useRmfakecloud = loaded.useRmfakecloud
        }
        if (loaded.rmfakecloudUrl !== undefined) {
            draft.rmfakecloudUrl = loaded.rmfakecloudUrl
        }
        if (loaded.syncOnStartup !== undefined) {
            draft.syncOnStartup = loaded.syncOnStartup
        }
        if (loaded.autoSync !== undefined) {
            draft.autoSync = loaded.autoSync
        }
        if (loaded.autoSyncIntervalMinutes !== undefined) {
            draft.autoSyncIntervalMinutes = loaded.autoSyncIntervalMinutes
        }
        if (loaded.sourceFolder !== undefined) {
            draft.sourceFolder = loaded.sourceFolder
        }
        if (isAutoSyncMode(loaded.autoSyncMode)) {
            draft.autoSyncMode = loaded.autoSyncMode
        } else if (loaded.autoSyncNewestOnly !== undefined) {
            // Legacy toggle: both values map to 'newest' — the old "every
            // notebook in the source folder" (false) has no mode equivalent.
            draft.autoSyncMode = 'newest'
        }
        if (loaded.ocrEnabled !== undefined) {
            draft.ocrEnabled = loaded.ocrEnabled
        }
        if (loaded.mdserverOcrUrl !== undefined) {
            draft.mdserverOcrUrl = loaded.mdserverOcrUrl
        }
        if (loaded.ocrRequestDelayMs !== undefined) {
            draft.ocrRequestDelayMs = loaded.ocrRequestDelayMs
        }
        if (loaded.imgPlaceholderMigrationVersion !== undefined) {
            draft.imgPlaceholderMigrationVersion = loaded.imgPlaceholderMigrationVersion
        }
        if (loaded.syncStore !== undefined) {
            draft.syncStore = loaded.syncStore
        }
        if (loaded.triageEnabled !== undefined) {
            draft.triageEnabled = loaded.triageEnabled
        }
        if (loaded.triageIdleMinutes !== undefined) {
            draft.triageIdleMinutes = loaded.triageIdleMinutes
        }
        if (loaded.triageQueueDir !== undefined) {
            draft.triageQueueDir = loaded.triageQueueDir
        }
        if (loaded.triageChatId !== undefined) {
            draft.triageChatId = loaded.triageChatId
        }
    })
}
