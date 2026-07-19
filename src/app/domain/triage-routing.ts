import type { SyncStore } from './sync-state'

/** Default idle threshold for PA triage routing (GP-125): 1 hour. */
export const DEFAULT_TRIAGE_IDLE_MINUTES = 60

/** One page selected for PA triage routing this pass. */
export interface TriageRouteCandidate {
    readonly notebookId: string
    readonly notebookName: string
    readonly folderPath: string
    readonly pageId: string
    readonly pageIndex: number
    /** Content hash of the page version being routed — the dedup key. */
    readonly srcHash: string
}

/**
 * Select pages eligible for PA triage routing (GP-125): "route new pages that
 * have no live activity in last 1h to the pa agent just like voice notes."
 *
 * A page is eligible when ALL of:
 * - it has been OCR'd (`ocrHash` non-empty — an entry with `''` was written
 *   by a non-OCR sync and has no transcript to route),
 * - its notebook has been synced at least once,
 * - its notebook's persisted `lastModifiedCloud` is >= `idleMs` old. This is
 *   the cloud-stamped "last activity" timestamp, so it is accurate for a
 *   backlog notebook too (edited weeks ago, OCR'd for the first time today —
 *   it is immediately idle, not "idle starting from today"). Per the
 *   pipeline's own invariant, this value is held back to its prior value
 *   until every OCR-enabled page in the notebook succeeds, so an
 *   in-progress/partially-failed OCR run is never mistaken for "finished
 *   and idle",
 * - it has not already been routed for this exact content version
 *   (`routedSrcHash !== srcHash` — dedup by page id + content hash; survives
 *   restarts because it is persisted in the sync store). A later edit to a
 *   routed page advances `srcHash`, making it eligible again.
 *
 * Pure: no I/O, no mutation, deterministic given `now`.
 */
export function selectPagesToRoute(
    store: SyncStore,
    now: number,
    idleMs: number
): TriageRouteCandidate[] {
    const out: TriageRouteCandidate[] = []

    for (const notebook of Object.values(store.notebooks)) {
        if (notebook.lastSyncedAt === 0 || !notebook.pages) {
            continue
        }
        if (now - notebook.lastModifiedCloud < idleMs) {
            continue // still active (or synced too recently to tell)
        }

        for (const page of Object.values(notebook.pages)) {
            if (!page.ocrHash) {
                continue // never OCR'd — nothing to route
            }
            if (page.routedSrcHash === page.srcHash) {
                continue // this exact content already filed
            }
            out.push({
                notebookId: notebook.remarkableId,
                notebookName: notebook.visibleName ?? notebook.remarkableId,
                folderPath: notebook.folderPath ?? '',
                pageId: page.pageId,
                pageIndex: page.pageIndex ?? 0,
                srcHash: page.srcHash
            })
        }
    }

    return out
}
