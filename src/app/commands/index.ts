import type { RemarkableSyncPlugin } from '../plugin'
import { openPanel } from './open-panel'
import { connectDevice } from './connect-device'
import { disconnectDevice } from './disconnect-device'
import { listNotebooks } from './list-notebooks'
import { syncNotebook } from './sync-notebook'
import { importRmdoc } from './import-rmdoc'

export function registerCommands(plugin: RemarkableSyncPlugin): void {
    plugin.addCommand({
        id: 'remarkable-open-panel',
        name: 'Open reMarkable panel',
        callback: () => openPanel(plugin)
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
        id: 'remarkable-sync-notebook',
        name: 'Sync a notebook',
        callback: () => {
            void syncNotebook(plugin)
        }
    })

    plugin.addCommand({
        id: 'remarkable-import-rmdoc',
        name: 'Import .rmdoc file',
        callback: () => {
            importRmdoc(plugin)
        }
    })
}
