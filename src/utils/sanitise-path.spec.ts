import { test, expect, describe } from 'bun:test'
import {
    containVaultFolderPath,
    normaliseTargetFolderInput,
    sanitiseName,
    sanitiseRelativePath,
    validateVaultFolderPath,
    FALLBACK_NAME,
    MAX_NAME_BYTES
} from './sanitise-path'

const utf8 = new TextEncoder()

/** Names chosen to exercise every branch, used for the idempotence sweep. */
const HOSTILE_NAMES: readonly string[] = [
    'Trips/Japan',
    'C# notes',
    'Q3: Review <draft>?',
    'a<>b',
    'a--b',
    '.hidden',
    '..',
    '///',
    '   ',
    '',
    'CON',
    'com9',
    'trailing. ',
    'x'.repeat(200),
    '名前'.repeat(80),
    'hascontrol',
    'Notes [v2] ^block|alias',
    // The two idempotence breaks fuzzing turned up. Both are ORDERING
    // bugs, and neither is visible without running sanitiseName twice.
    ' .hidden',
    '<name\u{feff}.  ',
    'nul.tar',
    'COM\u00b9'
]

describe('sanitiseName', () => {
    test('replaces a path separator so one name stays one file', () => {
        // The headline bug: a `/` in a device name silently created folders.
        expect(sanitiseName('Trips/Japan')).toBe('Trips-Japan')
    })

    test('replaces every character in the union set', () => {
        // Applied on every host, not just the host's own set, because a vault
        // is synced between machines.
        for (const char of ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '[', ']', '#', '^']) {
            expect(sanitiseName(`a${char}b`), `for ${char}`).toBe('a-b')
        }
    })

    test('collapses a run of replaced characters into one hyphen', () => {
        expect(sanitiseName('a<>b')).toBe('a-b')
    })

    test('leaves a run of hyphens the user typed themselves', () => {
        // Collapsing only applies to characters we replaced. Rewriting the
        // user's own punctuation would be a different, unasked-for change.
        expect(sanitiseName('a--b')).toBe('a--b')
    })

    test('replaces a leading dot', () => {
        // Obsidian excludes dot-prefixed files from the vault index, so the
        // file would sync to somewhere the user can never see it.
        expect(sanitiseName('.hidden')).toBe('-hidden')
        expect(sanitiseName('...hidden')).toBe('-hidden')
    })

    test('strips trailing dots and spaces', () => {
        // Windows strips these at creation, so the file lands at a path we did
        // not ask for. The next sync then fails to find it and rewrites it,
        // which defeats the skip-if-unchanged guard.
        expect(sanitiseName('trailing. ')).toBe('trailing')
        expect(sanitiseName('trailing...')).toBe('trailing')
    })

    test('removes control characters rather than hyphenating them', () => {
        // A hyphen standing in for an invisible byte is a hyphen the user
        // cannot explain.
        expect(sanitiseName('hascontrol')).toBe('hascontrol')
    })

    test('falls back when nothing usable survives', () => {
        expect(sanitiseName('')).toBe(FALLBACK_NAME)
        expect(sanitiseName('   ')).toBe(FALLBACK_NAME)
        // `///` reduces to a bare `-`, which is legal but useless, and two
        // different garbage names would collide there anyway.
        expect(sanitiseName('///')).toBe(FALLBACK_NAME)
    })

    test('suffixes Windows reserved device names', () => {
        expect(sanitiseName('CON')).toBe('CON-')
        expect(sanitiseName('con')).toBe('con-')
        expect(sanitiseName('com9')).toBe('com9-')
        expect(sanitiseName('LPT1')).toBe('LPT1-')
        // com0 and lpt0 are reserved on modern Windows too.
        expect(sanitiseName('com0')).toBe('com0-')
        expect(sanitiseName('lpt0')).toBe('lpt0-')
        // Windows folds the superscript digits onto COM1-3.
        expect(sanitiseName('COM\u00b9')).toBe('COM\u00b9-')
    })

    test('suffixes a reserved name that carries an extension', () => {
        // Windows reads the text before the FIRST dot, so `nul.tar` is as
        // reserved as `nul`. The hyphen goes on the STEM: suffixing the whole
        // component would leave the stem reserved and grow another hyphen on
        // every pass, which breaks idempotence.
        expect(sanitiseName('nul.tar')).toBe('nul-.tar')
        expect(sanitiseName('AUX.notes')).toBe('AUX-.notes')
        expect(sanitiseName('nul.tar.pdf')).toBe('nul-.tar.pdf')
    })

    test('strips whitespace before testing for a leading dot', () => {
        // `^\.+` does not match " .hidden", so trimming AFTERWARDS exposed a
        // dot with nothing left to catch it, and the name kept the prefix
        // Obsidian excludes from the vault index. Fuzzing found this by
        // running sanitiseName twice; a single pass looks fine.
        expect(sanitiseName(' .hidden')).toBe('-hidden')
        expect(sanitiseName('\u00a0.hidden')).toBe('-hidden')
    })

    test('removes whitespace a trailing dot was hiding', () => {
        // Stripping the trailing dot EXPOSES the BOM behind it, and the trim
        // has already run by then. The trailing class has to cover every
        // character trim would take, not just the literal space.
        expect(sanitiseName('name\u{feff}.')).toBe('name')
        expect(sanitiseName('name\u00a0.  ')).toBe('name')
    })

    test('leaves names that merely start with a reserved word', () => {
        // The boundary a sloppy regex gets wrong.
        expect(sanitiseName('CONtext')).toBe('CONtext')
        expect(sanitiseName('COM10')).toBe('COM10')
    })

    test('keeps the characters the output suffixes depend on', () => {
        // ` (annotated)`, ` (highlights)` and ` (text)` are appended before the
        // name reaches here, so parentheses must survive untouched.
        expect(sanitiseName('Meeting (annotated)')).toBe('Meeting (annotated)')
        expect(sanitiseName('A & B, part 2')).toBe('A & B, part 2')
        expect(sanitiseName('名前')).toBe('名前')
    })

    test('caps length in bytes, not characters', () => {
        // ext4 and APFS cap a component at 255 BYTES, so a CJK name is three
        // times longer than its character count suggests.
        const cjk = '名'.repeat(200)
        expect(utf8.encode(sanitiseName(cjk)).length).toBeLessThanOrEqual(MAX_NAME_BYTES)
    })

    test('never splits a surrogate pair when truncating', () => {
        const emoji = '🙂'.repeat(100)
        const result = sanitiseName(emoji)
        // A split pair leaves a lone surrogate, which is not a valid code point
        // and encodes to U+FFFD, so a UTF-8 round trip no longer matches.
        expect(new TextDecoder().decode(utf8.encode(result))).toBe(result)
        expect(utf8.encode(result).length).toBeLessThanOrEqual(MAX_NAME_BYTES)
    })

    test('keeps two long names apart when both are truncated', () => {
        // The trap this discriminator exists for: the suffix is appended by the
        // caller BEFORE sanitising, so without it a long `X` and the same name
        // plus ` (annotated)` truncate to the same string and the annotated PDF
        // overwrites the source.
        const long = 'x'.repeat(200)
        expect(sanitiseName(long)).not.toBe(sanitiseName(`${long} (annotated)`))
    })

    test('is idempotent', () => {
        // Load-bearing: the migration reporter compares an old path against a
        // new one, and the wikilink and the writer sanitise the same stem
        // independently and must agree.
        for (const name of HOSTILE_NAMES) {
            const once = sanitiseName(name)
            expect(sanitiseName(once), `for ${JSON.stringify(name)}`).toBe(once)
        }
    })
})

describe('sanitiseRelativePath', () => {
    test('sanitises each segment separately', () => {
        // folderPath arrives pre-joined from the cloud service; treating it as
        // one name would flatten a real hierarchy into one hyphenated folder.
        expect(sanitiseRelativePath('Work/Q3:notes')).toBe('Work/Q3-notes')
    })

    test('drops traversal segments rather than sanitising them', () => {
        // `-/-/etc` would look deliberate. Dropping is what contains it.
        expect(sanitiseRelativePath('../../etc')).toBe('etc')
        expect(sanitiseRelativePath('./a')).toBe('a')
    })

    test('drops empty segments', () => {
        expect(sanitiseRelativePath('a//b')).toBe('a/b')
    })

    test('leaves an empty path empty', () => {
        // The builders guard on `if (targetFolder)`, so this must not become
        // `Untitled` or every path would gain a folder.
        expect(sanitiseRelativePath('')).toBe('')
    })

    test('is idempotent', () => {
        for (const path of ['../../etc', 'a//b', 'Work/Q3:notes', '', 'Trips/Japan']) {
            const once = sanitiseRelativePath(path)
            expect(sanitiseRelativePath(once), `for ${JSON.stringify(path)}`).toBe(once)
        }
    })
})

describe('validateVaultFolderPath', () => {
    test('accepts the vault root and an ordinary path', () => {
        expect(validateVaultFolderPath('')).toBeNull()
        expect(validateVaultFolderPath('reMarkable')).toBeNull()
        expect(validateVaultFolderPath('reMarkable/Notes')).toBeNull()
    })

    test('rejects traversal and unsafe characters', () => {
        expect(validateVaultFolderPath('../../etc')).toBeString()
        expect(validateVaultFolderPath('rM:notes')).toBeString()
        expect(validateVaultFolderPath('.hidden')).toBeString()
    })

    test('names the actual problem', () => {
        // One catch-all message about characters is baffling for `/notes`,
        // which contains no forbidden character at all.
        expect(validateVaultFolderPath('/notes')).toContain('absolute')
        expect(validateVaultFolderPath('C:\\notes')).toContain('absolute')
        expect(validateVaultFolderPath('a/../b')).toContain('..')
        expect(validateVaultFolderPath('a\\..\\b')).toContain('..')
        expect(validateVaultFolderPath('C# notes')).toContain('#')
    })

    test('rejects characters that only break wikilinks', () => {
        for (const value of ['a[b', 'a]b', 'a#b', 'a^b', 'a|b']) {
            expect(validateVaultFolderPath(value), `for ${value}`).toBeString()
        }
    })
})

describe('normaliseTargetFolderInput', () => {
    test('drops surrounding whitespace and trailing slashes only', () => {
        expect(normaliseTargetFolderInput('  reMarkable/  ')).toBe('reMarkable')
        expect(normaliseTargetFolderInput('reMarkable/Notes//')).toBe('reMarkable/Notes')
        // A leading slash is kept so the validator can refuse it by name.
        expect(normaliseTargetFolderInput('/notes')).toBe('/notes')
    })
})

describe('containVaultFolderPath', () => {
    test('keeps a traversal inside the vault', () => {
        expect(containVaultFolderPath('../../etc')).toBe('etc')
        expect(containVaultFolderPath('a/./b/../c')).toBe('a/b/c')
        expect(containVaultFolderPath('..\\..\\etc')).toBe('etc')
    })

    test('turns an absolute path into a vault-relative one', () => {
        expect(containVaultFolderPath('/notes')).toBe('notes')
        expect(containVaultFolderPath('C:\\notes\\rM')).toBe('notes/rM')
        expect(containVaultFolderPath('C:/notes')).toBe('notes')
    })

    test('keeps output out of hidden folders', () => {
        // The config folder is dot-prefixed by default, and Obsidian does not
        // index any dot-prefixed folder.
        expect(containVaultFolderPath('.config')).toBe('-config')
        expect(containVaultFolderPath('rM/.trash')).toBe('rM/-trash')
    })

    test('removes control characters', () => {
        expect(containVaultFolderPath('rM\u0007notes')).toBe('rMnotes')
    })

    test('leaves characters that are legal somewhere alone', () => {
        // Replacing these would move output an existing vault has been
        // writing successfully; that is deferred to the next major.
        for (const value of ['rM:notes', 'C# notes', 'a[b]', 'a^b', 'a|b', 'a:b', 'trailing. ']) {
            expect(containVaultFolderPath(value), `for ${value}`).toBe(value)
        }
    })

    test('leaves a usable path and the vault root alone', () => {
        expect(containVaultFolderPath('')).toBe('')
        expect(containVaultFolderPath('reMarkable/Notes')).toBe('reMarkable/Notes')
    })

    test('is idempotent', () => {
        for (const value of ['../../etc', '/notes', 'C:\\x', '.config', 'a//b', 'rM:notes']) {
            const once = containVaultFolderPath(value)
            expect(containVaultFolderPath(once), `for ${JSON.stringify(value)}`).toBe(once)
        }
    })
})
