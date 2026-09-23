import {
    DEFAULT_SETTINGS,
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { log } from '../../utils/log'
import { containVaultFolderPath, validateVaultFolderPath } from '../../utils/sanitise-path'

const IMAGE_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp'])

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
}

/**
 * Make a stored target folder safe to write under, without breaking startup.
 *
 * `typeof` says "string", which does not stop `../../etc` from escaping the
 * vault. The value is contained rather than rejected, because this path is
 * non-interactive: a hand-edited `data.json` must degrade to something usable.
 *
 * Only containment is applied (traversal, absolute paths, hidden folders,
 * control characters). A character such as `#` or `:` is legal on some
 * platforms, so a vault already writing there keeps doing so; it is only
 * warned about. Rewriting it would move existing output, which is deferred to
 * the next major.
 */
function loadTargetFolder(stored: string): string {
    const contained = containVaultFolderPath(stored)
    if (contained !== stored) {
        log(`Target folder "${stored}" is not a usable vault path; using "${contained}"`, 'warn')
    }

    const problem = validateVaultFolderPath(contained)
    if (problem) {
        log(`Target folder "${contained}": ${problem} It is kept as is for now.`, 'warn')
    }

    return contained
}

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

    // `typeof` cannot see union members or object shapes, so the fields with
    // a narrower contract than "same primitive type" are validated explicitly:
    // a hand-edited file must degrade to defaults, not poison the plugin.
    if (!IMAGE_FORMATS.has(merged.imageFormat)) {
        merged.imageFormat = DEFAULT_SETTINGS.imageFormat
    }
    if (!Number.isFinite(merged.imageQuality)) {
        merged.imageQuality = DEFAULT_SETTINGS.imageQuality
    } else {
        merged.imageQuality = clamp(merged.imageQuality, 0.1, 1)
    }
    if (!Number.isFinite(merged.autoSyncIntervalMinutes)) {
        merged.autoSyncIntervalMinutes = DEFAULT_SETTINGS.autoSyncIntervalMinutes
    } else {
        merged.autoSyncIntervalMinutes = clamp(
            merged.autoSyncIntervalMinutes,
            MIN_AUTO_SYNC_INTERVAL_MINUTES,
            MAX_AUTO_SYNC_INTERVAL_MINUTES
        )
    }
    merged.targetFolder = loadTargetFolder(merged.targetFolder)

    // Everything downstream iterates `syncStore.notebooks`; an array or a
    // missing map would throw far from here.
    const store = merged.syncStore as unknown
    if (
        !store ||
        'object' !== typeof store ||
        Array.isArray(store) ||
        !(store as Record<string, unknown>)['notebooks'] ||
        'object' !== typeof (store as Record<string, unknown>)['notebooks'] ||
        Array.isArray((store as Record<string, unknown>)['notebooks'])
    ) {
        merged.syncStore = DEFAULT_SETTINGS.syncStore
    }

    return merged
}
