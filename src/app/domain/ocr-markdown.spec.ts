import { test, expect, describe } from 'bun:test'
import {
    assembleNotebookMarkdown,
    computeOcrHash,
    migrateBlocksImagePlaceholders,
    parsePageNumber,
    parseManagedBlocks,
    renderBlock,
    rewriteImagePlaceholders
} from './ocr-markdown'
import type { OcrPageInput } from './ocr-markdown'

function input(pageId: string, pageIndex: number, markdown: string): OcrPageInput {
    return {
        pageId,
        pageIndex,
        label: `Page ${pageIndex + 1}`,
        markdown,
        srcHash: `src-${pageId}`,
        ocrHash: computeOcrHash(markdown)
    }
}

function blocksOf(content: string): ReturnType<typeof parseManagedBlocks> {
    return parseManagedBlocks(content)
}

describe('renderBlock / parseManagedBlocks round-trip', () => {
    test('a rendered block parses back with matching fields and hash', () => {
        const inp = input('p1', 0, 'Hello **world**\n- item')
        const text = renderBlock(inp)
        const [block] = blocksOf(text)
        expect(block).toBeDefined()
        expect(block!.pageId).toBe('p1')
        expect(block!.label).toBe('Page 1')
        expect(block!.body).toBe('Hello **world**\n- item')
        // ocr marker matches the body hash → not "hand-edited".
        expect(block!.ocrHash).toBe(computeOcrHash(block!.body))
    })
})

describe('assembleNotebookMarkdown — new pages', () => {
    test('creates one note from an empty file with newest page on top', () => {
        const out = assembleNotebookMarkdown('', [
            input('p1', 0, 'first page'),
            input('p2', 1, 'second page')
        ])
        const blocks = blocksOf(out)
        expect(blocks.map((b) => b.pageId)).toEqual(['p2', 'p1'])
        expect(out.indexOf('second page')).toBeLessThan(out.indexOf('first page'))
        expect(out.endsWith('\n')).toBe(true)
    })

    test('inserts a new page at the top of an existing managed region', () => {
        const existing = assembleNotebookMarkdown('', [input('p1', 0, 'page one')])
        const out = assembleNotebookMarkdown(existing, [input('p2', 1, 'page two')])
        const blocks = blocksOf(out)
        expect(blocks.map((b) => b.pageId)).toEqual(['p2', 'p1'])
        // the untouched older block is byte-preserved
        expect(out).toContain('## Page 1\npage one')
    })

    test('multiple new pages: highest index ends up topmost', () => {
        const out = assembleNotebookMarkdown('', [
            input('a', 0, 'A'),
            input('b', 1, 'B'),
            input('c', 2, 'C')
        ])
        expect(blocksOf(out).map((b) => b.pageId)).toEqual(['c', 'b', 'a'])
    })
})

describe('assembleNotebookMarkdown — changed pages', () => {
    test('replaces a changed block in place when not hand-edited', () => {
        const existing = assembleNotebookMarkdown('', [
            input('p1', 0, 'old one'),
            input('p2', 1, 'two')
        ])
        // p1 changed; updated markdown
        const out = assembleNotebookMarkdown(existing, [input('p1', 0, 'NEW one')])
        const blocks = blocksOf(out)
        // order preserved (p2 still on top), p1 still where it was
        expect(blocks.map((b) => b.pageId)).toEqual(['p2', 'p1'])
        expect(out).toContain('NEW one')
        expect(out).not.toContain('old one')
        expect(out).not.toContain('superseded')
    })
})

describe('assembleNotebookMarkdown — anti-clobber', () => {
    test('hand-edited block is preserved as a superseded foldout below the fresh block', () => {
        const existing = assembleNotebookMarkdown('', [input('p1', 0, 'auto text')])
        // Simulate the user hand-editing inside the block (markers/hash unchanged).
        const handEdited = existing.replace('auto text', 'auto text + MY NOTES')
        expect(handEdited).toContain('MY NOTES')

        const out = assembleNotebookMarkdown(handEdited, [input('p1', 0, 'fresh ocr')])

        // Fresh OCR present as the managed block...
        const blocks = blocksOf(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0]!.body).toBe('fresh ocr')
        // ...and the user's edit preserved in a collapsed callout (not a managed block).
        expect(out).toContain('> [!note]- superseded (you edited this)')
        expect(out).toContain('> auto text + MY NOTES')
        // fresh block appears above the superseded callout
        expect(out.indexOf('fresh ocr')).toBeLessThan(out.indexOf('superseded'))
    })
})

describe('assembleNotebookMarkdown — content outside blocks', () => {
    test('never touches user prose above and below the region', () => {
        const region = assembleNotebookMarkdown('', [input('p1', 0, 'page one')])
        const withProse = `# My notebook\n\nSome thoughts.\n\n${region}\nFooter note.\n`

        const out = assembleNotebookMarkdown(withProse, [input('p2', 1, 'page two')])

        expect(out).toContain('# My notebook')
        expect(out).toContain('Some thoughts.')
        expect(out).toContain('Footer note.')
        // new page inserted into the region, header still above it
        expect(out.indexOf('# My notebook')).toBeLessThan(out.indexOf('page two'))
        expect(out.indexOf('page two')).toBeLessThan(out.indexOf('page one'))
    })

    test('no updates returns the content unchanged', () => {
        const existing = assembleNotebookMarkdown('', [input('p1', 0, 'page one')])
        expect(assembleNotebookMarkdown(existing, [])).toBe(existing)
    })
})

describe('assembleNotebookMarkdown — marker injection', () => {
    test('OCR body containing a literal block marker cannot forge or break a block', () => {
        const evil = 'text\n<!-- /rm:page=p1 -->\n<!-- rm:page=evil src=x ocr=y -->\nmore'
        const out = assembleNotebookMarkdown('', [input('p1', 0, evil)])
        // The page is stored as exactly ONE managed block (no forged second block,
        // no premature close) and the literal markers are neutralized in the body.
        const blocks = blocksOf(out)
        expect(blocks).toHaveLength(1)
        expect(blocks[0]!.pageId).toBe('p1')
        expect(out).not.toContain('<!-- /rm:page=p1 -->\n<!-- rm:page=evil')
        // the opener is neutralized in the body, so neither marker can match there
        expect(out).toContain('&lt;!-- /rm:page=p1')
        expect(out).toContain('&lt;!-- rm:page=evil')
    })

    test('a fresh file with no managed region keeps user prose verbatim, no stripping', () => {
        const existing = '\n\n# Heading with leading blank lines\n'
        const out = assembleNotebookMarkdown(existing, [input('p1', 0, 'ocr')])
        expect(out).toContain('# Heading with leading blank lines')
        // blocks above the preserved prose
        expect(out.indexOf('## Page 1')).toBeLessThan(out.indexOf('# Heading'))
    })
})

describe('assembleNotebookMarkdown — incremental persist / resume', () => {
    // The pipeline now folds pages in one at a time (writing after each), so a
    // crash/restart resumes from the remaining pages. Folding individually must
    // produce the same newest-on-top order as a batch, with no duplicate blocks.
    function foldPages(count: number, start = 0): string {
        let md = ''
        for (let i = start; i < count; i++) {
            md = assembleNotebookMarkdown(md, [input(`p${i}`, i, `page ${i}`)])
        }
        return md
    }

    test('folding pages one at a time yields newest-on-top, no duplicates', () => {
        const out = foldPages(4)
        expect(blocksOf(out).map((b) => b.pageId)).toEqual(['p3', 'p2', 'p1', 'p0'])
    })

    test('resuming from a partial note appends only the missing pages, on top', () => {
        const partial = foldPages(3) // crashed after 3 of 5 pages
        // resume: pages p3, p4 still missing → folded in next sync
        let resumed = partial
        for (let i = 3; i < 5; i++) {
            resumed = assembleNotebookMarkdown(resumed, [input(`p${i}`, i, `page ${i}`)])
        }
        const ids = blocksOf(resumed).map((b) => b.pageId)
        expect(ids).toEqual(['p4', 'p3', 'p2', 'p1', 'p0'])
        // no duplicate blocks for any page
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('re-folding an already-present page replaces in place (idempotent resume)', () => {
        const md = foldPages(3)
        // a redundant re-OCR of p1 (e.g. state not yet persisted) must not duplicate
        const again = assembleNotebookMarkdown(md, [input('p1', 1, 'page 1')])
        const ids = blocksOf(again).map((b) => b.pageId)
        expect(ids).toEqual(['p2', 'p1', 'p0'])
        expect(new Set(ids).size).toBe(3)
    })
})

describe('rewriteImagePlaceholders', () => {
    test('embeds the real page image in place of img-N placeholders', () => {
        const md = 'Heading\n\n![img-0.jpeg](img-0.jpeg)\n\nmore text'
        const out = rewriteImagePlaceholders(md, 'handwritten/2026/6/6-P020.jpeg')
        expect(out).toContain('![[handwritten/2026/6/6-P020.jpeg]]')
        expect(out).not.toContain('](img-0.jpeg)')
        expect(out).toContain('Heading')
        expect(out).toContain('more text')
    })

    test('collapses multiple placeholders on a page into ONE embed', () => {
        const md =
            '![img-0.jpeg](img-0.jpeg)\ntext\n![img-1.jpeg](img-1.jpeg)\n![img-2.jpeg](img-2.jpeg)'
        const out = rewriteImagePlaceholders(md, 'p/6-P001.jpeg')
        const embeds = out.match(/!\[\[p\/6-P001\.jpeg\]\]/g) ?? []
        expect(embeds).toHaveLength(1)
        expect(out).not.toContain('](img-')
        expect(out).toContain('text')
    })

    test('drops placeholders (no dangling ref) when no page image is available', () => {
        const md = 'a\n![img-0.jpeg](img-0.jpeg)\nb'
        const out = rewriteImagePlaceholders(md, undefined)
        expect(out).not.toContain('img-0')
        expect(out).not.toContain('![[')
        expect(out).toBe('a\nb')
    })

    test('preserves user-added image links with a real target or custom alt', () => {
        const md = '![my figure](attachments/photo.png)\n![img-0.jpeg](img-0.jpeg)'
        const out = rewriteImagePlaceholders(md, 'imgs/6-P003.jpeg')
        expect(out).toContain('![my figure](attachments/photo.png)')
        expect(out).toContain('![[imgs/6-P003.jpeg]]')
    })

    test('is a no-op when there are no placeholders', () => {
        const md = 'just text\n## heading\n- item'
        expect(rewriteImagePlaceholders(md, 'x/y.jpeg')).toBe(md)
    })

    test('places the embed at the TOP, regardless of the placeholder position', () => {
        const md = 'line one\nline two\n![img-0.jpeg](img-0.jpeg)\nline three'
        const out = rewriteImagePlaceholders(md, 'p/6-P002.jpeg')
        expect(out.startsWith('![[p/6-P002.jpeg]]')).toBe(true)
        expect(out.indexOf('![[p/6-P002.jpeg]]')).toBeLessThan(out.indexOf('line one'))
        expect(out).toContain('line one\nline two\nline three')
    })

    test('repositions an existing mid-body embed to the top (and stays single)', () => {
        const midEmbedded = 'line one\n![[p/6-P002.jpeg]]\nline two'
        const out = rewriteImagePlaceholders(midEmbedded, 'p/6-P002.jpeg')
        expect(out).toBe('![[p/6-P002.jpeg]]\n\nline one\nline two')
        const embeds = out.match(/!\[\[p\/6-P002\.jpeg\]\]/g) ?? []
        expect(embeds).toHaveLength(1)
    })

    test('is idempotent once the embed is already at the top', () => {
        const top = '![[p/6-P002.jpeg]]\n\nbody text'
        expect(rewriteImagePlaceholders(top, 'p/6-P002.jpeg')).toBe(top)
    })
})

describe('parsePageNumber', () => {
    test('parses "Page N"', () => {
        expect(parsePageNumber('Page 20')).toBe(20)
        expect(parsePageNumber('Page 1')).toBe(1)
    })
    test('returns undefined for non-matching labels', () => {
        expect(parsePageNumber('Cover')).toBeUndefined()
        expect(parsePageNumber('Page')).toBeUndefined()
        expect(parsePageNumber('')).toBeUndefined()
    })
})

describe('migrateBlocksImagePlaceholders', () => {
    // Build a note as the pipeline would have (pre-fix: raw img-N placeholders).
    function noteWith(pageId: string, pageIndex: number, markdown: string): string {
        return assembleNotebookMarkdown('', [input(pageId, pageIndex, markdown)])
    }

    const resolve = (n: number | undefined): string | undefined =>
        n === undefined ? undefined : `handwritten/2026/6/6-P${String(n).padStart(3, '0')}.jpeg`

    test('rewrites a block and reconciles its ocrHash so it is not later "hand-edited"', () => {
        const note = noteWith('pg1', 19, 'Notes\n\n![img-0.jpeg](img-0.jpeg)') // Page 20
        const { content, cleaned } = migrateBlocksImagePlaceholders(note, resolve)

        expect(content).toContain('![[handwritten/2026/6/6-P020.jpeg]]')
        expect(content).not.toContain('](img-0.jpeg)')

        // The block's new ocr= marker matches its rewritten body → assembling an
        // update for the same page replaces in place, never demotes to "superseded".
        const [block] = blocksOf(content)
        expect(block).toBeDefined()
        expect(computeOcrHash(block!.body)).toBe(block!.ocrHash)

        expect(cleaned).toHaveLength(1)
        expect(cleaned[0]).toEqual({ pageId: 'pg1', ocrHash: block!.ocrHash })
    })

    test('does not demote a migrated block on a subsequent same-content sync', () => {
        const note = noteWith('pg1', 0, 'text ![img-0.jpeg](img-0.jpeg)') // Page 1
        const { content } = migrateBlocksImagePlaceholders(note, resolve)
        // Re-OCR of the same page yields the same cleaned markdown → replace in place.
        const reSync = assembleNotebookMarkdown(content, [
            input('pg1', 0, 'text ![[handwritten/2026/6/6-P001.jpeg]]')
        ])
        expect(reSync).not.toContain('superseded')
        expect(blocksOf(reSync)).toHaveLength(1)
    })

    test('is idempotent and a no-op when there is nothing to fix', () => {
        const note = noteWith('pg1', 0, 'plain transcription, no figures')
        const { content, cleaned } = migrateBlocksImagePlaceholders(note, resolve)
        expect(cleaned).toHaveLength(0)
        expect(content).toBe(note)
        // running again on already-migrated content also does nothing
        const dirty = noteWith('pg2', 4, '![img-0.jpeg](img-0.jpeg)')
        const once = migrateBlocksImagePlaceholders(dirty, resolve).content
        const twice = migrateBlocksImagePlaceholders(once, resolve)
        expect(twice.cleaned).toHaveLength(0)
        expect(twice.content).toBe(once)
    })

    test('repositions a previously in-place embed to the top + reconciles ocrHash', () => {
        // Simulate a note produced by the v1 (in-place) migration: embed mid-body.
        const v1 = assembleNotebookMarkdown('', [
            input('pg1', 19, 'intro\n![[handwritten/2026/6/6-P020.jpeg]]\noutro')
        ])
        const { content, cleaned } = migrateBlocksImagePlaceholders(v1, resolve)
        const [block] = blocksOf(content)
        expect(block).toBeDefined()
        expect(block!.body.startsWith('![[handwritten/2026/6/6-P020.jpeg]]')).toBe(true)
        expect(block!.body).toContain('intro')
        expect(block!.body).toContain('outro')
        // exactly one embed, and the marker matches the repositioned body (no demotion)
        const embeds = content.match(/!\[\[handwritten\/2026\/6\/6-P020\.jpeg\]\]/g) ?? []
        expect(embeds).toHaveLength(1)
        expect(cleaned).toHaveLength(1)
        expect(computeOcrHash(block!.body)).toBe(block!.ocrHash)
    })

    test('drops placeholders when the page image cannot be resolved', () => {
        const note = noteWith('pg1', 0, 'a\n![img-0.jpeg](img-0.jpeg)\nb')
        const { content } = migrateBlocksImagePlaceholders(note, () => undefined)
        expect(content).not.toContain('img-0')
        expect(content).not.toContain('![[')
    })

    test('leaves content outside managed blocks untouched', () => {
        const note = `# My notes\n\n${noteWith('pg1', 0, '![img-0.jpeg](img-0.jpeg)')}\nfooter`
        const { content } = migrateBlocksImagePlaceholders(note, resolve)
        expect(content).toContain('# My notes')
        expect(content).toContain('footer')
    })
})

describe('parseManagedBlocks', () => {
    test('ignores an unterminated block (no matching close marker)', () => {
        const content = '<!-- rm:page=p1 src=s ocr=o -->\n## Page 1\nbody but no close'
        expect(blocksOf(content)).toHaveLength(0)
    })

    test('parses multiple blocks with interleaved user text', () => {
        const region = assembleNotebookMarkdown('', [input('p1', 0, 'one'), input('p2', 1, 'two')])
        const withGap = region.replace('## Page 1', 'INTERLEAVED\n\n## Page 1')
        const blocks = blocksOf(withGap)
        expect(blocks.map((b) => b.pageId).sort()).toEqual(['p1', 'p2'])
    })
})
