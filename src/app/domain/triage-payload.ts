import type { TriageRouteCandidate } from './triage-routing'

/** Matches md_capture's V2 triage-queue file shape (`routeViaTriage` in main.go). */
export interface TriageQueuePayload {
    chat_id: number
    text: string
    source: string
    note_id: string
}

export interface TriagePayloadInput {
    readonly candidate: TriageRouteCandidate
    /** The page's OCR'd markdown body (from the notebook note's managed block). */
    readonly ocrMarkdown: string
    /**
     * Vault-relative path to the page's saved image (or a full URL into the
     * `/remarkable` dashboard, if the caller resolves one) — provenance for
     * the triage agent to locate the source page.
     */
    readonly pageReference?: string
    readonly chatId: number
    readonly source: string
}

/**
 * `note_id` for a triaged reMarkable page: stable per (notebook, page), and
 * changes with the content hash so a re-edited page gets a fresh idempotency
 * key instead of colliding with — and being silently deduped against — its
 * earlier routed version by whatever downstream consumer keys on `note_id`.
 */
export function triageNoteId(candidate: TriageRouteCandidate): string {
    return `remarkable:${candidate.notebookId}:${candidate.pageId}:${candidate.srcHash.slice(0, 8)}`
}

/**
 * Build the triage-queue JSON payload for one idle reMarkable page, mirroring
 * `routeViaTriage`'s voice-note payload shape/wording so it flows through the
 * same PA intake unmodified.
 */
export function buildTriagePayload(input: TriagePayloadInput): TriageQueuePayload {
    const { candidate, ocrMarkdown, pageReference, chatId, source } = input
    const location = candidate.folderPath
        ? `${candidate.folderPath}/${candidate.notebookName}`
        : candidate.notebookName
    const lines = [
        'Triage this handwritten reMarkable page and route it into the vault.',
        `source_notebook: ${location}`,
        `page: ${candidate.pageIndex + 1}`
    ]
    if (pageReference) {
        lines.push(`page_image: ${pageReference}`)
    }
    lines.push(`Transcript:\n${ocrMarkdown}`)

    return {
        chat_id: chatId,
        text: lines.join('\n'),
        source,
        note_id: triageNoteId(candidate)
    }
}
