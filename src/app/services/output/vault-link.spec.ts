import { describe, expect, test } from 'bun:test'
import { linkToFile } from './vault-link'

/**
 * Every expectation below was checked against Obsidian 1.13.7: the markdown
 * was fed to the metadata cache and `getLinkpath` of the parsed link compared
 * with the file name. These tests pin that verified output.
 */
describe('linkToFile', () => {
    test('keeps an ordinary name a wikilink, byte-identical to earlier versions', () => {
        // Anything else would rewrite every existing highlights note on the
        // next sync.
        expect(linkToFile('Book (annotated).pdf')).toBe('[[Book (annotated).pdf]]')
        expect(linkToFile('Q3: review (annotated).pdf')).toBe('[[Q3: review (annotated).pdf]]')
        expect(linkToFile('Trips/Japan (annotated).pdf')).toBe('[[Trips/Japan (annotated).pdf]]')
    })

    test('uses a markdown link when a character would break the wikilink', () => {
        expect(linkToFile('Notes [v2] (annotated).pdf')).toBe(
            '[Notes \\[v2\\] (annotated).pdf](<Notes [v2] (annotated).pdf>)'
        )
        expect(linkToFile('A|B (annotated).pdf')).toBe(
            '[A\\|B (annotated).pdf](<A|B (annotated).pdf>)'
        )
        expect(linkToFile('x^y (annotated).pdf')).toBe(
            '[x^y (annotated).pdf](<x^y (annotated).pdf>)'
        )
        expect(linkToFile('a]]b.pdf')).toBe('[a\\]\\]b.pdf](<a]]b.pdf>)')
    })

    test('encodes what Obsidian would otherwise decode or misparse', () => {
        // Obsidian percent-decodes the destination: a bare `%` makes the whole
        // link vanish, and a literal `%20` would come back as a space.
        expect(linkToFile('50% [a].pdf')).toBe('[50\\% \\[a\\].pdf](<50%25 [a].pdf>)')
        expect(linkToFile('a%20b [c].pdf')).toBe('[a\\%20b \\[c\\].pdf](<a%2520b [c].pdf>)')
        // `\` is an escape inside the angle brackets.
        expect(linkToFile('a\\b [c].pdf')).toBe('[a\\\\b \\[c\\].pdf](<a\\\\b [c].pdf>)')
        // `\<` is not parsed at all; `%3C` decodes back.
        expect(linkToFile('a<b> [c].pdf')).toBe('[a\\<b\\> \\[c\\].pdf](<a%3Cb%3E [c].pdf>)')
    })

    test('escapes markdown and Obsidian syntax in the display text', () => {
        expect(linkToFile('a*b_c $e$ %%f%% ==g== [h].pdf')).toBe(
            '[a\\*b\\_c \\$e\\$ \\%\\%f\\%\\% \\=\\=g\\=\\= \\[h\\].pdf](<a*b_c $e$ %25%25f%25%25 ==g== [h].pdf>)'
        )
    })

    test('falls back to inline code when no link form resolves', () => {
        // `#` always splits a link into path and subpath, and a `:` turns a
        // markdown link into an external URL. A link to the wrong target is
        // worse than no link.
        expect(linkToFile('C# notes (annotated).pdf')).toBe('`C# notes (annotated).pdf`')
        expect(linkToFile('x^y: z.pdf')).toBe('`x^y: z.pdf`')
    })

    test('inline code survives backticks in the name', () => {
        expect(linkToFile('a`b #1.pdf')).toBe('``a`b #1.pdf``')
        expect(linkToFile('`x` #1.pdf')).toBe('`` `x` #1.pdf ``')
    })

    test('a line break never reaches a link', () => {
        expect(linkToFile('a\nb.pdf')).toBe('`a b.pdf`')
    })
})
