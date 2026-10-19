---
type: decision
id: 0003
status: proposed
date: 2026-10-19
domain: architecture
context: home
systems: [obsidian-plugin, remarkable]
source_repo: github.com/dsebastien/obsidian-remarkable-sync
project: obsidian-remarkable-sync
supersedes: null
related: [0001, 0002]
---

# What a PDF-backed document writes when "Save as PDF" is off

## Context

Found while working on #47. The defaults are `saveImages: true` and `savePdf: false`. For a notebook that is a reasonable starting point: one image per page, no PDF unless asked. For a document imported from a PDF it means the only output is a folder of page images, and page images contain the ink alone, never the PDF text, because the renderer draws the `.rm` layer and knows nothing about the source. A fresh install or a reinstall therefore produces what the reporter in #47 called "ghost annotations": folders of JPEGs showing highlights and handwriting floating on white.

The reporter had reinstalled the plugin to try to fix an unrelated problem, synced before changing any setting, and then read the result as a third bug. The behaviour is documented nowhere, and nothing in the plugin says that the images never include the source.

## Options considered

**Leave the defaults and document them.** Smallest change. The surprise remains for every PDF-first user who installs the plugin, and a documentation line is read after the surprise, not before.

**Flip the defaults to `savePdf: true`, `saveImages: false`.** A PDF per notebook and the original plus annotated copy for PDF-backed documents, images on request. Existing installs are unaffected (settings persist), so this only changes what a new user sees first. Notebook-first users lose the loose images by default and have to turn them on.

**A PDF-backed document always writes its original and its annotated copy, independent of `savePdf`.** `savePdf` then governs notebook PDFs only. The source is the document: a sync that drops it is not a sync of that document in any useful sense, and the annotated copy is the only output that shows the ink in context. Page images for PDF-backed documents stay governed by `saveImages`. This changes a documented business rule ("PDF export is opt-in via `savePdf`") and adds output for existing users who have `savePdf` off and PDF-backed documents in their account.

## Decision

Proposed, not taken. This changes a documented business rule, so it is the maintainer's call. The recommendation is the third option: a PDF-backed document always writes its original and its annotated copy. The second option is the fallback if changing the meaning of `savePdf` is unwanted.

Whichever is chosen, `docs/configuration.md` states that page images contain the ink only and never the source PDF.

## Consequences

- Third option: the business rule under "Source-backed documents" changes from "with `savePdf` enabled" to "always"; `renderAndWritePages` writes the source and annotated copy whenever `sourceDocument` is present; the `writesSourceOnly` short-circuit in the pipeline drops its `savePdf` condition. Existing users with PDF-backed documents and `savePdf` off gain two files per document on their next sync of it.
- Second option: `DEFAULT_SETTINGS` changes; nothing else does. The settings documentation and README table update their default column.
- Either way the docs gain the line about page images, and the reinstall case in #47 stops looking like a bug.
