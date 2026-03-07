import { Setting, debounce } from 'obsidian'
import { produce } from 'immer'
import type { Draft } from 'immer'
import type { RemarkableSyncPlugin } from '../../plugin'
import type { PluginSettings } from '../../types/plugin-settings.intf'

export function renderOutputSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('Output').setHeading()

    new Setting(containerEl)
        .setName('Target folder')
        .setDesc('Vault folder where notebooks will be saved. Leave empty for vault root.')
        .addText((text) => {
            const saveTargetFolder = debounce(
                async (value: string) => {
                    plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
                        draft.targetFolder = value.trim()
                    })
                    await plugin.saveSettings()
                },
                500,
                true
            )

            text.setPlaceholder('e.g., reMarkable')
                .setValue(plugin.settings.targetFolder)
                .onChange(saveTargetFolder)
        })

    new Setting(containerEl)
        .setName('Save images')
        .setDesc('Save rendered page images alongside markdown files')
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.saveImages).onChange(async (value) => {
                plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
                    draft.saveImages = value
                })
                await plugin.saveSettings()
            })
        })

    new Setting(containerEl)
        .setName('Image format')
        .setDesc('Format for rendered page images')
        .addDropdown((dropdown) => {
            dropdown
                .addOption('png', 'PNG')
                .addOption('jpeg', 'JPEG')
                .setValue(plugin.settings.imageFormat)
                .onChange(async (value) => {
                    plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
                        draft.imageFormat = value as 'png' | 'jpeg'
                    })
                    await plugin.saveSettings()
                })
        })
}
