import type { RemarkableSyncPlugin } from '../plugin'
import { openPanel } from './open-panel'
import { connectDevice } from './connect-device'
import { disconnectDevice } from './disconnect-device'
import { listNotebooks } from './list-notebooks'
import { syncNotebook } from './sync-notebook'
import { autoSyncScopeOptions, syncAllNotebooks } from './sync-all-notebooks'
import { importRmdoc } from './import-rmdoc'
import { cleanImagePlaceholdersCommand } from './clean-image-placeholders'

export function registerCommands(plugin: RemarkableSyncPlugin): void {
    plugin.addCommand({
        id: 'remarkable-open-panel',
        name: 'Open reMarkable panel',
        callback: () => openPanel(plugin)
    })

    plugin.addCommand({
        id: 'remarkable-open-sync-log',
        name: 'Open reMarkable sync log',
        callback: () => {
            void plugin.activateSyncLogView()
        }
    })

    plugin.addCommand({
        id: 'remarkable-connect-device',
        name: 'Connect to reMarkable cloud',
        callback: () => connectDevice(plugin)
    })

    plugin.addCommand({
        id: 'remarkable-disconnect-device',
        name: 'Disconnect from reMarkable cloud',
        callback: () => {
            void disconnectDevice(plugin)
        }
    })

    plugin.addCommand({
        id: 'remarkable-list-notebooks',
        name: 'List notebooks',
        callback: () => {
            void listNotebooks(plugin)
        }
    })

    plugin.addCommand({
        id: 'sync-notebook',
        name: 'Sync a notebook',
        callback: () => {
            void syncNotebook(plugin)
        }
    })

    plugin.addCommand({
        id: 'sync-all-notebooks',
        name: 'Sync all notebooks',
        callback: () => {
            void syncAllNotebooks(plugin)
        }
    })

    plugin.addCommand({
        // Stable id (predates the favorites mode) — only the name reflects
        // that this now follows the configured auto-sync scope.
        id: 'sync-newest-notebook',
        name: 'Sync auto-sync scope now',
        callback: () => {
            void syncAllNotebooks(plugin, autoSyncScopeOptions(plugin.settings))
        }
    })

    plugin.addCommand({
        id: 'remarkable-import-rmdoc',
        name: 'Import .rmdoc file',
        callback: () => {
            importRmdoc(plugin)
        }
    })

    plugin.addCommand({
        id: 'remarkable-clean-image-placeholders',
        name: 'Fix OCR image links in notes',
        callback: () => {
            void cleanImagePlaceholdersCommand(plugin)
        }
    })
}
