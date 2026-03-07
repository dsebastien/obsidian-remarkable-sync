import { Plugin } from 'obsidian'
import { DEFAULT_SETTINGS } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { RemarkableSyncSettingTab } from './settings/settings-tab'
import { log } from '../utils/log'
import { produce } from 'immer'
import type { Draft } from 'immer'
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

export class RemarkableSyncPlugin extends Plugin {
    settings: PluginSettings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)
    authService!: RemarkableAuthService
    cloudService!: RemarkableCloudService
    pipelineService!: NotebookPipelineService
    syncStoreService!: SyncStoreService

    override async onload(): Promise<void> {
        log('Initializing', 'debug')
        await this.loadSettings()

        this.authService = createRemarkableAuthService(this)
        this.cloudService = createRemarkableCloudService(this)
        this.syncStoreService = createSyncStoreService(this)
        this.pipelineService = createNotebookPipelineService(this)

        // Check auth status on load
        const isAuthenticated = await this.authService.isAuthenticated()
        if (isAuthenticated !== this.settings.isAuthenticated) {
            this.settings = produce(this.settings, (draft: Draft<PluginSettings>) => {
                draft.isAuthenticated = isAuthenticated
            })
            void this.saveSettings()
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

    async loadSettings(): Promise<void> {
        log('Loading settings', 'debug')
        const loadedSettings = (await this.loadData()) as PluginSettings | null

        if (!loadedSettings) {
            log('Using default settings', 'debug')
            this.settings = produce(DEFAULT_SETTINGS, () => DEFAULT_SETTINGS)
            return
        }

        this.settings = produce(DEFAULT_SETTINGS, (draft: Draft<PluginSettings>) => {
            if (loadedSettings.targetFolder !== undefined) {
                draft.targetFolder = loadedSettings.targetFolder
            }
            if (loadedSettings.saveImages !== undefined) {
                draft.saveImages = loadedSettings.saveImages
            }
            if (loadedSettings.imageFormat !== undefined) {
                draft.imageFormat = loadedSettings.imageFormat
            }
            if (loadedSettings.isAuthenticated !== undefined) {
                draft.isAuthenticated = loadedSettings.isAuthenticated
            }
            if (loadedSettings.syncStore !== undefined) {
                draft.syncStore = loadedSettings.syncStore
            }
        })

        log('Settings loaded', 'debug', this.settings)
    }

    async saveSettings(): Promise<void> {
        log('Saving settings', 'debug', this.settings)
        await this.saveData(this.settings)
        log('Settings saved', 'debug', this.settings)
    }
}
