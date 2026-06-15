# Specification: Finalize DB/Session Separation (Phase 4)

## Overview

**Spec ID:** 2026-01-22-finalize-db-session-separation
**Status:** Draft
**Phase:** 4 of multi-phase DB/Session separation

This specification completes the refactor so that:
- `/api/projects/**` is strictly **DB-backed project CRUD + DB active project**
- `/api/project-session/**` is strictly **session (file/import) project state**
- No endpoint multiplexes DB and session behavior
- Frontend uses the correct API based on bootstrap capabilities, with no legacy fallbacks

---

## Background

### Completed in Prior Phases

| Phase | Spec ID | Summary |
|-------|---------|---------|
| 1 | 2026-01-22-session-backed-active-project | `SessionProjectStore`, `ActiveProjectController` with multiplexing |
| 2 | 2026-01-22-no-db-mode-empty-state-ux | Empty-state UI, File Mode indicator, toast guidance |
| 3 | 2026-01-22-explicit-project-session-api | `ProjectSessionController`, `projectSessionApi.ts`, `activeProjectSource` tracking |

### Current State (After Phase 3)

**Backend:**
- `ActiveProjectController.java` - Always-on, multiplexes between DB and session based on `includeDatabase`
- `ProjectSessionController.java` - Always-on, pure session endpoints
- `ProjectController.java` - DB-conditional, provides DB CRUD operations

**Frontend:**
- `ProjectContext.tsx` - Mode-aware with `activeProjectSource` tracking
- `TopBar.tsx` - Routes import/export by mode
- `projectSessionApi.ts` - Session-specific API client
- `projectSnapshotApi.ts` - DB snapshot API client (used in DB mode)

### Problem to Solve

`ActiveProjectController` still multiplexes DB and session behavior. This creates:
1. Confusion about which endpoint serves which purpose
2. Deprecation warnings in logs during normal operation
3. No hard boundary between DB and session APIs

---

## Goals

1. **Hard Separation** - `/api/projects/**` is DB-only, `/api/project-session/**` is session-only
2. **No Multiplexing** - Remove all "if DB then X else session" logic from controllers
3. **Clean 404s** - DB endpoints return 404 when DB disabled (not session fallback)
4. **Frontend Stability** - No legacy fallbacks, clean mode-based routing
5. **Contract Clarity** - API contracts are explicit and stable for future work

---

## Backend Changes

### A) Make ActiveProjectController DB-Conditional

**File:** `src/main/java/com/example/architecturemodel/controller/ActiveProjectController.java`

**Current State:**
- Always-on controller (no `@ConditionalOnProperty`)
- Multiplexes: checks `appFeaturesProperties.isIncludeDatabase()` in each endpoint
- Logs deprecation warnings when called in no-DB mode

**Changes:**

1. **Add `@ConditionalOnProperty` annotation:**
```java
@RestController
@RequestMapping("/api/projects")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ActiveProjectController {
```

2. **Remove multiplexing logic** from all endpoints:
   - Remove `if (!appFeaturesProperties.isIncludeDatabase())` branches
   - Remove deprecation warning logs
   - Remove `SessionProjectStore` dependency
   - Remove `handleNoDbImport()` method

3. **Simplify endpoints to DB-only:**
   - `GET /api/projects/active` - Delegates to `ProjectService.getActiveProject()`
   - `GET /api/projects/active/export` - Delegates to `ProjectSnapshotService.exportActiveProjectSnapshot()`
   - `POST /api/projects/import` - Delegates to `ProjectSnapshotImportService.importSnapshot()`

**Result:**
- Controller only loads when `includeDatabase=true`
- When `includeDatabase=false`, these endpoints return 404 (no handler registered)
- Clean DB-only implementation with no session awareness

---

### B) Verify ProjectSessionController Remains Always-On

**File:** `src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`

**Current State:** Already correct - always-on, no `@ConditionalOnProperty`

**Verification:**
- Confirm no conditional property annotation
- Confirm endpoints work in both DB and no-DB modes
- Endpoints: GET `/api/project-session`, POST `/import`, GET `/export`, POST `/clear`

**No changes required** - this controller is the session-only API.

---

### C) Verify ProjectController Remains DB-Conditional

**File:** `src/main/java/com/example/architecturemodel/controller/ProjectController.java`

**Current State:** Already correct - has `@ConditionalOnProperty`

**Verification:**
- Confirm `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Endpoints for DB CRUD: create, list, activate, delete

**No changes required** - this controller is already DB-only.

---

### D) Remove Unused Code from ActiveProjectController

After making it DB-conditional, remove:

1. **Field:** `private final SessionProjectStore sessionProjectStore;`
2. **Field:** `private final AppFeaturesProperties appFeaturesProperties;`
3. **Method:** `handleNoDbImport(ProjectSnapshotImportRequestDto request)`
4. **All deprecation logging code**
5. **All `if (!appFeaturesProperties.isIncludeDatabase())` branches**

**Constructor changes:**
```java
// Before:
public ActiveProjectController(
    ProjectService projectService,
    ProjectSnapshotService projectSnapshotService,
    ProjectSnapshotImportService projectSnapshotImportService,
    SessionProjectStore sessionProjectStore,
    AppFeaturesProperties appFeaturesProperties
) { ... }

// After:
public ActiveProjectController(
    ProjectService projectService,
    ProjectSnapshotService projectSnapshotService,
    ProjectSnapshotImportService projectSnapshotImportService
) { ... }
```

---

### E) Update Tests for ActiveProjectController

**File:** `src/test/java/com/example/architecturemodel/controller/ActiveProjectControllerTest.java`

**Changes:**
1. Remove tests for no-DB mode behavior (these endpoints no longer exist in no-DB mode)
2. Keep tests for DB-mode behavior
3. Update test setup to not mock `SessionProjectStore` or `AppFeaturesProperties`

**File:** `src/test/java/com/example/architecturemodel/controller/ActiveProjectControllerDeprecationTest.java`

**Action:** Delete this file entirely - deprecation logging is removed.

---

### F) Add Smoke Tests for API Contract Stability

**File:** `src/test/java/com/example/architecturemodel/controller/ApiContractSmokeTest.java`

**Tests:**

1. **No-DB Mode Smoke Test:**
   - Set `app.features.include-database=false`
   - `GET /api/projects/active` returns 404
   - `GET /api/projects/active/export` returns 404
   - `POST /api/projects/import` returns 404
   - `GET /api/project-session` returns 200 or 404 (depending on session state)
   - `POST /api/project-session/import` returns 201

2. **DB Mode Smoke Test:**
   - Set `app.features.include-database=true`
   - `GET /api/projects/active` returns 200 or 404 (depending on DB state)
   - `GET /api/project-session` returns 200 or 404 (session still available)

---

## Frontend Changes

### G) Remove Legacy Fallback Patterns (Verification)

Based on exploration, the frontend already implements clean mode-based routing:

**ProjectContext.tsx:**
- Already routes to `getActiveProject()` (DB) or `getSessionProject()` (session) based on `includeDatabase`
- No fallback patterns found

**TopBar.tsx:**
- Already routes export to `exportActiveProjectSnapshot()` (DB) or `exportSessionSnapshot()` (session)
- No fallback patterns found

**ImportProjectSnapshotModal.tsx:**
- Already routes import to `importProjectSnapshot()` (DB) or `importToSession()` (session)
- No fallback patterns found

**Verification Task:** Review and confirm no "try endpoint A, then fallback to endpoint B" patterns exist.

---

### H) Stabilize activeProjectSource State

**File:** `frontend/src/contexts/ProjectContext.tsx`

**Current Implementation:** Already tracks `'db' | 'session' | 'none'`

**Verification:**
- Confirm state updates correctly on project load/clear
- Confirm all views that check `activeProject` also consider `activeProjectSource`

**No changes expected** - verification only.

---

### I) Add Frontend Smoke Tests

**File:** `frontend/src/__tests__/api-contract-routing.test.ts`

**Tests:**

1. **DB Mode Routing:**
   - When `includeDatabase=true`, ProjectContext calls `getActiveProject()`
   - When `includeDatabase=true`, export calls `exportActiveProjectSnapshot()`
   - When `includeDatabase=true`, import calls `importProjectSnapshot()`

2. **Session Mode Routing:**
   - When `includeDatabase=false`, ProjectContext calls `getSessionProject()`
   - When `includeDatabase=false`, export calls `exportSessionSnapshot()`
   - When `includeDatabase=false`, import calls `importToSession()`

3. **No Fallback Verification:**
   - When `includeDatabase=false`, `getActiveProject()` is never called
   - When `includeDatabase=true`, `getSessionProject()` is never called for initialization

---

## Documentation

### J) Update Developer Documentation

**File:** `README.md` or `docs/API_CONTRACTS.md` (if exists)

Add section:

```markdown
## API Contracts

### DB Mode (`app.features.include-database=true`)
- **Project CRUD:** `/api/projects/*` - Create, list, activate, delete
- **Active Project:** `/api/projects/active` - Get/export active project
- **Import:** `/api/projects/import` - Import snapshot to DB

### Session Mode (`app.features.include-database=false`)
- **Session Project:** `/api/project-session` - Get session project
- **Import:** `/api/project-session/import` - Import snapshot to session
- **Export:** `/api/project-session/export` - Export session snapshot
- **Clear:** `/api/project-session/clear` - Clear session

### Always Available
- **Bootstrap:** `/api/bootstrap` - Get feature toggles
- **Session Endpoints:** `/api/project-session/*` - Available in both modes

### Behavior by Mode
| Endpoint | DB Mode | No-DB Mode |
|----------|---------|------------|
| `GET /api/projects/active` | 200/404 | 404 |
| `GET /api/project-session` | 200/404 | 200/404 |
| `POST /api/projects/import` | 201 | 404 |
| `POST /api/project-session/import` | 201 | 201 |
```

---

## Files Summary

### Backend - Modified Files

| File | Changes |
|------|---------|
| `ActiveProjectController.java` | Add `@ConditionalOnProperty`, remove multiplexing, remove session dependencies |
| `ActiveProjectControllerTest.java` | Remove no-DB mode tests, simplify to DB-only |

### Backend - Deleted Files

| File | Reason |
|------|--------|
| `ActiveProjectControllerDeprecationTest.java` | Deprecation logging removed |

### Backend - New Files

| File | Purpose |
|------|---------|
| `ApiContractSmokeTest.java` | Smoke tests for API contract stability |

### Frontend - New Files

| File | Purpose |
|------|---------|
| `api-contract-routing.test.ts` | Verify mode-based routing, no fallbacks |

### Frontend - Verification Only

| File | Action |
|------|--------|
| `ProjectContext.tsx` | Verify no fallbacks, clean mode routing |
| `TopBar.tsx` | Verify no fallbacks, clean mode routing |
| `ImportProjectSnapshotModal.tsx` | Verify no fallbacks, clean mode routing |

---

## Testing Requirements

### Backend Tests

| Test File | Count | Coverage |
|-----------|-------|----------|
| `ActiveProjectControllerTest.java` | ~6 | DB-only endpoint behavior |
| `ApiContractSmokeTest.java` | 4-6 | API contract by mode |

### Frontend Tests

| Test File | Count | Coverage |
|-----------|-------|----------|
| `api-contract-routing.test.ts` | 6 | Mode-based routing verification |

### Total New Tests: ~12-18

---

## Acceptance Criteria

1. **No endpoint returns session-backed data under `/api/projects/**`**
   - `ActiveProjectController` is DB-conditional
   - Returns 404 when `includeDatabase=false`

2. **No endpoint returns DB-backed data under `/api/project-session/**`**
   - `ProjectSessionController` remains session-only
   - No DB service dependencies

3. **Frontend never calls DB endpoints when `includeDatabase=false`**
   - `ProjectContext` uses `getSessionProject()` in no-DB mode
   - Import/export use session APIs in no-DB mode

4. **Frontend never depends on legacy fallbacks**
   - No "try X, then fallback to Y" patterns
   - Clean mode-based routing throughout

5. **"No active project" handled cleanly with 404 and appropriate UI**
   - 404 from either API results in `activeProjectSource='none'`
   - Empty-state UI renders correctly

6. **API contracts explicit and stable**
   - Documentation updated
   - Smoke tests verify contracts

---

## Out of Scope

- Removing `/api/project-session/**` endpoints (they remain always-on)
- Changes to `SessionProjectStore` implementation
- Changes to `ProjectController` (already DB-conditional)
- Changes to bootstrap endpoint
- Persisting session projects across browser reloads
- Multiple concurrent sessions

---

## Dependencies

| Dependency | Status |
|------------|--------|
| Phase 1: SessionProjectStore | Complete |
| Phase 2: Empty-State UX | Complete |
| Phase 3: ProjectSessionController | Complete |
| Phase 3: projectSessionApi.ts | Complete |
| Phase 3: activeProjectSource tracking | Complete |

---

## Risk Assessment

### Low Risk
- `ActiveProjectController` changes are straightforward (add annotation, remove code)
- Frontend already implements correct routing (verification only)

### Medium Risk
- Test changes may uncover additional dependencies
- Removing deprecation tests requires care to not break other tests

### Mitigation
- Run full test suite before and after changes
- Verify backend compilation in both modes
- Manual smoke test of import/export flows
