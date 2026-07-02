import { Plugin } from 'obsidian'
import { DEFAULT_SETTINGS, MIN_AUTO_SYNC_INTERVAL_MINUTES } from './types/plugin-settings.intf'
import type { PluginSettings } from './types/plugin-settings.intf'
import { RemarkableSyncSettingTab } from './settings/settings-tab'
import { log } from '../utils/log'
import { produce } from 'immer'
import type { Draft, WritableDraft } from 'immer'
import { registerCommands } from './commands'
import { syncAllNotebooks } from './commands/sync-all-notebooks'
import { REMARKABLE_PANEL_VIEW_TYPE, RemarkablePanelView } from './ui/remarkable-panel-view'
import { SYNC_LOG_VIEW_TYPE, SyncLogView } from './ui/sync-log-view'
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
import type { SyncLogService } from './services/log/sync-log.service'
import { createSyncLogService } from './services/log/sync-log.service'
import {
    cleanImagePlaceholders,
    describeCleanResult,
    IMG_PLACEHOLDER_MIGRATION_VERSION
} from './services/migration/clean-image-placeholders'

export class RemarkableSyncPlugin extends Plugin {
    settings: PluginSettings = { ...DEFAULT_SETTINGS }
    isConnected = false
    isSyncing = false
    private autoSyncIntervalId: number | null = null
    authService!: RemarkableAuthService
    cloudService!: RemarkableCloudService
    pipelineService!: NotebookPipelineService
    syncStoreService!: SyncStoreService
    importService!: RmdocImportService
    syncLogService!: SyncLogService

    override async onload(): Promise<void> {
        log('Initializing', 'debug')
        await this.loadSettings()

        this.syncLogService = createSyncLogService()
        this.authService = createRemarkableAuthService(this)
        this.cloudService = createRemarkableCloudService(this)
        this.syncStoreService = createSyncStoreService(this)
        this.pipelineService = createNotebookPipelineService(this)
        this.importService = createRmdocImportService(this)

        // Check auth status on load
        this.isConnected = await this.authService.isAuthenticated()

        // Register the panel view
        this.registerView(REMARKABLE_PANEL_VIEW_TYPE, (leaf) => new RemarkablePanelView(leaf, this))
        // Register the sync-log view
        this.registerView(SYNC_LOG_VIEW_TYPE, (leaf) => new SyncLogView(leaf, this))

        // Register commands
        registerCommands(this)

        // Add ribbon icon to open the panel
        this.addRibbonIcon('tablet', 'Open reMarkable panel', () => {
            void this.activatePanelView()
        })

        // Add a settings screen for the plugin
        this.addSettingTab(new RemarkableSyncSettingTab(this.app, this))

        // Defer auto-sync wiring until the workspace is ready so we never do
        // heavy work during onload.
        this.app.workspace.onLayoutReady(() => {
            void this.runStartupTasks()
        })
    }

    /**
     * Deferred startup work (after the workspace is ready): run the one-time
     * image-placeholder migration, then the optional startup sync, then arm the
     * periodic auto-sync. Migration runs before the sync so the latter sees a
     * clean, reconciled state.
     */
    private async runStartupTasks(): Promise<void> {
        if (this.settings.imgPlaceholderMigrationVersion < IMG_PLACEHOLDER_MIGRATION_VERSION) {
            try {
                const result = await cleanImagePlaceholders(this)
                if (result.blocksCleaned > 0) {
                    this.syncLogService.emit('success', describeCleanResult(result))
                }
                // Record the version only on success, so a failed run retries next load.
                await this.updateSettings((draft) => {
                    draft.imgPlaceholderMigrationVersion = IMG_PLACEHOLDER_MIGRATION_VERSION
                })
            } catch (error) {
                log('Image-placeholder migration failed', 'error', error)
            }
        }

        if (this.settings.syncOnStartup) {
            this.runAutoSync('startup')
        }
        this.setupAutoSync()
    }

    /**
     * Run one unattended (silent) auto-sync pass, scoped to the configured
     * source folder and, when enabled, to the single newest-modified notebook.
     * Fire-and-forget: errors are caught + logged so a failed sync never crashes
     * Obsidian or wedges the periodic loop.
     */
    private runAutoSync(trigger: 'startup' | 'interval'): void {
        void syncAllNotebooks(this, {
            silent: true,
            trigger,
            folder: this.settings.sourceFolder,
            newestOnly: this.settings.autoSyncNewestOnly
        }).catch((error: unknown) => {
            log('Auto-sync failed', 'error', error)
        })
    }

    override onunload(): void {
        log('Unloading', 'debug')
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId)
            this.autoSyncIntervalId = null
        }
    }

    /**
     * (Re)configure the periodic auto-sync timer from current settings. Safe to
     * call repeatedly — clears any existing interval first, so toggling the
     * setting or changing the interval takes effect immediately without stacking
     * timers. The interval is also registered for cleanup on unload.
     */
    setupAutoSync(): void {
        if (this.autoSyncIntervalId !== null) {
            window.clearInterval(this.autoSyncIntervalId)
            this.autoSyncIntervalId = null
        }

        if (!this.settings.autoSync) {
            return
        }

        const minutes = Math.max(
            MIN_AUTO_SYNC_INTERVAL_MINUTES,
            this.settings.autoSyncIntervalMinutes
        )
        const intervalId = window.setInterval(
            () => {
                this.runAutoSync('interval')
            },
            minutes * 60 * 1000
        )
        this.registerInterval(intervalId)
        this.autoSyncIntervalId = intervalId
        log(`Auto-sync scheduled every ${minutes} minutes`, 'debug')
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

    async activateSyncLogView(): Promise<void> {
        const { workspace } = this.app
        let leaf = workspace.getLeavesOfType(SYNC_LOG_VIEW_TYPE)[0]
        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false)
            if (!rightLeaf) {
                return
            }
            leaf = rightLeaf
            await leaf.setViewState({
                type: SYNC_LOG_VIEW_TYPE,
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
            this.settings = { ...DEFAULT_SETTINGS }
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
            if (loadedSettings.useRmfakecloud !== undefined) {
                draft.useRmfakecloud = loadedSettings.useRmfakecloud
            }
            if (loadedSettings.rmfakecloudUrl !== undefined) {
                draft.rmfakecloudUrl = loadedSettings.rmfakecloudUrl
            }
            if (loadedSettings.syncOnStartup !== undefined) {
                draft.syncOnStartup = loadedSettings.syncOnStartup
            }
            if (loadedSettings.autoSync !== undefined) {
                draft.autoSync = loadedSettings.autoSync
            }
            if (loadedSettings.autoSyncIntervalMinutes !== undefined) {
                draft.autoSyncIntervalMinutes = loadedSettings.autoSyncIntervalMinutes
            }
            if (loadedSettings.sourceFolder !== undefined) {
                draft.sourceFolder = loadedSettings.sourceFolder
            }
            if (loadedSettings.autoSyncNewestOnly !== undefined) {
                draft.autoSyncNewestOnly = loadedSettings.autoSyncNewestOnly
            }
            if (loadedSettings.ocrEnabled !== undefined) {
                draft.ocrEnabled = loadedSettings.ocrEnabled
            }
            if (loadedSettings.mdserverOcrUrl !== undefined) {
                draft.mdserverOcrUrl = loadedSettings.mdserverOcrUrl
            }
            if (loadedSettings.ocrRequestDelayMs !== undefined) {
                draft.ocrRequestDelayMs = loadedSettings.ocrRequestDelayMs
            }
            if (loadedSettings.imgPlaceholderMigrationVersion !== undefined) {
                draft.imgPlaceholderMigrationVersion = loadedSettings.imgPlaceholderMigrationVersion
            }
            if (loadedSettings.syncStore !== undefined) {
                draft.syncStore = loadedSettings.syncStore
            }
        })

        log('Settings loaded', 'debug', this.settings)
    }

    async updateSettings(recipe: (draft: WritableDraft<PluginSettings>) => void): Promise<void> {
        this.settings = produce(this.settings, recipe)
        await this.saveSettings()
    }

    async saveSettings(): Promise<void> {
        log('Saving settings', 'debug', this.settings)
        await this.saveData(this.settings)
        log('Settings saved', 'debug', this.settings)
    }
}
