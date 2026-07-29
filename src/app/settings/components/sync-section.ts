import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import {
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../../types/plugin-settings.intf'

export function renderSyncSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin,
    redisplay: () => void
): void {
    new Setting(containerEl).setName('Sync').setHeading()

    new Setting(containerEl)
        .setName('Automatic sync')
        .setDesc(
            'Periodically sync all notebooks that need updating. Runs in the background; skipped while disconnected or when a sync is already in progress.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.autoSyncEnabled).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.autoSyncEnabled = value
                })
                plugin.autoSyncService.applySettings()
                redisplay()
            })
        })

    if (plugin.settings.autoSyncEnabled) {
        new Setting(containerEl)
            .setName('Sync interval')
            .setDesc(
                `How often to sync automatically, in minutes (${MIN_AUTO_SYNC_INTERVAL_MINUTES}–${MAX_AUTO_SYNC_INTERVAL_MINUTES}).`
            )
            .addSlider((slider) => {
                const saveInterval = debounce(
                    async (value: number) => {
                        await plugin.updateSettings((draft) => {
                            draft.autoSyncIntervalMinutes = value
                        })
                        plugin.autoSyncService.applySettings()
                    },
                    500,
                    true
                )
                slider
                    .setLimits(MIN_AUTO_SYNC_INTERVAL_MINUTES, MAX_AUTO_SYNC_INTERVAL_MINUTES, 5)
                    .setValue(plugin.settings.autoSyncIntervalMinutes)
                    .onChange(saveInterval)
            })
    }
}
