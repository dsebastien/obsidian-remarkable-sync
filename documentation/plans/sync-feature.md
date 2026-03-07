# Notebook Sync Feature Plan

## Goal

Support synchronizing reMarkable notebooks (one, multiple, or all). Each listed notebook should visually indicate its sync status.

## Design

### Sync State Tracking

- Store sync metadata per notebook in plugin data (via `saveData`/`loadData`)
- Track: `lastSyncedAt` (local timestamp), `lastModifiedCloud` (cloud timestamp), `syncedPageCount`
- Compare cloud `lastModified` vs local `lastSyncedAt` to determine sync status

### New Types

```typescript
// In src/app/domain/sync-state.ts
interface NotebookSyncState {
    remarkableId: string
    lastSyncedAt: number // epoch ms, 0 = never synced
    lastModifiedCloud: number // epoch ms from cloud
    syncedPageCount: number
}

// In plugin settings or separate store
interface SyncStore {
    notebooks: Record<string, NotebookSyncState> // keyed by remarkableId
}
```

### Sync Status Enum

```typescript
type SyncStatus = 'synced' | 'needs-sync' | 'never-synced'
```

Derived by comparing `lastSyncedAt` vs `lastModifiedCloud`:

- `never-synced`: `lastSyncedAt === 0`
- `synced`: `lastSyncedAt >= lastModifiedCloud`
- `needs-sync`: `lastSyncedAt < lastModifiedCloud`

### UI Changes (Panel View)

1. **Per-notebook sync indicator**: colored dot or icon next to each notebook name
    - Green check = synced
    - Orange refresh = needs sync
    - Grey circle = never synced
2. **Per-notebook sync button**: replaces current download button (or augments it)
3. **"Sync all" button** in panel header: syncs all notebooks that need it
4. **Multi-select**: checkboxes to select multiple notebooks, then "Sync selected" action

### Pipeline Changes

- After successful download+render, update the notebook's sync state in the store
- Pipeline already has progress callbacks — reuse for sync progress

### Settings Changes

- No new settings needed initially (sync uses existing targetFolder, saveImages, imageFormat)

## Implementation Steps

1. Create `src/app/domain/sync-state.ts` with types
2. Create `src/app/services/sync/sync-store.service.ts` — load/save sync state via plugin data
3. Update `NotebookPipelineService` — after successful processing, update sync state
4. Update `RemarkablePanelView`:
    - Show sync status indicator per notebook
    - Add "Sync all" button to header
    - Add multi-select with "Sync selected"
    - Update download button to be a "Sync" button
5. Add CSS for sync status indicators in `src/styles.src.css`
6. Update documentation (Architecture, Business Rules, Domain Model, usage docs)
7. Write tests for sync state logic

## Business Rules

- Sync state persists across sessions (stored in plugin data)
- A notebook is "synced" when its local data matches or is newer than cloud version
- "Sync all" only processes notebooks with `needs-sync` or `never-synced` status
- Sync state is cleared when user disconnects from reMarkable cloud
