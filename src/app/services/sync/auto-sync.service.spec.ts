import { test, expect, describe } from 'bun:test'
import { clampAutoSyncIntervalMinutes, createAutoSyncService } from './auto-sync.service'
import type { AutoSyncDeps } from './auto-sync.service'
import type { NotebookSummary } from '../../domain/notebook'
import type { NotebookSyncState } from '../../domain/sync-state'
import {
    DEFAULT_AUTO_SYNC_INTERVAL_MINUTES,
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../../types/plugin-settings.intf'

function notebook(id: string): NotebookSummary {
    return {
        id,
        visibleName: id,
        parent: '',
        lastModified: '0',
        pageCount: 1,
        folderPath: ''
    }
}

function syncState(id: string, lastSyncedAt: number, lastModifiedCloud: number): NotebookSyncState {
    return { remarkableId: id, lastSyncedAt, lastModifiedCloud, syncedPageCount: 1 }
}

interface HarnessConfig {
    enabled?: boolean
    connected?: boolean
    intervalMinutes?: number
    notebooks?: NotebookSummary[]
    syncStates?: Record<string, NotebookSyncState>
    listDocuments?: () => Promise<NotebookSummary[]>
}

interface Harness {
    deps: AutoSyncDeps
    timers: { callback: () => void; milliseconds: number; handle: number }[]
    cleared: number[]
    registered: number[]
    processed: string[]
    pruneCalls: (readonly string[])[]
}

function createHarness(config: HarnessConfig = {}): Harness {
    const timers: Harness['timers'] = []
    const cleared: number[] = []
    const registered: number[] = []
    const processed: string[] = []
    const pruneCalls: (readonly string[])[] = []
    let nextHandle = 1

    const deps: AutoSyncDeps = {
        isConnected: () => config.connected ?? true,
        isEnabled: () => config.enabled ?? true,
        intervalMinutes: () => config.intervalMinutes ?? DEFAULT_AUTO_SYNC_INTERVAL_MINUTES,
        listDocuments: config.listDocuments ?? (() => Promise.resolve(config.notebooks ?? [])),
        getSyncState: (id) => config.syncStates?.[id],
        processNotebook: (nb) => {
            processed.push(nb.id)
            return Promise.resolve()
        },
        pruneMissing: (ids) => {
            pruneCalls.push(ids)
            return Promise.resolve(0)
        },
        setIntervalFn: (callback, milliseconds) => {
            const handle = nextHandle++
            timers.push({ callback, milliseconds, handle })
            return handle
        },
        clearIntervalFn: (handle) => {
            cleared.push(handle)
        },
        registerIntervalFn: (handle) => {
            registered.push(handle)
        }
    }

    return { deps, timers, cleared, registered, processed, pruneCalls }
}

describe('clampAutoSyncIntervalMinutes', () => {
    test('returns the default for non-finite values', () => {
        expect(clampAutoSyncIntervalMinutes(Number.NaN)).toBe(DEFAULT_AUTO_SYNC_INTERVAL_MINUTES)
        expect(clampAutoSyncIntervalMinutes(Number.POSITIVE_INFINITY)).toBe(
            DEFAULT_AUTO_SYNC_INTERVAL_MINUTES
        )
    })

    test('clamps below the minimum', () => {
        expect(clampAutoSyncIntervalMinutes(0)).toBe(MIN_AUTO_SYNC_INTERVAL_MINUTES)
        expect(clampAutoSyncIntervalMinutes(-10)).toBe(MIN_AUTO_SYNC_INTERVAL_MINUTES)
    })

    test('clamps above the maximum', () => {
        expect(clampAutoSyncIntervalMinutes(100000)).toBe(MAX_AUTO_SYNC_INTERVAL_MINUTES)
    })

    test('rounds and passes valid values through', () => {
        expect(clampAutoSyncIntervalMinutes(30)).toBe(30)
        expect(clampAutoSyncIntervalMinutes(29.6)).toBe(30)
    })
})

describe('applySettings', () => {
    test('does not schedule a timer when disabled', () => {
        const harness = createHarness({ enabled: false })
        const service = createAutoSyncService(harness.deps)

        service.applySettings()

        expect(harness.timers).toHaveLength(0)
        expect(harness.registered).toHaveLength(0)
    })

    test('schedules and registers a timer with the configured interval', () => {
        const harness = createHarness({ intervalMinutes: 30 })
        const service = createAutoSyncService(harness.deps)

        service.applySettings()

        expect(harness.timers).toHaveLength(1)
        expect(harness.timers[0]?.milliseconds).toBe(30 * 60 * 1000)
        expect(harness.registered).toEqual([harness.timers[0]?.handle ?? -1])
    })

    test('clears the previous timer when re-applied', () => {
        const harness = createHarness()
        const service = createAutoSyncService(harness.deps)

        service.applySettings()
        service.applySettings()

        expect(harness.timers).toHaveLength(2)
        expect(harness.cleared).toEqual([harness.timers[0]?.handle ?? -1])
    })

    test('clears the timer when disabled after being enabled', () => {
        let enabled = true
        const harness = createHarness()
        harness.deps.isEnabled = () => enabled
        const service = createAutoSyncService(harness.deps)

        service.applySettings()
        enabled = false
        service.applySettings()

        expect(harness.cleared).toEqual([harness.timers[0]?.handle ?? -1])
        expect(harness.timers).toHaveLength(1)
    })

    test('clamps out-of-range intervals', () => {
        const harness = createHarness({ intervalMinutes: 1 })
        const service = createAutoSyncService(harness.deps)

        service.applySettings()

        expect(harness.timers[0]?.milliseconds).toBe(MIN_AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000)
    })
})

describe('runNow', () => {
    test('skips when disabled', async () => {
        const harness = createHarness({ enabled: false })
        const service = createAutoSyncService(harness.deps)

        const result = await service.runNow()

        expect(result.skipped).toBe('disabled')
        expect(harness.processed).toHaveLength(0)
    })

    test('skips when disconnected', async () => {
        const harness = createHarness({ connected: false })
        const service = createAutoSyncService(harness.deps)

        const result = await service.runNow()

        expect(result.skipped).toBe('disconnected')
        expect(harness.processed).toHaveLength(0)
    })

    test('skips overlapping runs', async () => {
        let resolveListing: (notebooks: NotebookSummary[]) => void = () => {
            // replaced synchronously by the promise executor below
        }
        const harness = createHarness({
            listDocuments: () =>
                new Promise<NotebookSummary[]>((resolve) => {
                    resolveListing = resolve
                })
        })
        const service = createAutoSyncService(harness.deps)

        const firstRun = service.runNow()
        expect(service.isRunning()).toBe(true)

        const secondResult = await service.runNow()
        expect(secondResult.skipped).toBe('already-running')

        resolveListing([])
        const firstResult = await firstRun
        expect(firstResult.skipped).toBeNull()
        expect(service.isRunning()).toBe(false)
    })

    test('syncs only notebooks that need updating', async () => {
        const harness = createHarness({
            notebooks: [notebook('synced'), notebook('needs-sync'), notebook('never-synced')],
            syncStates: {
                'synced': syncState('synced', 2000, 1000),
                'needs-sync': syncState('needs-sync', 500, 1000)
            }
        })
        const service = createAutoSyncService(harness.deps)

        const result = await service.runNow()

        expect(result.skipped).toBeNull()
        expect(result.syncedCount).toBe(2)
        expect(harness.processed).toEqual(['needs-sync', 'never-synced'])
    })

    test('prunes sync state against the fresh cloud listing', async () => {
        const harness = createHarness({ notebooks: [notebook('a'), notebook('b')] })
        const service = createAutoSyncService(harness.deps)

        await service.runNow()

        expect(harness.pruneCalls).toEqual([['a', 'b']])
    })

    test('recovers when the cloud listing fails', async () => {
        const harness = createHarness({
            listDocuments: () => Promise.reject(new Error('network down'))
        })
        const service = createAutoSyncService(harness.deps)

        const result = await service.runNow()

        expect(result.skipped).toBeNull()
        expect(result.syncedCount).toBe(0)
        expect(service.isRunning()).toBe(false)
    })

    test('timer callback triggers a sync pass', async () => {
        const harness = createHarness({ notebooks: [notebook('a')] })
        const service = createAutoSyncService(harness.deps)

        service.applySettings()
        harness.timers[0]?.callback()
        // The callback fires runNow without awaiting; flush microtasks
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(harness.processed).toEqual(['a'])
    })
})
