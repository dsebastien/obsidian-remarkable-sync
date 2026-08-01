import type { Highlight, Page } from '../../domain/notebook'

/**
 * Score how plausible it is that a line break sat immediately before `index`.
 *
 * Higher is better. A lowercase or closing character followed by an uppercase
 * one is the strongest signal, since that is what "DeviceTrust" looks like.
 * Letter-to-letter is weaker but is the only signal for joins like
 * "Backupservers". Anything adjacent to an existing space scores zero,
 * because no repair is needed there.
 */
function alphanumericRunBefore(text: string, index: number): number {
    // Step past closing punctuation first: "migration.|Deployed" ends a real
    // word, and counting from the full stop would score it as zero.
    let end = index
    let skipped = 0
    while (end > 0 && skipped < 2 && /[.,;:)\]!?]/.test(text[end - 1]!)) {
        end--
        skipped++
    }
    let n = 0
    while (n < end && /[A-Za-z0-9]/.test(text[end - 1 - n]!)) n++
    return n
}

function alphanumericRunAfter(text: string, index: number): number {
    let n = 0
    while (index + n < text.length && /[A-Za-z0-9]/.test(text[index + n]!)) n++
    return n
}

function joinPlausibility(text: string, index: number): number {
    const before = text[index - 1]
    const after = text[index]
    if (!before || !after) return 0
    if (' ' === before || ' ' === after) return 0
    if (!/[A-Za-z0-9.,;:)\]]/.test(before) || !/[A-Za-z([]/.test(after)) return 0

    // A one or two letter run beside the split is camelCase far more often than
    // a word ending: "i|Phone" and "macOS/i|OS" both look like case transitions
    // otherwise. Real line joins break between whole words.
    if (alphanumericRunBefore(text, index) < 3 || alphanumericRunAfter(text, index) < 3) {
        return 0
    }

    if (/[.!?]/.test(before) && /[A-Z]/.test(after)) return 5
    if (/[a-z,;:)\]]/.test(before) && /[A-Z]/.test(after)) return 4
    return 0
}

/**
 * Only case-transition joins are repaired.
 *
 * A lowercase-to-lowercase join like "Backupservers" is genuinely ambiguous:
 * without a dictionary "Backups ervers" is just as consistent with the data,
 * and the width estimate is not precise enough to choose. Attempting them
 * produced exactly that, plus "componentsa nd" and "Identit y&". Leaving such
 * joins intact is worse to read but never wrong, so the threshold sits above
 * them.
 */
const MIN_JOIN_SCORE = 4

/**
 * Restore the spaces the device dropped when it concatenated the source PDF's
 * lines.
 *
 * The device records highlighted text with line breaks removed, so it arrives
 * as "...someDeviceTrust..." and "...Backupservers...". A pure
 * lowercase-to-uppercase rule was tried first and was actively harmful: it
 * repaired "DeviceTrust" but destroyed "macOS/iOS", "iPhone" and "FastTrack",
 * and still missed every lowercase-to-lowercase join.
 *
 * The rectangles fix that. There is one rectangle per highlighted line, so a
 * highlight covering N rectangles has exactly N-1 joins, and each rectangle's
 * width says roughly how much text sat on that line. That gives an approximate
 * character offset per join, and the search only has to snap to the most
 * plausible boundary nearby.
 *
 * The exact-count constraint is what makes this safe: at most N-1 spaces are
 * ever inserted, near positions the geometry predicts, so it cannot spray
 * spaces through unrelated words the way the regex did.
 */
export function normaliseHighlightText(text: string, rectWidths: readonly number[] = []): string {
    const collapsed = text.replace(/\s+/g, ' ').trim()

    const joins = rectWidths.length - 1
    if (joins < 1 || collapsed.length < 4) {
        return collapsed
    }

    const totalWidth = rectWidths.reduce((sum, w) => sum + w, 0)
    if (totalWidth <= 0) {
        return collapsed
    }

    // Approximate character offset where each line ends, proportional to width
    const targets: number[] = []
    let widthSoFar = 0
    for (let i = 0; i < joins; i++) {
        widthSoFar += rectWidths[i]!
        targets.push(Math.round((widthSoFar / totalWidth) * collapsed.length))
    }

    // Kept tight: the width estimate is good to a few characters on realistic
    // text, and a wide window only invites false matches inside camelCase.
    const WINDOW = 8
    const cuts = new Set<number>()
    for (const target of targets) {
        let bestIndex = -1
        let bestScore = 0
        for (let offset = -WINDOW; offset <= WINDOW; offset++) {
            const index = target + offset
            if (index < 1 || index >= collapsed.length || cuts.has(index)) continue
            const score = joinPlausibility(collapsed, index)
            if (score < MIN_JOIN_SCORE) continue
            // Ties go to the position closest to what the geometry predicted
            if (
                score > bestScore ||
                (score === bestScore &&
                    score > 0 &&
                    Math.abs(offset) < Math.abs(bestIndex - target))
            ) {
                bestScore = score
                bestIndex = index
            }
        }
        if (bestIndex > 0) cuts.add(bestIndex)
    }

    if (cuts.size === 0) {
        return collapsed
    }

    const ordered = [...cuts].sort((a, b) => a - b)
    let result = ''
    let from = 0
    for (const cut of ordered) {
        result += `${collapsed.slice(from, cut)} `
        from = cut
    }
    return result + collapsed.slice(from)
}

export interface HighlightNoteOptions {
    documentName: string
    pages: readonly Page[]
    /** Vault path of the annotated PDF, linked from the note when present */
    annotatedPath?: string
}

interface PageHighlights {
    sourcePageIndex?: number
    highlights: readonly Highlight[]
}

function collect(pages: readonly Page[]): PageHighlights[] {
    return pages
        .filter((p) => (p.highlights?.length ?? 0) > 0)
        .map((p) => ({
            ...(undefined === p.sourcePageIndex ? {} : { sourcePageIndex: p.sourcePageIndex }),
            highlights: p.highlights ?? []
        }))
}

/**
 * Whether a document has any text highlights worth writing a note for.
 */
export function hasHighlights(pages: readonly Page[]): boolean {
    return collect(pages).length > 0
}

/**
 * Build a markdown note listing every text highlight in a document.
 *
 * The text comes from the device verbatim, so it is what was actually selected
 * rather than anything reconstructed from stroke geometry.
 *
 * No date or counter is included: the note must be byte-identical when the
 * document has not changed, so the skip-if-unchanged write guard can leave it
 * alone.
 */
export function buildHighlightsNote(options: HighlightNoteOptions): string {
    const { documentName, pages, annotatedPath } = options
    const byPage = collect(pages)

    const lines: string[] = [`# ${documentName} — highlights`, '']

    if (annotatedPath) {
        lines.push(`Annotated document: [[${annotatedPath}]]`, '')
    }

    const total = byPage.reduce((n, p) => n + p.highlights.length, 0)
    lines.push(`${total} highlight${1 === total ? '' : 's'}.`, '')

    for (const page of byPage) {
        lines.push(
            undefined === page.sourcePageIndex
                ? '## Inserted page'
                : `## Page ${page.sourcePageIndex + 1}`,
            ''
        )
        for (const highlight of page.highlights) {
            lines.push(
                `> ${normaliseHighlightText(
                    highlight.text,
                    highlight.rects.map((r) => r.width)
                )}`,
                ''
            )
        }
    }

    return `${lines.join('\n').trimEnd()}\n`
}
