import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { notebookDisplayPath } from '../domain/notebook'
import { log } from '../../utils/log'

export async function listNotebooks(plugin: RemarkableSyncPlugin): Promise<void> {
    if (!plugin.isConnected) {
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

        const lines = notebooks.map(notebookDisplayPath)

        new Notice(`Found ${notebooks.length} notebooks:\n${lines.join('\n')}`, 10000)
        log(`Listed ${notebooks.length} notebooks`, 'info')
    } catch (error) {
        log('Failed to list notebooks', 'error', error)
        new Notice('Failed to list notebooks')
    }
}
