import { Notice, Setting } from 'obsidian'
import type { RemarkableSyncPlugin } from '../../plugin'
import { connectDevice } from '../../commands/connect-device'
import { disconnectDevice } from '../../commands/disconnect-device'
import { resolveCloudUrls } from '../../services/cloud/cloud-urls'
import {
    LEGACY_IMPORT_DONE_DATA_KEY,
    legacyTokenFileExists,
    removeLegacyTokenFile
} from '../../services/auth/token-store'

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

    renderLegacyTokenFileSetting(containerEl, plugin, redisplay)
}

/**
 * Older desktop versions stored tokens in `~/.remarkable-sync/token.json`.
 * They are now kept in the plugin's data so that mobile works too, and the old
 * file is imported once and then left alone — it is shared by every vault on
 * the machine, so deleting it automatically would disconnect the user's other
 * vaults. Offer removal as an explicit action instead.
 *
 * Only offered once this vault has actually consumed the file. The marker and
 * the imported tokens are written together, so until it is set the legacy file
 * may still be the only copy of the credentials — removing it then would lose
 * them outright.
 */
function renderLegacyTokenFileSetting(
    containerEl: HTMLElement,
    plugin: RemarkableSyncPlugin,
    redisplay: () => void
): void {
    const imported = true === plugin.getDataValue(LEGACY_IMPORT_DONE_DATA_KEY)
    if (!imported || !legacyTokenFileExists()) {
        return
    }

    new Setting(containerEl)
        .setName('Legacy token file')
        .setDesc(
            'Credentials from ~/.remarkable-sync/token.json have been copied into this vault. The old file is still on your computer and is shared by your other vaults — remove it once they all use this version of the plugin.'
        )
        .addButton((button) => {
            button
                .setWarning()
                .setButtonText('Remove')
                .onClick(() => {
                    new Notice(
                        removeLegacyTokenFile()
                            ? 'Legacy token file removed.'
                            : 'Could not remove the legacy token file.'
                    )
                    redisplay()
                })
        })
}
