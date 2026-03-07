import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'

export async function disconnectDevice(plugin: RemarkableSyncPlugin): Promise<void> {
    await plugin.authService.disconnect()
    await plugin.syncStoreService.clearAll()
    plugin.isConnected = false
    new Notice('Disconnected from reMarkable cloud')
}
