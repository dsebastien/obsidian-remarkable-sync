import { test, expect, describe } from 'bun:test'
import { DEFAULT_SETTINGS } from './plugin-settings.intf'

describe('PluginSettings', () => {
    test('default settings have expected values', () => {
        expect(DEFAULT_SETTINGS.targetFolder).toBe('')
        expect(DEFAULT_SETTINGS.saveImages).toBe(true)
        expect(DEFAULT_SETTINGS.imageFormat).toBe('jpeg')
        expect(DEFAULT_SETTINGS.imageQuality).toBe(0.85)
        expect(DEFAULT_SETTINGS.useRmfakecloud).toBe(false)
        expect(DEFAULT_SETTINGS.rmfakecloudUrl).toBe('')
        expect(DEFAULT_SETTINGS.syncStore).toEqual({ notebooks: {} })
    })
})
