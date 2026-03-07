import { Notice } from 'obsidian'
import { produce } from 'immer'
import type { Draft } from 'immer'
import type { RemarkableSyncPlugin } from '../plugin'
import type { PluginSettings } from '../types/plugin-settings.intf'

export async function disconnectDevice(plugin: RemarkableSyncPlugin): Promise<void> {
    await plugin.authService.disconnect()
    await plugin.syncStoreService.clearAll()
    plugin.settings = produce(plugin.settings, (draft: Draft<PluginSettings>) => {
        draft.isAuthenticated = false
    })
    void plugin.saveSettings()
    new Notice('Disconnected from reMarkable cloud')
}
