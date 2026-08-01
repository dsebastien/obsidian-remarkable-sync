import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderPdfSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('PDF').setHeading()

    new Setting(containerEl)
        .setName('Save as PDF')
        .setDesc(
            'Write one PDF per notebook, beside the page images. Independent of "Save images": enable either, both or neither. WebP cannot be stored in a PDF, so pages are embedded as JPEG when that format is selected.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.savePdf).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.savePdf = value
                })
            })
        })
}
