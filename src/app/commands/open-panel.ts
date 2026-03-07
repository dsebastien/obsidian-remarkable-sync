import type { RemarkableSyncPlugin } from '../plugin'

export function openPanel(plugin: RemarkableSyncPlugin): void {
    void plugin.activatePanelView()
}
