import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { isAutoSyncMode, MIN_AUTO_SYNC_INTERVAL_MINUTES } from '../../types/plugin-settings.intf'

const SOURCE_FOLDER_DESC =
    'reMarkable cloud folder that auto-sync reads from (e.g. /2026). Includes its sub-folders. Leave empty to use all folders. Does not affect the manual "Sync a notebook" command.'
const SOURCE_FOLDER_IGNORED_DESC =
    'Ignored while the auto-sync scope is "Favorited notebooks" — a starred notebook syncs wherever it lives.'

export function renderSyncSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('Automatic sync').setHeading()

    // Updated in place on scope change (no full tab re-render, which would
    // clobber a still-debouncing Source folder edit).
    let folderSetting: Setting | undefined
    const applyScopeToFolderSetting = (): void => {
        if (!folderSetting) {
            return
        }
        const favorites = plugin.settings.autoSyncMode === 'favorites'
        folderSetting.setDesc(favorites ? SOURCE_FOLDER_IGNORED_DESC : SOURCE_FOLDER_DESC)
        folderSetting.setDisabled(favorites)
    }

    new Setting(containerEl)
        .setName('Auto-sync scope')
        .setDesc(
            'Which notebooks auto-sync picks up: the single most-recently-modified notebook in the source folder, or every notebook starred (favorited) on the device.'
        )
        .addDropdown((dropdown) => {
            dropdown
                .addOption('newest', 'Newest in source folder')
                .addOption('favorites', 'Favorited notebooks')
                .setValue(plugin.settings.autoSyncMode)
                .onChange(async (value) => {
                    await plugin.updateSettings((draft) => {
                        draft.autoSyncMode = isAutoSyncMode(value) ? value : 'newest'
                    })
                    applyScopeToFolderSetting()
                })
        })

    folderSetting = new Setting(containerEl).setName('Source folder').addText((text) => {
        const saveSourceFolder = debounce(
            async (value: string) => {
                await plugin.updateSettings((draft) => {
                    draft.sourceFolder = value.trim()
                })
            },
            500,
            true
        )

        text.setPlaceholder('/2026')
            .setValue(plugin.settings.sourceFolder)
            .onChange(saveSourceFolder)
    })
    applyScopeToFolderSetting()

    new Setting(containerEl)
        .setName('Sync on startup')
        .setDesc('Run an auto-sync once when Obsidian starts.')
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.syncOnStartup).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.syncOnStartup = value
                })
            })
        })

    new Setting(containerEl)
        .setName('Periodic auto-sync')
        .setDesc('Periodically run an auto-sync while Obsidian is open.')
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.autoSync).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.autoSync = value
                })
                plugin.setupAutoSync()
            })
        })

    new Setting(containerEl)
        .setName('Auto-sync interval (minutes)')
        .setDesc(`How often to auto-sync. Minimum ${MIN_AUTO_SYNC_INTERVAL_MINUTES} minutes.`)
        .addText((text) => {
            const saveInterval = debounce(
                async (value: string) => {
                    const parsed = parseInt(value, 10)
                    if (!Number.isFinite(parsed)) {
                        return
                    }
                    const minutes = Math.max(MIN_AUTO_SYNC_INTERVAL_MINUTES, parsed)
                    await plugin.updateSettings((draft) => {
                        draft.autoSyncIntervalMinutes = minutes
                    })
                    plugin.setupAutoSync()
                },
                500,
                true
            )

            text.setPlaceholder('15')
                .setValue(String(plugin.settings.autoSyncIntervalMinutes))
                .onChange(saveInterval)
        })
}
