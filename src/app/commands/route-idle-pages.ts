import type { RemarkableSyncPlugin } from '../plugin'
import { selectPagesToRoute } from '../domain/triage-routing'
import type { TriageRouteCandidate } from '../domain/triage-routing'
import { buildTriagePayload } from '../domain/triage-payload'
import { parseManagedBlocks } from '../domain/ocr-markdown'
import {
    buildNotebookMarkdownPath,
    buildPagePath,
    readNotebookMarkdown
} from '../services/output/markdown-writer.service'
import { writeTriageRequest } from '../services/triage/triage-queue.service'
import { log } from '../../utils/log'

export interface RouteIdlePagesResult {
    readonly candidates: number
    readonly routed: number
    readonly failed: number
}

/**
 * GP-125: file every idle, OCR'd page (per `selectPagesToRoute`) into the
 * same PA triage-queue intake voice notes use. Groups candidates by notebook
 * so each notebook's assembled markdown note is read at most once.
 *
 * Fail-soft per page: a read/write failure is logged and the page is left
 * un-routed (`routedSrcHash` untouched) so it is retried on the next sync
 * cycle — never marked routed without a confirmed queue-file write, and never
 * thrown into the caller's sync loop.
 */
export async function routeIdlePages(plugin: RemarkableSyncPlugin): Promise<RouteIdlePagesResult> {
    const result: RouteIdlePagesResult = { candidates: 0, routed: 0, failed: 0 }
    if (!plugin.settings.triageEnabled) {
        return result
    }

    const idleMs = Math.max(1, plugin.settings.triageIdleMinutes) * 60_000
    const candidates = selectPagesToRoute(plugin.syncStoreService.getStore(), Date.now(), idleMs)
    if (candidates.length === 0) {
        return result
    }

    const byNotebook = new Map<string, TriageRouteCandidate[]>()
    for (const c of candidates) {
        const list = byNotebook.get(c.notebookId) ?? []
        list.push(c)
        byNotebook.set(c.notebookId, list)
    }

    let routed = 0
    let failed = 0

    for (const [, pages] of byNotebook) {
        const first = pages[0]!
        const mdPath = buildNotebookMarkdownPath(plugin.settings.targetFolder, first.notebookName)

        let content: string
        try {
            content = await readNotebookMarkdown(plugin.app.vault, mdPath)
        } catch (error) {
            log(`Triage routing: failed to read ${mdPath}`, 'error', error)
            failed += pages.length
            continue
        }

        const blockByPageId = new Map(parseManagedBlocks(content).map((b) => [b.pageId, b]))

        for (const candidate of pages) {
            const block = blockByPageId.get(candidate.pageId)
            if (!block || block.srcHash !== candidate.srcHash) {
                // Note not yet written for this exact version, or hash drifted
                // since the sync-store snapshot was taken — retry next cycle.
                failed++
                continue
            }

            try {
                const pagePath = buildPagePath(
                    plugin.settings.targetFolder,
                    candidate.folderPath,
                    candidate.notebookName,
                    candidate.pageIndex,
                    plugin.settings.imageFormat
                )
                const payload = buildTriagePayload({
                    candidate,
                    ocrMarkdown: block.body,
                    pageReference: pagePath,
                    chatId: plugin.settings.triageChatId,
                    source: 'remarkable-page'
                })
                writeTriageRequest(plugin.settings.triageQueueDir, payload)
                await plugin.syncStoreService.markPageRouted(
                    candidate.notebookId,
                    candidate.pageId,
                    candidate.srcHash,
                    Date.now()
                )
                routed++
                plugin.syncLogService.emit(
                    'success',
                    `${candidate.notebookName} p${candidate.pageIndex + 1}: routed to PA triage (idle)`
                )
            } catch (error) {
                log(
                    `Triage routing: failed to route ${candidate.notebookName} p${candidate.pageIndex + 1}`,
                    'error',
                    error
                )
                plugin.syncLogService.emit(
                    'error',
                    `${candidate.notebookName} p${candidate.pageIndex + 1}: triage routing failed — will retry`
                )
                failed++
            }
        }
    }

    return { candidates: candidates.length, routed, failed }
}
