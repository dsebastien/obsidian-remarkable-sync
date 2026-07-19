import { test, expect, describe } from 'bun:test'
import { buildTriagePayload, triageNoteId } from './triage-payload'
import type { TriageRouteCandidate } from './triage-routing'

const candidate: TriageRouteCandidate = {
    notebookId: 'nb-abc123',
    notebookName: 'Project Ideas',
    folderPath: '2026/Work',
    pageId: 'page-9',
    pageIndex: 2,
    srcHash: 'deadbeef1234'
}

describe('triageNoteId', () => {
    test('stable per notebook+page+content, changes when content changes', () => {
        const id1 = triageNoteId(candidate)
        const id2 = triageNoteId({ ...candidate, srcHash: 'other-hash-000' })
        expect(id1).toBe('remarkable:nb-abc123:page-9:deadbeef')
        expect(id2).not.toBe(id1)
    })
})

describe('buildTriagePayload', () => {
    test('produces the md_capture triage-queue shape with provenance + transcript', () => {
        const payload = buildTriagePayload({
            candidate,
            ocrMarkdown: 'Buy stamps\n- [ ] mail the letter',
            pageReference: '2026/Work/Project Ideas/Project Ideas-P003.jpeg',
            chatId: -5188649683,
            source: 'remarkable-page'
        })

        expect(payload.chat_id).toBe(-5188649683)
        expect(payload.source).toBe('remarkable-page')
        expect(payload.note_id).toBe('remarkable:nb-abc123:page-9:deadbeef')
        expect(payload.text).toContain('source_notebook: 2026/Work/Project Ideas')
        expect(payload.text).toContain('page: 3') // 1-based
        expect(payload.text).toContain(
            'page_image: 2026/Work/Project Ideas/Project Ideas-P003.jpeg'
        )
        expect(payload.text).toContain('Buy stamps')
        expect(payload.text).toContain('mail the letter')
    })

    test('omits page_image line when no reference is given', () => {
        const payload = buildTriagePayload({
            candidate,
            ocrMarkdown: 'hello',
            chatId: 1,
            source: 'remarkable-page'
        })
        expect(payload.text).not.toContain('page_image:')
    })

    test('notebook at vault root omits the folder prefix', () => {
        const payload = buildTriagePayload({
            candidate: { ...candidate, folderPath: '' },
            ocrMarkdown: 'hello',
            chatId: 1,
            source: 'remarkable-page'
        })
        expect(payload.text).toContain('source_notebook: Project Ideas')
    })
})
