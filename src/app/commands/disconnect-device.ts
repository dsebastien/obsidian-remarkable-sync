import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { resolveCloudUrls } from '../services/cloud/cloud-urls'
import { log } from '../../utils/log'

export async function disconnectDevice(plugin: RemarkableSyncPlugin): Promise<void> {
    const urls = resolveCloudUrls(plugin.settings)

    try {
        await plugin.authService.disconnect()
    } catch (error) {
        // The tokens are still stored, so the next launch would come back
        // connected. Say so instead of reporting a disconnect that did not
        // happen.
        log('Failed to disconnect', 'error', error)
        new Notice('Could not remove the stored credentials. Please try again.')
        return
    }

    await plugin.syncStoreService.clearAll()
    plugin.isConnected = false
    new Notice(
        urls.isRmfakecloud ? 'Disconnected from rmfakecloud' : 'Disconnected from reMarkable cloud'
    )
}
