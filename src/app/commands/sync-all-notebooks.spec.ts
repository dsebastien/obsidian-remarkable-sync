import { test, expect, describe } from 'bun:test'
import { autoSyncScopeOptions } from './sync-all-notebooks'
import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'

function settings(overrides: Partial<PluginSettings>): PluginSettings {
    return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('autoSyncScopeOptions', () => {
    test('newest mode scopes to the source folder, newest only', () => {
        const options = autoSyncScopeOptions(
            settings({ autoSyncMode: 'newest', sourceFolder: '/2026' })
        )
        expect(options).toEqual({ folder: '/2026', newestOnly: true })
    })

    test('favorites mode ignores the source folder entirely', () => {
        const options = autoSyncScopeOptions(
            settings({ autoSyncMode: 'favorites', sourceFolder: '/2026' })
        )
        expect(options).toEqual({ favoritesOnly: true })
        expect(options.folder).toBeUndefined()
        expect(options.newestOnly).toBeUndefined()
    })
})
