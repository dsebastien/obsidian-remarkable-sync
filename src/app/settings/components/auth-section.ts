import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { connectDevice } from '../../commands/connect-device'
import { disconnectDevice } from '../../commands/disconnect-device'
import { resolveCloudUrls } from '../../services/cloud/cloud-urls'

export function renderAuthSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin,
    redisplay: () => void
): void {
    const urls = resolveCloudUrls(plugin.settings)
    const cloudName = urls.isRmfakecloud ? 'rmfakecloud' : 'reMarkable cloud'

    new Setting(containerEl).setName('Authentication').setHeading()

    if (plugin.isConnected) {
        new Setting(containerEl)
            .setName('Status')
            .setDesc(`Connected to ${cloudName}`)
            .addButton((button) => {
                button.setButtonText('Disconnect').onClick(async () => {
                    await disconnectDevice(plugin)
                    redisplay()
                })
            })
    } else {
        new Setting(containerEl)
            .setName('Status')
            .setDesc(`Not connected to ${cloudName}`)
            .addButton((button) => {
                button
                    .setCta()
                    .setButtonText('Connect')
                    .onClick(() => {
                        connectDevice(plugin, redisplay)
                    })
            })
    }
}
