import type { NotebookSummary } from '../../domain/notebook'
import type { NotebookSyncState } from '../../domain/sync-state'
import { deriveSyncStatus } from '../../domain/sync-state'
import {
    DEFAULT_AUTO_SYNC_INTERVAL_MINUTES,
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../../types/plugin-settings.intf'
import type { RemarkableSyncPlugin } from '../../plugin'
import { log } from '../../../utils/log'

export function clampAutoSyncIntervalMinutes(minutes: number): number {
    if (!Number.isFinite(minutes)) {
        return DEFAULT_AUTO_SYNC_INTERVAL_MINUTES
    }
    const rounded = Math.round(minutes)
    if (rounded < MIN_AUTO_SYNC_INTERVAL_MINUTES) {
        return MIN_AUTO_SYNC_INTERVAL_MINUTES
    }
    if (rounded > MAX_AUTO_SYNC_INTERVAL_MINUTES) {
        return MAX_AUTO_SYNC_INTERVAL_MINUTES
    }
    return rounded
}

export type AutoSyncSkipReason = 'disabled' | 'disconnected' | 'already-running'

export interface AutoSyncRunResult {
    readonly skipped: AutoSyncSkipReason | null
    readonly prunedCount: number
    readonly syncedCount: number
}

/**
 * Narrow dependency surface so the scheduling and guard logic can be tested
 * without a live Obsidian plugin instance.
 */
export interface AutoSyncDeps {
    isConnected(): boolean
    isEnabled(): boolean
    intervalMinutes(): number
    listDocuments(): Promise<NotebookSummary[]>
    getSyncState(remarkableId: string): NotebookSyncState | undefined
    processNotebook(notebook: NotebookSummary): Promise<void>
    pruneMissing(presentIds: readonly string[]): Promise<number>
    setIntervalFn(callback: () => void, milliseconds: number): number
    clearIntervalFn(handle: number): void
    registerIntervalFn(handle: number): void
}

export interface AutoSyncService {
    /** (Re-)schedule the background timer from the current settings. */
    applySettings(): void
    /** Run one guarded sync pass immediately. */
    runNow(): Promise<AutoSyncRunResult>
    isRunning(): boolean
}

export function createAutoSyncService(deps: AutoSyncDeps): AutoSyncService {
    let timerHandle: number | null = null
    let running = false

    async function runNow(): Promise<AutoSyncRunResult> {
        if (!deps.isEnabled()) {
            return { skipped: 'disabled', prunedCount: 0, syncedCount: 0 }
        }
        if (!deps.isConnected()) {
            return { skipped: 'disconnected', prunedCount: 0, syncedCount: 0 }
        }
        if (running) {
            return { skipped: 'already-running', prunedCount: 0, syncedCount: 0 }
        }
        running = true
        try {
            const notebooks = await deps.listDocuments()
            const prunedCount = await deps.pruneMissing(notebooks.map((nb) => nb.id))
            const toSync = notebooks.filter((nb) => {
                const status = deriveSyncStatus(deps.getSyncState(nb.id))
                return status === 'needs-sync' || status === 'never-synced'
            })
            for (const notebook of toSync) {
                await deps.processNotebook(notebook)
            }
            if (toSync.length > 0 || prunedCount > 0) {
                log('Automatic sync completed', 'debug', {
                    synced: toSync.length,
                    pruned: prunedCount
                })
            }
            return { skipped: null, prunedCount, syncedCount: toSync.length }
        } catch (error) {
            log('Automatic sync failed', 'error', error)
            return { skipped: null, prunedCount: 0, syncedCount: 0 }
        } finally {
            running = false
        }
    }

    function applySettings(): void {
        if (timerHandle !== null) {
            deps.clearIntervalFn(timerHandle)
            timerHandle = null
        }
        if (!deps.isEnabled()) {
            return
        }
        const minutes = clampAutoSyncIntervalMinutes(deps.intervalMinutes())
        timerHandle = deps.setIntervalFn(
            () => {
                void runNow()
            },
            minutes * 60 * 1000
        )
        deps.registerIntervalFn(timerHandle)
        log('Automatic sync scheduled', 'debug', { minutes })
    }

    function isRunning(): boolean {
        return running
    }

    return { applySettings, runNow, isRunning }
}

export function createAutoSyncServiceForPlugin(plugin: RemarkableSyncPlugin): AutoSyncService {
    return createAutoSyncService({
        isConnected: () => plugin.isConnected,
        isEnabled: () => plugin.settings.autoSyncEnabled,
        intervalMinutes: () => plugin.settings.autoSyncIntervalMinutes,
        listDocuments: () => plugin.cloudService.listDocuments(),
        getSyncState: (remarkableId) => plugin.syncStoreService.getState(remarkableId),
        processNotebook: async (notebook): Promise<void> => {
            await plugin.pipelineService.processNotebook(notebook, () => {
                // Background sync has no progress UI
            })
        },
        pruneMissing: (presentIds) => plugin.syncStoreService.pruneMissing(presentIds),
        setIntervalFn: (callback, milliseconds) => window.setInterval(callback, milliseconds),
        clearIntervalFn: (handle) => window.clearInterval(handle),
        registerIntervalFn: (handle) => plugin.registerInterval(handle)
    })
}
