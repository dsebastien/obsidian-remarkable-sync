import { test, expect, describe } from 'bun:test'
import { DEFAULT_SETTINGS, resolveSettings } from './plugin-settings.intf'
import type { LoadedPluginSettings } from './plugin-settings.intf'

describe('PluginSettings', () => {
    test('default settings have expected values', () => {
        expect(DEFAULT_SETTINGS.targetFolder).toBe('')
        expect(DEFAULT_SETTINGS.saveImages).toBe(true)
        expect(DEFAULT_SETTINGS.imageFormat).toBe('jpeg')
        expect(DEFAULT_SETTINGS.imageQuality).toBe(0.85)
        expect(DEFAULT_SETTINGS.useRmfakecloud).toBe(false)
        expect(DEFAULT_SETTINGS.rmfakecloudUrl).toBe('')
        expect(DEFAULT_SETTINGS.autoSyncMode).toBe('newest')
        expect(DEFAULT_SETTINGS.syncStore).toEqual({ notebooks: {} })
    })
})

describe('resolveSettings', () => {
    test('null (fresh install) → defaults', () => {
        expect(resolveSettings(null)).toEqual(DEFAULT_SETTINGS)
    })

    test('persisted fields override defaults; missing fields keep defaults', () => {
        const settings = resolveSettings({ sourceFolder: '/Books', autoSync: true })
        expect(settings.sourceFolder).toBe('/Books')
        expect(settings.autoSync).toBe(true)
        expect(settings.targetFolder).toBe(DEFAULT_SETTINGS.targetFolder)
        expect(settings.autoSyncMode).toBe('newest')
    })

    test('persisted autoSyncMode is honored', () => {
        expect(resolveSettings({ autoSyncMode: 'favorites' }).autoSyncMode).toBe('favorites')
        expect(resolveSettings({ autoSyncMode: 'newest' }).autoSyncMode).toBe('newest')
    })

    test('legacy autoSyncNewestOnly migrates to newest mode', () => {
        expect(resolveSettings({ autoSyncNewestOnly: true }).autoSyncMode).toBe('newest')
        // false ("every notebook in the source folder") has no mode equivalent
        expect(resolveSettings({ autoSyncNewestOnly: false }).autoSyncMode).toBe('newest')
    })

    test('legacy field does not clobber an explicit autoSyncMode', () => {
        const settings = resolveSettings({ autoSyncMode: 'favorites', autoSyncNewestOnly: true })
        expect(settings.autoSyncMode).toBe('favorites')
    })

    test('corrupt autoSyncMode value falls back to newest', () => {
        const corrupt = { autoSyncMode: 'bogus' } as unknown as LoadedPluginSettings
        expect(resolveSettings(corrupt).autoSyncMode).toBe('newest')
    })

    test('does not clobber the sync store', () => {
        const syncStore = {
            notebooks: {
                abc: {
                    remarkableId: 'abc',
                    lastSyncedAt: 5,
                    lastModifiedCloud: 4,
                    syncedPageCount: 2
                }
            }
        }
        const settings = resolveSettings({ syncStore })
        expect(settings.syncStore).toEqual(syncStore)
    })
})
