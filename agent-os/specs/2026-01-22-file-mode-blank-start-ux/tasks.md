# Task Breakdown: File Mode Blank Start UX

## Overview

**Spec ID:** 2026-01-22-file-mode-blank-start-ux
**Total Tasks:** 18
**Estimated Effort:** 4-6 hours
**Module:** Backend (Java) + Frontend (React/TypeScript)

This task breakdown implements a clean "blank start" experience in File Mode where the app opens directly to a blank workspace instead of forcing an import screen.

---

## Task List

### Backend Layer

#### Task Group 1: SessionProjectStore Enhancement
**Dependencies:** None
**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/store/SessionProjectStore.java`

- [x] 1.0 Complete SessionProjectStore enhancement
  - [x] 1.1 Write 4 focused tests for new SessionProjectStore methods
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/store/SessionProjectStoreTest.java`
    - Test `ensureActiveProject_createsBlankProject_whenNoneExists`
    - Test `ensureActiveProject_returnsExisting_whenProjectExists`
    - Test `ensureActiveSnapshot_createsBlankSnapshot_whenNoneExists`
    - Test `ensureActiveSnapshot_returnsExisting_whenSnapshotExists`
  - [x] 1.2 Add `createBlankProject()` private helper method
    - Returns `ProjectDto` with:
      - `id`: `UUID.randomUUID()`
      - `name`: `"Untitled"`
      - `projectParentFolder`: `null`
      - `projectHierarchy`: `null`
      - `organisationId`: `null`
      - `isActive`: `true`
      - `createdAt`: `Instant.now()`
      - `updatedAt`: `Instant.now()`
  - [x] 1.3 Add `createBlankSnapshot(ProjectDto project)` private helper method
    - Returns `ProjectSnapshotDto` with:
      - `meta`: `new ProjectSnapshotMetaDto(1, Instant.now(), "session")`
      - `project`: passed project parameter
      - `model`: `new ModelDto(new MetaModelDto(List.of(), List.of(), List.of()), List.of())`
      - `workItems`: `List.of()`
      - `artifacts`: `List.of()`
  - [x] 1.4 Add `ensureActiveProject()` synchronized method
    - If `activeProject == null`: create blank project and blank snapshot
    - Return `activeProject`
  - [x] 1.5 Add `ensureActiveSnapshot()` synchronized method
    - If `activeSnapshot == null`: call `ensureActiveProject()`
    - Return `activeSnapshot`
  - [x] 1.6 Add required imports
    - `com.example.architecturemodel.model.dto.export.ProjectSnapshotMetaDto`
    - `com.example.architecturemodel.model.dto.ModelDto`
    - `com.example.architecturemodel.model.dto.MetaModelDto`
    - `java.time.Instant`
    - `java.util.List`
    - `java.util.UUID`
  - [x] 1.7 Ensure SessionProjectStore tests pass
    - Run: `mvn test -Dtest=SessionProjectStoreTest -pl architecture-model-service`
    - Verify all 4 new tests pass

**Acceptance Criteria:**
- `ensureActiveProject()` creates blank "Untitled" project when none exists
- `ensureActiveProject()` returns existing project when one exists
- `ensureActiveSnapshot()` creates blank snapshot when none exists
- `ensureActiveSnapshot()` returns existing snapshot when one exists
- Both methods are thread-safe (synchronized)
- All 4 tests pass

---

#### Task Group 2: ProjectSessionController Updates
**Dependencies:** Task Group 1
**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`

- [x] 2.0 Complete ProjectSessionController updates
  - [x] 2.1 Write 4 focused tests for controller endpoint changes
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java`
    - Test `getSessionProject_returns200WithBlankProject_whenNoSessionExists`
    - Test `exportSessionSnapshot_returns200WithBlankSnapshot_whenNoSessionExists`
    - Test `importToSession_normalizesSnapshotProjectIdentity`
    - Test `getSessionProject_returnsBlankProjectWithNameUntitled`
  - [x] 2.2 Update `getSessionProject()` to use `ensureActiveProject()`
    - Before: `sessionProjectStore.getActiveProject().orElseThrow(...)`
    - After: `sessionProjectStore.ensureActiveProject()`
    - Returns 200 with blank project (never 404)
  - [x] 2.3 Update `exportSessionSnapshot()` to use `ensureActiveSnapshot()`
    - Before: `sessionProjectStore.getActiveSnapshot().orElseThrow(...)`
    - After: `sessionProjectStore.ensureActiveSnapshot()`
    - Returns 200 with blank snapshot (never 404)
  - [x] 2.4 Update `importToSession()` to normalize snapshot identity
    - Create `normalizedSnapshot` that replaces `request.snapshot().project()` with `syntheticProject`
    - Store `normalizedSnapshot` instead of `request.snapshot()`
    - Ensures export after import returns coherent snapshot
  - [x] 2.5 Update Javadoc comments
    - Remove "@throws ResourceNotFoundException" from `getSessionProject()`
    - Remove "@throws ResourceNotFoundException" from `exportSessionSnapshot()`
    - Update method descriptions to reflect auto-initialization behavior
  - [x] 2.6 Ensure ProjectSessionController tests pass
    - Run: `mvn test -Dtest=ProjectSessionControllerTest -pl architecture-model-service`
    - Verify all 4 new/updated tests pass

**Acceptance Criteria:**
- GET `/api/project-session` returns 200 with blank "Untitled" project (never 404)
- GET `/api/project-session/export` returns 200 with blank snapshot (never 404)
- POST `/api/project-session/import` normalizes snapshot to use session project identity
- Subsequent export after import returns coherent snapshot
- All 4 tests pass

---

### Frontend Layer

#### Task Group 3: Remove Forced Import Empty-State
**Dependencies:** Task Group 2 (backend must return valid project)
**Files:**
- `frontend/src/components/MetaModelView/MetaModelView.tsx`
- `frontend/src/components/ProductView/ProductView.tsx`

- [x] 3.0 Complete removal of NoProjectEmptyState blocks
  - [x] 3.1 Write 2 focused tests for view rendering
    - File: `frontend/src/__tests__/MetaModelView.blank-start.test.tsx`
    - Test `MetaModelView_rendersBlankWorkspace_whenProjectIsUntitled`
    - Test `ProductView_rendersBlankWorkspace_whenProjectIsUntitled`
  - [x] 3.2 Remove NoProjectEmptyState block from MetaModelView.tsx
    - Locate block: `if (!includeDatabase && activeProject === null) { return <NoProjectEmptyState ... /> }`
    - Remove entire conditional block
    - Remove `NoProjectEmptyState` import if no longer used
  - [x] 3.3 Remove NoProjectEmptyState block from ProductView.tsx
    - Locate block: `if (!includeDatabase && activeProject === null) { return <NoProjectEmptyState ... /> }`
    - Remove entire conditional block
    - Remove `NoProjectEmptyState` import if no longer used
  - [x] 3.4 Remove or update related test files
    - Check for tests expecting `NoProjectEmptyState` to render in File Mode
    - Update tests to expect blank workspace instead
    - Remove obsolete test assertions
  - [x] 3.5 Ensure view component tests pass
    - Run: `npm test -- --testPathPattern="MetaModelView|ProductView" --run`
    - Verify views render correctly with blank "Untitled" project

**Acceptance Criteria:**
- MetaModelView renders blank workspace in File Mode (no import screen)
- ProductView renders blank workspace in File Mode (no import screen)
- No `NoProjectEmptyState` rendered when `activeProject` is blank "Untitled" project
- All 2 view tests pass

---

#### Task Group 4: Remove Export Guards
**Dependencies:** Task Group 2 (backend must return valid snapshot)
**File:** `frontend/src/components/TopBar/TopBar.tsx`

- [x] 4.0 Complete removal of export toast guards
  - [x] 4.1 Write 2 focused tests for export behavior
    - File: `frontend/src/__tests__/TopBar.export-guard.test.tsx`
    - Test `handleExportJsonClick_proceedsWithoutToast_whenBlankProject`
    - Test `handleExportXlsxClick_proceedsWithoutToast_whenBlankProject`
  - [x] 4.2 Remove toast guard from `handleExportJsonClick`
    - Locate guard: `if (!includeDatabase && !state.loadedFileName) { setNotification(...); return; }`
    - Remove entire conditional block
    - Export should proceed to call API which returns valid (possibly blank) snapshot
  - [x] 4.3 Remove toast guard from `handleExportXlsxClick` if present
    - Check for similar guard pattern
    - Remove if exists
  - [x] 4.4 Update or remove related test files
    - Check for tests expecting "Nothing to export yet" toast
    - Remove obsolete test assertions
    - Update tests to expect export to proceed
  - [x] 4.5 Ensure TopBar export tests pass
    - Run: `npm test -- --testPathPattern="TopBar" --run`
    - Verify export proceeds without toast guard

**Acceptance Criteria:**
- Export JSON proceeds without "Nothing to export yet" toast
- Export XLSX proceeds without toast (if guard existed)
- Export calls API which returns valid blank snapshot
- All 2 export tests pass

---

### Testing

#### Task Group 5: Integration Testing & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and verify end-to-end flow
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 4 tests from SessionProjectStore (Task 1.1)
    - Review 4 tests from ProjectSessionController (Task 2.1)
    - Review 2 tests from View components (Task 3.1)
    - Review 2 tests from TopBar export (Task 4.1)
    - Total existing tests: 12 tests
  - [x] 5.2 Analyze test coverage gaps for this feature
    - Identify any missing critical workflow coverage
    - Focus on File Mode startup -> blank workspace -> export flow
    - Focus on import -> export identity consistency
  - [x] 5.3 Write up to 4 additional integration tests if needed
    - Test: Full startup flow in File Mode returns blank project
    - Test: Export immediately after startup produces valid JSON
    - Test: Import then export maintains project identity
    - Test: Clear then access recreates blank project
  - [x] 5.4 Run all feature-specific tests
    - Backend: `mvn test -Dtest=SessionProjectStoreTest,ProjectSessionControllerTest -pl architecture-model-service`
    - Frontend: `npm test -- --testPathPattern="MetaModelView|ProductView|TopBar" --run`
    - Verify all tests pass (approximately 12-16 tests total)

**Acceptance Criteria:**
- All feature-specific tests pass
- File Mode startup -> blank workspace flow verified
- Export on blank project flow verified
- Import -> export identity consistency verified
- No more than 4 additional tests added if needed

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: SessionProjectStore Enhancement** (Backend)
   - Foundation for auto-initialization
   - No external dependencies

2. **Task Group 2: ProjectSessionController Updates** (Backend)
   - Depends on SessionProjectStore methods
   - Enables frontend to receive valid responses

3. **Task Group 3: Remove Forced Import Empty-State** (Frontend)
   - Depends on backend returning valid project
   - Removes import screen blocker

4. **Task Group 4: Remove Export Guards** (Frontend)
   - Depends on backend returning valid snapshot
   - Enables immediate export

5. **Task Group 5: Integration Testing** (Testing)
   - Verifies end-to-end flow
   - Fills any critical test gaps

---

## Files Summary

### Backend - Modified Files

| File | Changes |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/store/SessionProjectStore.java` | Add `ensureActiveProject()`, `ensureActiveSnapshot()`, `createBlankProject()`, `createBlankSnapshot()` |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java` | Update GET endpoints to use ensure methods, normalize import snapshot identity |
| `architecture-model-service/src/test/java/com/example/architecturemodel/store/SessionProjectStoreTest.java` | Add 4 tests for ensure methods + 2 integration tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java` | Add/update 4 tests for 200 responses and identity normalization |

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Remove `NoProjectEmptyState` block |
| `frontend/src/components/ProductView/ProductView.tsx` | Remove `NoProjectEmptyState` block |
| `frontend/src/components/TopBar/TopBar.tsx` | Remove export toast guards |
| `frontend/src/__tests__/MetaModelView.blank-start.test.tsx` | Add 2 tests for blank workspace rendering |
| `frontend/src/__tests__/TopBar.export-guard.test.tsx` | Add 2 tests for export without guard |

---

## Manual Testing Checklist

After all tasks complete, verify:

1. [ ] Start app in File Mode (`include-database=false`)
2. [ ] Verify: Blank Architecture & Design workspace shown (no import screen)
3. [ ] Verify: Project name shows "Untitled" in header/title
4. [ ] Click Export JSON -> Verify: Download works, file contains blank "Untitled" project
5. [ ] Click Export XLSX -> Verify: Download works (if XLSX export is supported)
6. [ ] Import a previously exported file -> Verify: Data loads correctly
7. [ ] Export again -> Verify: File matches imported data (no identity mismatch)
8. [ ] Clear session and refresh -> Verify: Returns to blank "Untitled" state

---

## Risk Mitigation

### Potential Issues

1. **DTO imports missing in SessionProjectStore**
   - Mitigation: Verify all required imports before testing (Task 1.6)

2. **Frontend tests expect null activeProject**
   - Mitigation: Search for and update tests expecting null state (Tasks 3.4, 4.4)

3. **Blank snapshot structure incompatible with downstream consumers**
   - Mitigation: Use same DTO structures as existing import/export

### Rollback Plan

If issues arise:
1. Backend changes are additive - revert to using `getActiveProject().orElseThrow()`
2. Frontend changes are removals - restore the conditional blocks
3. All changes are isolated to File Mode - DB mode unaffected
