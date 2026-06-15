# Specification: Explicit Project Session API

## Overview

**Spec ID:** 2026-01-22-explicit-project-session-api
**Status:** Draft
**Phase:** 3 of multi-phase DB/Session separation

This specification introduces an explicit **Project Session API** that provides clear, intentional semantics for session-backed projects. The session endpoints work in BOTH DB and no-DB modes, creating a clean separation between:
- **DB-backed projects** (`/api/projects/*`) - Persistent storage in PostgreSQL
- **Session projects** (`/api/project-session/*`) - In-memory, ephemeral storage

---

## Background

### Current State (After Phase 1 & 2)
- `ActiveProjectController` multiplexes DB and session modes via `if/else` on `includeDatabase`
- Frontend calls `/api/projects/active` regardless of mode
- `SessionProjectStore` exists but is only used as a hidden fallback
- No explicit API contract for session-only operations

### Problems with Current Approach
1. `/api/projects/active` conflates two different concepts (DB project vs session project)
2. Session behavior is implicit and undocumented
3. Difficult to reason about, test, and extend
4. No clear path for features that need session semantics in DB mode

---

## Goals

1. **Explicit Session API** - First-class endpoints for session project operations
2. **Works in Both Modes** - Session endpoints available regardless of `includeDatabase`
3. **Clean Separation** - DB endpoints for DB, session endpoints for session
4. **Backward Compatible** - Existing behavior unchanged for users
5. **Deprecation Path** - Soft deprecation signals for cross-mode usage

---

## Backend Changes

### A) New ProjectSessionController (Always-On)

Create a new controller that is always available, regardless of `includeDatabase`:

**File:** `src/main/java/com/example/architecturemodel/controller/ProjectSessionController.java`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/project-session` | Get current session project |
| `POST` | `/api/project-session/import` | Import snapshot into session |
| `GET` | `/api/project-session/export` | Export session snapshot |
| `POST` | `/api/project-session/clear` | Clear session project |

**Implementation Details:**

```java
@RestController
@RequestMapping("/api/project-session")
@Slf4j
public class ProjectSessionController {

    private final SessionProjectStore sessionProjectStore;

    // Constructor injection - no optional dependencies

    @GetMapping
    public ResponseEntity<ProjectDto> getSessionProject() {
        return sessionProjectStore.getActiveProject()
            .map(ResponseEntity::ok)
            .orElseThrow(() -> new ResourceNotFoundException("No session project."));
    }

    @PostMapping("/import")
    public ResponseEntity<ProjectSnapshotImportResultDto> importToSession(
            @RequestBody ProjectSnapshotImportRequestDto request) {
        // Create synthetic ProjectDto
        // Store in SessionProjectStore
        // Return result with modelSaved=false, counts=0
    }

    @GetMapping("/export")
    public ResponseEntity<ProjectSnapshotDto> exportSessionSnapshot() {
        return sessionProjectStore.getActiveSnapshot()
            .map(ResponseEntity::ok)
            .orElseThrow(() -> new ResourceNotFoundException("No session project."));
    }

    @PostMapping("/clear")
    public ResponseEntity<Void> clearSession() {
        sessionProjectStore.clear();
        return ResponseEntity.noContent().build();
    }
}
```

**Key Points:**
- No `@ConditionalOnProperty` - always available
- No optional service injection - only uses `SessionProjectStore`
- Consistent with `BootstrapController` pattern
- Returns 404 via `ResourceNotFoundException` when no session project

---

### B) Deprecation Logging for Cross-Mode Usage

Add deprecation warnings when `/api/projects/active`, `/api/projects/active/export`, or `/api/projects/import` are called while `includeDatabase=false`.

**File:** `src/main/java/com/example/architecturemodel/controller/ActiveProjectController.java`

**Changes:**

```java
@GetMapping("/active")
public ResponseEntity<ProjectDto> getActiveProject() {
    if (!appFeaturesProperties.isIncludeDatabase()) {
        log.warn("[DEPRECATION] /api/projects/active called in no-DB mode. " +
                 "Use /api/project-session instead. This will be removed in a future version.");
    }
    // ... existing implementation
}

@GetMapping("/active/export")
public ResponseEntity<ProjectSnapshotDto> exportActiveProjectSnapshot() {
    if (!appFeaturesProperties.isIncludeDatabase()) {
        log.warn("[DEPRECATION] /api/projects/active/export called in no-DB mode. " +
                 "Use /api/project-session/export instead. This will be removed in a future version.");
    }
    // ... existing implementation
}

@PostMapping("/import")
public ResponseEntity<ProjectSnapshotImportResultDto> importSnapshot(...) {
    if (!appFeaturesProperties.isIncludeDatabase()) {
        log.warn("[DEPRECATION] /api/projects/import called in no-DB mode. " +
                 "Use /api/project-session/import instead. This will be removed in a future version.");
    }
    // ... existing implementation
}
```

**Note:** These are warnings only - no behavior change. Purpose is to make coupling visible during development.

---

### C) Test Coverage

**File:** `src/test/java/com/example/architecturemodel/controller/ProjectSessionControllerTest.java`

**Tests:**
1. `GET /api/project-session` returns 200 with project when session exists
2. `GET /api/project-session` returns 404 when no session
3. `POST /api/project-session/import` stores project and returns 201
4. `POST /api/project-session/import` returns synthetic ProjectDto with generated UUID
5. `GET /api/project-session/export` returns snapshot when session exists
6. `GET /api/project-session/export` returns 404 when no session
7. `POST /api/project-session/clear` clears session and returns 204
8. `POST /api/project-session/clear` returns 204 even when no session (idempotent)
9. All endpoints work when `includeDatabase=true` (both modes)
10. All endpoints work when `includeDatabase=false`

---

## Frontend Changes

### D) New Session API Client

**File:** `frontend/src/api/projectSessionApi.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Get the current session project.
 * Returns null if no session project exists (404).
 */
export async function getSessionProject(): Promise<ProjectDto | null> {
    const response = await fetch(`${API_BASE}/api/project-session`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to get session project: ${response.status}`);
    return mapProjectFromSnake(await response.json());
}

/**
 * Import a snapshot into the session.
 */
export async function importToSession(
    req: ProjectSnapshotImportRequestDto
): Promise<ProjectSnapshotImportResultDto> {
    const response = await fetch(`${API_BASE}/api/project-session/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            snapshot: req.snapshot,
            import_as_name: req.importAsName,
            set_active: req.setActive ?? true,
        }),
    });
    if (!response.ok) throw new Error(`Failed to import to session: ${response.status}`);
    return mapImportResultFromSnake(await response.json());
}

/**
 * Export the session project snapshot.
 * Returns null if no session project exists (404).
 */
export async function exportSessionSnapshot(): Promise<ProjectSnapshotDto | null> {
    const response = await fetch(`${API_BASE}/api/project-session/export`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to export session: ${response.status}`);
    return response.json();
}

/**
 * Clear the session project.
 */
export async function clearSession(): Promise<void> {
    const response = await fetch(`${API_BASE}/api/project-session/clear`, {
        method: 'POST',
    });
    if (!response.ok) throw new Error(`Failed to clear session: ${response.status}`);
}
```

---

### E) Extend ProjectContext with Source Tracking

**File:** `frontend/src/contexts/ProjectContext.tsx`

**Updated Types:**

```typescript
type ProjectSource = 'db' | 'session' | 'none';

interface ProjectContextType {
    activeProject: ProjectDto | null;
    activeProjectSource: ProjectSource;
    loading: boolean;
    refreshActiveProject: () => Promise<void>;
    clearActiveProject: () => void;
}
```

**Updated Initialization Logic:**

```typescript
const includeDatabase = useIncludeDatabase();

const initialize = useCallback(async () => {
    setLoading(true);
    try {
        if (includeDatabase) {
            // DB mode: load from /api/projects/active
            const project = await getActiveProject();
            setActiveProject(project);
            setActiveProjectSource(project ? 'db' : 'none');
        } else {
            // No-DB mode: load from /api/project-session
            const project = await getSessionProject();
            setActiveProject(project);
            setActiveProjectSource(project ? 'session' : 'none');
        }
    } catch (error) {
        console.error('Failed to load project:', error);
        setActiveProject(null);
        setActiveProjectSource('none');
    } finally {
        setLoading(false);
    }
}, [includeDatabase]);
```

**New Hook:**

```typescript
export function useActiveProjectSource(): ProjectSource {
    const context = useContext(ProjectContext);
    if (!context) throw new Error('useActiveProjectSource must be used within ProjectProvider');
    return context.activeProjectSource;
}
```

---

### F) Update Import/Export Flows to Route by Mode

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Import Flow Changes:**

```typescript
const handleImportSuccess = async (result: ProjectSnapshotImportResultDto, setActive: boolean) => {
    if (setActive) {
        await refreshActiveProject();
        // ... rest of existing logic
    }
};

// In handleFileChange or modal confirmation:
const performImport = async (snapshot: ProjectSnapshotDto, options: ImportOptions) => {
    const request = { snapshot, ...options };

    if (includeDatabase) {
        // DB mode: use existing endpoint
        return importProjectSnapshot(request);
    } else {
        // No-DB mode: use session endpoint
        return importToSession(request);
    }
};
```

**Export Flow Changes:**

```typescript
const executeJsonExport = async (projectName: string) => {
    let snapshot: ProjectSnapshotDto | null;

    if (includeDatabase) {
        // DB mode: use existing endpoint
        snapshot = await exportActiveProjectSnapshot();
    } else {
        // No-DB mode: use session endpoint
        snapshot = await exportSessionSnapshot();
    }

    if (!snapshot) {
        setNotification('No active project to export.');
        // ...
    }
    // ... rest of export logic
};
```

---

### G) Update Empty-State Messaging

When `activeProjectSource === 'none'` in no-DB mode, update messaging:

**File:** `frontend/src/components/EmptyState/NoProjectEmptyState.tsx`

```typescript
interface NoProjectEmptyStateProps {
    onImportJson: () => void;
    onImportXlsx: () => void;
    isSessionMode?: boolean; // New prop
}

// In render:
<h2>No project loaded{isSessionMode ? ' in this session' : ''}</h2>
<p>Import a project snapshot to begin working.</p>
```

**Usage in views:**

```typescript
const includeDatabase = useIncludeDatabase();
const activeProjectSource = useActiveProjectSource();

if (activeProjectSource === 'none') {
    return (
        <NoProjectEmptyState
            onImportJson={...}
            onImportXlsx={...}
            isSessionMode={!includeDatabase}
        />
    );
}
```

---

## Testing Requirements

### Backend Tests

| Test File | Tests |
|-----------|-------|
| `ProjectSessionControllerTest.java` | 10 tests for all session endpoints |

### Frontend Tests

| Test File | Tests |
|-----------|-------|
| `projectSessionApi.test.ts` | 4 tests for API client functions |
| `ProjectContext.activeProjectSource.test.tsx` | 4 tests for source tracking |
| `TopBar.import-routing.test.tsx` | 3 tests for import flow routing |
| `TopBar.export-routing.test.tsx` | 3 tests for export flow routing |

---

## Files Summary

### Backend - New Files

| File | Purpose |
|------|---------|
| `src/main/java/.../controller/ProjectSessionController.java` | Session API endpoints |
| `src/test/java/.../controller/ProjectSessionControllerTest.java` | Tests |

### Backend - Modified Files

| File | Changes |
|------|---------|
| `src/main/java/.../controller/ActiveProjectController.java` | Add deprecation logging |

### Frontend - New Files

| File | Purpose |
|------|---------|
| `frontend/src/api/projectSessionApi.ts` | Session API client |
| `frontend/src/__tests__/projectSessionApi.test.ts` | API client tests |

### Frontend - Modified Files

| File | Changes |
|------|---------|
| `frontend/src/contexts/ProjectContext.tsx` | Add `activeProjectSource` state and hook |
| `frontend/src/components/TopBar/TopBar.tsx` | Route import/export by mode |
| `frontend/src/components/EmptyState/NoProjectEmptyState.tsx` | Session-aware messaging |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Pass `isSessionMode` to empty-state |
| `frontend/src/components/ProductView/ProductView.tsx` | Pass `isSessionMode` to empty-state |

---

## Acceptance Criteria

1. **Backend exposes `/api/project-session/*` endpoints**
   - All four endpoints work in both DB and no-DB modes
   - Endpoints return correct status codes (200, 201, 204, 404)
   - 10 backend tests pass

2. **Frontend no longer relies on `/api/projects/active` in no-DB mode**
   - `ProjectContext` uses `getSessionProject()` when `includeDatabase=false`
   - Import uses `importToSession()` when `includeDatabase=false`
   - Export uses `exportSessionSnapshot()` when `includeDatabase=false`

3. **DB and session flows are cleanly separated**
   - `activeProjectSource` correctly tracks 'db', 'session', or 'none'
   - No mixing of endpoint calls across modes

4. **User behavior unchanged**
   - Same UX as Phase 2
   - Same import/export flows
   - Same empty-state messaging (slightly refined for session mode)

5. **Deprecation logging visible**
   - Warnings logged when `/api/projects/active*` called in no-DB mode
   - No runtime errors from deprecation

---

## Out of Scope

- Persisting session projects across browser reloads
- Local filesystem "Save As" for session projects
- Removing `/api/projects/active` (Phase 4)
- Multiple concurrent sessions per client
- Session expiry/timeout handling
- UI for `POST /api/project-session/clear` (internal use only)

---

## Dependencies

| Dependency | Status |
|------------|--------|
| SessionProjectStore | Complete (Phase 1) |
| ActiveProjectController dual-mode | Complete (Phase 1) |
| FileMenu gating | Complete (Spec 2026-01-19) |
| Empty-state components | Complete (Phase 2) |
| ImportActionsContext | Complete (Phase 2) |
