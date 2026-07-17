import type { Setting, SettingDefinitionItem } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import { connectDevice } from '../commands/connect-device'
import { disconnectDevice } from '../commands/disconnect-device'
import {
    resolveCloudUrls,
    validateRmfakecloudUrl,
    normalizeRmfakecloudUrlInput
} from '../services/cloud/cloud-urls'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'

/**
 * Declarative setting definitions (Obsidian >= 1.13.0, guaranteed by
 * minAppVersion). The sole rendering path for the settings tab.
 *
 * @param plugin the plugin instance (settings source and command target)
 * @param requestUpdate re-builds and re-renders the definitions (call after state changes)
 */
export function buildSettingDefinitions(
    plugin: RemarkableSyncPlugin,
    requestUpdate: () => void
): SettingDefinitionItem[] {
    return [
        {
            type: 'group',
            heading: 'Authentication',
            items: [
                {
                    name: 'Status',
                    aliases: ['connect', 'disconnect', 'authentication', 'remarkable cloud'],
                    render: (setting: Setting): void => {
                        const urls = resolveCloudUrls(plugin.settings)
                        const cloudName = urls.isRmfakecloud ? 'rmfakecloud' : 'reMarkable cloud'
                        if (plugin.isConnected) {
                            setting.setDesc(`Connected to ${cloudName}`).addButton((button) => {
                                button.setButtonText('Disconnect').onClick(async () => {
                                    await disconnectDevice(plugin)
                                    requestUpdate()
                                })
                            })
                        } else {
                            setting.setDesc(`Not connected to ${cloudName}`).addButton((button) => {
                                button
                                    .setCta()
                                    .setButtonText('Connect')
                                    .onClick(() => {
                                        connectDevice(plugin, requestUpdate)
                                    })
                            })
                        }
                    }
                }
            ]
        },
        {
            type: 'group',
            heading: 'Cloud',
            items: [
                {
                    name: 'Use rmfakecloud',
                    desc: 'Connect to a self-hosted rmfakecloud server instead of the official reMarkable cloud',
                    control: {
                        type: 'toggle',
                        key: 'useRmfakecloud',
                        defaultValue: false
                    }
                },
                {
                    name: 'Server URL',
                    desc: 'The base URL of your rmfakecloud server (e.g., https://cloud.example.com)',
                    aliases: ['rmfakecloud url'],
                    visible: (): boolean => plugin.settings.useRmfakecloud,
                    control: {
                        type: 'text',
                        key: 'rmfakecloudUrl',
                        placeholder: 'https://cloud.example.com',
                        validate: (value: string): string | void => {
                            const normalized = normalizeRmfakecloudUrlInput(value)
                            if (!normalized) {
                                return
                            }
                            const error = validateRmfakecloudUrl(normalized)
                            if (error) {
                                return error
                            }
                            return
                        }
                    }
                },
                {
                    name: 'Cloud settings warning',
                    searchable: false,
                    visible: (): boolean => plugin.settings.useRmfakecloud && plugin.isConnected,
                    render: (setting: Setting): void => {
                        setting.settingEl.empty()
                        const warningEl = setting.settingEl.createDiv({
                            cls: 'remarkable-cloud-warning'
                        })
                        warningEl.createEl('p', {
                            text: 'Changing cloud settings requires disconnecting and reconnecting. Tokens from one cloud are not valid on another.',
                            cls: 'remarkable-cloud-warning-text'
                        })
                    }
                }
            ]
        },
        {
            type: 'group',
            heading: 'Output',
            items: [
                {
                    name: 'Target folder',
                    desc: 'Vault folder where notebooks will be saved. Leave empty for vault root.',
                    control: {
                        type: 'text',
                        key: 'targetFolder',
                        placeholder: 'e.g., reMarkable'
                    }
                },
                {
                    name: 'Save images',
                    desc: 'Save rendered page images alongside markdown files',
                    control: {
                        type: 'toggle',
                        key: 'saveImages',
                        defaultValue: true
                    }
                },
                {
                    name: 'Image format',
                    desc: 'Format for rendered page images. JPEG and WebP are smaller; PNG is lossless.',
                    control: {
                        type: 'dropdown',
                        key: 'imageFormat',
                        options: { jpeg: 'JPEG', webp: 'WebP', png: 'PNG' },
                        defaultValue: 'jpeg'
                    }
                },
                {
                    name: 'Image quality',
                    desc: 'Quality for JPEG/WebP (0.1 = smallest, 1.0 = best). Does not apply to PNG.',
                    visible: (): boolean => plugin.settings.imageFormat !== 'png',
                    control: {
                        type: 'slider',
                        key: 'imageQuality',
                        min: 0.1,
                        max: 1.0,
                        step: 0.05,
                        defaultValue: 0.85
                    }
                }
            ]
        },
        {
            type: 'group',
            heading: 'About',
            items: [
                {
                    name: 'Follow me on X',
                    desc: 'Sébastien Dubois (@dSebastien)',
                    render: (setting: Setting): void => {
                        setting.addButton((button) => {
                            button.setCta()
                            button.setButtonText('Follow me on X').onClick(() => {
                                window.open('https://x.com/dSebastien')
                            })
                        })
                    }
                }
            ]
        },
        {
            type: 'group',
            heading: 'Support',
            items: [
                {
                    name: 'Buy me a coffee',
                    desc: 'Buy me a coffee to support the development of this plugin',
                    render: (setting: Setting): void => {
                        const linkEl = setting.controlEl.createEl('a', {
                            href: 'https://www.buymeacoffee.com/dsebastien'
                        })
                        const imgEl = linkEl.createEl('img')
                        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
                        imgEl.alt = 'Buy me a coffee'
                        imgEl.width = 175
                    }
                }
            ]
        }
    ]
}
