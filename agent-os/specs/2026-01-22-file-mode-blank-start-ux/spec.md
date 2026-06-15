# Specification: File Mode Blank Start UX

## Overview

**Spec ID:** 2026-01-22-file-mode-blank-start-ux
**Status:** Draft
**Module:** Backend (Java) + Frontend (React/TypeScript)

This specification enables a clean "blank start" experience in File Mode (`includeDatabase=false`):
- App opens directly to a blank Architecture & Design workspace
- No forced "Import JSON/XLSX" screen on startup
- Export works immediately (even on blank project)
- Import remains available via Project menu

---

## Background

### Current Behavior (Problem)

When the app starts in File Mode:
1. `GET /api/project-session` returns **404** (no session exists)
2. Frontend sets `activeProject=null`
3. `MetaModelView` and `ProductView` render `NoProjectEmptyState`
4. User is **forced to import** before they can see the workspace
5. Export is blocked with toast: "Nothing to export yet - import a project snapshot first"

### Desired Behavior (Solution)

When the app starts in File Mode:
1. `GET /api/project-session` returns **200** with blank "Untitled" project
2. Frontend sets `activeProject` to the blank project
3. Views render the normal blank workspace (no empty-state blocker)
4. User can immediately work or export
5. Import remains available via Project menu

---

## Goals

1. **Blank Start** - File Mode opens to blank workspace, not import screen
2. **Export Always Works** - Export succeeds even on blank project
3. **Import Optional** - Import is menu-driven, not forced
4. **Identity Consistency** - Imported snapshots load correctly without identity mismatch

---

## Backend Changes

### A) Auto-Initialize Blank Session Project

**File:** `src/main/java/com/example/architecturemodel/store/SessionProjectStore.java`

**Changes:**

1. **Add method to ensure blank project exists:**

```java
/**
 * Ensures a session project exists, creating a blank one if needed.
 * Returns the current active project (creating if necessary).
 */
public synchronized ProjectDto ensureActiveProject() {
    if (activeProject == null) {
        activeProject = createBlankProject();
        activeSnapshot = createBlankSnapshot(activeProject);
    }
    return activeProject;
}

private ProjectDto createBlankProject() {
    return new ProjectDto(
        UUID.randomUUID(),
        "Untitled",           // Default name
        null,                 // projectParentFolder
        null,                 // projectHierarchy
        null,                 // organisationId
        true,                 // isActive
        Instant.now(),
        Instant.now()
    );
}

private ProjectSnapshotDto createBlankSnapshot(ProjectDto project) {
    return new ProjectSnapshotDto(
        new ProjectSnapshotMetaDto(1, Instant.now(), "session"),
        project,
        new ModelDto(new MetaModelDto(List.of(), List.of(), List.of()), List.of()),
        List.of(),  // workItems
        List.of()   // artifacts
    );
}
```

2. **Add method to ensure snapshot exists:**

```java
/**
 * Ensures a session snapshot exists, creating a blank one if needed.
 * Returns the current active snapshot (creating if necessary).
 */
public synchronized ProjectSnapshotDto ensureActiveSnapshot() {
    if (activeSnapshot == null) {
        // This also creates the project if needed
        ensureActiveProject();
    }
    return activeSnapshot;
}
```

**Note:** The `clear()` method remains unchanged - it sets both to null, allowing re-initialization on next access.

---

### B) Update ProjectSessionController GET Endpoints

**File:** `src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`

**Changes:**

1. **Update GET /api/project-session:**

```java
@GetMapping
public ResponseEntity<ProjectDto> getSessionProject() {
    // Auto-initialize blank project if none exists
    ProjectDto project = sessionProjectStore.ensureActiveProject();
    return ResponseEntity.ok(project);
}
```

**Before:** Threw `ResourceNotFoundException` if no project
**After:** Returns 200 with blank "Untitled" project

2. **Update GET /api/project-session/export:**

```java
@GetMapping("/export")
public ResponseEntity<ProjectSnapshotDto> exportSessionSnapshot() {
    // Auto-initialize blank snapshot if none exists
    ProjectSnapshotDto snapshot = sessionProjectStore.ensureActiveSnapshot();
    return ResponseEntity.ok(snapshot);
}
```

**Before:** Threw `ResourceNotFoundException` if no snapshot
**After:** Returns 200 with blank snapshot (empty model, no work items)

---

### C) Ensure Import Syncs Project Identity

**File:** `src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`

**Current behavior in POST /api/project-session/import:**
- Creates synthetic `ProjectDto` with new UUID
- Stores snapshot as-is from request

**Change:** Align snapshot's project with the active session project:

```java
@PostMapping("/import")
public ResponseEntity<ProjectSnapshotImportResultDto> importToSession(
        @RequestBody ProjectSnapshotImportRequestDto request) {

    // Create or update active session project
    ProjectDto sessionProject = new ProjectDto(
        UUID.randomUUID(),
        request.effectiveProjectName(),
        null,  // projectParentFolder
        null,  // projectHierarchy
        null,  // organisationId
        true,  // isActive
        Instant.now(),
        Instant.now()
    );

    // Normalize snapshot to use session project identity
    ProjectSnapshotDto normalizedSnapshot = new ProjectSnapshotDto(
        request.snapshot().meta(),
        sessionProject,  // Use session project, not snapshot.project
        request.snapshot().model(),
        request.snapshot().workItems(),
        request.snapshot().artifacts()
    );

    sessionProjectStore.setActiveProject(sessionProject, normalizedSnapshot);

    ProjectSnapshotImportResultDto result = new ProjectSnapshotImportResultDto(
        sessionProject,
        false,  // modelSaved (not persisted to DB)
        0, 0, 0, 0, 0, 0, 0, 0  // counts (not applicable for session)
    );

    return ResponseEntity.status(HttpStatus.CREATED).body(result);
}
```

**Key Change:** The stored snapshot's `project` field now matches the active session project exactly, avoiding identity mismatch on subsequent export.

---

### D) Update Backend Tests

**File:** `src/test/java/com/example/architecturemodel/store/SessionProjectStoreTest.java`

**Add tests:**
1. `ensureActiveProject_createsBlankProject_whenNoneExists`
2. `ensureActiveProject_returnsExisting_whenProjectExists`
3. `ensureActiveSnapshot_createsBlankSnapshot_whenNoneExists`
4. `ensureActiveSnapshot_returnsExisting_whenSnapshotExists`
5. `clear_resetsState_allowingReinitialization`

**File:** `src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java`

**Update tests:**
1. `GET /api/project-session` now returns 200 (not 404) when no prior session
2. `GET /api/project-session/export` now returns 200 (not 404) when no prior import
3. Add test: blank project has name "Untitled"
4. Add test: blank snapshot has empty model

---

## Frontend Changes

### E) Remove Forced Import Empty-State

**File:** `frontend/src/components/MetaModelView/MetaModelView.tsx`

**Current code (approximately line 58-66):**
```tsx
if (!includeDatabase && activeProject === null) {
  return (
    <NoProjectEmptyState
      onImportJson={triggerImportJson}
      onImportXlsx={triggerImportXlsx}
      isSessionMode={!includeDatabase}
    />
  );
}
```

**Change:** Remove this block entirely. The backend now always returns a project, so `activeProject` will never be null in File Mode after initialization.

**File:** `frontend/src/components/ProductView/ProductView.tsx`

**Same change:** Remove the `NoProjectEmptyState` block (approximately line 277-286).

---

### F) Remove Export Toast Guard

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Current code in handleExportJsonClick (approximately line 432-438):**
```tsx
if (!includeDatabase && !state.loadedFileName) {
  setNotification('Nothing to export yet - import a project snapshot first.');
  setTimeout(() => setNotification(null), 4000);
  return;
}
```

**Change:** Remove this guard. Export should proceed to call the API, which will return a valid (possibly blank) snapshot.

**Also update handleExportXlsxClick** if it has a similar guard.

---

### G) Update ProjectContext Initialization (Optional Cleanup)

**File:** `frontend/src/contexts/ProjectContext.tsx`

The current initialization logic already handles null gracefully, but since the backend now always returns a project in File Mode, we can simplify error handling:

```tsx
useEffect(() => {
  const initialize = async () => {
    setLoading(true);
    try {
      if (includeDatabase) {
        const project = await getActiveProject();
        setActiveProject(project);
        setActiveProjectSource(project ? 'db' : 'none');
      } else {
        // File Mode: backend always returns a project (blank or imported)
        const project = await getSessionProject();
        setActiveProject(project);
        setActiveProjectSource(project ? 'session' : 'none');
      }
    } catch (error) {
      console.error('Failed to fetch active project on init:', error);
      setActiveProject(null);
      setActiveProjectSource('none');
    } finally {
      setLoading(false);
    }
  };
  initialize();
}, [includeDatabase]);
```

**Note:** No functional change needed - the backend change makes `getSessionProject()` always return a project in File Mode. The frontend already handles this correctly.

---

### H) Update Frontend Tests

**File:** `frontend/src/__tests__/MetaModelView.empty-state.test.tsx` (or similar)

**Update/remove tests:**
- Remove or update tests that expect `NoProjectEmptyState` to render in File Mode
- Add test: MetaModelView renders blank workspace when `activeProject` is blank "Untitled" project

**File:** `frontend/src/__tests__/TopBar.export-toast.test.tsx` (or similar)

**Update/remove tests:**
- Remove tests for "Nothing to export yet" toast in File Mode
- Add test: Export proceeds without toast when project is blank

---

## Files Summary

### Backend - Modified Files

| File | Changes |
|------|---------|
| `SessionProjectStore.java` | Add `ensureActiveProject()`, `ensureActiveSnapshot()`, helper methods |
| `ProjectSessionController.java` | Update GET endpoints to use ensure methods, normalize import snapshot |
| `SessionProjectStoreTest.java` | Add 5 tests for ensure methods |
| `ProjectSessionControllerTest.java` | Update tests for 200 responses, add blank project tests |

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `MetaModelView.tsx` | Remove `NoProjectEmptyState` block |
| `ProductView.tsx` | Remove `NoProjectEmptyState` block |
| `TopBar.tsx` | Remove export toast guard |
| Test files | Update tests for new behavior |

---

## Testing Requirements

### Backend Tests

| Test File | Count | Coverage |
|-----------|-------|----------|
| `SessionProjectStoreTest.java` | +5 | Ensure methods, reinitialization |
| `ProjectSessionControllerTest.java` | ~4 updated | 200 responses, blank project |

### Frontend Tests

| Test File | Count | Coverage |
|-----------|-------|----------|
| View tests | ~2 updated | Remove empty-state expectations |
| TopBar tests | ~1 updated | Remove toast guard expectations |

### Manual Testing

1. Start app in File Mode (`include-database=false`)
2. Verify: Blank Architecture & Design workspace shown (no import screen)
3. Click Export → Verify: Download works, file contains blank "Untitled" project
4. Import a previously exported file → Verify: Data loads correctly
5. Export again → Verify: File matches imported data (no identity mismatch)

---

## Acceptance Criteria

1. **Blank Start**
   - In File Mode, app opens directly to blank Architecture & Design workspace
   - No `NoProjectEmptyState` / forced import screen on startup

2. **Export Always Works**
   - Export works immediately on blank project
   - No "Nothing to export yet" toast
   - Exported file contains valid blank project snapshot

3. **Import Optional**
   - Import only triggered via Project menu
   - Not forced on startup

4. **Identity Consistency**
   - Import sets active project correctly
   - Subsequent export produces coherent snapshot
   - No project/snapshot identity mismatch

---

## Out of Scope

- DB mode CRUD changes
- "Save/Save As" filesystem persistence
- Cross-session persistence without export
- Changes to NoProjectEmptyState component itself (just remove its usage in File Mode views)

---

## Dependencies

| Dependency | Status |
|------------|--------|
| Phase 4: Finalize DB/Session Separation | Complete |
| SessionProjectStore | Exists, needs enhancement |
| ProjectSessionController | Exists, needs modification |
| NoProjectEmptyState component | Exists, usage being removed |

---

## Risk Assessment

### Low Risk
- Backend changes are additive (new methods) or simplify existing behavior
- Frontend changes are removal of guards/blocks

### Medium Risk
- Test updates may uncover additional dependencies on "no project" state
- Need to ensure blank snapshot structure is valid for all downstream consumers

### Mitigation
- Run full test suite before and after changes
- Manual smoke test of import/export cycle
- Verify exported blank snapshot can be re-imported
