# Task Breakdown: Explicit Project Session API (Phase 3)

## Overview

**Spec ID:** 2026-01-22-explicit-project-session-api
**Total Tasks:** 28 (across 5 task groups)
**Estimated Effort:** Medium-Large

This spec introduces an explicit Project Session API (`/api/project-session/*`) that provides clear, intentional semantics for session-backed projects. The session endpoints work in BOTH DB and no-DB modes, creating a clean separation between DB-backed projects and session projects.

---

## Task List

### Backend Layer

#### Task Group 1: ProjectSessionController (Always-On)
**Dependencies:** None
**Engineer:** Backend/Java

- [x] 1.0 Complete ProjectSessionController implementation
  - [x] 1.1 Write 6 focused tests for ProjectSessionController
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java`
    - Test 1: `GET /api/project-session` returns 200 with project when session exists
    - Test 2: `GET /api/project-session` returns 404 when no session
    - Test 3: `POST /api/project-session/import` stores project and returns 201
    - Test 4: `GET /api/project-session/export` returns snapshot when session exists
    - Test 5: `GET /api/project-session/export` returns 404 when no session
    - Test 6: `POST /api/project-session/clear` clears session and returns 204
  - [x] 1.2 Create ProjectSessionController with GET endpoint
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`
    - No `@ConditionalOnProperty` - always available
    - Inject `SessionProjectStore` via constructor (required dependency)
    - Implement `@GetMapping` returning `ResponseEntity<ProjectDto>`
    - Return 200 with project data when session exists
    - Throw `ResourceNotFoundException` when no session project
  - [x] 1.3 Implement POST /import endpoint
    - Accept `ProjectSnapshotImportRequestDto` as `@RequestBody`
    - Create synthetic `ProjectDto` with generated UUID
    - Use `request.effectiveProjectName()` for project name
    - Store project and snapshot in `SessionProjectStore`
    - Return `ProjectSnapshotImportResultDto` with `modelSaved=false`, counts=0
    - Return HTTP 201 status
  - [x] 1.4 Implement GET /export endpoint
    - Return `ResponseEntity<ProjectSnapshotDto>`
    - Delegate to `sessionProjectStore.getActiveSnapshot()`
    - Return 200 with snapshot when exists
    - Throw `ResourceNotFoundException` when no session snapshot
  - [x] 1.5 Implement POST /clear endpoint
    - Call `sessionProjectStore.clear()`
    - Return `ResponseEntity.noContent()` (HTTP 204)
    - Should be idempotent (succeed even when no session)
  - [x] 1.6 Ensure ProjectSessionController tests pass
    - Run the 6 tests written in 1.1
    - Verify all endpoints return correct status codes
    - Verify endpoints work regardless of `includeDatabase` setting

**Acceptance Criteria:**
- All 6 tests pass
- Controller is always available (no conditional property)
- GET returns 200/404 correctly
- POST /import returns 201 with synthetic project
- POST /clear is idempotent (204 even when empty)
- All endpoints work in both DB and no-DB modes

---

#### Task Group 2: Deprecation Logging in ActiveProjectController
**Dependencies:** None (can run in parallel with Task Group 1)
**Engineer:** Backend/Java

- [x] 2.0 Add deprecation logging to ActiveProjectController
  - [x] 2.1 Write 3 focused tests for deprecation logging
    - **File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ActiveProjectControllerDeprecationTest.java`
    - Test 1: GET /active logs deprecation warning when `includeDatabase=false`
    - Test 2: GET /active/export logs deprecation warning when `includeDatabase=false`
    - Test 3: POST /import logs deprecation warning when `includeDatabase=false`
    - Use log capture or mock logging to verify warnings
  - [x] 2.2 Add deprecation warning to getActiveProject()
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ActiveProjectController.java`
    - Check `if (!appFeaturesProperties.isIncludeDatabase())`
    - Log `[DEPRECATION] /api/projects/active called in no-DB mode. Use /api/project-session instead.`
    - Place warning BEFORE existing implementation
    - Do NOT change behavior - warning only
  - [x] 2.3 Add deprecation warning to exportActiveProjectSnapshot()
    - Same pattern as 2.2
    - Log `[DEPRECATION] /api/projects/active/export called in no-DB mode. Use /api/project-session/export instead.`
  - [x] 2.4 Add deprecation warning to importSnapshot()
    - Same pattern as 2.2
    - Log `[DEPRECATION] /api/projects/import called in no-DB mode. Use /api/project-session/import instead.`
  - [x] 2.5 Ensure deprecation logging tests pass
    - Run the 3 tests written in 2.1
    - Verify warnings are logged correctly
    - Verify no behavior changes (endpoints still work)

**Acceptance Criteria:**
- All 3 tests pass
- Deprecation warnings logged when `includeDatabase=false`
- No runtime errors from deprecation code
- Existing behavior unchanged (warnings are advisory only)

---

### Frontend API Layer

#### Task Group 3: Session API Client
**Dependencies:** Task Group 1 (backend endpoints must exist)
**Engineer:** Frontend/TypeScript

- [x] 3.0 Complete projectSessionApi client
  - [x] 3.1 Write 5 focused tests for projectSessionApi
    - **File:** `frontend/src/__tests__/projectSessionApi.test.ts`
    - Test 1: `getSessionProject()` returns project data on 200
    - Test 2: `getSessionProject()` returns null on 404
    - Test 3: `importToSession()` sends correct request body and returns result
    - Test 4: `exportSessionSnapshot()` returns snapshot on 200, null on 404
    - Test 5: `clearSession()` calls POST and handles success
    - Use `fetch` mocking pattern from existing API tests
  - [x] 3.2 Create projectSessionApi.ts with type definitions
    - **File:** `frontend/src/api/projectSessionApi.ts`
    - Define `API_BASE` constant (same pattern as projectSnapshotApi.ts)
    - Import `ProjectDto` from `projectsApi.ts`
    - Import/re-export relevant types from `projectSnapshotApi.ts`
  - [x] 3.3 Implement getSessionProject() function
    - `GET /api/project-session`
    - Return `ProjectDto | null`
    - Return null on 404 (no session)
    - Throw Error on other failures
    - Map response from snake_case using `mapProjectFromSnake`
  - [x] 3.4 Implement importToSession() function
    - `POST /api/project-session/import`
    - Accept `ProjectSnapshotImportRequestDto`
    - Build request body with snake_case fields
    - Return `ProjectSnapshotImportResultDto`
    - Map response using `mapImportResultFromSnake`
  - [x] 3.5 Implement exportSessionSnapshot() function
    - `GET /api/project-session/export`
    - Return `ProjectSnapshotDto | null`
    - Return null on 404
    - Return raw JSON (no transformation, like exportActiveProjectSnapshot)
  - [x] 3.6 Implement clearSession() function
    - `POST /api/project-session/clear`
    - Return `Promise<void>`
    - Throw Error on non-ok response
  - [x] 3.7 Ensure projectSessionApi tests pass
    - Run the 5 tests written in 3.1
    - Verify all functions handle success/error cases

**Acceptance Criteria:**
- All 5 tests pass
- API client follows established patterns from projectSnapshotApi.ts
- Handles 404 gracefully (returns null, not error)
- Correctly maps snake_case responses to camelCase

---

### Frontend Context Layer

#### Task Group 4: ProjectContext with Source Tracking
**Dependencies:** Task Group 3 (session API client needed)
**Engineer:** Frontend/TypeScript

- [x] 4.0 Extend ProjectContext with activeProjectSource
  - [x] 4.1 Write 4 focused tests for ProjectContext source tracking
    - **File:** `frontend/src/__tests__/ProjectContext.activeProjectSource.test.tsx`
    - Test 1: In DB mode, activeProjectSource is 'db' when project loaded
    - Test 2: In DB mode, activeProjectSource is 'none' when no project
    - Test 3: In no-DB mode, activeProjectSource is 'session' when project loaded
    - Test 4: In no-DB mode, activeProjectSource is 'none' when no project
    - Mock useIncludeDatabase hook and API calls
  - [x] 4.2 Add ProjectSource type and update interface
    - **File:** `frontend/src/contexts/ProjectContext.tsx`
    - Add type: `type ProjectSource = 'db' | 'session' | 'none';`
    - Add `activeProjectSource: ProjectSource` to `ProjectContextType`
  - [x] 4.3 Add activeProjectSource state
    - Add `const [activeProjectSource, setActiveProjectSource] = useState<ProjectSource>('none');`
    - Include in context value object
  - [x] 4.4 Update initialization logic for mode-aware loading
    - Import `useIncludeDatabase` from AppConfigContext
    - Import `getSessionProject` from projectSessionApi
    - Update `useEffect` initialization:
      - If `includeDatabase`: call `getActiveProject()`, set source to 'db' or 'none'
      - If `!includeDatabase`: call `getSessionProject()`, set source to 'session' or 'none'
  - [x] 4.5 Create useActiveProjectSource hook
    - Export new hook that returns `context.activeProjectSource`
    - Follow pattern of existing hooks (throw if no context)
  - [x] 4.6 Update refreshActiveProject for mode awareness
    - In DB mode: call `getActiveProject()`
    - In no-DB mode: call `getSessionProject()`
    - Update source state accordingly
  - [x] 4.7 Ensure ProjectContext tests pass
    - Run the 4 tests written in 4.1
    - Verify source tracking works in both modes

**Acceptance Criteria:**
- All 4 tests pass
- `activeProjectSource` correctly reflects 'db', 'session', or 'none'
- Initialization loads from correct API based on mode
- `useActiveProjectSource` hook exported and functional

---

### Frontend UI Layer

#### Task Group 5: Import/Export Flow Routing and Empty-State Updates
**Dependencies:** Task Groups 3 and 4
**Engineer:** Frontend/TypeScript

- [x] 5.0 Update import/export flows and empty-state messaging
  - [x] 5.1 Write 4 focused tests for import/export routing
    - **File:** `frontend/src/__tests__/TopBar.import-export-routing.test.tsx`
    - Test 1: In DB mode, JSON export calls `exportActiveProjectSnapshot`
    - Test 2: In no-DB mode, JSON export calls `exportSessionSnapshot`
    - Test 3: In DB mode, import calls `importProjectSnapshot`
    - Test 4: In no-DB mode, import calls `importToSession`
    - Mock the API functions and useIncludeDatabase hook
  - [x] 5.2 Update TopBar JSON export flow
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
    - Import `exportSessionSnapshot` from projectSessionApi
    - Update `executeJsonExport`:
      - If `includeDatabase`: use existing `exportActiveProjectSnapshot`
      - If `!includeDatabase`: use `exportSessionSnapshot`
  - [x] 5.3 Update TopBar import flow
    - Import `importToSession` from projectSessionApi
    - Update `handleImportSuccess` or add routing in `ImportProjectSnapshotModal`:
      - If `includeDatabase`: use existing `importProjectSnapshot`
      - If `!includeDatabase`: use `importToSession`
    - Note: May need to update `ImportProjectSnapshotModal` props or create helper
  - [x] 5.4 Update NoProjectEmptyState with isSessionMode prop
    - **File:** `frontend/src/components/EmptyState/NoProjectEmptyState.tsx`
    - Add optional `isSessionMode?: boolean` prop to interface
    - Update heading: `No project loaded{isSessionMode ? ' in this session' : ''}`
    - Keep sub-text unchanged (generic messaging)
  - [x] 5.5 Update MetaModelView empty-state usage
    - **File:** `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Import `useActiveProjectSource` hook (when available)
    - Pass `isSessionMode={!includeDatabase}` to NoProjectEmptyState
    - Condition: show empty-state when `activeProjectSource === 'none'` (alternative to current check)
  - [x] 5.6 Update ProductView empty-state usage
    - **File:** `frontend/src/components/ProductView/ProductView.tsx`
    - Same changes as 5.5
    - Pass `isSessionMode={!includeDatabase}` to NoProjectEmptyState
  - [x] 5.7 Ensure import/export routing tests pass
    - Run the 4 tests written in 5.1
    - Verify correct API calls based on mode

**Acceptance Criteria:**
- All 4 tests pass
- Export uses correct endpoint based on `includeDatabase`
- Import uses correct endpoint based on `includeDatabase`
- Empty-state shows "in this session" suffix when in session mode
- User behavior unchanged (same UX, cleaner implementation)

---

## Test Coverage Summary

### Backend Tests
| Test File | Count | Coverage |
|-----------|-------|----------|
| `ProjectSessionControllerTest.java` | 6 | All session endpoints |
| `ActiveProjectControllerDeprecationTest.java` | 3 | Deprecation logging |
| **Total Backend** | **9** | |

### Frontend Tests
| Test File | Count | Coverage |
|-----------|-------|----------|
| `projectSessionApi.test.ts` | 5 | API client functions |
| `ProjectContext.activeProjectSource.test.tsx` | 4 | Source tracking |
| `TopBar.import-export-routing.test.tsx` | 4 | Import/export routing |
| **Total Frontend** | **13** | |

### Total Tests: 22

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel Backend):
  Task Group 1: ProjectSessionController
  Task Group 2: Deprecation Logging

Phase 2 (Frontend API):
  Task Group 3: Session API Client

Phase 3 (Frontend Context):
  Task Group 4: ProjectContext Source Tracking

Phase 4 (Frontend UI):
  Task Group 5: Import/Export Routing & Empty-State
```

### Dependency Graph

```
TG1 (Backend Controller) ----+
                             |
TG2 (Deprecation Logging)    |  (Parallel)
                             |
                             v
                    TG3 (API Client)
                             |
                             v
                    TG4 (Context)
                             |
                             v
                    TG5 (UI Updates)
```

---

## Files Summary

### Backend - New Files

| File | Purpose |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java` | Session API endpoints |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java` | Session controller tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ActiveProjectControllerDeprecationTest.java` | Deprecation logging tests |

### Backend - Modified Files

| File | Changes |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ActiveProjectController.java` | Add deprecation logging for 3 endpoints |

### Frontend - New Files

| File | Purpose |
|------|---------|
| `frontend/src/api/projectSessionApi.ts` | Session API client |
| `frontend/src/__tests__/projectSessionApi.test.ts` | API client tests |
| `frontend/src/__tests__/ProjectContext.activeProjectSource.test.tsx` | Source tracking tests |
| `frontend/src/__tests__/TopBar.import-export-routing.test.tsx` | Routing tests |

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `frontend/src/contexts/ProjectContext.tsx` | Add `activeProjectSource` state and `useActiveProjectSource` hook |
| `frontend/src/components/TopBar/TopBar.tsx` | Route import/export by mode |
| `frontend/src/components/EmptyState/NoProjectEmptyState.tsx` | Add `isSessionMode` prop |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Pass `isSessionMode` to empty-state |
| `frontend/src/components/ProductView/ProductView.tsx` | Pass `isSessionMode` to empty-state |
| `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` | Add `includeDatabase` prop for mode-aware import routing |

---

## Technical Notes

### Key Patterns to Follow

1. **Backend Controller Pattern** (from BootstrapController):
   - No `@ConditionalOnProperty` - always available
   - Constructor injection for required dependencies
   - Use `@Slf4j` for logging

2. **Frontend API Client Pattern** (from projectSnapshotApi.ts):
   - Handle 404 as null return (not error)
   - Map snake_case to camelCase
   - Preserve raw JSON for snapshots

3. **Context Hook Pattern** (from ProjectContext.tsx):
   - Single context with multiple hooks
   - Throw if used outside provider
   - Memoize callbacks where appropriate

### Existing Components to Reference

- `SessionProjectStore.java` - Already has all needed methods
- `ActiveProjectController.java` - Reference for import logic
- `projectSnapshotApi.ts` - Reference for API client patterns
- `ProjectContext.tsx` - Reference for context patterns
- `AppConfigContext.tsx` - Reference for `useIncludeDatabase` hook
