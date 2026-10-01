import { Notice } from 'obsidian'
import type { DocumentListing, NotebookSummary } from '../../domain/notebook'
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

/** Most runs a failing notebook is skipped for (8 hours at the default interval). */
export const MAX_AUTO_SYNC_BACKOFF_RUNS = 16

/** Consecutive failures of one notebook before the user is told, once a session. */
export const AUTO_SYNC_FAILURES_BEFORE_NOTICE = 2

/** Runs to skip after the given number of consecutive failures: 1, 2, 4, … capped. */
export function autoSyncBackoffRuns(consecutiveFailures: number): number {
    return Math.min(2 ** Math.max(0, consecutiveFailures - 1), MAX_AUTO_SYNC_BACKOFF_RUNS)
}

export type AutoSyncSkipReason = 'disabled' | 'disconnected' | 'already-running'

export interface AutoSyncRunResult {
    readonly skipped: AutoSyncSkipReason | null
    readonly prunedCount: number
    /** Notebooks this run tried to sync. */
    readonly syncedCount: number
    /** Notebooks due for a sync but skipped because they keep failing. */
    readonly deferredCount: number
}

/**
 * Narrow dependency surface so the scheduling and guard logic can be tested
 * without a live Obsidian plugin instance.
 */
export interface AutoSyncDeps {
    isConnected(): boolean
    isEnabled(): boolean
    intervalMinutes(): number
    listDocuments(): Promise<DocumentListing>
    getSyncState(remarkableId: string): NotebookSyncState | undefined
    /** Sync one notebook; resolves with why it failed, or null on success. */
    processNotebook(notebook: NotebookSummary): Promise<string | null>
    notify(message: string): void
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

interface NotebookFailure {
    /** The cloud version that failed; a new version is retried at once. */
    readonly lastModified: string
    readonly consecutive: number
    skipRuns: number
}

export function createAutoSyncService(deps: AutoSyncDeps): AutoSyncService {
    let timerHandle: number | null = null
    let running = false
    // Per session. A notebook that fails every time (a blob the cloud never
    // serves) would otherwise be downloaded again on every run, silently.
    const failures = new Map<string, NotebookFailure>()
    const notified = new Set<string>()

    const notRun = (skipped: AutoSyncSkipReason): AutoSyncRunResult => ({
        skipped,
        prunedCount: 0,
        syncedCount: 0,
        deferredCount: 0
    })

    /** Whether the backoff lets this notebook sync now; spends one skipped run if not. */
    function isDue(notebook: NotebookSummary): boolean {
        const failure = failures.get(notebook.id)
        if (!failure) return true
        if (failure.lastModified !== notebook.lastModified) {
            failures.delete(notebook.id)
            return true
        }
        if (failure.skipRuns <= 0) return true
        failure.skipRuns--
        return false
    }

    function recordOutcome(notebook: NotebookSummary, error: string | null): void {
        if (null === error) {
            failures.delete(notebook.id)
            return
        }
        const consecutive = (failures.get(notebook.id)?.consecutive ?? 0) + 1
        failures.set(notebook.id, {
            lastModified: notebook.lastModified,
            consecutive,
            skipRuns: autoSyncBackoffRuns(consecutive)
        })
        log(`Automatic sync failed for ${notebook.visibleName}`, 'warn', { error, consecutive })
        if (consecutive >= AUTO_SYNC_FAILURES_BEFORE_NOTICE && !notified.has(notebook.id)) {
            notified.add(notebook.id)
            deps.notify(
                `Automatic sync could not sync "${notebook.visibleName}": ${error}. It will retry less often; sync it from the reMarkable panel to retry now.`
            )
        }
    }

    async function runNow(): Promise<AutoSyncRunResult> {
        if (!deps.isEnabled()) {
            return notRun('disabled')
        }
        if (!deps.isConnected()) {
            return notRun('disconnected')
        }
        if (running) {
            return notRun('already-running')
        }
        running = true
        try {
            const listing = await deps.listDocuments()
            const notebooks = listing.notebooks

            // Prune ONLY from a listing known to be complete. An absent
            // notebook means "deleted on the device" only if we are certain we
            // saw everything; otherwise a network failure erases sync state
            // and the next run re-downloads a library that never changed.
            const prunedCount = listing.complete
                ? await deps.pruneMissing(notebooks.map((nb) => nb.id))
                : 0

            if (!listing.complete) {
                log('Skipped pruning: the cloud listing was incomplete', 'debug', {
                    error: listing.error
                })
            }

            const pending = notebooks.filter((nb) => {
                const status = deriveSyncStatus(deps.getSyncState(nb.id), nb.lastModified)
                return status === 'needs-sync' || status === 'never-synced'
            })
            const toSync = pending.filter(isDue)
            const deferredCount = pending.length - toSync.length
            for (const notebook of toSync) {
                recordOutcome(notebook, await deps.processNotebook(notebook))
            }
            if (toSync.length > 0 || prunedCount > 0 || deferredCount > 0) {
                log('Automatic sync completed', 'debug', {
                    synced: toSync.length,
                    deferred: deferredCount,
                    pruned: prunedCount
                })
            }
            return { skipped: null, prunedCount, syncedCount: toSync.length, deferredCount }
        } catch (error) {
            log('Automatic sync failed', 'error', error)
            return { skipped: null, prunedCount: 0, syncedCount: 0, deferredCount: 0 }
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
        processNotebook: async (notebook): Promise<string | null> => {
            // Background sync has no progress UI; only the failure reason is kept.
            const failure = { error: 'Sync failed' }
            const ok = await plugin.pipelineService.processNotebook(notebook, (progress) => {
                if ('error' === progress.status && progress.error) {
                    failure.error = progress.error
                }
            })
            return ok ? null : failure.error
        },
        notify: (message) => {
            new Notice(message)
        },
        pruneMissing: (presentIds) => plugin.syncStoreService.pruneMissing(presentIds),
        setIntervalFn: (callback, milliseconds) => window.setInterval(callback, milliseconds),
        clearIntervalFn: (handle) => window.clearInterval(handle),
        registerIntervalFn: (handle) => plugin.registerInterval(handle)
    })
}
