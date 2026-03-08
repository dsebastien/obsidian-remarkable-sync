import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { resolveCloudUrls } from '../services/cloud/cloud-urls'

export async function disconnectDevice(plugin: RemarkableSyncPlugin): Promise<void> {
    const urls = resolveCloudUrls(plugin.settings)
    await plugin.authService.disconnect()
    await plugin.syncStoreService.clearAll()
    plugin.isConnected = false
    new Notice(
        urls.isRmfakecloud ? 'Disconnected from rmfakecloud' : 'Disconnected from reMarkable cloud'
    )
}
