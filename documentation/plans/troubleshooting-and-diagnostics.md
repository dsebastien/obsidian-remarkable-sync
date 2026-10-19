# Troubleshooting and diagnostics (from #47)

Issue #47 took two weeks and five comments without a single file reaching the developer. The reporter (a PhD student on a reMarkable 2, PDFs uploaded through the official desktop app) hit three separate problems, and every one of them looked like a successful sync. This plan closes the gaps that thread exposed. Status: proposed.

## What the thread exposed

| Symptom                                          | Cause                                                                                                                                             | Status                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Original PDF written, no `(annotated)` copy      | Source PDF locked with an owner password (library databases). pdf-lib 1.17.1 refuses any encrypted file. The notice is transient and easy to miss | Reproduced with RC4 and AES owner-locked files                       |
| Yellow text highlights drawn as black bars       | The plugin draws the colour the device recorded. A reMarkable 2 records something near black for a highlight. Paper Pro records the chosen colour | Inferred from screenshots and the colour table, not from an rM2 file |
| Folders of ink-only JPEGs after a reinstall      | Defaults are `saveImages: true`, `savePdf: false`. Page images never contain the source PDF. Generated files are never deleted                    | Expected behaviour, undocumented                                     |
| Format 1 `.content` never mapped to source pages | `redirectionPageMap` was never read                                                                                                               | Fixed on this branch                                                 |

## 1. reMarkable 2 highlights

- Text highlights and highlighter strokes are never drawn black or dark grey. When the resolved colour (recorded ARGB or palette entry) has low luminance, use the yellow default (`#FFED75`). This matches the device's own PDF export, which renders rM2 highlights yellow.
- Both renderers (`pdf-annotator.service.ts`, `stroke-renderer.ts`) take the colour from `pen-model.ts`, so the guard lives in `highlightColour` and in `strokeColour` for highlighter pen types only. Ordinary pens keep black.
- Specs: colour 0 and 1 without ARGB, ARGB black with alpha 255, ARGB dark grey, and a real colour that must pass through unchanged.
- When an rM2 `.rmdoc` arrives, add its page as a fixture and pin the recorded value.

## 2. Encrypted source PDFs

- Move from `pdf-lib` 1.17.1 (unmaintained) to `@cantoo/pdf-lib` (MIT, same API, maintained). `PDFDocument.load(bytes, { password: '' })` decrypts a file locked with an owner password only, which is the library-database case. Verified in a scratch test on RC4-128 and AES-256 copies: the file loads, takes a stroke, and saves unlocked.
- A file that needs a real user password still fails. Report it as "needs a password to open" rather than "may be encrypted or too large".
- Specs need encrypted fixtures. pdf-lib cannot write them, so commit two tiny owner-locked PDFs (one RC4, one AES-256, generated once with `qpdf`) under `src/app/services/output/fixtures/`, plus the unlocked original. Cover: unlocked annotates, owner-locked annotates and the output carries no `/Encrypt`, user-password-locked returns the password failure.
- Record the decision (dependency swap) with an ADR.

## 3. Diagnosing from the issue thread

Until the bundle in section 6 exists, the docs carry a troubleshooting page with copy-and-paste steps for a non-technical user:

- Encryption check: paste `grep -a -c "/Encrypt" ` into Terminal, drag the PDF from Finder into the window, press Return. `0` is unlocked, `1` or more is locked. Also the Preview path (**Tools → Show Inspector**, Encryption pane) and the Acrobat path (**File → Properties → Security**).
- Where the PDF came from matters. Ask the source (publisher site, library database, scan, email) in the issue template.
- Raw document files: the desktop app keeps a xochitl-style copy under `~/Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop` (sandboxed app) or `~/Library/Application Support/remarkable/desktop` (older app), and `%APPDATA%/remarkable/desktop` on Windows. One Terminal line zips a document's `.metadata`, `.content`, `.pdf` and page folder into an `.rmdoc` on the Desktop. Verified against the folder layout.
- A GitHub issue template that asks for plugin version, device model, how PDFs reach the device, the encryption check result, and the bundle.

## 4. Defaults

- `saveImages: true, savePdf: false` serves a notebook user and fails a PDF user: a reinstall produces ink-only JPEG folders that read as "ghost annotations".
- Proposal: a source-backed document always writes its original and annotated copy, independent of `savePdf`, which then governs notebook PDFs only. The source is the document. Alternative: flip the defaults to `savePdf: true, saveImages: false`. Both change business rules and need the maintainer's decision.
- Either way, `docs/configuration.md` states that page images contain ink only, never the source PDF.

## 5. Failures that look like success

Today every outcome is a transient `Notice` (35 call sites, none with a longer timeout), so an auto sync run can skip annotations, hit an encrypted file or draw nothing and leave no trace once the notice fades.

- Record an outcome per document in the sync store: `lastOutcome: { kind: 'ok' | 'partial' | 'failed', reasons: string[], at: number }`. Reasons are stable codes with user text: `source-encrypted`, `source-needs-password`, `annotations-unplaced`, `pages-failed`, `source-too-large`.
- Panel row shows a status icon for `partial` and `failed` with the reason as tooltip. A "Needs attention" section at the top of the panel lists those documents until their next successful sync.
- One summary notice per run instead of one per document: "Synced 11 documents, 2 need attention (open the reMarkable panel)". Failure notices stay longer than success notices.
- Keep a ring buffer of the last 300 log lines in memory (`log.ts`), regardless of the debug toggle, for the bundle.

## 6. Support bundle

A command and a settings button, **Create support bundle**, that writes a zip into the vault under `<targetFolder>/_support/` and tells the user where it is. Nothing is uploaded. The modal lists exactly what goes in, with the document files behind an explicit checkbox.

Always included:

- `report.md`: plugin and Obsidian versions, platform, device model if known, settings with the secret name and token redacted, sync store summary (count, oldest and newest sync), last outcome per document, the log ring buffer.
- For every source-backed document with a recent `partial` or `failed` outcome: file name, size, `fileType`, `.content` format version, whether the PDF carries `/Encrypt` and which filter. The reporter then never has to run the grep themselves.

Opt-in, one checkbox per document:

- The raw document files as `<name>.rmdoc` (`.metadata`, `.content`, `.pagedata`, `.pdf` or `.epub`, page folder). The plugin already downloads all of them; `fflate/browser` provides `zipSync`.
- A second checkbox leaves the source PDF out of the `.rmdoc`, for copyrighted material. The `.rm` pages are what a highlight or mapping bug needs.

The troubleshooting docs page and the issue template point at this button first, and at the manual steps in section 3 only as a fallback.

## Order

Sections 1 and 2 need nothing from any reporter and fix the two visible breakages. Section 5 is the structural change the rest hangs off. Section 6 builds on 5. Sections 3 and 4 are docs and a maintainer decision.

## Open questions

- Maintainer decision on section 4 (business rule change).
- Bundle size and build check after the dependency swap in section 2 (`dist/main.js` `require(...)` scan, no Node builtins).
- The exact rM2 highlight value, confirmed when an rM2 `.rmdoc` arrives.
