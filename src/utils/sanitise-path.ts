import { log } from './log'

/**
 * Characters that cannot appear in a vault path component.
 *
 * This is the UNION of every platform's rules, applied on every host rather
 * than only the host's own. A vault is synced between machines: a name that is
 * legal on macOS and illegal on Windows is still a broken name, and the machine
 * that wrote it is not the machine that discovers that.
 *
 * `\ / : * ? " < >` and `|` are filesystem restrictions across Windows, Android
 * and the POSIX platforms. `[ ] # ^` are legal in a file name on macOS and
 * Linux but break an Obsidian wikilink, and `|` breaks one too: `#` reads as a
 * heading reference, `^` as a block reference, `|` as an alias separator, and
 * `]]` closes the link early.
 *
 * The trailing `+` collapses a RUN of replaced characters into a single
 * hyphen, so `a<>b` is `a-b` rather than `a--b`. Runs of hyphens the user typed
 * themselves are left alone, which is why `-` is deliberately not in the class.
 */
const UNSAFE_CHARACTERS = /[\\/:*?"<>|[\]#^]+/g

/**
 * Remove control characters.
 *
 * Removed rather than replaced: a hyphen standing in for an invisible byte is a
 * hyphen the user cannot explain, and no name carries meaning in U+0000-U+001F.
 *
 * Written as a code-point filter rather than a character class because a
 * control-character class is a `no-control-regex` error and the rule gate
 * refuses an inline disable. Iterating code points reads better regardless.
 */
function stripControlCharacters(value: string): string {
    let result = ''
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0
        if (code < 0x20 || 0x7f === code) continue
        result += char
    }
    return result
}

/** Obsidian excludes dot-prefixed files from the vault index entirely. */
const LEADING_DOTS = /^\.+/

/**
 * Windows strips a trailing dot or space at creation time, silently moving the
 * file, so they go here.
 *
 * `\s` rather than a literal space because this runs AFTER `trim()`: removing a
 * trailing dot can expose a non-breaking space or a BOM that `trim()` would
 * have taken, and there is no second trim to catch it. Matching all trimmable
 * whitespace keeps the result stable in one pass.
 *
 * Kept immediately after `truncate` on purpose. The `+$` shape is quadratic on
 * a long run, and the 150-byte cap in front of it is what makes that
 * unreachable. Do not move this above the truncate.
 */
const TRAILING_DOTS_AND_SPACES = /[\s.]+$/

const ONLY_HYPHENS = /^-+$/

/**
 * Reserved on Windows whatever the extension: `CON.md` is still `CON`.
 *
 * The forum thread this work came from does not mention these, but omitting
 * them would make the character rule portable and the name rule not, which is
 * incoherent. The failure without it is a bare `EINVAL` from the adapter, on
 * Windows only, with nothing in the message to explain it.
 *
 * `com0` and `lpt0` are included: modern Windows reserves them alongside 1-9.
 * The superscript forms are there because Windows folds `COM\u00b9`, `COM\u00b2`
 * and `COM\u00b3` onto `COM1`, `COM2` and `COM3`, so a name that looks
 * perfectly ordinary fails the same way.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
    'con',
    'prn',
    'aux',
    'nul',
    ...Array.from({ length: 10 }, (_, i) => `com${i}`),
    ...Array.from({ length: 10 }, (_, i) => `lpt${i}`),
    ...['\u00b9', '\u00b2', '\u00b3'].flatMap((digit) => [`com${digit}`, `lpt${digit}`])
])

/**
 * Append a hyphen to the reserved STEM, not to the whole component.
 *
 * Windows looks at the text before the FIRST dot, so `nul.tar` is as reserved
 * as `nul`. Suffixing the whole component would give `nul.tar-`, whose stem is
 * still `nul`, so it would stay reserved AND grow another hyphen on every
 * pass. Suffixing the stem gives `nul-.tar`, which is safe and stable, and
 * idempotence is a hard requirement here.
 */
function escapeReservedDeviceName(name: string): string | null {
    const dot = name.indexOf('.')
    const stem = dot <= 0 ? name : name.slice(0, dot)

    if (!RESERVED_DEVICE_NAMES.has(stem.toLowerCase())) {
        return null
    }

    return dot <= 0 ? `${name}-` : `${stem}-${name.slice(dot)}`
}

/** What a name becomes when sanitising leaves nothing usable. */
export const FALLBACK_NAME = 'Untitled'

/**
 * Longest permitted name, in UTF-8 BYTES rather than characters.
 *
 * ext4 and APFS cap a path component at 255 bytes, so a 100-character CJK name
 * is 300 bytes and fails. 150 leaves room for what callers append afterwards
 * (`-P001.jpeg`, `.pdf`, ` (annotated)`).
 *
 * This does NOT guarantee a path under Windows' 260-character limit, and it is
 * not trying to. `buildPagePath` spends the name TWICE (once as the image
 * folder, once as the file stem), so two names at this cap already exceed 260
 * before the vault root is counted. Per-component legality is what this cap
 * buys; whole-path length is a separate problem that a per-component rule
 * cannot solve.
 */
export const MAX_NAME_BYTES = 150

/** Bytes reserved for the `-` and the 6-character discriminator. */
const DISCRIMINATOR_BYTES = 7

const utf8 = new TextEncoder()

function byteLength(value: string): number {
    return utf8.encode(value).length
}

/**
 * djb2, rendered base36 and padded to 6 characters.
 *
 * Only used to keep two truncated names apart, so collision resistance matters
 * far more than cryptographic strength. Deterministic, which is what lets the
 * skip-if-unchanged write guard keep working across syncs.
 */
function discriminator(value: string): string {
    let hash = 5381
    for (const char of value) {
        // `| 0` keeps this in int32 rather than drifting into float territory.
        hash = ((hash << 5) + hash + char.codePointAt(0)!) | 0
    }
    return Math.abs(hash).toString(36).padStart(6, '0').slice(-6)
}

/**
 * Truncate to `MAX_NAME_BYTES`, appending a discriminator when it fires.
 *
 * The discriminator is not decoration. The ` (annotated)`, ` (highlights)` and
 * ` (text)` suffixes are appended by the caller BEFORE the name reaches here,
 * so a long `X` and the same name plus ` (annotated)` would truncate to the
 * identical string and the annotated PDF would overwrite the source. That is
 * strictly worse than the over-long name it set out to fix.
 *
 * Iterates code points, never `slice`, so a surrogate pair is never split in
 * half.
 */
function truncate(name: string): string {
    if (byteLength(name) <= MAX_NAME_BYTES) {
        return name
    }

    const budget = MAX_NAME_BYTES - DISCRIMINATOR_BYTES
    let stem = ''
    let used = 0
    for (const char of name) {
        const size = byteLength(char)
        if (used + size > budget) break
        stem += char
        used += size
    }

    return `${stem}-${discriminator(name)}`
}

export interface SanitiseOptions {
    /**
     * Log a warning when a name is shortened. Off for validation, which runs
     * on every keystroke in the settings pane and only needs the verdict.
     */
    readonly reportTruncation?: boolean
}

/**
 * Make one path COMPONENT safe to write into a vault.
 *
 * Idempotent by construction, and that is a requirement rather than a nicety:
 * `validateVaultFolderPath` accepts a value exactly when sanitising leaves it
 * unchanged, so a clean name must survive a second pass untouched.
 *
 * Not applied to notebook or folder names in the path builders yet: doing so
 * moves existing output to a new path, which is deferred to the next major
 * (see `documentation/plans/path-sanitisation.md`).
 *
 * Deliberately does NOT call Obsidian's `normalizePath`. That function carries
 * no doc comment and guarantees nothing about illegal characters, and it
 * applies Unicode NFC normalisation, which changes the BYTES of the path. Files
 * written by earlier versions on macOS may be recorded NFD; renormalising would
 * make `getAbstractFileByPath` miss them and rewrite every file on every sync.
 */
export function sanitiseName(name: string, options: SanitiseOptions = {}): string {
    let result = stripControlCharacters(name)
    result = result.replace(UNSAFE_CHARACTERS, '-')
    // Trim BEFORE the leading-dot check: `^\.+` does not match " .hidden", so
    // trimming afterwards exposed a dot with nothing left to catch it, and the
    // name kept the prefix Obsidian excludes from the vault index.
    result = result.trim()
    result = result.replace(LEADING_DOTS, '-')
    const untruncated = result
    result = truncate(result)
    if (result !== untruncated && (options.reportTruncation ?? true)) {
        log(`Name too long for a file path, shortened to "${result}"`, 'warn')
    }
    result = result.replace(TRAILING_DOTS_AND_SPACES, '')

    if ('' === result || ONLY_HYPHENS.test(result)) {
        // `///` reduces to `-`, which is legal but useless, and two different
        // garbage names would collide there anyway.
        return FALLBACK_NAME
    }

    return escapeReservedDeviceName(result) ?? result
}

/**
 * Make a multi-segment relative path safe, one component at a time.
 *
 * `folderPath` arrives pre-joined from the cloud service, so it has to be split
 * back apart: sanitising it as one name would turn a real hierarchy into a
 * single hyphenated folder.
 *
 * `.` and `..` segments are DROPPED rather than sanitised, so `../../etc`
 * becomes `etc` rather than `-/-/etc`. Sanitising them would leave a path that
 * looks deliberate; dropping them is what actually contains the traversal.
 * Empty segments go for the same reason, so `a//b` is `a/b`.
 */
export function sanitiseRelativePath(path: string, options: SanitiseOptions = {}): string {
    return path
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => '' !== segment && '.' !== segment && '..' !== segment)
        .map((segment) => sanitiseName(segment, options))
        .join('/')
}

/**
 * Normalise what someone typed into the target folder field before validating.
 *
 * Only whitespace around the value and trailing slashes go: `reMarkable/` is
 * what people type for a folder, and refusing it with a message about
 * characters would be baffling. Nothing inside the path is rewritten.
 */
export function normaliseTargetFolderInput(value: string): string {
    return value.trim().replace(/\/+$/, '')
}

/** A leading `/` or `\`, or a Windows drive letter such as `C:`. */
const ABSOLUTE_PATH = /^(?:[\\/]|[A-Za-z]:)/

/**
 * Whether a user-supplied target folder is usable as written.
 *
 * Returns a message to show, or null when the value is fine. Used where the
 * value should be REFUSED rather than quietly rewritten: silently changing what
 * someone just typed into a settings field is worse than telling them why it
 * cannot be used.
 *
 * An empty string is valid and means the vault root, which is the documented
 * default.
 */
export function validateVaultFolderPath(value: string): string | null {
    if ('' === value) {
        return null
    }

    if (ABSOLUTE_PATH.test(value)) {
        return 'Folder path must be relative to the vault root, not an absolute path.'
    }

    if (value.split(/[\\/]/).some((segment) => '.' === segment || '..' === segment)) {
        return 'Folder path cannot contain "." or ".." segments.'
    }

    if (sanitiseRelativePath(value, { reportTruncation: false }) !== value) {
        return 'Folder path cannot contain \\ : * ? " < > | [ ] # ^, empty segments, leading dots, or trailing dots or spaces.'
    }

    return null
}

/**
 * Keep a STORED target folder inside the vault, changing nothing else.
 *
 * Used on load, where the value cannot be refused (the path is non-interactive
 * and must never break startup) but must not be allowed to escape the vault or
 * land in a hidden folder. Deliberately narrower than `sanitiseRelativePath`:
 * a character like `#` or `:` is legal on some platforms, so a vault that has
 * been writing to such a folder keeps writing there. Replacing those
 * characters moves existing output and is deferred to the next major.
 *
 * - `\` is treated as a separator on every platform, since it is one on
 *   Windows: a vault synced there would otherwise read `..\..` as an escape.
 *   A folder with a literal `\` on Linux or macOS therefore becomes nested
 *   folders. The settings field refuses `\`, so only a value stored before
 *   2.2.0 or edited by hand can be affected.
 * - Empty (or whitespace-only), `.` and `..` segments are dropped, which also removes a leading
 *   `/` (an absolute path becomes vault-relative).
 * - A drive letter prefix (`C:\\` or `C:/`) is dropped; `a:b` is left alone.
 * - Control characters are removed.
 * - Leading dots become a hyphen, as in `sanitiseName`: Obsidian does not
 *   index dot-prefixed folders, and the vault configuration folder is one.
 */
export function containVaultFolderPath(value: string): string {
    return stripControlCharacters(value)
        .replace(/^[A-Za-z]:(?=[\\/])/, '')
        .split(/[\\/]/)
        .filter((segment) => '' !== segment.trim() && '.' !== segment && '..' !== segment)
        .map((segment) => segment.replace(LEADING_DOTS, '-'))
        .join('/')
}
