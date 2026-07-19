import { test, expect, describe, afterEach } from 'bun:test'
import { produce } from 'immer'
import type { Draft } from 'immer'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TFile } from 'obsidian'
import type { Vault } from 'obsidian'
import { routeIdlePages } from './route-idle-pages'
import { DEFAULT_SETTINGS } from '../types/plugin-settings.intf'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { createSyncLogService } from '../services/log/sync-log.service'
import { renderBlock, computeOcrHash } from '../domain/ocr-markdown'
import type { RemarkableSyncPlugin } from '../plugin'

const HOUR = 60 * 60 * 1000
const NOW = 1_000_000_000_000

const tmpDirs: string[] = []
function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'route-idle-pages-spec-'))
    tmpDirs.push(dir)
    return dir
}
afterEach(() => {
    while (tmpDirs.length > 0) {
        rmSync(tmpDirs.pop()!, { recursive: true, force: true })
    }
})

/** Minimal in-memory vault stub: one markdown file, no real Obsidian runtime. */
function stubVault(files: Record<string, string>): Vault {
    return {
        getAbstractFileByPath: (path: string) => {
            if (!(path in files)) {
                return null
            }
            const file = new TFile()
            ;(file as unknown as { path: string }).path = path
            return file
        },
        read: (file: TFile) => Promise.resolve(files[file.path] ?? '')
    } as unknown as Vault
}

/** Builds a stub RemarkableSyncPlugin exposing only what routeIdlePages touches. */
function stubPlugin(opts: {
    settings: PluginSettings
    files: Record<string, string>
}): RemarkableSyncPlugin {
    const state = { settings: opts.settings }
    const plugin = {
        app: { vault: stubVault(opts.files) },
        get settings() {
            return state.settings
        },
        syncLogService: createSyncLogService(() => NOW),
        updateSettings: (recipe: (draft: Draft<PluginSettings>) => void) => {
            state.settings = produce(state.settings, recipe)
            return Promise.resolve()
        }
    } as unknown as RemarkableSyncPlugin

    // syncStoreService mirrors the real create*Service but bound to this stub's
    // updateSettings/settings, so markPageRouted round-trips through the same
    // settings object the test asserts against afterwards.
    plugin.syncStoreService = {
        getStore: () => plugin.settings.syncStore,
        getState: (id: string) => plugin.settings.syncStore.notebooks[id],
        updateState: () => Promise.resolve(),
        markPageRouted: async (
            remarkableId: string,
            pageId: string,
            srcHash: string,
            routedAt: number
        ) => {
            await plugin.updateSettings((draft) => {
                const page = draft.syncStore.notebooks[remarkableId]?.pages?.[pageId]
                if (page) {
                    page.routedSrcHash = srcHash
                    page.routedAt = routedAt
                }
            })
        },
        clearAll: () => Promise.resolve()
    }

    return plugin
}

describe('routeIdlePages', () => {
    test('routes an idle OCRd page: writes one triage file and marks it routed', async () => {
        const queueDir = join(makeTmpDir(), 'triage-queue')
        const md = 'Buy oat milk\n- [ ] call the vet'
        const block = renderBlock({
            pageId: 'p1',
            pageIndex: 0,
            label: 'Page 1',
            markdown: md,
            srcHash: 'srcA',
            ocrHash: computeOcrHash(md)
        })

        const settings: PluginSettings = {
            ...DEFAULT_SETTINGS,
            targetFolder: '',
            triageEnabled: true,
            triageIdleMinutes: 60,
            triageQueueDir: queueDir,
            triageChatId: -5188649683,
            syncStore: {
                notebooks: {
                    'nb-1': {
                        remarkableId: 'nb-1',
                        lastSyncedAt: NOW - HOUR,
                        lastModifiedCloud: NOW - 2 * HOUR,
                        syncedPageCount: 1,
                        visibleName: 'Groceries',
                        folderPath: '',
                        pages: {
                            p1: {
                                pageId: 'p1',
                                srcHash: 'srcA',
                                ocrHash: computeOcrHash(md),
                                pageIndex: 0
                            }
                        }
                    }
                }
            }
        }

        const plugin = stubPlugin({ settings, files: { 'Groceries.md': block } })

        // Freeze "now" for the routing pass itself.
        const realNow = Date.now
        Date.now = () => NOW
        try {
            const result = await routeIdlePages(plugin)
            expect(result).toEqual({ candidates: 1, routed: 1, failed: 0 })
        } finally {
            Date.now = realNow
        }

        const files = readdirSync(queueDir).filter((f) => f.endsWith('.json'))
        expect(files).toHaveLength(1)
        const payload = JSON.parse(readFileSync(join(queueDir, files[0]!), 'utf-8'))
        expect(payload.chat_id).toBe(-5188649683)
        expect(payload.source).toBe('remarkable-page')
        expect(payload.note_id).toBe('remarkable:nb-1:p1:srcA')
        expect(payload.text).toContain('Buy oat milk')
        expect(payload.text).toContain('call the vet')
        expect(payload.text).toContain('source_notebook: Groceries')

        expect(plugin.settings.syncStore.notebooks['nb-1']!.pages!['p1']!.routedSrcHash).toBe(
            'srcA'
        )
    })

    test('a second pass with unchanged content routes nothing (dedup persists)', async () => {
        const queueDir = join(makeTmpDir(), 'triage-queue')
        const md = 'hello'
        const block = renderBlock({
            pageId: 'p1',
            pageIndex: 0,
            label: 'Page 1',
            markdown: md,
            srcHash: 'srcA',
            ocrHash: computeOcrHash(md)
        })
        const settings: PluginSettings = {
            ...DEFAULT_SETTINGS,
            targetFolder: '',
            triageEnabled: true,
            triageIdleMinutes: 60,
            triageQueueDir: queueDir,
            syncStore: {
                notebooks: {
                    'nb-1': {
                        remarkableId: 'nb-1',
                        lastSyncedAt: NOW - HOUR,
                        lastModifiedCloud: NOW - 2 * HOUR,
                        syncedPageCount: 1,
                        visibleName: 'Notes',
                        folderPath: '',
                        pages: {
                            p1: {
                                pageId: 'p1',
                                srcHash: 'srcA',
                                ocrHash: computeOcrHash(md),
                                pageIndex: 0,
                                routedSrcHash: 'srcA',
                                routedAt: NOW - HOUR
                            }
                        }
                    }
                }
            }
        }
        const plugin = stubPlugin({ settings, files: { 'Notes.md': block } })
        const realNow = Date.now
        Date.now = () => NOW
        try {
            const result = await routeIdlePages(plugin)
            expect(result).toEqual({ candidates: 0, routed: 0, failed: 0 })
        } finally {
            Date.now = realNow
        }
        // Nothing routed → the queue dir is never even created.
        expect(existsSync(queueDir)).toBe(false)
    })

    test('fail-soft: page listed in the sync store but missing from the note body is skipped, not marked routed', async () => {
        const queueDir = join(makeTmpDir(), 'triage-queue')
        const settings: PluginSettings = {
            ...DEFAULT_SETTINGS,
            targetFolder: '',
            triageEnabled: true,
            triageIdleMinutes: 60,
            triageQueueDir: queueDir,
            syncStore: {
                notebooks: {
                    'nb-1': {
                        remarkableId: 'nb-1',
                        lastSyncedAt: NOW - HOUR,
                        lastModifiedCloud: NOW - 2 * HOUR,
                        syncedPageCount: 1,
                        visibleName: 'Orphan',
                        folderPath: '',
                        pages: {
                            p1: { pageId: 'p1', srcHash: 'srcA', ocrHash: 'ocrA', pageIndex: 0 }
                        }
                    }
                }
            }
        }
        // Note file has no managed block at all (e.g. write race / not yet flushed).
        const plugin = stubPlugin({ settings, files: { 'Orphan.md': '' } })
        const result = await routeIdlePages(plugin)
        expect(result).toEqual({ candidates: 1, routed: 0, failed: 1 })
        expect(
            plugin.settings.syncStore.notebooks['nb-1']!.pages!['p1']!.routedSrcHash
        ).toBeUndefined()
    })

    test('triageEnabled=false is a no-op', async () => {
        const settings: PluginSettings = {
            ...DEFAULT_SETTINGS,
            triageEnabled: false,
            syncStore: {
                notebooks: {
                    'nb-1': {
                        remarkableId: 'nb-1',
                        lastSyncedAt: NOW - HOUR,
                        lastModifiedCloud: NOW - 2 * HOUR,
                        syncedPageCount: 1,
                        pages: {
                            p1: { pageId: 'p1', srcHash: 'srcA', ocrHash: 'ocrA', pageIndex: 0 }
                        }
                    }
                }
            }
        }
        const plugin = stubPlugin({ settings, files: {} })
        const result = await routeIdlePages(plugin)
        expect(result).toEqual({ candidates: 0, routed: 0, failed: 0 })
    })
})
