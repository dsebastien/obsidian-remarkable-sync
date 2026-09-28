/**
 * Characters that break a wikilink: `]` closes it early, `|` starts an alias,
 * `#` a heading reference and `^` a block reference. `[` is included so a name
 * holding `[[` cannot open a nested link.
 */
const WIKILINK_BREAKERS = /[[\]#^|]/

/**
 * Characters a markdown link cannot carry to Obsidian.
 *
 * `#` always splits a link into path and subpath (`parseLinktext`), in a
 * wikilink and in a markdown link alike. Percent-encoding it does not help:
 * Obsidian decodes a markdown destination the way `decodeURI` does, which
 * leaves `%23` encoded, so the link then names a file called `...%23...`.
 * A `:` anywhere in a markdown destination makes Obsidian treat the link as
 * an external URL, and `%3A` stays encoded for the same `decodeURI` reason.
 * A line break cannot sit inside either link form. All verified against
 * Obsidian 1.13.7's metadata cache.
 */
const MARKDOWN_UNLINKABLE = /[#:\r\n]/

/** Display text characters with a markdown or Obsidian meaning. */
const TEXT_SPECIALS = /[\\[\]*_`~=<>$%|]/g

/**
 * Encode a markdown link destination so Obsidian decodes it back to the name.
 *
 * The destination is wrapped in angle brackets so spaces need no encoding.
 * Inside them, `\` is a CommonMark escape, so it is doubled. `%` must be
 * encoded because Obsidian percent-decodes the destination, and a bare `%`
 * makes the decode fail and the link disappear. `<` and `>` cannot be
 * backslash-escaped inside angle brackets (Obsidian does not parse the link
 * at all), but `decodeURI` restores `%3C` and `%3E`.
 */
function encodeDestination(fileName: string): string {
    return fileName
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '%25')
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
}

/** Inline code that survives backticks in the content. */
function inlineCode(text: string): string {
    const flat = text.replace(/[\r\n]+/g, ' ')
    const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length))
    const fence = '`'.repeat(longestRun + 1)
    const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
    return `${fence}${pad}${flat}${pad}${fence}`
}

/**
 * A link to a file the plugin wrote, in the form Obsidian can resolve.
 *
 * Takes a file NAME, exactly as the writer named the file (see
 * `documentFileName`), so the link and the file cannot drift apart. The name
 * is never rewritten here: a link to a sanitised name would point at a file
 * that does not exist.
 *
 * - An ordinary name stays a wikilink, `[[name]]`, byte-identical to what
 *   earlier versions wrote, so existing notes are not rewritten on re-sync.
 * - A name holding `[ ] ^ |` would break the wikilink, so it becomes a
 *   markdown link with an angle-bracket destination, `[name](<name>)`, which
 *   Obsidian resolves the same way (by name, from the note's folder).
 * - A name that breaks a wikilink AND holds `#` or `:` cannot be linked in
 *   either form (see `MARKDOWN_UNLINKABLE`; `#` always breaks a wikilink), so
 *   it is written as inline code: the reader still sees which file it is, and
 *   no link points at the wrong file.
 */
export function linkToFile(fileName: string): string {
    if (!WIKILINK_BREAKERS.test(fileName) && !/[\r\n]/.test(fileName)) {
        return `[[${fileName}]]`
    }

    if (MARKDOWN_UNLINKABLE.test(fileName)) {
        return inlineCode(fileName)
    }

    const text = fileName.replace(TEXT_SPECIALS, (char) => `\\${char}`)
    return `[${text}](<${encodeDestination(fileName)}>)`
}
