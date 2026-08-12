import { Modal, setIcon } from 'obsidian'
import type { App } from 'obsidian'

export class ImportConfirmModal extends Modal {
    private readonly fileName: string
    private readonly targetFolder: string
    private readonly onConfirm: () => void

    constructor(app: App, fileName: string, targetFolder: string, onConfirm: () => void) {
        super(app)
        this.fileName = fileName
        this.targetFolder = targetFolder
        this.onConfirm = onConfirm
    }

    override onOpen(): void {
        const { contentEl } = this

        contentEl.createEl('h3', { text: 'Import .rmdoc file' })

        const info = contentEl.createDiv({ cls: 'remarkable-import-info' })

        const fileRow = info.createDiv({ cls: 'remarkable-import-row' })
        const fileIcon = fileRow.createSpan({ cls: 'remarkable-import-icon' })
        setIcon(fileIcon, 'file')
        fileRow.createSpan({ text: this.fileName })

        const targetRow = info.createDiv({ cls: 'remarkable-import-row' })
        const folderIcon = targetRow.createSpan({ cls: 'remarkable-import-icon' })
        setIcon(folderIcon, 'folder')
        targetRow.createSpan({
            text: this.targetFolder || '(vault root)'
        })

        const actions = contentEl.createDiv({ cls: 'remarkable-import-actions' })

        const confirmBtn = actions.createEl('button', {
            cls: 'mod-cta',
            text: 'Import'
        })
        confirmBtn.addEventListener('click', () => {
            this.close()
            this.onConfirm()
        })

        const cancelBtn = actions.createEl('button', {
            text: 'Cancel'
        })
        cancelBtn.addEventListener('click', () => {
            this.close()
        })
    }

    override onClose(): void {
        this.contentEl.empty()
    }
}
