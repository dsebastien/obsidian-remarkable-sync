import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderOutputSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('Output').setHeading()

    new Setting(containerEl)
        .setName('Target folder')
        .setDesc('Vault folder where notebooks will be saved. Leave empty for vault root.')
        .addText((text) => {
            const saveTargetFolder = debounce(
                async (value: string) => {
                    await plugin.updateSettings((draft) => {
                        draft.targetFolder = value.trim()
                    })
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
                await plugin.updateSettings((draft) => {
                    draft.saveImages = value
                })
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
                    await plugin.updateSettings((draft) => {
                        draft.imageFormat = value as 'png' | 'jpeg'
                    })
                })
        })
}
