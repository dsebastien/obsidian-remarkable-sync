import { log } from '../../../utils/log'

/**
 * A horizontal band of text on a page, in PDF user space (y grows upward).
 */
export interface TextLine {
    /** Baseline y */
    baseline: number
    /** Top of the band */
    top: number
    /** Bottom of the band */
    bottom: number
}

/**
 * Extract the horizontal bands occupied by text on a page.
 *
 * Deliberately does NOT decode any text. Snapping a highlighter to a line only
 * needs to know *where the lines are*, not what they say, and glyph decoding is
 * where PDF text extraction becomes genuinely hard (font encodings, CMaps,
 * ToUnicode). Tracking the text-positioning operators is comparatively simple
 * and needs no font tables.
 *
 * Operators that matter:
 *   BT / ET      begin and end a text object, resetting the matrix
 *   Tf           select font and size
 *   TL           set leading (line spacing)
 *   Td / TD      move to the next line by an offset (TD also sets leading)
 *   Tm           set the text matrix outright
 *   T*           next line, using the leading
 *   Tj ' "  TJ   show text, which is what marks the current position as used
 *
 * The scale factor from the text matrix is applied to the font size, so text
 * scaled by the matrix still yields a sensible band height.
 */
export function extractTextLines(contentStream: string): TextLine[] {
    const lines: TextLine[] = []

    // Tokenise: numbers, names, strings collapsed to a placeholder, operators.
    // Strings are collapsed because their contents are irrelevant here and
    // escaping rules inside them would otherwise confuse the operator scan.
    const tokens = contentStream
        .replace(/\((?:\\.|[^\\)])*\)/gs, ' (S) ')
        .replace(/<[0-9A-Fa-f\s]*>/g, ' (S) ')
        .replace(/([[\]{}])/g, ' $1 ')
        .split(/\s+/)
        .filter((t) => t.length > 0)

    let fontSize = 0
    let leading = 0
    let scaleY = 1
    let y = 0
    let inText = false
    const stack: number[] = []

    const num = (i: number): number => {
        const v = parseFloat(tokens[i] ?? '')
        return Number.isFinite(v) ? v : 0
    }

    const record = (): void => {
        const size = fontSize * scaleY
        if (size <= 0 || !Number.isFinite(y)) return
        // Ascent and descent as a fraction of point size: close enough for a
        // highlight band, and independent of the font's real metrics.
        lines.push({ baseline: y, top: y + size * 0.75, bottom: y - size * 0.25 })
    }

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]!

        switch (t) {
            case 'BT':
                inText = true
                y = 0
                scaleY = 1
                break
            case 'ET':
                inText = false
                break
            case 'Tf':
                fontSize = num(i - 1)
                break
            case 'TL':
                leading = num(i - 1)
                break
            case 'Td':
                y += num(i - 1)
                break
            case 'TD':
                leading = -num(i - 1)
                y += num(i - 1)
                break
            case 'Tm': {
                // a b c d e f Tm
                const b = num(i - 5)
                const d = num(i - 3)
                y = num(i - 1)
                scaleY = Math.hypot(b, d) || 1
                break
            }
            case 'T*':
                y -= leading
                break
            case 'Tj':
            case "'":
            case '"':
                if ("'" === t || '"' === t) y -= leading
                if (inText) record()
                break
            case 'TJ':
                if (inText) record()
                break
            case 'q':
                stack.push(scaleY)
                break
            case 'Q': {
                const restored = stack.pop()
                if (undefined !== restored) scaleY = restored
                break
            }
            default:
                break
        }
    }

    return mergeLines(lines)
}

/**
 * Collapse the many show-operators that make up one visual line into a single
 * band. A justified paragraph can emit a dozen `Tj` calls per line.
 */
function mergeLines(lines: readonly TextLine[]): TextLine[] {
    if (0 === lines.length) return []

    const sorted = [...lines].sort((a, b) => b.baseline - a.baseline)
    const merged: TextLine[] = []

    for (const line of sorted) {
        const last = merged[merged.length - 1]
        // Same line if the baselines are within a quarter of the band height
        const tolerance = Math.max((line.top - line.bottom) * 0.25, 1)
        if (last && Math.abs(last.baseline - line.baseline) <= tolerance) {
            merged[merged.length - 1] = {
                baseline: last.baseline,
                top: Math.max(last.top, line.top),
                bottom: Math.min(last.bottom, line.bottom)
            }
        } else {
            merged.push(line)
        }
    }

    return merged
}

/**
 * The text line a y coordinate falls on, if any.
 *
 * The search is widened beyond the band so a highlighter swept slightly above
 * or below the text still finds it, which is the normal case for freehand
 * highlighting. That slack is proportional to the line's **own** height rather
 * than a fixed number of points: line height and spacing vary between pages and
 * within a page, so a 24pt heading needs more slack than an 8pt footnote, and a
 * fixed tolerance would either miss the heading or bleed across the footnotes.
 *
 * `minimum` is the floor in points, for lines so small that a proportional
 * allowance would be smaller than an ordinary hand wobble.
 */
export function lineAt(lines: readonly TextLine[], y: number, minimum = 2): TextLine | null {
    let best: TextLine | null = null
    let bestDistance = Infinity

    for (const line of lines) {
        const height = line.top - line.bottom
        const allowance = Math.max(minimum, height * 0.5)
        const distance = y > line.top ? y - line.top : y < line.bottom ? line.bottom - y : 0
        if (distance <= allowance && distance < bestDistance) {
            best = line
            bestDistance = distance
        }
    }

    return best
}

/** A point in PDF user space. */
export interface PathPoint {
    x: number
    y: number
}

/** The horizontal extent a stroke covered on one text line. */
export interface LineSpan {
    line: TextLine
    x0: number
    x1: number
}

/**
 * Fraction of the path that must lie on text before the stroke is treated as a
 * line highlight. A mark that spends much of its length in open space is doing
 * something other than marking lines.
 */
const MIN_ON_TEXT = 0.75

/** How much more horizontal than vertical travel a line swipe must have. */
const MIN_HORIZONTALITY = 2

/** Vertical wander allowed while on one line, as a multiple of its height. */
const MAX_WANDER = 1.5

/**
 * Match a stroke path to the text lines it highlights, or decide that it is not
 * a line highlight at all.
 *
 * Highlighting on the device comes in two kinds and they must not be treated
 * alike. A swipe along a line of text is meant to mark that text, and the
 * device renders it as a clean band; drawing the hand's actual wobble instead
 * is the most visible difference from the device. But a circled word, a fluid
 * shading sweep or a scribble across a paragraph is a **freehand mark**, and
 * straightening it into line bands destroys what was drawn. Proximity to text
 * is not the test: nearly every mark on a page of prose is near text.
 *
 * So the path itself decides. A line swipe is horizontal, stays on the lines it
 * crosses, and visits each line once. Returns null when any of that fails, and
 * the caller draws the raw path.
 */
export function snapPathToLines(
    points: readonly PathPoint[],
    lines: readonly TextLine[]
): LineSpan[] | null {
    if (points.length < 2 || 0 === lines.length) return null

    const spans = new Map<TextLine, { x0: number; x1: number; lo: number; hi: number }>()
    /** Lines in the order the path entered them, for the revisit check. */
    const visits: TextLine[] = []

    let onTextLength = 0
    let totalLength = 0
    let travelX = 0
    let travelY = 0

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const dx = Math.abs(b.x - a.x)
        const dy = Math.abs(b.y - a.y)
        const length = Math.hypot(dx, dy)

        totalLength += length
        travelX += dx
        travelY += dy

        const line = lineAt(lines, (a.y + b.y) / 2)
        if (!line) continue
        onTextLength += length

        if (visits[visits.length - 1] !== line) visits.push(line)

        const existing = spans.get(line)
        spans.set(line, {
            x0: Math.min(existing?.x0 ?? Infinity, a.x, b.x),
            x1: Math.max(existing?.x1 ?? -Infinity, a.x, b.x),
            lo: Math.min(existing?.lo ?? Infinity, a.y, b.y),
            hi: Math.max(existing?.hi ?? -Infinity, a.y, b.y)
        })
    }

    if (0 === spans.size || 0 === totalLength) return null

    // Mostly off the text: a mark in a margin, or a gesture that merely passes
    // over a line on its way somewhere else.
    if (onTextLength / totalLength < MIN_ON_TEXT) return null

    // Not a swipe: a circle, a bracket or a vertical stroke travels as far up
    // and down as it does across.
    if (travelX < MIN_HORIZONTALITY * travelY) return null

    // Came back to a line it had already left. A swipe down a paragraph visits
    // each line once, in order; a scribble or an ellipse crosses back.
    if (new Set(visits).size !== visits.length) return null

    // Wandered too far from a line while nominally on it, which a blob of
    // shading does and a swipe does not.
    for (const [line, span] of spans) {
        if (span.hi - span.lo > (line.top - line.bottom) * MAX_WANDER) return null
    }

    return [...spans]
        .map(([line, span]) => ({ line, x0: span.x0, x1: span.x1 }))
        .filter((s) => s.x1 > s.x0)
}

/**
 * Read a page's content stream as text, returning null when it cannot be
 * decoded. Callers fall back to drawing the raw stroke path.
 */
export function decodeContentStream(bytes: Uint8Array): string | null {
    try {
        return new TextDecoder('latin1').decode(bytes)
    } catch (error) {
        log('Could not decode a page content stream for text snapping', 'debug', error)
        return null
    }
}
