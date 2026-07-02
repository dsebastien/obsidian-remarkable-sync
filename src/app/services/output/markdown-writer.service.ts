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
 * Build the vault path for a notebook's assembled OCR markdown note:
 * `<targetFolder>/<notebookName>.md` (targetFolder optional).
 */
export function buildNotebookMarkdownPath(targetFolder: string, notebookName: string): string {
    const parts: string[] = []
    if (targetFolder) {
        parts.push(targetFolder)
    }
    parts.push(`${notebookName}.md`)
    return parts.join('/')
}

/**
 * Ensure the parent folder of `filePath` exists, creating it if needed. A no-op
 * for vault-root files. Tolerates a concurrent create (the folder appearing
 * between the check and the call).
 */
async function ensureParentFolder(vault: Vault, filePath: string): Promise<void> {
    const folderParts = filePath.split('/')
    folderParts.pop()
    const folderFullPath = folderParts.join('/')
    if (!folderFullPath) {
        return
    }
    try {
        if (!vault.getAbstractFileByPath(folderFullPath)) {
            await vault.createFolder(folderFullPath)
        }
    } catch {
        // Folder might already exist (race with a concurrent write).
    }
}

/**
 * Whether a file already exists in the vault at `filePath`.
 */
export function vaultFileExists(vault: Vault, filePath: string): boolean {
    return vault.getFileByPath(filePath) !== null
}

/**
 * Read an existing notebook markdown note, or return '' if it does not exist.
 */
export async function readNotebookMarkdown(vault: Vault, filePath: string): Promise<string> {
    const existing = vault.getAbstractFileByPath(filePath)
    if (existing instanceof TFile) {
        return vault.read(existing)
    }
    return ''
}

/**
 * Write (create or overwrite) a notebook's assembled markdown note, creating the
 * parent folder if needed.
 */
export async function writeNotebookMarkdown(
    vault: Vault,
    filePath: string,
    content: string
): Promise<void> {
    await ensureParentFolder(vault, filePath)

    const existing = vault.getAbstractFileByPath(filePath)
    if (existing instanceof TFile) {
        await vault.modify(existing, content)
    } else {
        await vault.create(filePath, content)
    }
    log(`Wrote notebook markdown: ${filePath}`, 'debug')
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

    await ensureParentFolder(vault, filePath)

    // Write binary data
    const existingFile = vault.getAbstractFileByPath(filePath)
    if (existingFile instanceof TFile) {
        await vault.modifyBinary(existingFile, imageData)
    } else {
        await vault.createBinary(filePath, imageData)
    }

    log(`Wrote image: ${filePath}`, 'debug')
    return filePath
}
