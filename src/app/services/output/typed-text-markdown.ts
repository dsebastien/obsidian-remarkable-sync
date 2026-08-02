import type { Page } from '../../domain/notebook'
import { pageTextToMarkdown } from '../parser/text-sequence'
import { hasText } from '../parser/text-sequence'

export interface TypedTextNoteOptions {
    documentName: string
    pages: readonly Page[]
}

/** Pages carrying typed text, in document order. */
function collect(pages: readonly Page[]): { page: Page; markdown: string }[] {
    return pages
        .filter((page) => hasText(page.text))
        .map((page) => ({ page, markdown: page.text ? pageTextToMarkdown(page.text) : '' }))
        .filter((entry) => '' !== entry.markdown)
}

/** Whether a document has any typed text worth writing a note for. */
export function hasTypedText(pages: readonly Page[]): boolean {
    return collect(pages).length > 0
}

/**
 * Build a markdown note holding a document's typed text.
 *
 * The point of the note is that the text is **text**: Obsidian indexes it for
 * search, and any `[[wikilink]]` typed on the device becomes a real link in the
 * graph. Rendering the same characters into the page image would leave them as
 * invisible as they are today.
 *
 * A page heading is emitted only when there is more than one page with text, so
 * the common single-page case reads as a plain document rather than a report.
 *
 * No date or counter is included: the note must be byte-identical when the
 * document has not changed, so the skip-if-unchanged write guard can leave it
 * alone.
 */
export function buildTypedTextNote(options: TypedTextNoteOptions): string {
    const { documentName, pages } = options
    const entries = collect(pages)

    const lines: string[] = [`# ${documentName}`, '']

    for (const { page, markdown } of entries) {
        if (entries.length > 1) {
            lines.push(`## Page ${page.pageIndex + 1}`, '')
        }
        lines.push(markdown, '')
    }

    return `${lines.join('\n').trimEnd()}\n`
}
