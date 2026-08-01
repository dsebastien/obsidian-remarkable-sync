import { TFile } from 'obsidian'
import type { Vault } from 'obsidian'
import { log } from '../../../utils/log'

/**
 * Build the full vault path for a page file
 */
export function buildPagePath(
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    pageIndex: number,
    extension: string
): string {
    const pageNum = String(pageIndex + 1).padStart(3, '0')
    const fileName = `${notebookName}-P${pageNum}.${extension}`

    const parts: string[] = []
    if (targetFolder) {
        parts.push(targetFolder)
    }
    if (folderPath) {
        parts.push(folderPath)
    }
    parts.push(notebookName)
    parts.push(fileName)

    return parts.join('/')
}

/**
 * Build the full vault path for a whole-document file (a PDF).
 *
 * Deliberately NOT nested inside the per-notebook folder that `buildPagePath`
 * uses: the document sits beside that folder, so images and a PDF can both be
 * produced for the same notebook without colliding.
 */
export function buildDocumentPath(
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    extension: string
): string {
    const parts: string[] = []
    if (targetFolder) {
        parts.push(targetFolder)
    }
    if (folderPath) {
        parts.push(folderPath)
    }
    parts.push(`${notebookName}.${extension}`)

    return parts.join('/')
}

/**
 * Whether two buffers hold identical bytes.
 */
export function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
    if (a.byteLength !== b.byteLength) {
        return false
    }

    const viewA = new Uint8Array(a)
    const viewB = new Uint8Array(b)

    for (let i = 0; i < viewA.length; i++) {
        if (viewA[i] !== viewB[i]) {
            return false
        }
    }

    return true
}

/**
 * Create the parent folder of a vault path if it does not exist yet.
 */
async function ensureParentFolder(vault: Vault, filePath: string): Promise<void> {
    const folderParts = filePath.split('/')
    folderParts.pop()
    const folderFullPath = folderParts.join('/')

    if (!folderFullPath) {
        return
    }

    try {
        const folder = vault.getAbstractFileByPath(folderFullPath)
        if (!folder) {
            await vault.createFolder(folderFullPath)
        }
    } catch {
        // Folder might already exist
    }
}

/**
 * Write binary data to the vault, skipping the write entirely when the file
 * already holds exactly these bytes.
 *
 * The skip matters because generated output is deterministic: a device can bump
 * a notebook's `lastModified` for benign reasons (opening it is enough), which
 * re-runs the pipeline over unchanged content. An unconditional `modifyBinary`
 * would bump the file's mtime every time and make Obsidian Sync, Git or Dropbox
 * treat it as a change. With automatic sync enabled that repeats on a timer.
 *
 * @returns true when the file was created or modified, false when it was
 *          already identical and the write was skipped.
 */
export async function writeBinaryIfChanged(
    vault: Vault,
    filePath: string,
    data: ArrayBuffer
): Promise<boolean> {
    const existingFile = vault.getAbstractFileByPath(filePath)

    if (existingFile instanceof TFile) {
        try {
            const current = await vault.readBinary(existingFile)
            if (buffersEqual(current, data)) {
                log(`Unchanged, skipping write: ${filePath}`, 'debug')
                return false
            }
        } catch (error) {
            // Unreadable existing file: fall through and overwrite it.
            log(`Could not read ${filePath} for comparison, overwriting`, 'debug', error)
        }

        await vault.modifyBinary(existingFile, data)
        return true
    }

    await ensureParentFolder(vault, filePath)
    await vault.createBinary(filePath, data)
    return true
}

/**
 * Write a page image to the vault
 */
export async function writePageImage(
    vault: Vault,
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    pageIndex: number,
    imageData: ArrayBuffer,
    format: 'png' | 'jpeg' | 'webp'
): Promise<string> {
    const filePath = buildPagePath(targetFolder, folderPath, notebookName, pageIndex, format)

    const written = await writeBinaryIfChanged(vault, filePath, imageData)
    if (written) {
        log(`Wrote image: ${filePath}`, 'debug')
    }

    return filePath
}

/**
 * Suffix distinguishing the annotated copy from the source document.
 *
 * The source is written through unmodified under the plain name, so the two
 * never collide and the original is always recoverable.
 */
export const ANNOTATED_SUFFIX = ' (annotated)'

/**
 * Write a whole-notebook PDF to the vault
 */
export async function writeDocumentPdf(
    vault: Vault,
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    pdfData: ArrayBuffer
): Promise<string> {
    const filePath = buildDocumentPath(targetFolder, folderPath, notebookName, 'pdf')

    const written = await writeBinaryIfChanged(vault, filePath, pdfData)
    if (written) {
        log(`Wrote PDF: ${filePath}`, 'debug')
    }

    return filePath
}
