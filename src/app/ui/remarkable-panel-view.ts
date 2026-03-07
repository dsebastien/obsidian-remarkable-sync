import { ItemView, setIcon } from 'obsidian'
import type { WorkspaceLeaf } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import type { NotebookSummary } from '../domain/notebook'
import type {
    PipelineProgress,
    PipelineStatus
} from '../services/pipeline/notebook-pipeline.service'
import { deriveSyncStatus } from '../domain/sync-state'
import type { SyncStatus } from '../domain/sync-state'
import { formatRemarkableDate } from '../../utils/date-utils'
import { log } from '../../utils/log'

export const REMARKABLE_PANEL_VIEW_TYPE = 'remarkable-panel'

export class RemarkablePanelView extends ItemView {
    private readonly plugin: RemarkableSyncPlugin
    private notebooks: NotebookSummary[] = []
    private notebookProgress: Map<string, PipelineProgress> = new Map()
    private selectedIds: Set<string> = new Set()
    private isLoading = false
    private isBulkSyncing = false

    constructor(leaf: WorkspaceLeaf, plugin: RemarkableSyncPlugin) {
        super(leaf)
        this.plugin = plugin
    }

    override getViewType(): string {
        return REMARKABLE_PANEL_VIEW_TYPE
    }

    override getDisplayText(): string {
        return 'reMarkable'
    }

    override getIcon(): string {
        return 'tablet'
    }

    override async onOpen(): Promise<void> {
        this.render()
    }

    override async onClose(): Promise<void> {
        // Cleanup handled by Obsidian
    }

    private render(): void {
        const { contentEl } = this
        contentEl.empty()

        const root = contentEl.createDiv({ cls: 'remarkable-panel' })

        this.renderHeader(root)

        if (!this.plugin.isConnected) {
            this.renderDisconnected(root)
            return
        }

        if (this.isLoading) {
            root.createDiv({ cls: 'remarkable-loading', text: 'Loading notebooks...' })
            return
        }

        if (this.notebooks.length === 0) {
            const empty = root.createDiv({ cls: 'remarkable-empty' })
            empty.createEl('p', {
                text: 'No notebooks found. Click refresh to load notebooks from the cloud.'
            })
            return
        }

        this.renderNotebookList(root)
    }

    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'remarkable-header' })

        header.createEl('h4', { text: 'reMarkable Notebooks' })

        const actions = header.createDiv({ cls: 'remarkable-header-actions' })

        if (this.plugin.isConnected) {
            // Sync all button
            const syncAllBtn = actions.createEl('button', {
                cls: 'remarkable-btn remarkable-btn-icon',
                attr: { 'aria-label': 'Sync all notebooks that need updating' }
            })
            setIcon(syncAllBtn, 'refresh-cw-off')
            syncAllBtn.addEventListener('click', () => {
                void this.syncAll()
            })
            if (this.isBulkSyncing) {
                syncAllBtn.disabled = true
            }

            // Sync selected button (only visible when items are selected)
            if (this.selectedIds.size > 0) {
                const syncSelectedBtn = actions.createEl('button', {
                    cls: 'remarkable-btn remarkable-btn-sm',
                    text: `Sync selected (${this.selectedIds.size})`,
                    attr: { 'aria-label': 'Sync selected notebooks' }
                })
                syncSelectedBtn.addEventListener('click', () => {
                    void this.syncSelected()
                })
                if (this.isBulkSyncing) {
                    syncSelectedBtn.disabled = true
                }
            }

            // Refresh button
            const refreshBtn = actions.createEl('button', {
                cls: 'remarkable-btn remarkable-btn-icon',
                attr: { 'aria-label': 'Refresh notebook list' }
            })
            setIcon(refreshBtn, 'refresh-cw')
            refreshBtn.addEventListener('click', () => {
                void this.refreshNotebooks()
            })
        }

        // Auth status indicator
        const statusEl = header.createDiv({ cls: 'remarkable-auth-status' })
        if (this.plugin.isConnected) {
            statusEl.createSpan({ cls: 'remarkable-status-dot remarkable-status-connected' })
            statusEl.createSpan({ text: 'Connected' })
        } else {
            statusEl.createSpan({ cls: 'remarkable-status-dot remarkable-status-disconnected' })
            statusEl.createSpan({ text: 'Disconnected' })
        }
    }

    private renderDisconnected(container: HTMLElement): void {
        const disconnected = container.createDiv({ cls: 'remarkable-disconnected' })
        disconnected.createEl('p', {
            text: 'Not connected to reMarkable cloud.'
        })
        disconnected.createEl('p', {
            text: 'Run the "Connect to reMarkable cloud" command to authenticate.'
        })
    }

    private renderNotebookList(container: HTMLElement): void {
        const list = container.createDiv({ cls: 'remarkable-notebook-list' })

        // Select all checkbox
        const selectAllRow = list.createDiv({ cls: 'remarkable-select-all-row' })
        const selectAllCheckbox = selectAllRow.createEl('input', {
            cls: 'remarkable-notebook-checkbox',
            attr: { type: 'checkbox' }
        })
        const allSelected =
            this.notebooks.length > 0 && this.selectedIds.size === this.notebooks.length
        const someSelected = this.selectedIds.size > 0 && !allSelected
        selectAllCheckbox.checked = allSelected
        selectAllCheckbox.indeterminate = someSelected
        selectAllRow.createSpan({
            cls: 'remarkable-select-all-label',
            text: 'Select all'
        })
        selectAllCheckbox.addEventListener('change', () => {
            if (selectAllCheckbox.checked) {
                for (const nb of this.notebooks) {
                    this.selectedIds.add(nb.id)
                }
            } else {
                this.selectedIds.clear()
            }
            this.render()
        })
        selectAllRow.addEventListener('click', (e) => {
            if (e.target !== selectAllCheckbox) {
                selectAllCheckbox.checked = !selectAllCheckbox.checked
                selectAllCheckbox.dispatchEvent(new Event('change'))
            }
        })

        // Group by folder path
        const grouped = new Map<string, NotebookSummary[]>()
        for (const nb of this.notebooks) {
            const folder = nb.folderPath || 'Root'
            const existing = grouped.get(folder)
            if (existing) {
                existing.push(nb)
            } else {
                grouped.set(folder, [nb])
            }
        }

        // Sort folders
        const sortedFolders = Array.from(grouped.keys()).sort()

        for (const folder of sortedFolders) {
            const notebooks = grouped.get(folder)
            if (!notebooks) continue

            if (folder !== 'Root') {
                const folderHeader = list.createDiv({ cls: 'remarkable-folder-header' })
                setIcon(folderHeader.createSpan(), 'folder')
                folderHeader.createSpan({ text: folder })
            }

            for (const nb of notebooks) {
                this.renderNotebookRow(list, nb)
            }
        }
    }

    private getSyncStatus(notebook: NotebookSummary): SyncStatus {
        const state = this.plugin.syncStoreService.getState(notebook.id)
        return deriveSyncStatus(state)
    }

    private renderNotebookRow(container: HTMLElement, notebook: NotebookSummary): void {
        const row = container.createDiv({ cls: 'remarkable-notebook-row' })
        const syncStatus = this.getSyncStatus(notebook)

        const topRow = row.createDiv({ cls: 'remarkable-notebook-top' })

        // Checkbox for multi-select
        const checkbox = topRow.createEl('input', {
            cls: 'remarkable-notebook-checkbox',
            attr: { type: 'checkbox' }
        })
        checkbox.checked = this.selectedIds.has(notebook.id)
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selectedIds.add(notebook.id)
            } else {
                this.selectedIds.delete(notebook.id)
            }
            this.render()
        })

        // Sync status indicator
        const statusDot = topRow.createSpan({
            cls: `remarkable-sync-dot remarkable-sync-${syncStatus}`
        })
        statusDot.setAttribute('aria-label', this.getSyncStatusLabel(syncStatus))

        const info = topRow.createDiv({ cls: 'remarkable-notebook-info' })
        info.createDiv({ cls: 'remarkable-notebook-name', text: notebook.visibleName })

        const actions = topRow.createDiv({ cls: 'remarkable-notebook-actions' })

        // Sync button
        const syncBtn = actions.createEl('button', {
            cls: 'remarkable-btn remarkable-btn-icon',
            attr: { 'aria-label': 'Sync notebook' }
        })
        setIcon(syncBtn, 'refresh-cw')
        syncBtn.addEventListener('click', () => {
            void this.processNotebook(notebook)
        })

        // Date on second line
        row.createDiv({
            cls: 'remarkable-notebook-meta',
            text: formatRemarkableDate(notebook.lastModified)
        })

        // Progress indicator
        const progress = this.notebookProgress.get(notebook.id)
        if (progress && progress.status !== 'idle') {
            this.renderProgressIndicator(row, progress)
        }
    }

    private getSyncStatusLabel(status: SyncStatus): string {
        switch (status) {
            case 'synced':
                return 'Synced'
            case 'needs-sync':
                return 'Needs sync'
            case 'never-synced':
                return 'Never synced'
        }
    }

    private renderProgressIndicator(container: HTMLElement, progress: PipelineProgress): void {
        const indicator = container.createDiv({ cls: 'remarkable-progress' })

        const statusMap: Record<PipelineStatus, string> = {
            idle: '',
            downloading: 'Downloading...',
            parsing: 'Parsing...',
            rendering: `Rendering page ${progress.currentPage}/${progress.totalPages}`,
            done: 'Done',
            error: `Error: ${progress.error ?? 'Unknown'}`
        }

        const statusText = statusMap[progress.status]
        const statusClass =
            progress.status === 'done'
                ? 'remarkable-progress-done'
                : progress.status === 'error'
                  ? 'remarkable-progress-error'
                  : 'remarkable-progress-active'

        indicator.createSpan({ cls: `remarkable-progress-text ${statusClass}`, text: statusText })

        if (progress.totalPages > 0 && progress.status !== 'done' && progress.status !== 'error') {
            const pct = Math.round((progress.currentPage / progress.totalPages) * 100)
            const bar = indicator.createDiv({ cls: 'remarkable-progress-bar' })
            bar.createDiv({
                cls: 'remarkable-progress-fill',
                attr: { style: `width: ${pct}%` }
            })
        }
    }

    private async refreshNotebooks(): Promise<void> {
        this.isLoading = true
        this.render()

        try {
            this.notebooks = await this.plugin.cloudService.listDocuments()
        } catch (error) {
            log('Failed to refresh notebooks', 'error', error)
        }

        this.isLoading = false
        this.render()
    }

    private async processNotebook(notebook: NotebookSummary): Promise<void> {
        this.notebookProgress.set(notebook.id, {
            status: 'downloading',
            currentPage: 0,
            totalPages: 0
        })
        this.render()

        await this.plugin.pipelineService.processNotebook(notebook, (progress) => {
            this.notebookProgress.set(notebook.id, progress)
            this.render()
        })
    }

    private async syncAll(): Promise<void> {
        const toSync = this.notebooks.filter((nb) => {
            const status = this.getSyncStatus(nb)
            return status === 'needs-sync' || status === 'never-synced'
        })

        if (toSync.length === 0) {
            return
        }

        this.isBulkSyncing = true
        this.render()

        for (const nb of toSync) {
            await this.processNotebook(nb)
        }

        this.isBulkSyncing = false
        this.render()
    }

    private async syncSelected(): Promise<void> {
        const toSync = this.notebooks.filter((nb) => this.selectedIds.has(nb.id))

        if (toSync.length === 0) {
            return
        }

        this.isBulkSyncing = true
        this.render()

        for (const nb of toSync) {
            await this.processNotebook(nb)
        }

        this.selectedIds.clear()
        this.isBulkSyncing = false
        this.render()
    }
}
