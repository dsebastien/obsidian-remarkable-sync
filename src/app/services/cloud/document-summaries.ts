import type { NotebookSummary } from '../../domain/notebook'
import type { RemarkableDocumentMetadata } from '../../domain/remarkable-types'

/** A root-index entry paired with its parsed `.metadata` file. */
export interface EntryMetadata {
    readonly id: string
    readonly metadata: RemarkableDocumentMetadata
}

/**
 * Build notebook summaries from the parsed metadata of every root-index entry.
 * Pure: resolves folder paths from the CollectionType parent chain, skips
 * deleted/trashed entries, and carries `pinned` (the device star) through to
 * the summary.
 */
export function buildNotebookSummaries(entries: readonly EntryMetadata[]): NotebookSummary[] {
    // Folder name/parent maps from CollectionType entries
    const folderNames = new Map<string, string>()
    const folderParents = new Map<string, string>()

    for (const { id, metadata } of entries) {
        if (metadata.deleted) continue
        if (metadata.type === 'CollectionType') {
            folderNames.set(id, metadata.visibleName)
            folderParents.set(id, metadata.parent)
        }
    }

    // Resolve folder path from parent chain
    const buildFolderPath = (parentId: string): string => {
        const parts: string[] = []
        let current = parentId
        const visited = new Set<string>()
        while (current && current !== '' && current !== 'trash' && !visited.has(current)) {
            visited.add(current)
            const name = folderNames.get(current)
            if (name) {
                parts.unshift(name)
                current = folderParents.get(current) ?? ''
            } else {
                break
            }
        }
        return parts.join('/')
    }

    const notebooks: NotebookSummary[] = []
    for (const { id, metadata } of entries) {
        if (metadata.deleted) continue
        if (metadata.type !== 'DocumentType') continue
        if (metadata.parent === 'trash') continue

        notebooks.push({
            id,
            visibleName: metadata.visibleName,
            parent: metadata.parent,
            lastModified: metadata.lastModified,
            pageCount: 0,
            folderPath: buildFolderPath(metadata.parent),
            // Defensive === true: older/self-hosted clouds may omit the field.
            pinned: metadata.pinned === true
        })
    }
    return notebooks
}
