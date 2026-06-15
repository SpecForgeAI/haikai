# Spec: Activate Project on Open and Propagate Active Project Context

**Date:** 2026-01-26
**Status:** Draft
**Scope:** Global (applies across Product & Delivery / Architecture & Design / Diagrams)
**Target:** Project selection/open flow + active project lifecycle + chat/context propagation
**Services:** frontend, gateway (verify/align), architecture-model-service (verify/align)

---

## Problem Statement

When a user selects and opens a project from the ModelFileDialog (via the "Open" menu), the project is loaded but **not activated**. This causes the following issues:

1. **"No active project" errors** appear immediately after opening a project because:
   - `handleOpenFromBackend` in TopBar.tsx calls `loadModelByFilename()` first
   - Then calls `refreshActiveProject()` which fetches from `GET /api/projects/active`
   - But the project was never activated via `POST /api/projects/{id}/activate`
   - So `GET /api/projects/active` returns 404 (no active project)

2. **Downstream features fail** because they depend on `activeProject` from ProjectContext:
   - ImplementationAssistantPanel needs `activeProject?.projectParentFolder`
   - Chat context construction needs project metadata
   - Transcript persistence needs project parent folder path

3. **File Mode (no DB)** has no activation mechanism at all, causing similar issues

### Root Cause

The current flow in `handleOpenFromBackend`:
```typescript
// CURRENT: Wrong order
const model = await loadModelByFilename(filename);
dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
await refreshActiveProject(); // This GETs active project but never sets it!
```

The `refreshActiveProject()` call simply fetches the active project from the backend but does NOT activate the opened project. The backend's `POST /api/projects/{id}/activate` endpoint is never called during the "Open" flow.

---

## Solution

### Overview

Change the project open flow to **activate first, then load**:

1. **Activation Sequence:** Call `activateProject(projectId)` BEFORE `loadModelByFilename()`
2. **Project Identification:** Modify ModelFileDialog to pass the project ID (not just filename) through the selection callback
3. **Direct State Update:** Use the POST activate response to update ProjectContext directly (faster than a separate GET)
4. **File Mode Handling:** In File Mode (no DB), establish active project in frontend state only when opened

### Key Design Decisions

1. **Option A - Direct State Update:** Update active project state directly from the POST `/activate` response rather than making a separate GET call. This reduces latency and network calls.

2. **Project ID from Dialog:** The ModelFileDialog already fetches the full project list including IDs. Pass the ID through the callback rather than trying to resolve it from the filename.

3. **Error Handling:**
   - Activation failure: Show error toast/banner, do NOT proceed to model load
   - Model load failure after successful activation: Show error, but project is now active (acceptable state)

4. **File Mode:** When `includeDatabase=false`, set active project directly in frontend state without any backend calls.

---

## Changes

### Task Group 1: Modify ModelFileDialog to Pass Project ID

**File:** `frontend/src/components/file/ModelFileDialog.tsx`

**Changes:**

1.1. Update the `onConfirm` prop type for "open" mode to accept project ID:
```typescript
// Current signature (open mode):
onConfirm: (result: string | SaveAsResult) => void;

// New signature (open mode should pass project info):
// For open mode: result includes projectId
// For saveAs mode: result is SaveAsResult (unchanged)
```

1.2. Create a new interface for open mode result:
```typescript
/**
 * Open project result with project ID for activation.
 * Spec 2026-01-26: Activate Project on Open
 */
export interface OpenProjectResult {
  filename: string;
  projectId: string;
}
```

1.3. Update `handleSaveClick` (poorly named for open mode) to pass project ID:
```typescript
// In open mode branch:
if (mode === 'open') {
  // Current: onConfirm(selectedFilename);
  // New: Pass both filename and project ID
  onConfirm({
    filename: selectedFilename,
    projectId: selectedProjectId!, // Already tracked in state
  } as OpenProjectResult);
  return;
}
```

1.4. Update the prop types documentation to clarify the union type:
```typescript
/**
 * Callback when confirmed.
 * - open mode: receives OpenProjectResult with filename and projectId
 * - saveAs mode: receives SaveAsResult object with all fields
 */
onConfirm: (result: OpenProjectResult | SaveAsResult) => void;
```

**Test File:** `frontend/src/__tests__/ModelFileDialog.openProjectResult.test.tsx`
- Test that clicking OK in open mode calls onConfirm with `{ filename, projectId }`
- Test that projectId is correctly populated from selected project

---

### Task Group 2: Add ProjectContext State Update Method

**File:** `frontend/src/contexts/ProjectContext.tsx`

**Changes:**

2.1. Add a new method to set active project directly from a ProjectDto:
```typescript
interface ProjectContextType {
  // ... existing properties ...

  /**
   * Set the active project directly from a DTO.
   * Used after successful POST /activate to avoid extra GET call.
   * Spec 2026-01-26: Activate Project on Open
   */
  setActiveProject: (project: ProjectDto) => void;
}
```

2.2. Implement `setActiveProject` in the provider:
```typescript
const setActiveProject = useCallback((project: ProjectDto) => {
  setActiveProject(project);
  setActiveProjectSource(includeDatabase ? 'db' : 'session');
}, [includeDatabase]);
```

2.3. Export a new hook:
```typescript
/**
 * Hook to get the setActiveProject function from context.
 * Spec 2026-01-26: Activate Project on Open
 *
 * @returns Function to set active project directly
 * @throws Error if used outside ProjectProvider
 */
export function useSetActiveProject(): (project: ProjectDto) => void {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useSetActiveProject must be used within a ProjectProvider');
  }
  return context.setActiveProject;
}
```

**Test File:** `frontend/src/__tests__/ProjectContext.setActiveProject.test.tsx`
- Test that setActiveProject updates the activeProject state
- Test that setActiveProject sets appropriate source ('db' or 'session')

---

### Task Group 3: Update TopBar handleOpenFromBackend Flow

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Changes:**

3.1. Import new hooks and types:
```typescript
// Add to existing imports from ProjectContext
import {
  useProject,
  useRefreshActiveProject,
  useClearActiveProject,
  useSetActiveProject // NEW
} from '../../contexts/ProjectContext';

// Add to existing imports from projectsApi
import { activateProject } from '../../api/projectsApi';

// Add import for new type
import { OpenProjectResult } from '../file/ModelFileDialog';

// Add import for File Mode detection
import { useIncludeDatabase } from '../../contexts/AppConfigContext';
```

3.2. Get new hooks in component body:
```typescript
const setActiveProject = useSetActiveProject();
const includeDatabase = useIncludeDatabase(); // Already imported, verify usage
```

3.3. Rewrite `handleOpenFromBackend` with activation-first flow:
```typescript
/**
 * Handle opening a model from the backend.
 *
 * Spec 2026-01-26: Activate Project on Open
 * - Activation-first flow: activate project BEFORE loading model
 * - Uses project ID from dialog selection (not filename resolution)
 * - Updates ProjectContext directly from POST response
 * - Handles File Mode by setting state directly (no backend call)
 *
 * Flow:
 * 1. If DB mode: POST /api/projects/{id}/activate
 * 2. Update ProjectContext with activated project
 * 3. Load model via loadModelByFilename
 * 4. Dispatch LOAD_MODEL to ArchitectureContext
 *
 * Error Handling:
 * - Activation failure: show error, do NOT proceed to model load
 * - Model load failure: show error (project is now active)
 */
const handleOpenFromBackend = async (result: OpenProjectResult | SaveAsResult) => {
  // Type guard for open mode result
  if (!('projectId' in result)) {
    // This shouldn't happen for open mode, but handle gracefully
    setErrorMessages(['Invalid open result: missing project ID']);
    setErrorModalOpen(true);
    return;
  }

  const { filename, projectId } = result;

  try {
    // Step 1: Activate project (DB mode) or set state directly (File mode)
    if (includeDatabase) {
      // DB mode: Call activation endpoint
      const activatedProject = await activateProject(projectId);
      // Update ProjectContext directly from response
      setActiveProject(activatedProject);
    } else {
      // File Mode: Create a minimal ProjectDto and set directly
      // In File Mode, we don't have full project data, so construct it
      const fileProject: ProjectDto = {
        id: projectId,
        name: filename,
        projectParentFolder: '', // Will be set from model if available
        projectHierarchy: null,
        organisationId: null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setActiveProject(fileProject);
    }

    // Step 2: Load the model
    const model = await loadModelByFilename(filename);
    dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });

    // Step 3: Close dialog
    setOpenDialogVisible(false);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to open project';
    setErrorMessages([errorMessage]);
    setErrorModalOpen(true);
  }
};
```

3.4. Update ModelFileDialog usage to handle new result type:
```typescript
<ModelFileDialog
  mode="open"
  isOpen={isOpenDialogVisible}
  onClose={() => setOpenDialogVisible(false)}
  onConfirm={handleOpenFromBackend}  // Now accepts OpenProjectResult
/>
```

**Test File:** `frontend/src/__tests__/TopBar.activateOnOpen.test.tsx`
- Test that opening a project calls `activateProject()` before `loadModelByFilename()`
- Test that ProjectContext is updated from activation response
- Test that activation failure prevents model load
- Test File Mode sets active project without backend call

---

### Task Group 4: Update File Mode Project Handling

**File:** `frontend/src/contexts/ProjectContext.tsx`

**Changes:**

4.1. Update `refreshActiveProject` to gracefully handle File Mode:
```typescript
const refreshActiveProject = useCallback(async () => {
  try {
    if (includeDatabase) {
      const project = await getActiveProject();
      setActiveProject(project);
      setActiveProjectSource(project ? 'db' : 'none');
    } else {
      // File Mode: Try session endpoint, but don't fail if 404
      try {
        const project = await getSessionProject();
        setActiveProject(project);
        setActiveProjectSource(project ? 'session' : 'none');
      } catch (error) {
        // In File Mode, 404 is expected if no project imported
        // Just leave current state - don't clear it
        console.debug('No session project in File Mode');
      }
    }
  } catch (error) {
    console.error('Failed to fetch active project:', error);
    // Keep current state on error
  }
}, [includeDatabase]);
```

**Test File:** `frontend/src/__tests__/ProjectContext.fileMode.test.tsx`
- Test that File Mode doesn't fail on missing session project
- Test that File Mode preserves state set via `setActiveProject`

---

### Task Group 5: Add Imports for ProjectDto Type

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Changes:**

5.1. Add ProjectDto import for File Mode project construction:
```typescript
import { activateProject, ProjectDto } from '../../api/projectsApi';
```

---

### Task Group 6: Type Refinements

**File:** `frontend/src/components/file/ModelFileDialog.tsx`

**Changes:**

6.1. Export the new `OpenProjectResult` type:
```typescript
export interface OpenProjectResult {
  filename: string;
  projectId: string;
}
```

6.2. Update prop interface to use union type:
```typescript
export interface ModelFileDialogProps {
  // ... existing props ...

  /**
   * Callback when confirmed.
   * - open mode: receives OpenProjectResult with filename and projectId
   * - saveAs mode: receives SaveAsResult object with all fields
   */
  onConfirm: (result: OpenProjectResult | SaveAsResult) => void;
}
```

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/components/file/ModelFileDialog.tsx` | Modified | Pass project ID in open mode callback |
| `frontend/src/contexts/ProjectContext.tsx` | Modified | Add setActiveProject method and hook |
| `frontend/src/components/TopBar/TopBar.tsx` | Modified | Activate-first flow in handleOpenFromBackend |

## New Test Files

| File | Description |
|------|-------------|
| `frontend/src/__tests__/ModelFileDialog.openProjectResult.test.tsx` | Tests for OpenProjectResult callback |
| `frontend/src/__tests__/ProjectContext.setActiveProject.test.tsx` | Tests for setActiveProject method |
| `frontend/src/__tests__/TopBar.activateOnOpen.test.tsx` | Tests for activate-first flow |
| `frontend/src/__tests__/ProjectContext.fileMode.test.tsx` | Tests for File Mode handling |

---

## Sequence Diagram

### Current (Broken) Flow

```
User clicks "Open" -> ModelFileDialog
                           |
                           v
                   handleOpenFromBackend(filename)
                           |
                           v
                   loadModelByFilename(filename)
                           |
                           v
                   dispatch(LOAD_MODEL)
                           |
                           v
                   refreshActiveProject()
                           |
                           v
                   GET /api/projects/active
                           |
                           v
                   404 Not Found! (project was never activated)
```

### New (Fixed) Flow

```
User clicks "Open" -> ModelFileDialog
                           |
                           v
                   handleOpenFromBackend({ filename, projectId })
                           |
                           v
               [DB Mode]   |   [File Mode]
                   |               |
                   v               v
        POST /api/projects/{id}/activate    setActiveProject(dto)
                   |               |
                   v               |
        setActiveProject(response) |
                   |               |
                   +----- + -------+
                           |
                           v
                   loadModelByFilename(filename)
                           |
                           v
                   dispatch(LOAD_MODEL)
                           |
                           v
                   Project is active! No 404!
```

---

## Testing Plan

### Unit Tests

1. **ModelFileDialog.openProjectResult.test.tsx**
   - Verify open mode calls onConfirm with `{ filename, projectId }`
   - Verify projectId matches selected project from list

2. **ProjectContext.setActiveProject.test.tsx**
   - Verify setActiveProject updates activeProject state
   - Verify setActiveProject sets source to 'db' when includeDatabase=true
   - Verify setActiveProject sets source to 'session' when includeDatabase=false

3. **TopBar.activateOnOpen.test.tsx**
   - Verify activateProject is called before loadModelByFilename
   - Verify ProjectContext is updated from activation response
   - Verify activation failure shows error and prevents model load
   - Verify File Mode sets project without backend call

4. **ProjectContext.fileMode.test.tsx**
   - Verify File Mode refresh doesn't fail on 404
   - Verify File Mode preserves state set via setActiveProject

### Integration Tests

1. **Open Project Flow (DB Mode)**
   - Open a project via ModelFileDialog
   - Verify activeProject is populated immediately
   - Verify ImplementationAssistantPanel has required projectParentFolder

2. **Open Project Flow (File Mode)**
   - Open a project in File Mode
   - Verify activeProject is set from frontend state
   - Verify no backend activation calls are made

3. **Error Handling**
   - Mock activation failure
   - Verify error toast appears
   - Verify model load does not proceed

---

## Backward Compatibility

- SaveAs mode is unchanged (still uses SaveAsResult)
- CreateProjectModal is unchanged (already activates via setActive: true)
- ImportProjectSnapshotModal is unchanged
- Existing projects and models are unaffected

---

## Exclusions

Per requirements, the following are **NOT** changed:
- CreateProjectModal - already handles activation internally
- ImportProjectSnapshotModal - has its own activation flow

---

## Notes

1. The `activateProject` API function already exists in `projectsApi.ts` and returns a full `ProjectDto`
2. The backend `POST /api/projects/{id}/activate` endpoint is already implemented in `ProjectController.java`
3. File Mode detection is already available via `useIncludeDatabase()` hook
4. The ModelFileDialog already tracks `selectedProjectId` in its state, so passing it through is straightforward
