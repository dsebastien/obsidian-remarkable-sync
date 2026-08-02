import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderTypedTextSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin
): void {
    new Setting(containerEl).setName('Typed text').setHeading()

    new Setting(containerEl)
        .setName('Save typed text note')
        .setDesc(
            'Write a markdown note holding text you typed on a keyboard. Because it is written as text rather than drawn into the page image, it is searchable and any links you typed become real links. Handwriting is not included: it stays as ink in the page image. Only creates a file for documents that actually have typed text.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.saveTypedTextNote).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.saveTypedTextNote = value
                })
            })
        })
}
