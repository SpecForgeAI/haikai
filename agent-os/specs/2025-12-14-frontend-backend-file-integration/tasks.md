# Task Breakdown: Frontend Backend File Integration

## Overview
Total Tasks: 20
Estimated Complexity: Medium

## Context

### Current State
- File menu has: Open…, Save, Import Meta-Model…, Export Meta-Model
- All operations are local (browser file system only)
- Model stored in ArchitectureContext with LOAD_MODEL action

### What Needs to Change
1. Add API client for backend model endpoints
2. Create ModelFileDialog component for file selection
3. Update FileMenu with new structure and backend handlers
4. Preserve existing JSON/XLSX import/export under new labels

### Key Files
- `frontend/src/components/TopBar/TopBar.tsx` - Menu state and handlers
- `frontend/src/components/TopBar/FileMenu.tsx` - Menu dropdown
- `frontend/src/contexts/ArchitectureContext.tsx` - Model storage

---

## Task List

### API Layer

#### Task Group 1: Create API Client Module
**Dependencies:** None

- [x] 1.0 Complete API client
  - [x] 1.1 Create modelApi.ts file
    - File: `frontend/src/api/modelApi.ts`
    - Create directory if needed: `frontend/src/api/`
  - [x] 1.2 Add TypeScript interfaces
    - `ModelFileSummaryDto` with fields: id, filename, description, created_at, updated_at, is_default, tags
    - Use existing `ArchitectureModel` type from `src/types/model.ts`
  - [x] 1.3 Implement fetchModelFilenames()
    - GET `/api/model/filenames`
    - Returns `Promise<ModelFileSummaryDto[]>`
    - Throw error on non-OK response
  - [x] 1.4 Implement loadModelByFilename()
    - GET `/api/model?filename={name}`
    - Returns `Promise<ArchitectureModel>`
    - Throw error on non-OK response
  - [x] 1.5 Implement saveModelByFilename()
    - PUT `/api/model?filename={name}`
    - Body: JSON ArchitectureModel
    - Returns `Promise<ModelFileSummaryDto>`
    - Throw error on non-OK response
  - [x] 1.6 Add API_BASE configuration
    - Use `import.meta.env.VITE_API_BASE_URL ?? ''`
    - Empty string works with Vite proxy

**Acceptance Criteria:**
- All three API functions exported
- Error handling for non-OK responses
- Uses existing ArchitectureModel type

**Files to Create:**
- `frontend/src/api/modelApi.ts`

---

### Component Layer

#### Task Group 2: Create ModelFileDialog Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete ModelFileDialog component
  - [x] 2.1 Create component file and CSS module
    - File: `frontend/src/components/file/ModelFileDialog.tsx`
    - File: `frontend/src/components/file/ModelFileDialog.module.css`
    - Create directory if needed: `frontend/src/components/file/`
  - [x] 2.2 Define component props interface
    ```typescript
    type ModelFileDialogMode = 'open' | 'saveAs';
    interface ModelFileDialogProps {
      mode: ModelFileDialogMode;
      isOpen: boolean;
      onClose: () => void;
      onConfirm: (filename: string) => void;
      currentFilename?: string;
    }
    ```
  - [x] 2.3 Implement loading state and file list fetch
    - Call `fetchModelFilenames()` when dialog opens
    - Show loading spinner while fetching
    - Store file list in local state
  - [x] 2.4 Implement error handling with retry
    - Show error message if fetch fails
    - Provide retry button
  - [x] 2.5 Implement file list display
    - Render list of filenames with updated dates
    - Clickable rows for selection
    - Highlight selected row
  - [x] 2.6 Implement "open" mode behavior
    - Single selection from list
    - OK button confirms selected filename
    - OK disabled if nothing selected
  - [x] 2.7 Implement "saveAs" mode behavior
    - Show filename text input above list
    - Clicking row populates input
    - User can type new filename
    - OK disabled if input is empty/blank
    - Pre-fill with currentFilename if provided
  - [x] 2.8 Implement OK/Cancel buttons
    - OK: Call `onConfirm(filename.trim())` then close
    - Cancel: Call `onClose()`
  - [x] 2.9 Add keyboard support
    - Enter triggers OK (if enabled)
    - Escape triggers Cancel
  - [x] 2.10 Style to match existing Modal patterns
    - Use similar colors, spacing, fonts
    - Match existing modal overlay

**Acceptance Criteria:**
- Dialog shows loading state while fetching
- Error state allows retry
- File list is clickable
- OK/Cancel buttons work correctly
- Keyboard accessible

**Files to Create:**
- `frontend/src/components/file/ModelFileDialog.tsx`
- `frontend/src/components/file/ModelFileDialog.module.css`

---

### Integration Layer

#### Task Group 3: Update FileMenu Component
**Dependencies:** None (can run in parallel)

- [x] 3.0 Complete FileMenu updates
  - [x] 3.1 Update FileMenu props interface
    - Add: `onOpenBackend`, `onSaveAsBackend`
    - Rename: `onOpen` → `onImportJson`, `onSave` → `onExportJson`
    - Rename: `onImport` → `onImportXlsx`, `onExport` → `onExportXlsx`
  - [x] 3.2 Update menu item structure
    - New order:
      1. Open… (onOpenBackend)
      2. Save As… (onSaveAsBackend)
      3. Separator
      4. Import as JSON… (onImportJson)
      5. Export as JSON… (onExportJson)
      6. Separator
      7. Import as XLSX… (onImportXlsx)
      8. Export as XLSX… (onExportXlsx)
  - [x] 3.3 Update JSX rendering
    - Render new menu items with correct labels
    - Add separators between groups

**Acceptance Criteria:**
- FileMenu renders all 6 menu items plus separators
- Each item calls correct handler prop

**Files to Modify:**
- `frontend/src/components/TopBar/FileMenu.tsx`

---

#### Task Group 4: Wire Up TopBar Handlers
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete TopBar integration
  - [x] 4.1 Add dialog state
    ```typescript
    const [isOpenDialogVisible, setOpenDialogVisible] = useState(false);
    const [isSaveAsDialogVisible, setSaveAsDialogVisible] = useState(false);
    ```
  - [x] 4.2 Implement handleOpenFromBackend
    - Call `loadModelByFilename(filename)`
    - Dispatch `LOAD_MODEL` action with result
    - Close dialog on success
    - Show error notification on failure
  - [x] 4.3 Implement handleSaveToBackend
    - Call `saveModelByFilename(filename, state.model)`
    - Update `loadedFileName` in state (optional)
    - Close dialog on success
    - Show success notification
    - Show error notification on failure
  - [x] 4.4 Update FileMenu props
    - Pass new handlers: `onOpenBackend`, `onSaveAsBackend`
    - Rename existing handlers to match new prop names
  - [x] 4.5 Render ModelFileDialog instances
    - Render for "open" mode when `isOpenDialogVisible`
    - Render for "saveAs" mode when `isSaveAsDialogVisible`
  - [x] 4.6 Verify existing JSON handlers still work
    - `handleFileChange` for Import as JSON
    - `handleSaveClick` for Export as JSON
  - [x] 4.7 Verify existing XLSX handlers still work
    - `handleExcelFileChange` for Import as XLSX
    - `handleExportClick` for Export as XLSX

**Acceptance Criteria:**
- Open… menu item opens ModelFileDialog in open mode
- Save As… menu item opens ModelFileDialog in saveAs mode
- Backend handlers load/save models correctly
- Existing JSON/XLSX handlers unchanged

**Files to Modify:**
- `frontend/src/components/TopBar/TopBar.tsx`

---

### Testing Layer

#### Task Group 5: Testing and Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete testing
  - [ ] 5.1 Write API client tests (optional)
    - Test fetchModelFilenames returns array
    - Test loadModelByFilename throws on 404
    - Test saveModelByFilename sends correct payload
  - [ ] 5.2 Write ModelFileDialog tests (optional)
    - Test dialog renders loading state
    - Test file list appears after fetch
    - Test OK button disabled when no selection
    - Test OK calls onConfirm with filename
  - [x] 5.3 Manual verification checklist
    - [ ] Open… shows dialog with file list
    - [ ] Select file and OK loads model
    - [ ] Save As… shows dialog with input
    - [ ] Enter filename and OK saves model
    - [ ] Import as JSON… opens file picker
    - [ ] Export as JSON… downloads JSON file
    - [ ] Import as XLSX… opens file picker
    - [ ] Export as XLSX… downloads XLSX file
    - [ ] Error notifications shown on API failure

**Acceptance Criteria:**
- All manual verification steps pass
- No regressions in existing functionality

---

## Execution Order

```
Phase 1 (Parallel):
  - Task Group 1: Create API Client Module
  - Task Group 3: Update FileMenu Component

Phase 2 (Depends on Group 1):
  - Task Group 2: Create ModelFileDialog Component

Phase 3 (Depends on Groups 1, 2, 3):
  - Task Group 4: Wire Up TopBar Handlers

Phase 4 (Final):
  - Task Group 5: Testing and Verification
```

---

## File Summary

### Files to Create

| File | Description |
|------|-------------|
| `frontend/src/api/modelApi.ts` | API client for model endpoints |
| `frontend/src/components/file/ModelFileDialog.tsx` | File selection dialog |
| `frontend/src/components/file/ModelFileDialog.module.css` | Dialog styles |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar/FileMenu.tsx` | New menu structure, new props |
| `frontend/src/components/TopBar/TopBar.tsx` | Dialog state, backend handlers |

---

## Success Criteria

1. **Backend Open Works**: Can select file from list, model loads into app
2. **Backend Save Works**: Can enter filename, model saves to backend
3. **JSON Import/Export Preserved**: Same behavior as before, new labels
4. **XLSX Import/Export Preserved**: Same behavior as before, new labels
5. **Error Handling**: API errors shown to user, not silent failures
6. **Loading States**: Spinner shown during API calls

---

## Technical Notes

### API Base URL

For Vite, use environment variable:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
```

In development, can use Vite proxy or leave empty for same-origin.

### Model Compatibility

Backend returns exact same structure as frontend `ArchitectureModel`:
- No transformation needed
- Can dispatch directly: `dispatch({ type: 'LOAD_MODEL', payload: model })`

### Existing Modal Pattern

Reference existing `Modal` component for consistent styling:
```typescript
import Modal from '../common/Modal';

<Modal isOpen={isOpen} onClose={onClose} title="Open Model">
  {/* content */}
</Modal>
```
