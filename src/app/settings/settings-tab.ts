import { Notice, PluginSettingTab } from 'obsidian'
import type { App, SettingDefinitionItem } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import {
    MAX_AUTO_SYNC_INTERVAL_MINUTES,
    MIN_AUTO_SYNC_INTERVAL_MINUTES
} from '../types/plugin-settings.intf'
import { connectDevice } from '../commands/connect-device'
import { disconnectDevice } from '../commands/disconnect-device'
import {
    normalizeRmfakecloudUrlInput,
    resolveCloudUrls,
    validateRmfakecloudUrl
} from '../services/cloud/cloud-urls'
import {
    LEGACY_IMPORT_DONE_DATA_KEY,
    legacyTokenFileExists,
    removeLegacyTokenFile
} from '../services/auth/token-store'
import { BUY_ME_A_COFFEE_BADGE_DATA_URL } from '../assets/buy-me-a-coffee'
import { BUY_ME_A_COFFEE_URL, renderSupportSection } from '../ui/support-links'

/**
 * The settings keys owned by plain declarative controls, i.e. everything the
 * `getControlValue`/`setControlValue` pair addresses.
 */
type ControlKey =
    | 'useRmfakecloud'
    | 'rmfakecloudUrl'
    | 'autoSyncEnabled'
    | 'autoSyncIntervalMinutes'
    | 'targetFolder'
    | 'saveImages'
    | 'imageFormat'
    | 'imageQuality'
    | 'savePdf'
    | 'saveHighlightsNote'
    | 'saveTypedTextNote'

/** Writes after which the auto-sync scheduler must re-read its settings. */
const AUTO_SYNC_KEYS: ReadonlySet<string> = new Set(['autoSyncEnabled', 'autoSyncIntervalMinutes'])

/**
 * Writes that change which other rows are visible (conditional sections),
 * so the pane re-renders after the commit.
 */
const VISIBILITY_KEYS: ReadonlySet<string> = new Set([
    'useRmfakecloud',
    'autoSyncEnabled',
    'imageFormat'
])

const IMAGE_FORMATS = ['jpeg', 'webp', 'png'] as const

/**
 * Settings tab, declared rather than rendered (Obsidian 1.13+).
 *
 * `getSettingDefinitions()` REPLACES `display()`: when it returns a non-empty
 * array, `display()` is never called. There is no partial adoption — the whole
 * settings UI is declarative, or none of it. In exchange, Obsidian owns
 * navigation, focus and ARIA, and every declared `name`/`desc` is indexed by
 * the settings search.
 *
 * The old tab handed every section a `redisplay` callback; under the
 * declarative API those listeners are dead (`display()` never runs), so every
 * state change that used to redisplay now calls `update()` instead — the
 * connect/disconnect flows included.
 *
 * Rules that each cost a shipped bug the first time they were broken:
 *
 * - A `render:` hook renders the ROW. Write into `setting.settingEl` only.
 * - A row `action:` fires on the whole row and draws no button; button rows
 *   use `render:` with `addButton`.
 * - `setControlValue` MUST reject on failure — resolving tells the framework
 *   the write landed.
 * - A definition with neither `control` nor `render` is skipped entirely;
 *   info rows need a no-op render hook.
 * - `visible:` is evaluated on each render; call `update()` after the state
 *   it reads changes.
 */
export class RemarkableSyncSettingTab extends PluginSettingTab {
    plugin: RemarkableSyncPlugin

    constructor(app: App, plugin: RemarkableSyncPlugin) {
        super(app, plugin)
        this.plugin = plugin
    }

    override getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'Authentication',
                items: [
                    {
                        name: 'Status',
                        // The description and the button both depend on live
                        // connection state, so the whole row is rendered; a
                        // connect/disconnect re-renders the pane via update().
                        render: (setting): void => {
                            const urls = resolveCloudUrls(this.plugin.settings)
                            const cloudName = urls.isRmfakecloud
                                ? 'rmfakecloud'
                                : 'reMarkable cloud'
                            if (this.plugin.isConnected) {
                                setting.setDesc(`Connected to ${cloudName}`)
                                setting.addButton((button) => {
                                    button.setButtonText('Disconnect').onClick(async () => {
                                        await disconnectDevice(this.plugin)
                                        this.update()
                                    })
                                })
                            } else {
                                setting.setDesc(`Not connected to ${cloudName}`)
                                setting.addButton((button) => {
                                    button
                                        .setCta()
                                        .setButtonText('Connect')
                                        .onClick(() => {
                                            connectDevice(this.plugin, () => {
                                                this.update()
                                            })
                                        })
                                })
                            }
                        }
                    },
                    {
                        name: 'Legacy token file',
                        desc: 'Credentials from ~/.remarkable-sync/token.json have been copied into this vault. The old file is still on your computer and is shared by your other vaults — remove it once they all use this version of the plugin.',
                        // Only offered once this vault has actually consumed
                        // the file: the marker and the imported tokens are
                        // written together, so until it is set the legacy file
                        // may still be the only copy of the credentials.
                        visible: (): boolean =>
                            true === this.plugin.getDataValue(LEGACY_IMPORT_DONE_DATA_KEY) &&
                            legacyTokenFileExists(),
                        render: (setting): void => {
                            setting.addButton((button) => {
                                button
                                    .setWarning()
                                    .setButtonText('Remove')
                                    .onClick(() => {
                                        new Notice(
                                            removeLegacyTokenFile()
                                                ? 'Legacy token file removed.'
                                                : 'Could not remove the legacy token file.'
                                        )
                                        this.update()
                                    })
                            })
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
                        control: { type: 'toggle', key: 'useRmfakecloud' }
                    },
                    {
                        name: 'Server URL',
                        desc: 'The base URL of your rmfakecloud server (e.g., https://cloud.example.com)',
                        visible: (): boolean => this.plugin.settings.useRmfakecloud,
                        control: {
                            type: 'text',
                            key: 'rmfakecloudUrl',
                            placeholder: 'https://cloud.example.com',
                            // Inline validation, shown by the framework below
                            // the row. The old tab painted its own error span
                            // but persisted the invalid value anyway; now an
                            // invalid URL is refused outright.
                            validate: (value: string): string | void => {
                                const trimmed = normalizeRmfakecloudUrlInput(value)
                                if (trimmed === '') {
                                    return
                                }
                                return validateRmfakecloudUrl(trimmed) ?? undefined
                            }
                        }
                    },
                    {
                        name: 'Cloud change warning',
                        desc: 'Changing cloud settings requires disconnecting and reconnecting. Tokens from one cloud are not valid on another.',
                        searchable: false,
                        visible: (): boolean =>
                            this.plugin.settings.useRmfakecloud && this.plugin.isConnected,
                        // A definition with neither control nor render is
                        // skipped entirely — an info row needs this no-op.
                        render: (): void => {}
                    }
                ]
            },
            {
                type: 'group',
                heading: 'Sync',
                items: [
                    {
                        name: 'Automatic sync',
                        desc: 'Periodically sync all notebooks that need updating. Runs in the background; skipped while disconnected or when a sync is already in progress.',
                        control: { type: 'toggle', key: 'autoSyncEnabled' }
                    },
                    {
                        name: 'Sync interval',
                        desc: `How often to sync automatically, in minutes (${MIN_AUTO_SYNC_INTERVAL_MINUTES}–${MAX_AUTO_SYNC_INTERVAL_MINUTES}).`,
                        visible: (): boolean => this.plugin.settings.autoSyncEnabled,
                        control: {
                            type: 'slider',
                            key: 'autoSyncIntervalMinutes',
                            min: MIN_AUTO_SYNC_INTERVAL_MINUTES,
                            max: MAX_AUTO_SYNC_INTERVAL_MINUTES,
                            step: 5
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
                        desc: 'Save rendered page images alongside Markdown files',
                        control: { type: 'toggle', key: 'saveImages' }
                    },
                    {
                        name: 'Image format',
                        desc: 'Format for rendered page images. JPEG and WebP are smaller; PNG is lossless.',
                        control: {
                            type: 'dropdown',
                            key: 'imageFormat',
                            options: {
                                jpeg: 'JPEG',
                                webp: 'WebP',
                                png: 'PNG'
                            }
                        }
                    },
                    {
                        name: 'Image quality',
                        desc: 'Quality for JPEG/WebP (0.1 = smallest, 1.0 = best). Does not apply to PNG.',
                        visible: (): boolean => this.plugin.settings.imageFormat !== 'png',
                        control: {
                            type: 'slider',
                            key: 'imageQuality',
                            min: 0.1,
                            max: 1,
                            step: 0.05
                        }
                    }
                ]
            },
            {
                type: 'group',
                heading: 'PDF',
                items: [
                    {
                        name: 'Save as PDF',
                        desc: 'Write one PDF per notebook, beside the page images. Independent of "Save images": enable either, both or neither. WebP cannot be stored in a PDF, so pages are embedded as JPEG when that format is selected.',
                        control: { type: 'toggle', key: 'savePdf' }
                    }
                ]
            },
            {
                type: 'group',
                heading: 'Highlights',
                items: [
                    {
                        name: 'Save highlights note',
                        desc: 'Write a Markdown note listing text you highlighted on the device, quoted under its page number. Only creates a file for documents that actually have highlights. Text highlights are always embedded in the annotated PDF regardless of this setting.',
                        control: { type: 'toggle', key: 'saveHighlightsNote' }
                    }
                ]
            },
            {
                type: 'group',
                heading: 'Typed text',
                items: [
                    {
                        name: 'Save typed text note',
                        desc: 'Write a Markdown note holding text you typed on a keyboard. Because it is written as text rather than drawn into the page image, it is searchable and any links you typed become real links. Handwriting is not included: it stays as ink in the page image. Only creates a file for documents that actually have typed text.',
                        control: { type: 'toggle', key: 'saveTypedTextNote' }
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
                        searchable: false,
                        // A CTA button, not a row `action:` — `action:` makes
                        // the WHOLE row clickable and draws no button at all.
                        render: (setting): void => {
                            setting.addButton((button) => {
                                button
                                    .setCta()
                                    .setButtonText('Follow me on X')
                                    .onClick(() => {
                                        window.open('https://x.com/dSebastien')
                                    })
                            })
                        }
                    },
                    {
                        name: 'Support',
                        // Not a setting — keep it out of the settings search.
                        searchable: false,
                        render: (setting): void => {
                            // Render INSIDE the row (settingEl), never into
                            // group.listEl — see the class docs above.
                            setting.infoEl.remove() // the section draws its own headings
                            // `.setting-item` is a flex ROW; the support block
                            // is a stack of full-width rows.
                            setting.settingEl.addClass('settings-stack')
                            renderSupportSection(setting.settingEl, (el) => {
                                this.renderBuyMeACoffeeBadge(el)
                            })
                        }
                    }
                ]
            }
        ]
    }

    /**
     * Reads the value behind a control `key`. Returning undefined/null makes
     * the framework fall back to the control's declared `defaultValue`.
     */
    override getControlValue(key: string): unknown {
        switch (key as ControlKey) {
            case 'useRmfakecloud':
                return this.plugin.settings.useRmfakecloud
            case 'rmfakecloudUrl':
                return this.plugin.settings.rmfakecloudUrl
            case 'autoSyncEnabled':
                return this.plugin.settings.autoSyncEnabled
            case 'autoSyncIntervalMinutes':
                return this.plugin.settings.autoSyncIntervalMinutes
            case 'targetFolder':
                return this.plugin.settings.targetFolder
            case 'saveImages':
                return this.plugin.settings.saveImages
            case 'imageFormat':
                return this.plugin.settings.imageFormat
            case 'imageQuality':
                return this.plugin.settings.imageQuality
            case 'savePdf':
                return this.plugin.settings.savePdf
            case 'saveHighlightsNote':
                return this.plugin.settings.saveHighlightsNote
            case 'saveTypedTextNote':
                return this.plugin.settings.saveTypedTextNote
            default:
                return undefined
        }
    }

    /**
     * Persists a control edit. Rejecting (not resolving) on failure is what
     * lets the framework roll the control back to the stored truth.
     *
     * Side effects run strictly AFTER the successful commit: the auto-sync
     * scheduler re-reads its settings, and visibility-changing writes
     * re-render the pane (the conditional rows read live state through
     * `visible:` hooks).
     */
    override async setControlValue(key: string, value: unknown): Promise<void> {
        switch (key as ControlKey) {
            case 'useRmfakecloud': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.useRmfakecloud = next
                })
                break
            }
            case 'rmfakecloudUrl': {
                if (typeof value !== 'string') {
                    throw new Error(`Setting "${key}" expects a string.`)
                }
                const trimmed = normalizeRmfakecloudUrlInput(value)
                if (trimmed !== '') {
                    const error = validateRmfakecloudUrl(trimmed)
                    if (error) {
                        throw new Error(error)
                    }
                }
                await this.plugin.updateSettings((draft) => {
                    draft.rmfakecloudUrl = trimmed
                })
                break
            }
            case 'autoSyncEnabled': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.autoSyncEnabled = next
                })
                break
            }
            case 'autoSyncIntervalMinutes': {
                const next = this.expectNumber(
                    key,
                    value,
                    MIN_AUTO_SYNC_INTERVAL_MINUTES,
                    MAX_AUTO_SYNC_INTERVAL_MINUTES
                )
                await this.plugin.updateSettings((draft) => {
                    draft.autoSyncIntervalMinutes = next
                })
                break
            }
            case 'targetFolder': {
                if (typeof value !== 'string') {
                    throw new Error(`Setting "${key}" expects a string.`)
                }
                const trimmed = value.trim()
                await this.plugin.updateSettings((draft) => {
                    draft.targetFolder = trimmed
                })
                break
            }
            case 'saveImages': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.saveImages = next
                })
                break
            }
            case 'imageFormat': {
                if (
                    typeof value !== 'string' ||
                    !IMAGE_FORMATS.includes(value as (typeof IMAGE_FORMATS)[number])
                ) {
                    throw new Error(`Setting "${key}" expects one of the declared options.`)
                }
                const next = value as (typeof IMAGE_FORMATS)[number]
                await this.plugin.updateSettings((draft) => {
                    draft.imageFormat = next
                })
                break
            }
            case 'imageQuality': {
                const next = this.expectNumber(key, value, 0.1, 1)
                await this.plugin.updateSettings((draft) => {
                    draft.imageQuality = next
                })
                break
            }
            case 'savePdf': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.savePdf = next
                })
                break
            }
            case 'saveHighlightsNote': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.saveHighlightsNote = next
                })
                break
            }
            case 'saveTypedTextNote': {
                const next = this.expectBoolean(key, value)
                await this.plugin.updateSettings((draft) => {
                    draft.saveTypedTextNote = next
                })
                break
            }
            default:
                new Notice('Failed to save settings.')
                throw new Error(`Setting "${key}" does not address a known field.`)
        }
        if (AUTO_SYNC_KEYS.has(key)) {
            this.plugin.autoSyncService.applySettings()
        }
        if (VISIBILITY_KEYS.has(key)) {
            this.update()
        }
    }

    private expectBoolean(key: string, value: unknown): boolean {
        if (typeof value !== 'boolean') {
            throw new Error(`Setting "${key}" expects a boolean.`)
        }
        return value
    }

    /**
     * The slider constrains what the UI can produce, but `setControlValue` is
     * a public write surface: an unconstrained value (`Infinity` serializes
     * as `null` and can poison the next settings load) must never reach the
     * store. Fractional values are allowed — the image-quality slider steps
     * in twentieths.
     */
    private expectNumber(key: string, value: unknown, min: number, max: number): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`Setting "${key}" expects a number.`)
        }
        if (value < min || value > max) {
            throw new Error(`Setting "${key}" expects a value between ${min} and ${max}.`)
        }
        return value
    }

    private renderBuyMeACoffeeBadge(contentEl: HTMLElement): void {
        const badgeContainer = contentEl.createDiv()
        const linkEl = badgeContainer.createEl('a', {
            href: BUY_ME_A_COFFEE_URL
        })
        const imgEl = linkEl.createEl('img')
        imgEl.src = BUY_ME_A_COFFEE_BADGE_DATA_URL
        imgEl.alt = 'Buy me a coffee'
        imgEl.width = 175
    }
}
