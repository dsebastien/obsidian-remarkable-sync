import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'

/**
 * Merge the settings stored in `data.json` over the defaults.
 *
 * Driven by the keys of `DEFAULT_SETTINGS` rather than a hand-written list of
 * assignments. The previous hand-written version silently dropped any setting
 * whose line was forgotten, which meant the value round-tripped to disk
 * correctly and then reset to its default on the next launch. Iterating the
 * defaults makes that impossible: a new setting is picked up as soon as it has
 * a default.
 *
 * Only keys present in `DEFAULT_SETTINGS` are copied, so unrelated `data.json`
 * entries (notably `tokens`, which must never enter `PluginSettings` because
 * the settings object is written to the debug log) cannot leak in.
 *
 * Values whose type does not match the default are ignored rather than trusted,
 * so a hand-edited or corrupted file degrades to defaults instead of poisoning
 * the plugin.
 */
export function mergeLoadedSettings(loaded: unknown): PluginSettings {
    const merged: PluginSettings = { ...DEFAULT_SETTINGS }

    if (!loaded || 'object' !== typeof loaded) {
        return merged
    }

    const source = loaded as Record<string, unknown>
    const target = merged as unknown as Record<string, unknown>

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        const value = source[key]

        // Absent, or explicitly null: keep the default.
        if (undefined === value || null === value) continue

        // `typeof null === 'object'` is already excluded above.
        const defaultValue = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key]
        if (typeof value !== typeof defaultValue) continue

        target[key] = value
    }

    return merged
}
