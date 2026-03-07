import type { RemarkableSyncPlugin } from '../plugin'
import { AuthModal } from '../ui/auth-modal'

export function connectDevice(plugin: RemarkableSyncPlugin, onSuccess?: () => void): void {
    new AuthModal(plugin, onSuccess).open()
}
