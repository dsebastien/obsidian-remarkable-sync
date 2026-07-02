import type { RemarkableSyncPlugin } from '../../plugin'
import { migrateBlocksImagePlaceholders } from '../../domain/ocr-markdown'
import type { CleanedBlock, PageImageResolver } from '../../domain/ocr-markdown'
import { normalizeFolder } from '../../domain/notebook'
import { log } from '../../../utils/log'

export interface CleanImagePlaceholdersResult {
    filesChanged: number
    blocksCleaned: number
}

/**
 * Bump when the rewrite output format changes so the one-time migration re-runs once
 * for existing users (compared against the stored `imgPlaceholderMigrationVersion`).
 * v1: img-N → real page-image embed. v2: embed positioned at the top of each block.
 */
export const IMG_PLACEHOLDER_MIGRATION_VERSION = 2

// Saved page images use the configured image format; jpg is accepted defensively.
const IMAGE_EXTS = ['jpeg', 'jpg', 'png', 'webp'] as const
const MANAGED_BLOCK_MARKER = '<!-- rm:page='

/** Human-readable summary of a migration/clean run, shared by the command + startup. */
export function describeCleanResult(result: CleanImagePlaceholdersResult): string {
    return result.blocksCleaned > 0
        ? `Fixed ${result.blocksCleaned} broken image ref(s) across ${result.filesChanged} note(s)`
        : 'No broken image refs found'
}

/**
 * One-time migration: rewrite the broken `img-N` placeholders in every assembled
 * notebook note under the target folder so each page's figure embeds that page's
 * real saved image instead. Reconciles the stored per-page `ocrHash` so the
 * anti-clobber guard does not later mistake the cleanup for a hand-edit. No re-OCR.
 *
 * Touches only the plugin's own generated notes (those containing managed
 * `<!-- rm:page= -->` blocks with `img-N` placeholders) and is idempotent (safe to
 * run repeatedly). A no-op when OCR has never run.
 */
export async function cleanImagePlaceholders(
    plugin: RemarkableSyncPlugin
): Promise<CleanImagePlaceholdersResult> {
    const result: CleanImagePlaceholdersResult = { filesChanged: 0, blocksCleaned: 0 }

    // Reverse index: pageId → notebookId, so we can reconcile the stored ocrHash.
    const notebookIdByPageId = new Map<string, string>()
    for (const [notebookId, state] of Object.entries(plugin.settings.syncStore.notebooks)) {
        for (const pageId of Object.keys(state.pages ?? {})) {
            notebookIdByPageId.set(pageId, notebookId)
        }
    }
    // Nothing OCR'd yet → nothing to migrate; skip the vault scan entirely.
    if (notebookIdByPageId.size === 0) {
        return result
    }

    const { vault } = plugin.app
    const targetFolder = normalizeFolder(plugin.settings.targetFolder)
    const underTarget = (path: string): boolean =>
        targetFolder === '' || path.startsWith(`${targetFolder}/`)

    // Index saved page-image paths by basename (e.g. "6-P020.jpeg" → [full vault path]).
    // Keep all paths per basename so we can disambiguate by the notebook's own subfolder.
    const imagePathsByName = new Map<string, string[]>()
    for (const file of vault.getFiles()) {
        if (IMAGE_EXTS.includes(file.extension.toLowerCase() as (typeof IMAGE_EXTS)[number])) {
            if (underTarget(file.path)) {
                const paths = imagePathsByName.get(file.name)
                if (paths) {
                    paths.push(file.path)
                } else {
                    imagePathsByName.set(file.name, [file.path])
                }
            }
        }
    }

    const allCleaned: CleanedBlock[] = []

    for (const file of vault.getMarkdownFiles()) {
        if (!underTarget(file.path)) {
            continue
        }
        let content: string
        try {
            content = await vault.read(file)
        } catch (error) {
            log(`Image-ref migration: failed to read ${file.path}`, 'warn', error)
            continue
        }
        if (!content.includes(MANAGED_BLOCK_MARKER)) {
            continue
        }

        // The note file is `<targetFolder>/<notebookName>.md`; page images live at
        // `<targetFolder>/<folderPath>/<notebookName>/<notebookName>-P<NNN>.<ext>`, so
        // prefer an image under a folder named for this notebook when basenames collide.
        const notebookName = file.basename
        const resolveImagePath: PageImageResolver = (pageNumber) => {
            if (pageNumber === undefined) {
                return undefined
            }
            const nnn = String(pageNumber).padStart(3, '0')
            for (const ext of IMAGE_EXTS) {
                const paths = imagePathsByName.get(`${notebookName}-P${nnn}.${ext}`)
                if (!paths || paths.length === 0) {
                    continue
                }
                return paths.find((p) => p.includes(`/${notebookName}/`)) ?? paths[0]
            }
            return undefined
        }

        const { content: newContent, cleaned } = migrateBlocksImagePlaceholders(
            content,
            resolveImagePath
        )
        if (cleaned.length === 0) {
            continue
        }

        try {
            await vault.modify(file, newContent)
        } catch (error) {
            log(`Image-ref migration: failed to write ${file.path}`, 'error', error)
            continue
        }
        result.filesChanged++
        result.blocksCleaned += cleaned.length
        allCleaned.push(...cleaned)
    }

    // Reconcile the stored per-page ocrHash to the rewritten body (no re-OCR), so the
    // anti-clobber guard sees a match on the next sync.
    if (allCleaned.length > 0) {
        await plugin.updateSettings((draft) => {
            for (const { pageId, ocrHash } of allCleaned) {
                const notebookId = notebookIdByPageId.get(pageId)
                if (!notebookId) {
                    continue
                }
                const page = draft.syncStore.notebooks[notebookId]?.pages?.[pageId]
                if (page) {
                    page.ocrHash = ocrHash
                }
            }
        })
    }

    return result
}
