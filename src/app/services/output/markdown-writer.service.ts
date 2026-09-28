import { TFile, TFolder } from 'obsidian'
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
    parts.push(documentFileName(notebookName, extension))

    return parts.join('/')
}

/**
 * The file name a whole-document output (PDF, EPUB, markdown note) is written
 * under.
 *
 * The one definition of it: the highlights note derives its link to the
 * annotated PDF from this too. Composing the two independently is how a link
 * ends up pointing at a file that does not exist the moment either changes.
 */
export function documentFileName(notebookName: string, extension: string): string {
    return `${notebookName}.${extension}`
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
 *
 * Refuses, with the offending path in the message, when a FILE occupies the
 * parent folder or any of its ancestors. `createFolder` would otherwise throw
 * into the catch below, which exists to tolerate "folder already exists", and
 * the failure would re-emerge from `createBinary` with nothing to explain it.
 * Every ancestor is checked, not only the direct parent: for `a/b/c.pdf` with a
 * file at `a`, the lookup of `a/b` returns null and looks like a folder that
 * simply needs creating.
 */
async function ensureParentFolder(vault: Vault, filePath: string): Promise<void> {
    const folderParts = filePath.split('/')
    folderParts.pop()
    const folderFullPath = folderParts.join('/')

    if (!folderFullPath) {
        return
    }

    for (let i = 1; i <= folderParts.length; i++) {
        const ancestor = folderParts.slice(0, i).join('/')
        if (vault.getAbstractFileByPath(ancestor) instanceof TFile) {
            throw new Error(
                `Cannot write ${filePath}: a file already occupies the folder path ${ancestor}`
            )
        }
    }

    if (vault.getAbstractFileByPath(folderFullPath)) {
        return
    }

    try {
        await vault.createFolder(folderFullPath)
    } catch (error) {
        // Tolerated: the folder can exist on disk before the vault index knows
        // about it (a concurrent sync, or a case-only difference on a
        // case-insensitive filesystem). A file in the way was refused above;
        // anything else resurfaces from createBinary with its own message.
        log(`Could not create folder ${folderFullPath}, continuing`, 'debug', error)
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

    // Throwing rather than returning false: false means "unchanged, skipped"
    // to every caller, so returning it here would silently drop the user's
    // output. The throw surfaces through the pipeline's own catch as a Notice
    // that names the path. Recorded as a known defect on 2026-08-01.
    if (existingFile instanceof TFolder) {
        throw new Error(`Cannot write ${filePath}: a folder already occupies that path`)
    }

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
 * Write a markdown note to the vault, skipping the write when unchanged.
 */
export async function writeMarkdownNote(
    vault: Vault,
    targetFolder: string,
    folderPath: string,
    noteName: string,
    contents: string
): Promise<string> {
    const filePath = buildDocumentPath(targetFolder, folderPath, noteName, 'md')
    const data = new TextEncoder().encode(contents)
    const buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)

    const written = await writeBinaryIfChanged(vault, filePath, buffer)
    if (written) {
        log(`Wrote note: ${filePath}`, 'debug')
    }

    return filePath
}

/**
 * Write a whole-document binary file (a PDF, or a source EPUB written through
 * unchanged) to the vault.
 *
 * The extension follows the actual content. Writing a source EPUB's bytes
 * under a `.pdf` name produced a file no reader could open, so the extension
 * is a parameter rather than an assumption.
 */
export async function writeDocumentFile(
    vault: Vault,
    targetFolder: string,
    folderPath: string,
    notebookName: string,
    data: ArrayBuffer,
    extension: 'pdf' | 'epub'
): Promise<string> {
    const filePath = buildDocumentPath(targetFolder, folderPath, notebookName, extension)

    const written = await writeBinaryIfChanged(vault, filePath, data)
    if (written) {
        log(`Wrote document: ${filePath}`, 'debug')
    }

    return filePath
}

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
    return writeDocumentFile(vault, targetFolder, folderPath, notebookName, pdfData, 'pdf')
}
