import { Setting, debounce } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'

export function renderTriageSection(containerEl: HTMLElement, plugin: RemarkableSyncPlugin): void {
    new Setting(containerEl).setName('PA triage routing (GP-125)').setHeading()

    new Setting(containerEl)
        .setName('Route idle pages to PA')
        .setDesc(
            'After a page has been transcribed and has had no further writing activity for the idle threshold below, file it into the same triage intake voice notes use — just like a voice note, it becomes actionable without manual steps. Requires OCR to be enabled above.'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.triageEnabled).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.triageEnabled = value
                })
            })
        })

    new Setting(containerEl)
        .setName('Idle threshold (minutes)')
        .setDesc(
            'How long a page must go unchanged (by its cloud-stamped last-modified time) before it is filed. Default 60.'
        )
        .addText((text) => {
            const save = debounce(
                async (value: string) => {
                    const parsed = parseInt(value, 10)
                    if (!Number.isFinite(parsed) || parsed <= 0) {
                        return
                    }
                    await plugin.updateSettings((draft) => {
                        draft.triageIdleMinutes = parsed
                    })
                },
                500,
                true
            )
            text.setPlaceholder('60')
                .setValue(String(plugin.settings.triageIdleMinutes))
                .onChange(save)
        })

    new Setting(containerEl)
        .setName('Triage queue directory')
        .setDesc(
            "Host path to md_capture's triage-queue dir (the same one the audio-to-action pipeline writes to). Default ~/Vaults/personal/triage-queue."
        )
        .addText((text) => {
            const save = debounce(
                async (value: string) => {
                    const trimmed = value.trim()
                    if (!trimmed) {
                        return
                    }
                    await plugin.updateSettings((draft) => {
                        draft.triageQueueDir = trimmed
                    })
                },
                500,
                true
            )
            text.setValue(plugin.settings.triageQueueDir).onChange(save)
        })
}
