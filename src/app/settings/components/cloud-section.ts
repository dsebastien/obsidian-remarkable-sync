import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { validateRmfakecloudUrl } from '../../services/cloud/cloud-urls'

export function renderCloudSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin,
    redisplay: () => void
): void {
    new Setting(containerEl).setName('Cloud').setHeading()

    new Setting(containerEl)
        .setName('Use rmfakecloud')
        .setDesc(
            'Connect to a self-hosted rmfakecloud server instead of the official reMarkable cloud'
        )
        .addToggle((toggle) => {
            toggle.setValue(plugin.settings.useRmfakecloud).onChange(async (value) => {
                await plugin.updateSettings((draft) => {
                    draft.useRmfakecloud = value
                })
                redisplay()
            })
        })

    if (plugin.settings.useRmfakecloud) {
        const urlSetting = new Setting(containerEl)
            .setName('Server URL')
            .setDesc('The base URL of your rmfakecloud server (e.g., https://cloud.example.com)')
            .addText((text) => {
                text.setPlaceholder('https://cloud.example.com')
                    .setValue(plugin.settings.rmfakecloudUrl)
                    .onChange(async (value) => {
                        const trimmed = value.trim().replace(/\/+$/, '')
                        const error = trimmed ? validateRmfakecloudUrl(trimmed) : null
                        const descEl = urlSetting.descEl
                        const existingError = descEl.querySelector('.remarkable-cloud-url-error')
                        if (existingError) existingError.remove()

                        if (error) {
                            descEl.createSpan({
                                cls: 'remarkable-cloud-url-error',
                                text: error
                            })
                        }

                        await plugin.updateSettings((draft) => {
                            draft.rmfakecloudUrl = trimmed
                        })
                    })
                text.inputEl.addClass('remarkable-cloud-url-input')
            })

        if (plugin.isConnected) {
            const warningEl = containerEl.createDiv({ cls: 'remarkable-cloud-warning' })
            warningEl.createEl('p', {
                text: 'Changing cloud settings requires disconnecting and reconnecting. Tokens from one cloud are not valid on another.',
                cls: 'remarkable-cloud-warning-text'
            })
        }
    }
}
