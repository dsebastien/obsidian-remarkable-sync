import { test, expect, describe } from 'bun:test'
import { mergeLoadedSettings } from './load-settings'
import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'

/**
 * A value that differs from the default, for any setting type.
 */
function differentValue(key: keyof PluginSettings): unknown {
    // Constrained settings need a value that is different but still valid,
    // since invalid values are deliberately reset by validation.
    if ('imageFormat' === key) return 'png'
    if ('imageQuality' === key) return 0.5
    if ('syncStore' === key) return { notebooks: { doc: { lastSyncedVersion: 2 } } }

    const current = DEFAULT_SETTINGS[key]
    if ('boolean' === typeof current) return !current
    if ('number' === typeof current) return current + 1
    if ('string' === typeof current) return `${current}-changed`
    return { changed: true }
}

describe('mergeLoadedSettings', () => {
    test('no stored data gives the defaults', () => {
        expect(mergeLoadedSettings(null)).toEqual({ ...DEFAULT_SETTINGS })
        expect(mergeLoadedSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS })
    })

    test('non-object stored data gives the defaults', () => {
        expect(mergeLoadedSettings('nonsense')).toEqual({ ...DEFAULT_SETTINGS })
        expect(mergeLoadedSettings(42)).toEqual({ ...DEFAULT_SETTINGS })
    })

    test('an empty object gives the defaults', () => {
        expect(mergeLoadedSettings({})).toEqual({ ...DEFAULT_SETTINGS })
    })

    /**
     * The guard that matters. `savePdf` shipped broken because it was added to
     * the interface and the defaults but not to the hand-written list of
     * assignments in loadSettings, so it saved correctly and then silently
     * reset to false on the next launch. This asserts every setting survives a
     * round trip, so the next setting added cannot repeat it.
     */
    test('EVERY setting round-trips from stored data', () => {
        const keys = Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]
        expect(keys.length).toBeGreaterThan(0)

        for (const key of keys) {
            const stored = { [key]: differentValue(key) }
            const merged = mergeLoadedSettings(stored)

            expect(
                merged[key],
                `setting "${key}" did not survive a load: it will silently reset on restart`
            ).toEqual(stored[key] as never)
        }
    })

    test('savePdf specifically survives a restart', () => {
        expect(mergeLoadedSettings({ savePdf: true }).savePdf).toBe(true)
        expect(mergeLoadedSettings({ savePdf: false }).savePdf).toBe(false)
        expect(mergeLoadedSettings({}).savePdf).toBe(false)
    })

    test('unrelated keys are not copied in, so tokens cannot reach settings', () => {
        const merged = mergeLoadedSettings({
            savePdf: true,
            tokens: { deviceToken: 'secret', userToken: 'secret' },
            legacyTokensImported: true
        })

        expect(merged).not.toHaveProperty('tokens')
        expect(merged).not.toHaveProperty('legacyTokensImported')
        expect(merged.savePdf).toBe(true)
    })

    test('values of the wrong type fall back to the default', () => {
        const merged = mergeLoadedSettings({
            savePdf: 'yes',
            saveImages: 1,
            imageQuality: 'high',
            targetFolder: { nope: true }
        })

        expect(merged.savePdf).toBe(DEFAULT_SETTINGS.savePdf)
        expect(merged.saveImages).toBe(DEFAULT_SETTINGS.saveImages)
        expect(merged.imageQuality).toBe(DEFAULT_SETTINGS.imageQuality)
        expect(merged.targetFolder).toBe(DEFAULT_SETTINGS.targetFolder)
    })

    test('explicit null falls back to the default', () => {
        const merged = mergeLoadedSettings({ savePdf: null, syncStore: null })

        expect(merged.savePdf).toBe(DEFAULT_SETTINGS.savePdf)
        expect(merged.syncStore).toEqual(DEFAULT_SETTINGS.syncStore)
    })

    test('a realistic pre-PDF data.json loads with PDF export off', () => {
        // Exactly what an install from before this feature would hold.
        const merged = mergeLoadedSettings({
            targetFolder: 'reMarkable',
            saveImages: true,
            imageFormat: 'png',
            imageQuality: 0.9,
            useRmfakecloud: false,
            rmfakecloudUrl: '',
            autoSyncEnabled: true,
            autoSyncIntervalMinutes: 60,
            syncStore: { notebooks: {} }
        })

        expect(merged.targetFolder).toBe('reMarkable')
        expect(merged.imageFormat).toBe('png')
        expect(merged.autoSyncIntervalMinutes).toBe(60)
        expect(merged.savePdf).toBe(false)
    })

    test('does not mutate DEFAULT_SETTINGS', () => {
        const before = JSON.stringify(DEFAULT_SETTINGS)
        mergeLoadedSettings({ savePdf: true, targetFolder: 'x' })
        expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before)
    })
})

describe('mergeLoadedSettings validation', () => {
    test('an unknown image format degrades to the default', () => {
        const merged = mergeLoadedSettings({ imageFormat: 'gif' })
        expect(merged.imageFormat).toBe(DEFAULT_SETTINGS.imageFormat)
    })

    test('image quality is clamped into its slider range', () => {
        expect(mergeLoadedSettings({ imageQuality: 7 }).imageQuality).toBe(1)
        expect(mergeLoadedSettings({ imageQuality: -1 }).imageQuality).toBe(0.1)
        expect(mergeLoadedSettings({ imageQuality: NaN }).imageQuality).toBe(
            DEFAULT_SETTINGS.imageQuality
        )
    })

    test('the sync interval is clamped into its allowed range', () => {
        expect(mergeLoadedSettings({ autoSyncIntervalMinutes: 1 }).autoSyncIntervalMinutes).toBe(5)
        expect(mergeLoadedSettings({ autoSyncIntervalMinutes: 9999 }).autoSyncIntervalMinutes).toBe(
            240
        )
    })

    test('a malformed sync store degrades to the default instead of throwing later', () => {
        expect(mergeLoadedSettings({ syncStore: [] }).syncStore).toEqual(DEFAULT_SETTINGS.syncStore)
        expect(mergeLoadedSettings({ syncStore: { notebooks: 'no' } }).syncStore).toEqual(
            DEFAULT_SETTINGS.syncStore
        )
        const valid = { notebooks: { abc: { lastSyncedVersion: 1 } } }
        expect(mergeLoadedSettings({ syncStore: valid }).syncStore).toEqual(valid as never)
    })
})
