# Sanitise notebook and folder names in vault paths (#40, breaking half)

Status: deferred to the next major. The non-breaking half shipped in 2.2.0 (folder-vs-file guards, target folder validation/containment, one `documentFileName` for the file and its link).

## Problem

`buildPagePath` / `buildDocumentPath` (`src/app/services/output/markdown-writer.service.ts`) join `targetFolder`, `folderPath` and `notebookName` raw:

- `/` inside a notebook name creates nested folders (`Q3/Q4 review`).
- `: * ? " < > |` are legal on macOS, illegal on Windows/Android: a synced vault breaks on the other machine.

## Why it is breaking

Output for affected notebooks lands at a new path. Links users wrote to the old files stop resolving. The plugin never moves, renames or deletes vault files, so the old copy stays behind.

## Work

- Apply `sanitiseName` (from `src/utils/sanitise-path.ts`) per segment inside both builders, while `folderPath` segments and `notebookName` are still distinct strings. Never sanitise the joined path.
- Folder segments: decide on a narrower character set than the union (do not refuse `#inbox`); the plugin only links to a bare file name. Notebook file names keep the union.
- Keep `documentFileName` the single source for the file name and the highlights-note link.
- Idempotence: sanitising an already-sanitised path is a no-op (fuzz-verified in the sanitiser; keep it so).
- Migration notice: when an old (unsanitised) path exists and differs from the new one, report both paths once. Do not move or delete the old file.
- Decide collisions before shipping: two notebooks with the same `visibleName` in one folder; `Q3/Q4` vs `Q3-Q4` after sanitising; case-insensitive filesystems (APFS, NTFS).
- Release as `feat!` with curated notes explaining the move and the notice.

## Acceptance

- Unit tests: builders sanitise each segment, never the separators they add; idempotent; link and file agree.
- Live vault: a notebook named `Q3/Q4 review` produces one file; the migration notice names old and new paths; existing output with ordinary names does not move.
