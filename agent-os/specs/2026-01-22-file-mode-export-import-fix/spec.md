# Specification: File Mode JSON Export/Import Fix

## Overview

**Spec ID:** 2026-01-22-file-mode-export-import-fix
**Status:** Draft
**Module:** Frontend (React/TypeScript)

This specification fixes the broken JSON export/import round-trip in File Mode:
- Export now captures the user's current in-memory model (from ArchitectureContext)
- Import now loads the imported model into ArchitectureContext immediately

---

## Background

### Current Behavior (Broken)

**Export Problem:**
1. User adds Business User row in UI
2. User clicks Export JSON
3. `executeJsonExport()` calls `exportSessionSnapshot()` (backend API)
4. Backend returns snapshot from SessionProjectStore (last import or blank)
5. **Result:** Exported JSON has no Business User (user's edits lost)

**Import Problem:**
1. User imports JSON file with Business User
2. `handleImportSuccess()` calls `loadModelByFilename(result.project.name)`
3. `loadModelByFilename()` calls `/api/model?filename=...` (DB-only endpoint)
4. Endpoint fails in File Mode (no DB)
5. Error is silently swallowed
6. **Result:** Model never loaded into ArchitectureContext, UI shows blank

### Root Cause

```
Frontend State (ArchitectureContext.state.model)
    ↑↓ No sync mechanism ↑↓
Backend State (SessionProjectStore.activeSnapshot)
```

- **Export:** Reads from backend (stale) instead of frontend (current)
- **Import:** Tries DB endpoint instead of using snapshot directly

---

## Goals

1. **Export captures UI state** - File Mode export includes current ArchitectureContext model
2. **Import loads immediately** - File Mode import dispatches LOAD_MODEL with snapshot
3. **Round-trip consistency** - Export → Import reproduces same content
4. **DB mode unchanged** - No changes to DB mode behavior

---

## Frontend Changes

### A) Fix File Mode JSON Export

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Current code in `executeJsonExport` (approximately line 395):**
```typescript
if (includeDatabase) {
  snapshot = await exportActiveProjectSnapshot();
} else {
  snapshot = await exportSessionSnapshot();  // <-- BROKEN: returns stale backend data
}
```

**Change:** In File Mode, build snapshot locally from ArchitectureContext state:

```typescript
const executeJsonExport = async (projectName: string) => {
  try {
    let snapshot: ProjectSnapshotDto;

    if (includeDatabase) {
      // DB mode: use existing backend endpoint
      const dbSnapshot = await exportActiveProjectSnapshot();
      if (!dbSnapshot) {
        setErrorMessages(['No active project to export']);
        setErrorModalOpen(true);
        return;
      }
      snapshot = dbSnapshot;
    } else {
      // File Mode: build snapshot from current ArchitectureContext state
      snapshot = buildLocalSnapshot(projectName);
    }

    // ... rest of export logic (download JSON)
  } catch (err) {
    // ... error handling
  }
};

/**
 * Build a ProjectSnapshotDto from current frontend state.
 * Used for File Mode export where backend doesn't have current UI edits.
 */
const buildLocalSnapshot = (projectName: string): ProjectSnapshotDto => {
  return {
    meta: {
      snapshot_version: 1,
      exported_at: new Date().toISOString(),
      export_kind: 'session',
    },
    project: activeProject ?? {
      id: crypto.randomUUID(),
      name: projectName,
      project_parent_folder: null,
      project_hierarchy: null,
      organisation_id: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    model: state.model,  // <-- Current ArchitectureContext model with user's edits
    work_items: [],      // Empty in File Mode (no ProductContext sync needed)
    artifacts: [],       // Empty in File Mode
  };
};
```

**Key Points:**
- `state.model` comes from ArchitectureContext (via `useArchitectureContext()`)
- Contains `metaModel` (entities, relationships) and `diagrams`
- This captures all user edits made in the UI
- `activeProject` comes from ProjectContext

---

### B) Fix File Mode JSON Import - Update Modal Callback

**File:** `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`

**Current callback signature:**
```typescript
interface ImportProjectSnapshotModalProps {
  // ...
  onImported: (result: ProjectSnapshotImportResultDto, setActive: boolean) => void;
}
```

**Change:** Pass full snapshot along with result:

```typescript
interface ImportProjectSnapshotModalProps {
  // ...
  onImported: (
    result: ProjectSnapshotImportResultDto,
    setActive: boolean,
    snapshot: ProjectSnapshotDto  // <-- Add snapshot parameter
  ) => void;
}
```

**Update the import handler call (approximately line 283):**
```typescript
// Before:
onImported(result, setActive);

// After:
onImported(result, setActive, pendingSnapshotJson!);
```

---

### C) Fix File Mode JSON Import - Update Success Handler

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Current `handleImportSuccess` (approximately lines 533-558):**
```typescript
const handleImportSuccess = async (result: ProjectSnapshotImportResultDto, setActive: boolean) => {
  try {
    if (setActive) {
      await refreshActiveProject();
      try {
        const model = await loadModelByFilename(result.project.name);  // <-- FAILS in File Mode
        dispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
      } catch {
        console.warn('Could not load model after import - model may not exist yet');
      }
    }
    // ... success notification
  } catch (error) {
    // ... error handling
  }
};
```

**Change:** Accept snapshot parameter and use it in File Mode:

```typescript
const handleImportSuccess = async (
  result: ProjectSnapshotImportResultDto,
  setActive: boolean,
  snapshot: ProjectSnapshotDto  // <-- New parameter
) => {
  try {
    if (setActive) {
      // 1. Refresh active project state (keeps header/project name correct)
      await refreshActiveProject();

      // 2. Load model into ArchitectureContext
      if (includeDatabase) {
        // DB mode: load from backend (existing behavior)
        try {
          const model = await loadModelByFilename(result.project.name);
          dispatch({ type: 'LOAD_MODEL', payload: model, fileName: result.project.name });
        } catch {
          console.warn('Could not load model after import - model may not exist yet');
        }
      } else {
        // File Mode: load directly from imported snapshot
        if (snapshot.model) {
          dispatch({
            type: 'LOAD_MODEL',
            payload: snapshot.model,
            fileName: result.project.name
          });
        } else {
          console.warn('Imported snapshot has no model data');
        }
      }
    }

    // Success notification
    setNotification(`Imported "${result.project.name}" successfully`);
    setTimeout(() => setNotification(null), 4000);
  } catch (error) {
    console.error('Failed to complete import:', error);
    setErrorMessages(['Failed to complete import. Please try again.']);
    setErrorModalOpen(true);
  }
};
```

**Key Points:**
- In File Mode, `snapshot.model` is used directly
- No backend call needed - model comes from the parsed JSON
- `LOAD_MODEL` action populates ArchitectureContext.state.model
- UI immediately reflects imported entities/diagrams

---

### D) Update TopBar Import Modal Usage

**File:** `frontend/src/components/TopBar/TopBar.tsx`

Update the modal component usage to pass the new callback signature:

```typescript
<ImportProjectSnapshotModal
  open={importSnapshotModalOpen}
  onClose={() => setImportSnapshotModalOpen(false)}
  onImported={handleImportSuccess}  // Now expects 3 parameters
  includeDatabase={includeDatabase}
  preloadedSnapshot={pendingSnapshotJson}
  preloadedSnapshotName={pendingSnapshotName}
/>
```

The modal will now call `onImported(result, setActive, snapshot)` with all three parameters.

---

### E) Type Definitions

**File:** `frontend/src/api/projectSnapshotApi.ts` (or types file)

Ensure `ProjectSnapshotDto` includes the model field with correct structure:

```typescript
export interface ProjectSnapshotDto {
  meta: {
    snapshot_version: number;
    exported_at: string;
    export_kind: string;
  };
  project: ProjectDto;
  model: ArchitectureModel;  // metaModel + diagrams
  work_items: WorkItemDto[];
  artifacts: ArtifactDto[];
}
```

The `ArchitectureModel` type should already be defined in ArchitectureContext:

```typescript
export interface ArchitectureModel {
  metaModel: MetaModel;
  diagrams: Diagram[];
}
```

---

## Files Summary

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | Add `buildLocalSnapshot()`, update `executeJsonExport()`, update `handleImportSuccess()` signature |
| `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` | Update `onImported` callback to pass snapshot |

### Frontend - No Changes Needed

| File | Reason |
|------|--------|
| `ArchitectureContext.tsx` | `LOAD_MODEL` action already works correctly |
| `projectSessionApi.ts` | Existing types are sufficient |
| Backend files | No backend changes required |

---

## Testing Requirements

### Unit Tests

**File:** `frontend/src/__tests__/TopBar.file-mode-export.test.tsx`

1. `buildLocalSnapshot_includesCurrentModelState`
   - Mock ArchitectureContext with test model data
   - Call `buildLocalSnapshot('TestProject')`
   - Verify snapshot.model matches context state

2. `executeJsonExport_usesLocalSnapshot_inFileMode`
   - Mock `includeDatabase=false`
   - Mock ArchitectureContext with Business User entity
   - Trigger export
   - Verify downloaded JSON contains Business User

3. `executeJsonExport_usesBackendSnapshot_inDbMode`
   - Mock `includeDatabase=true`
   - Trigger export
   - Verify `exportActiveProjectSnapshot()` was called

**File:** `frontend/src/__tests__/TopBar.file-mode-import.test.tsx`

4. `handleImportSuccess_dispatchesLoadModel_inFileMode`
   - Mock `includeDatabase=false`
   - Call `handleImportSuccess(result, true, snapshotWithModel)`
   - Verify `LOAD_MODEL` dispatched with snapshot.model

5. `handleImportSuccess_usesLoadModelByFilename_inDbMode`
   - Mock `includeDatabase=true`
   - Call `handleImportSuccess(result, true, snapshot)`
   - Verify `loadModelByFilename()` was called

6. `importModal_passesSnapshotToCallback`
   - Render ImportProjectSnapshotModal
   - Complete import flow
   - Verify `onImported` called with all 3 parameters

### Integration Tests

**File:** `frontend/src/__tests__/file-mode-roundtrip.test.tsx`

7. `exportImportRoundTrip_preservesModelContent`
   - Start with model containing Business User
   - Export to JSON
   - Clear state
   - Import the exported JSON
   - Verify Business User is restored

---

## Acceptance Criteria

1. **Export captures UI state**
   - In File Mode, after adding entities in UI, JSON export includes them
   - `snapshot.model.metaModel.entities.business_users` contains added rows

2. **Import loads immediately**
   - In File Mode, importing JSON loads model into UI immediately
   - Tables and diagrams show imported data without page refresh

3. **Round-trip consistency**
   - Export → Import reproduces same meta-model content
   - No data loss for entities, relationships, or diagrams

4. **DB mode unchanged**
   - DB mode export still calls `exportActiveProjectSnapshot()`
   - DB mode import still calls `loadModelByFilename()`

---

## Out of Scope

- Syncing frontend state to backend session store
- Work items or artifacts in File Mode export (empty arrays)
- Backend changes
- Auto-save functionality

---

## Dependencies

| Dependency | Status |
|------------|--------|
| ArchitectureContext with LOAD_MODEL | Exists |
| ProjectSnapshotDto type | Exists |
| ImportProjectSnapshotModal | Exists, needs callback change |
| File Mode blank start (prior spec) | Complete |

---

## Risk Assessment

### Low Risk
- Changes are isolated to File Mode (DB mode unchanged)
- `LOAD_MODEL` action already handles model loading correctly
- Snapshot structure is well-defined

### Medium Risk
- Callback signature change requires updating all callers of ImportProjectSnapshotModal
- Need to ensure `pendingSnapshotJson` is always available when `onImported` is called

### Mitigation
- Search for all usages of `onImported` callback
- Add null check for snapshot in `handleImportSuccess`
- Comprehensive testing of both modes
