import { Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { connectDevice } from '../../commands/connect-device'
import { disconnectDevice } from '../../commands/disconnect-device'

export function renderAuthSection(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin,
    redisplay: () => void
): void {
    new Setting(containerEl).setName('Authentication').setHeading()

    if (plugin.isConnected) {
        new Setting(containerEl)
            .setName('Status')
            .setDesc('Connected to reMarkable cloud')
            .addButton((button) => {
                button.setButtonText('Disconnect').onClick(async () => {
                    await disconnectDevice(plugin)
                    redisplay()
                })
            })
    } else {
        new Setting(containerEl)
            .setName('Status')
            .setDesc('Not connected to reMarkable cloud')
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
