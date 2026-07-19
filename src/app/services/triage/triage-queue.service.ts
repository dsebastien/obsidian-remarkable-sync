import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { log } from '../../../utils/log'
import type { TriageQueuePayload } from '../../domain/triage-payload'

/** Default triage-queue dir (matches md_capture's `TRIAGE_QUEUE_DIR`, host side). */
export function defaultTriageQueueDir(): string {
    return join(homedir(), 'Vaults', 'personal', 'triage-queue')
}

/**
 * Write one triage-queue request file. Mirrors md_capture's `routeViaTriage`
 * publish: write to a unique `.tmp` name, then rename into place, so the 5s
 * `process_triage_queue.sh` poller (which globs `*.json`) never reads a
 * half-written file and a crash mid-write never leaves a corrupt `.json`
 * behind for it to choke on.
 */
export function writeTriageRequest(queueDir: string, payload: TriageQueuePayload): string {
    mkdirSync(queueDir, { recursive: true })
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
    const tmpPath = join(queueDir, `${name}.tmp`)
    const finalPath = join(queueDir, name)
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8')
    renameSync(tmpPath, finalPath)
    log(`Triage request queued: ${name} (note_id=${payload.note_id})`, 'debug')
    return finalPath
}
