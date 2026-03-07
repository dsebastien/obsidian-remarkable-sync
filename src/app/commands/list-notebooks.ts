import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { log } from '../../utils/log'

export async function listNotebooks(plugin: RemarkableSyncPlugin): Promise<void> {
    if (!plugin.settings.isAuthenticated) {
        new Notice('Not connected to reMarkable cloud')
        return
    }

    new Notice('Fetching notebooks...')

    try {
        const notebooks = await plugin.cloudService.listDocuments()

        if (notebooks.length === 0) {
            new Notice('No notebooks found')
            return
        }

        const lines = notebooks.map((nb) => {
            const path = nb.folderPath ? `${nb.folderPath}/` : ''
            return `${path}${nb.visibleName}`
        })

        new Notice(`Found ${notebooks.length} notebooks:\n${lines.join('\n')}`, 10000)
        log(`Listed ${notebooks.length} notebooks`, 'info')
    } catch (error) {
        log('Failed to list notebooks', 'error', error)
        new Notice('Failed to list notebooks')
    }
}
