import { Notice } from 'obsidian'
import type { RemarkableSyncPlugin } from '../plugin'
import type { PluginSettings } from '../types/plugin-settings.intf'
import { notebookNeedsSync } from '../domain/sync-state'
import { notebooksInFolder, newestNotebook, favoriteNotebooks } from '../domain/notebook'
import { log } from '../../utils/log'
import { routeIdlePages } from './route-idle-pages'

export interface SyncAllResult {
    total: number
    synced: number
    skipped: number
    failed: number
}

export interface SyncAllOptions {
    /** Suppress this routine's own start/no-op notices (for unattended runs). */
    silent?: boolean
    /** What kicked off this run — shown in the in-app sync log. */
    trigger?: 'startup' | 'interval' | 'manual'
    /**
     * Restrict to notebooks within this cloud folder (recursive). Empty/undefined
     * = all folders. Used to scope auto-sync to e.g. `/2026`.
     */
    folder?: string
    /**
     * Sync only the single most-recently-modified notebook in scope (after the
     * folder filter). Still skipped if unchanged.
     */
    newestOnly?: boolean
    /**
     * Sync only notebooks starred ("favorited") on the device. Ignores `folder`
     * and `newestOnly` — a star is explicit intent wherever the notebook lives.
     */
    favoritesOnly?: boolean
}

/**
 * The scope options auto-sync (and the manual scoped-sync command) should pass
 * to `syncAllNotebooks` for the configured `autoSyncMode`.
 */
export function autoSyncScopeOptions(
    settings: PluginSettings
): Pick<SyncAllOptions, 'folder' | 'newestOnly' | 'favoritesOnly'> {
    if (settings.autoSyncMode === 'favorites') {
        return { favoritesOnly: true }
    }
    return { folder: settings.sourceFolder, newestOnly: true }
}

/**
 * Sync notebooks from the reMarkable cloud, reusing the existing per-notebook
 * pipeline. Optionally scoped to a `folder` and/or to the single `newestOnly`
 * notebook, or to device-starred notebooks via `favoritesOnly`. Unchanged
 * notebooks (cloud mtime not advanced past the last sync) are skipped so we do
 * not re-render anything that has not changed.
 *
 * Fail-soft: a single bad notebook (download/parse/render error) is logged and
 * counted, never thrown — one failure must not abort the run, crash Obsidian, or
 * wedge the periodic loop. Pass `silent: true` for unattended (startup/interval)
 * runs to suppress the routine's own start/no-op notices; per-notebook notices
 * from the pipeline and the final summary on activity/failure still surface.
 */
export async function syncAllNotebooks(
    plugin: RemarkableSyncPlugin,
    options: SyncAllOptions = {}
): Promise<SyncAllResult> {
    const result: SyncAllResult = { total: 0, synced: 0, skipped: 0, failed: 0 }
    const silent = options.silent === true

    if (!plugin.isConnected) {
        if (!silent) {
            new Notice('Not connected to reMarkable cloud')
        }
        return result
    }

    // Prevent overlapping runs (startup + interval, manual + interval, or a slow
    // run still going when the next tick fires).
    if (plugin.isSyncing) {
        log('Sync all skipped: a sync is already running', 'debug')
        if (!silent) {
            new Notice('A reMarkable sync is already in progress')
        }
        return result
    }
    plugin.isSyncing = true

    const trigger = options.trigger ?? 'manual'
    const scope = options.favoritesOnly
        ? ' (favorites)'
        : options.newestOnly
          ? ` (newest in ${options.folder || 'all folders'})`
          : options.folder
            ? ` (${options.folder})`
            : ''
    plugin.syncLogService.emit('info', `Sync started — ${trigger}${scope}`)

    try {
        let notebooks
        try {
            notebooks = await plugin.cloudService.listDocuments()
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error'
            log('Sync all: failed to list notebooks', 'error', error)
            plugin.syncLogService.emit('error', `Failed to fetch notebook list: ${reason}`)
            if (!silent) {
                new Notice('Failed to fetch notebook list')
            }
            return result
        }

        if (notebooks.length === 0) {
            if (!silent) {
                new Notice('No notebooks found')
            }
            return result
        }

        // Scope: favorites = every starred notebook, any folder. Otherwise
        // restrict to the source folder, then optionally to the single
        // newest-modified notebook. This is what keeps auto-sync from touching
        // other folders (e.g. /Books) or re-rendering everything.
        let candidates: typeof notebooks
        if (options.favoritesOnly) {
            candidates = favoriteNotebooks(notebooks)
        } else {
            candidates =
                options.folder !== undefined
                    ? notebooksInFolder(notebooks, options.folder)
                    : notebooks
            if (options.newestOnly) {
                const newest = newestNotebook(candidates)
                candidates = newest ? [newest] : []
            }
        }

        result.total = candidates.length
        if (candidates.length === 0) {
            // Zero in scope (e.g. nothing starred) is a quiet no-op on silent runs.
            if (!silent) {
                if (options.favoritesOnly) {
                    new Notice('No favorited notebooks to sync')
                } else {
                    const where = options.folder ? ` in "${options.folder}"` : ''
                    new Notice(`No notebooks to sync${where}`)
                }
            }
            return result
        }

        if (!silent) {
            const label = options.favoritesOnly
                ? `Syncing ${candidates.length} favorited notebook(s)...`
                : options.newestOnly
                  ? `Syncing newest notebook (${candidates[0]!.visibleName})...`
                  : `Syncing ${candidates.length} notebooks...`
            new Notice(label)
        }

        for (const notebook of candidates) {
            const state = plugin.syncStoreService.getState(notebook.id)
            if (!notebookNeedsSync(notebook.lastModified, state)) {
                result.skipped++
                continue
            }

            try {
                const ok = await plugin.pipelineService.processNotebook(notebook, (progress) => {
                    if (progress.status === 'error') {
                        log(
                            `Sync all: ${notebook.visibleName} reported ${progress.error ?? 'an error'}`,
                            'debug'
                        )
                    }
                })
                if (ok) {
                    result.synced++
                } else {
                    result.failed++
                }
            } catch (error) {
                // Fail-soft: keep going through the rest of the notebooks.
                result.failed++
                log(`Sync all: error syncing ${notebook.visibleName}`, 'error', error)
            }
        }

        const summary = `reMarkable sync: ${result.synced} synced, ${result.skipped} unchanged, ${result.failed} failed`
        log(summary, 'info', result)
        plugin.syncLogService.emit(result.failed > 0 ? 'error' : 'success', summary)
        // Always surface a summary on a manual run; for unattended runs, surface
        // only when something actually happened (synced or failed) so a quiet
        // "nothing changed" tick stays quiet.
        if (!silent || result.synced > 0 || result.failed > 0) {
            new Notice(summary)
        }
        return result
    } finally {
        plugin.isSyncing = false
        // GP-125: after every sync-all pass (regardless of whether anything in
        // scope needed syncing — an idle-but-unrouted page is exactly the case
        // where nothing needed syncing), file any now-idle OCR'd pages to PA
        // triage. Fail-soft: never let a triage-routing bug wedge the sync loop
        // or shadow the sync result above.
        try {
            const routing = await routeIdlePages(plugin)
            if (routing.routed > 0 || routing.failed > 0) {
                log('Triage routing pass complete', 'info', routing)
            }
        } catch (error) {
            log('Triage routing pass failed', 'error', error)
        }
    }
}
