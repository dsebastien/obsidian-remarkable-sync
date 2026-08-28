import { describe, expect, test, mock } from 'bun:test'
import { RemarkableSyncPlugin } from '../plugin'
import { RemarkableSyncSettingTab } from './settings-tab'
import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import { createWriteQueue } from '../utils/plugin-data'

/**
 * Behavioral coverage for the settings write path.
 *
 * Nothing in CI renders a settings pane, so these tests exercise the
 * properties no UI test can reach: writes are serialized THROUGH THE SAME
 * QUEUE as token writes, memory is committed only after persistence succeeds,
 * and a rejected value never reaches the store.
 */

async function expectRejection(promise: Promise<unknown>, contains: string): Promise<void> {
    let caught: unknown
    await promise.catch((error: unknown) => {
        caught = error
    })
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain(contains)
}

interface Harness {
    plugin: RemarkableSyncPlugin
    tab: RemarkableSyncSettingTab
    saveData: ReturnType<typeof mock>
    applySettings: ReturnType<typeof mock>
}

function createHarness(options?: { saveData?: () => Promise<void> }): Harness {
    const saveData = mock(async () => {
        if (options?.saveData) {
            await options.saveData()
        }
    })
    const applySettings = mock(() => {})

    const plugin = Object.create(RemarkableSyncPlugin.prototype) as RemarkableSyncPlugin
    const internals = plugin as unknown as Record<string, unknown>
    internals['settings'] = { ...DEFAULT_SETTINGS }
    internals['rawData'] = { ...DEFAULT_SETTINGS, deviceToken: 'keep-me' }
    internals['enqueueWrite'] = createWriteQueue()
    internals['saveData'] = saveData
    internals['autoSyncService'] = { applySettings }

    const tab = Object.create(RemarkableSyncSettingTab.prototype) as RemarkableSyncSettingTab
    const tabInternals = tab as unknown as Record<string, unknown>
    tabInternals['plugin'] = plugin
    tabInternals['update'] = () => {}

    return { plugin, tab, saveData, applySettings }
}

describe('updateSettings', () => {
    test('commits to memory only after the write is persisted', async () => {
        let release = (): void => {}
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const { plugin, saveData } = createHarness({ saveData: () => gate })

        const pending = plugin.updateSettings((draft) => {
            draft.targetFolder = 'committed'
        })

        // Let the queued write start and reach its save await; a bare
        // synchronous assertion would pass even with the ordering reversed,
        // because the queue defers the work to a microtask.
        await Promise.resolve()
        await Promise.resolve()
        expect(saveData).toHaveBeenCalledTimes(1)
        expect(plugin.settings.targetFolder).toBe(DEFAULT_SETTINGS.targetFolder)

        release()
        await pending
        expect(plugin.settings.targetFolder).toBe('committed')
    })

    test('leaves memory untouched and rejects when persistence fails', async () => {
        const { plugin } = createHarness({
            saveData: () => Promise.reject(new Error('disk full'))
        })

        await expectRejection(
            plugin.updateSettings((draft) => {
                draft.saveImages = !DEFAULT_SETTINGS.saveImages
            }),
            'disk full'
        )
        expect(plugin.settings.saveImages).toBe(DEFAULT_SETTINGS.saveImages)
    })

    test('serializes overlapping writes so both land', async () => {
        let release = (): void => {}
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        let first = true
        const { plugin } = createHarness({
            saveData: () => {
                if (first) {
                    first = false
                    return gate
                }
                return Promise.resolve()
            }
        })

        const a = plugin.updateSettings((draft) => {
            draft.targetFolder = 'first'
        })
        const b = plugin.updateSettings((draft) => {
            draft.savePdf = !DEFAULT_SETTINGS.savePdf
        })
        release()
        await Promise.all([a, b])
        expect(plugin.settings.targetFolder).toBe('first')
        expect(plugin.settings.savePdf).toBe(!DEFAULT_SETTINGS.savePdf)
    })

    test('preserves sibling data.json entries (the tokens)', async () => {
        const { plugin, saveData } = createHarness()
        await plugin.updateSettings((draft) => {
            draft.targetFolder = 'notebooks'
        })
        const written = saveData.mock.calls[0]?.[0] as Record<string, unknown>
        expect(written['deviceToken']).toBe('keep-me')
        expect(written['targetFolder']).toBe('notebooks')
    })
})

describe('setControlValue', () => {
    test('persists a write and re-arms the auto-sync scheduler for sync keys', async () => {
        const { tab, plugin, applySettings } = createHarness()
        await tab.setControlValue('autoSyncEnabled', true)
        expect(plugin.settings.autoSyncEnabled).toBe(true)
        expect(applySettings).toHaveBeenCalledTimes(1)

        applySettings.mockClear()
        await tab.setControlValue('saveImages', true)
        expect(applySettings).not.toHaveBeenCalled()
    })

    test('normalizes and persists the rmfakecloud URL, rejecting invalid ones', async () => {
        const { tab, plugin } = createHarness()
        await tab.setControlValue('rmfakecloudUrl', '  https://cloud.example.com  ')
        expect(plugin.settings.rmfakecloudUrl).toBe('https://cloud.example.com')

        await expectRejection(tab.setControlValue('rmfakecloudUrl', 'not a url'), 'URL')
        expect(plugin.settings.rmfakecloudUrl).toBe('https://cloud.example.com')
    })

    test('rejects non-finite and out-of-range numbers without writing', async () => {
        const { tab, plugin, saveData } = createHarness()
        await expectRejection(
            tab.setControlValue('autoSyncIntervalMinutes', Infinity),
            'expects a number'
        )
        await expectRejection(
            tab.setControlValue('autoSyncIntervalMinutes', 4),
            'between 5 and 240'
        )
        await expectRejection(tab.setControlValue('imageQuality', 1.5), 'between 0.1 and 1')
        expect(saveData).not.toHaveBeenCalled()
        expect(plugin.settings.autoSyncIntervalMinutes).toBe(
            DEFAULT_SETTINGS.autoSyncIntervalMinutes
        )

        // Fractional values inside the range are valid for the quality slider.
        await tab.setControlValue('imageQuality', 0.85)
        expect(plugin.settings.imageQuality).toBe(0.85)
    })

    test('rejects a dropdown value outside the declared options', async () => {
        const { tab, plugin } = createHarness()
        await expectRejection(
            tab.setControlValue('imageFormat', 'gif'),
            'expects one of the declared options'
        )
        expect(plugin.settings.imageFormat).toBe(DEFAULT_SETTINGS.imageFormat)

        await tab.setControlValue('imageFormat', 'webp')
        expect(plugin.settings.imageFormat).toBe('webp')
    })

    test('rejects an unknown key', async () => {
        const { tab, saveData } = createHarness()
        await expectRejection(
            tab.setControlValue('__proto__', 'x'),
            'does not address a known field'
        )
        expect(saveData).not.toHaveBeenCalled()
    })
})
