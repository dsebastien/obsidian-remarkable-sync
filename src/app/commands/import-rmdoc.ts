import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { ImportConfirmModal } from '../ui/import-confirm-modal'
import { log } from '../../utils/log'

/**
 * Open a native file picker for .rmdoc files and process the selected file.
 */
export function importRmdoc(plugin: RemarkableSyncPlugin): void {
    // Create a hidden file input to trigger the native file browser
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.rmdoc'
    fileInput.addClass('hidden')
    document.body.appendChild(fileInput)

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0]
        document.body.removeChild(fileInput)

        if (!file) {
            return
        }

        // Show confirmation modal
        new ImportConfirmModal(plugin.app, file.name, plugin.settings.targetFolder, () => {
            void processFile(plugin, file)
        }).open()
    })

    // Also clean up if the user cancels the file dialog
    fileInput.addEventListener('cancel', () => {
        document.body.removeChild(fileInput)
    })

    fileInput.click()
}

async function processFile(plugin: RemarkableSyncPlugin, file: File): Promise<void> {
    new Notice(`Importing ${file.name}...`)

    try {
        const buffer = await file.arrayBuffer()
        await plugin.importService.processRmdocFile(buffer, file.name, (progress) => {
            if (progress.status === 'error') {
                log(`Import failed for ${file.name}: ${progress.error}`, 'error')
            }
        })
    } catch (error) {
        log(`Failed to read file ${file.name}`, 'error', error)
        new Notice(`Failed to read file: ${file.name}`)
    }
}
