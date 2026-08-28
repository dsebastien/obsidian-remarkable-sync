import { Plugin } from 'obsidian'
import { DEFAULT_SETTINGS } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { RemarkableSyncSettingTab } from './settings/settings-tab'
import { mergeLoadedSettings } from './settings/load-settings'
import { log } from '../utils/log'
import { produce } from 'immer'
import type { WritableDraft } from 'immer'
import { registerCommands } from './commands'
import { REMARKABLE_PANEL_VIEW_TYPE, RemarkablePanelView } from './ui/remarkable-panel-view'
import type { RemarkableAuthService } from './services/auth/remarkable-auth.service'
import { createRemarkableAuthService } from './services/auth/remarkable-auth.service'
import type { RemarkableCloudService } from './services/cloud/remarkable-cloud.service'
import { createRemarkableCloudService } from './services/cloud/remarkable-cloud.service'
import type { NotebookPipelineService } from './services/pipeline/notebook-pipeline.service'
import { createNotebookPipelineService } from './services/pipeline/notebook-pipeline.service'
import type { SyncStoreService } from './services/sync/sync-store.service'
import { createSyncStoreService } from './services/sync/sync-store.service'
import type { RmdocImportService } from './services/import/rmdoc-import.service'
import { createRmdocImportService } from './services/import/rmdoc-import.service'
import type { AutoSyncService } from './services/sync/auto-sync.service'
import { createAutoSyncServiceForPlugin } from './services/sync/auto-sync.service'
import { registerWhatsNewView } from './whats-new'
import { createWriteQueue, mergePluginData } from './utils/plugin-data'

export class RemarkableSyncPlugin extends Plugin {
    override settings: PluginSettings = { ...DEFAULT_SETTINGS }
    isConnected = false
    authService!: RemarkableAuthService
    cloudService!: RemarkableCloudService
    pipelineService!: NotebookPipelineService
    syncStoreService!: SyncStoreService
    importService!: RmdocImportService
    autoSyncService!: AutoSyncService

    /** Last known contents of `data.json`, kept so writes can merge instead of replace. */
    private rawData: Record<string, unknown> = {}
    /** Serializes `data.json` writes; see {@link persistData}. */
    private readonly enqueueWrite = createWriteQueue()

    override async onload(): Promise<void> {
        // Must run before anything can call saveData (fresh-install detection)
        registerWhatsNewView(this)
        log('Initializing', 'debug')
        await this.loadSettings()

        this.authService = createRemarkableAuthService(this)
        this.cloudService = createRemarkableCloudService(this)
        this.syncStoreService = createSyncStoreService(this)
        this.pipelineService = createNotebookPipelineService(this)
        this.importService = createRmdocImportService(this)
        this.autoSyncService = createAutoSyncServiceForPlugin(this)

        // Check auth status on load — must never prevent the plugin from loading
        try {
            this.isConnected = await this.authService.isAuthenticated()
        } catch (error) {
            log('Failed to check authentication status, treating as disconnected', 'error', error)
            this.isConnected = false
        }

        // Register the panel view
        this.registerView(REMARKABLE_PANEL_VIEW_TYPE, (leaf) => new RemarkablePanelView(leaf, this))

        // Register commands
        registerCommands(this)

        // Add ribbon icon to open the panel
        this.addRibbonIcon('tablet', 'Open reMarkable panel', () => {
            void this.activatePanelView()
        })

        // Add a settings screen for the plugin
        this.addSettingTab(new RemarkableSyncSettingTab(this.app, this))

        // Schedule automatic background sync when enabled in settings
        this.autoSyncService.applySettings()
    }

    override onunload(): void {
        log('Unloading', 'debug')
    }

    async activatePanelView(): Promise<void> {
        const { workspace } = this.app
        let leaf = workspace.getLeavesOfType(REMARKABLE_PANEL_VIEW_TYPE)[0]
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false)
            if (!rightLeaf) {
                return
            }
            leaf = rightLeaf
            await leaf.setViewState({
                type: REMARKABLE_PANEL_VIEW_TYPE,
                active: true
            })
        }
        void workspace.revealLeaf(leaf)
    }

    /**
     * Read a single top-level entry from the plugin's `data.json`.
     * Used for data that must not travel through {@link PluginSettings} —
     * currently the reMarkable tokens.
     */
    getDataValue(key: string): unknown {
        return this.rawData[key]
    }

    /**
     * Merge a patch into the plugin's `data.json` and persist it.
     *
     * All `data.json` writes MUST go through here. `saveData` replaces the
     * whole file, so writing only the settings object would erase sibling
     * entries (the tokens). Writes are serialized on a promise chain because
     * a settings save and a background token refresh can otherwise interleave
     * and lose one of the two changes.
     *
     * A patch entry set to `undefined` removes that key.
     */
    async persistData(patch: Record<string, unknown>): Promise<void> {
        await this.enqueueWrite(async (): Promise<void> => {
            const merged = mergePluginData(this.rawData, patch)
            await this.saveData(merged)
            // Only after the write landed — otherwise a failed save would leave
            // in-memory state claiming to be persisted.
            this.rawData = merged
        })
    }

    async loadSettings(): Promise<void> {
        log('Loading settings', 'debug')
        const loadedData = (await this.loadData()) as Record<string, unknown> | null
        this.rawData = loadedData ?? {}

        if (!loadedData) {
            log('Using default settings', 'debug')
            this.settings = { ...DEFAULT_SETTINGS }
            return
        }

        this.settings = mergeLoadedSettings(loadedData)

        log('Settings loaded', 'debug', this.settings)
    }

    /**
     * Apply a mutation to the settings (via immer) and persist the result.
     * The single write path — the declarative settings tab routes every
     * control edit through here so persistence happens in exactly one place.
     *
     * Persist-then-commit: memory is swapped only after the merged data.json
     * write succeeds, so a rejected write rolls the control back to the
     * on-disk truth. The produce() runs INSIDE the queued task so each
     * mutation derives from the previously COMMITTED state — producing out
     * here would let overlapping calls build on the same base across the save
     * await, the second commit silently dropping the first edit. The body
     * mirrors persistData() rather than calling it: enqueueing from inside a
     * queued task would deadlock the chain.
     */
    async updateSettings(recipe: (draft: WritableDraft<PluginSettings>) => void): Promise<void> {
        await this.enqueueWrite(async (): Promise<void> => {
            const next = produce(this.settings, recipe)
            const merged = mergePluginData(this.rawData, { ...next })
            await this.saveData(merged)
            this.rawData = merged
            this.settings = next
        })
    }

    async saveSettings(): Promise<void> {
        log('Saving settings', 'debug', this.settings)
        await this.persistData({ ...this.settings })
        log('Settings saved', 'debug', this.settings)
    }
}
