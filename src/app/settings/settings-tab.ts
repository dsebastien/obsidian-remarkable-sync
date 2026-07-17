import { App, PluginSettingTab } from 'obsidian'
import type { SettingDefinitionItem } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { buildSettingDefinitions } from './setting-definitions'
import { normalizeRmfakecloudUrlInput } from '../services/cloud/cloud-urls'

export class RemarkableSyncSettingTab extends PluginSettingTab {
    plugin: RemarkableSyncPlugin

    constructor(app: App, plugin: RemarkableSyncPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    /**
     * Declarative settings (requires Obsidian >= 1.13.0, guaranteed by
     * minAppVersion): makes the plugin settings discoverable through
     * Obsidian's settings search. Supersedes the deprecated display().
     */
    override getSettingDefinitions(): SettingDefinitionItem[] {
        return buildSettingDefinitions(this.plugin, () => this.update())
    }

    override getControlValue(key: string): unknown {
        switch (key) {
            case 'useRmfakecloud':
                return this.plugin.settings.useRmfakecloud
            case 'rmfakecloudUrl':
                return this.plugin.settings.rmfakecloudUrl
            case 'targetFolder':
                return this.plugin.settings.targetFolder
            case 'saveImages':
                return this.plugin.settings.saveImages
            case 'imageFormat':
                return this.plugin.settings.imageFormat
            case 'imageQuality':
                return this.plugin.settings.imageQuality
            default:
                return undefined
        }
    }

    override async setControlValue(key: string, value: unknown): Promise<void> {
        switch (key) {
            case 'useRmfakecloud': {
                if (typeof value !== 'boolean') {
                    return
                }
                const useRmfakecloud = value
                await this.plugin.updateSettings((draft) => {
                    draft.useRmfakecloud = useRmfakecloud
                })
                // Re-render: server URL visibility and cloud name in the auth status
                this.update()
                return
            }
            case 'rmfakecloudUrl': {
                if (typeof value !== 'string') {
                    return
                }
                const rmfakecloudUrl = normalizeRmfakecloudUrlInput(value)
                await this.plugin.updateSettings((draft) => {
                    draft.rmfakecloudUrl = rmfakecloudUrl
                })
                return
            }
            case 'targetFolder': {
                if (typeof value !== 'string') {
                    return
                }
                const targetFolder = value.trim()
                await this.plugin.updateSettings((draft) => {
                    draft.targetFolder = targetFolder
                })
                return
            }
            case 'saveImages': {
                if (typeof value !== 'boolean') {
                    return
                }
                const saveImages = value
                await this.plugin.updateSettings((draft) => {
                    draft.saveImages = saveImages
                })
                return
            }
            case 'imageFormat': {
                if (value !== 'png' && value !== 'jpeg' && value !== 'webp') {
                    return
                }
                const imageFormat = value
                await this.plugin.updateSettings((draft) => {
                    draft.imageFormat = imageFormat
                })
                // Re-evaluate the image quality slider visibility
                this.refreshDomState()
                return
            }
            case 'imageQuality': {
                if (typeof value !== 'number') {
                    return
                }
                const imageQuality = value
                await this.plugin.updateSettings((draft) => {
                    draft.imageQuality = imageQuality
                })
                return
            }
            default:
                return
        }
    }
}
