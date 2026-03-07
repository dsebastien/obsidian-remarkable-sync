import { FuzzySuggestModal, Notice } from 'obsidian'
import type { App, FuzzyMatch } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import type { NotebookSummary } from '../domain/notebook'
import { log } from '../../utils/log'

class NotebookSuggestModal extends FuzzySuggestModal<NotebookSummary> {
    private readonly notebooks: NotebookSummary[]
    private readonly onChoose: (notebook: NotebookSummary) => void

    constructor(
        app: App,
        notebooks: NotebookSummary[],
        onChoose: (notebook: NotebookSummary) => void
    ) {
        super(app)
        this.notebooks = notebooks
        this.onChoose = onChoose
        this.setPlaceholder('Select a notebook to sync...')
    }

    override getItems(): NotebookSummary[] {
        return this.notebooks
    }

    override getItemText(item: NotebookSummary): string {
        if (item.folderPath) {
            return `${item.folderPath}/${item.visibleName}`
        }
        return item.visibleName
    }

    override onChooseItem(item: NotebookSummary, _evt: MouseEvent | KeyboardEvent): void {
        this.onChoose(item)
    }

    override renderSuggestion(match: FuzzyMatch<NotebookSummary>, el: HTMLElement): void {
        super.renderSuggestion(match, el)
    }
}

export async function syncNotebook(plugin: RemarkableSyncPlugin): Promise<void> {
    if (!plugin.settings.isAuthenticated) {
        new Notice('Not connected to reMarkable cloud')
        return
    }

    new Notice('Fetching notebook list...')

    try {
        const notebooks = await plugin.cloudService.listDocuments()

        if (notebooks.length === 0) {
            new Notice('No notebooks found')
            return
        }

        new NotebookSuggestModal(plugin.app, notebooks, (notebook) => {
            new Notice(`Syncing ${notebook.visibleName}...`)
            void plugin.pipelineService.processNotebook(notebook, (progress) => {
                if (progress.status === 'done') {
                    log(`Synced ${notebook.visibleName}`, 'info')
                } else if (progress.status === 'error') {
                    log(`Failed to sync ${notebook.visibleName}: ${progress.error}`, 'error')
                }
            })
        }).open()
    } catch (error) {
        log('Failed to fetch notebooks for sync', 'error', error)
        new Notice('Failed to fetch notebook list')
    }
}
