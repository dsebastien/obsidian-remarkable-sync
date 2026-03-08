import { App, PluginSettingTab } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { renderAuthSection } from './components/auth-section'
import { renderCloudSection } from './components/cloud-section'
import { renderOutputSection } from './components/output-section'
import { renderAboutSection } from './components/about-section'

export class RemarkableSyncSettingTab extends PluginSettingTab {
    plugin: RemarkableSyncPlugin

    constructor(app: App, plugin: RemarkableSyncPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    display(): void {
        const { containerEl } = this
        containerEl.empty()

        renderAuthSection(containerEl, this.plugin, () => this.display())
        renderCloudSection(containerEl, this.plugin, () => this.display())
        renderOutputSection(containerEl, this.plugin)
        renderAboutSection(containerEl)
    }
}
