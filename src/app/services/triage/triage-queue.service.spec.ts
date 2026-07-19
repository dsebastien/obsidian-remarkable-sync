import { test, expect, describe, afterEach } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultTriageQueueDir, writeTriageRequest } from './triage-queue.service'
import type { TriageQueuePayload } from '../../domain/triage-payload'

const tmpDirs: string[] = []
function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'triage-queue-spec-'))
    tmpDirs.push(dir)
    return dir
}

afterEach(() => {
    while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop()!
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('defaultTriageQueueDir', () => {
    test('resolves under the home vault triage-queue path', () => {
        expect(defaultTriageQueueDir()).toMatch(/Vaults\/personal\/triage-queue$/)
    })
})

describe('writeTriageRequest', () => {
    test('writes a single valid JSON file matching the md_capture shape, no leftover .tmp', () => {
        const dir = makeTmpDir()
        const queueDir = join(dir, 'triage-queue') // does not exist yet — must be created
        const payload: TriageQueuePayload = {
            chat_id: -5188649683,
            text: 'Triage this handwritten reMarkable page and route it into the vault.\nsource_notebook: 2026/Ideas\npage: 1\nTranscript:\nhello',
            source: 'remarkable-page',
            note_id: 'remarkable:nb-1:p1:deadbeef'
        }

        const finalPath = writeTriageRequest(queueDir, payload)

        expect(existsSync(finalPath)).toBe(true)
        const entries = readdirSync(queueDir)
        const tmpFiles = entries.filter((e) => e.endsWith('.tmp'))
        const jsonFiles = entries.filter((e) => e.endsWith('.json'))
        expect(tmpFiles).toHaveLength(0)
        expect(jsonFiles).toHaveLength(1)

        const written = JSON.parse(readFileSync(finalPath, 'utf-8')) as TriageQueuePayload
        expect(written).toEqual(payload)
    })

    test('two writes produce two distinct files (unique names, no overwrite)', () => {
        const dir = makeTmpDir()
        const payload: TriageQueuePayload = {
            chat_id: 1,
            text: 'a',
            source: 'remarkable-page',
            note_id: 'x'
        }
        const p1 = writeTriageRequest(dir, payload)
        const p2 = writeTriageRequest(dir, payload)
        expect(p1).not.toBe(p2)
        expect(readdirSync(dir).filter((e) => e.endsWith('.json'))).toHaveLength(2)
    })
})
