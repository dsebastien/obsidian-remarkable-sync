import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderHighlightsSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin
): void {
    new Setting(containerEl).setName('Highlights').setHeading()

    new Setting(containerEl)
        .setName('Save highlights note')
        .setDesc(
            'Write a Markdown note listing text you highlighted on the device, quoted under its page number. Only creates a file for documents that actually have highlights. Text highlights are always embedded in the annotated PDF regardless of this setting.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.saveHighlightsNote).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.saveHighlightsNote = value
                })
            })
        })
}
