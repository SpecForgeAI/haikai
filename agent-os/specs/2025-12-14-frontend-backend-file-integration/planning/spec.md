# Specification: Frontend Backend File Integration

## 1. Overview

### 1.1 Problem Statement

The Architecture Modelling Tool frontend currently stores models only in browser localStorage and supports JSON/XLSX file import/export. With the new Java backend + PostgreSQL persistence layer, users need a way to open and save models to the server.

### 1.2 Goals

1. Add backend-aware "Open…" and "Save As…" functionality using the `/api/model` endpoints
2. Preserve existing JSON import/export as "Import as JSON…" / "Export as JSON…"
3. Preserve existing XLSX import/export as "Import as XLSX…" / "Export as XLSX…"
4. Integrate loaded models into existing ArchitectureContext store

### 1.3 Non-Goals

- User authentication/authorization (future enhancement)
- Auto-save functionality
- Conflict resolution for concurrent edits

## 2. Technical Design

### 2.1 Current Architecture

**File Menu Location:** `frontend/src/components/TopBar/`
- `TopBar.tsx` - Manages menu state and file operation handlers
- `FileMenu.tsx` - Dropdown menu component using React Portal

**Model Storage:** `frontend/src/contexts/ArchitectureContext.tsx`
- `AppState.model` - The ArchitectureModel (metaModel + diagrams)
- `AppState.loadedFileName` - Currently loaded filename
- Actions: `LOAD_MODEL`, `ADD_ENTITY`, `UPDATE_ENTITY`, `DELETE_ENTITY`

**Existing File Operations:** `frontend/src/utils/fileOperations.ts`
- `loadJsonFile()` - Parse and validate JSON, return ArchitectureModel
- `saveJsonFile()` - Serialize model to JSON, trigger browser download

**Existing Excel Operations:** `frontend/src/utils/excelOperations.ts`
- `importMetaModelFromExcel()` - Parse XLSX, return entities/relationships
- `exportMetaModelToExcel()` - Export meta-model to XLSX download

**Existing API Pattern:** `frontend/src/utils/diagramApi.ts`
- Uses `fetch()` with `API_BASE_URL`
- Error handling with custom `ApiError` class

### 2.2 New Components

#### 2.2.1 API Client Module

**File:** `frontend/src/api/modelApi.ts`

```typescript
export interface ModelFileSummaryDto {
  id: string;
  filename: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  is_default?: boolean;
  tags?: string;
}

// ArchitectureModelDto matches existing ArchitectureModel type
// (metaModel + diagrams)

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export async function fetchModelFilenames(): Promise<ModelFileSummaryDto[]> {
  const res = await fetch(`${API_BASE}/api/model/filenames`);
  if (!res.ok) {
    throw new Error(`Failed to load filenames: ${res.status}`);
  }
  return res.json();
}

export async function loadModelByFilename(filename: string): Promise<ArchitectureModel> {
  const params = new URLSearchParams({ filename });
  const res = await fetch(`${API_BASE}/api/model?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to load model "${filename}": ${res.status}`);
  }
  return res.json();
}

export async function saveModelByFilename(
  filename: string,
  model: ArchitectureModel
): Promise<ModelFileSummaryDto> {
  const params = new URLSearchParams({ filename });
  const res = await fetch(`${API_BASE}/api/model?${params}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  });
  if (!res.ok) {
    throw new Error(`Failed to save model "${filename}": ${res.status}`);
  }
  return res.json();
}
```

#### 2.2.2 ModelFileDialog Component

**File:** `frontend/src/components/file/ModelFileDialog.tsx`

**Props:**
```typescript
type ModelFileDialogMode = 'open' | 'saveAs';

interface ModelFileDialogProps {
  mode: ModelFileDialogMode;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filename: string) => void;
  currentFilename?: string; // Pre-fill for saveAs mode
}
```

**Behavior:**
- On open, fetches file list via `fetchModelFilenames()`
- Shows loading spinner while fetching
- Shows error message with retry button if fetch fails
- Displays list of available files (clickable rows)
- For "open" mode: Click row to select, OK to confirm
- For "saveAs" mode: Click row to populate input, or type new name
- OK button disabled if filename is empty/blank
- Cancel button closes dialog

**UI Structure:**
```
┌─────────────────────────────────────────┐
│ Open Model / Save Model As              │
├─────────────────────────────────────────┤
│ [Filename input - saveAs mode only]     │
├─────────────────────────────────────────┤
│ Available Files:                        │
│ ┌─────────────────────────────────────┐ │
│ │ my-architecture        2024-01-15  │ │
│ │ test-model             2024-01-10  │ │
│ │ backup                 2024-01-05  │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│              [Cancel]  [OK]             │
└─────────────────────────────────────────┘
```

#### 2.2.3 Updated FileMenu Structure

**File:** `frontend/src/components/TopBar/FileMenu.tsx`

New menu structure:
```typescript
const menuItems = [
  { label: 'Open…', action: 'open-backend' },
  { label: 'Save As…', action: 'save-backend' },
  { type: 'separator' },
  { label: 'Import as JSON…', action: 'import-json' },
  { label: 'Export as JSON…', action: 'export-json' },
  { type: 'separator' },
  { label: 'Import as XLSX…', action: 'import-xlsx' },
  { label: 'Export as XLSX…', action: 'export-xlsx' },
];
```

### 2.3 State Management

**New State in TopBar.tsx:**
```typescript
const [isOpenDialogVisible, setOpenDialogVisible] = useState(false);
const [isSaveAsDialogVisible, setSaveAsDialogVisible] = useState(false);
```

**Handlers:**
```typescript
const handleOpenFromBackend = async (filename: string) => {
  try {
    const model = await loadModelByFilename(filename);
    dispatch({ type: 'LOAD_MODEL', payload: model, fileName: filename });
    setOpenDialogVisible(false);
  } catch (err) {
    // Show error toast/notification
  }
};

const handleSaveToBackend = async (filename: string) => {
  try {
    await saveModelByFilename(filename, state.model);
    dispatch({ type: 'SET_FILENAME', payload: filename }); // Optional
    setSaveAsDialogVisible(false);
    // Show success notification
  } catch (err) {
    // Show error toast/notification
  }
};
```

### 2.4 Menu Item Mapping

| New Label | Old Label | Handler |
|-----------|-----------|---------|
| Open… | (new) | `handleOpenFromBackend` via dialog |
| Save As… | (new) | `handleSaveToBackend` via dialog |
| Import as JSON… | Open… | Existing `handleFileChange` |
| Export as JSON… | Save | Existing `handleSaveClick` |
| Import as XLSX… | Import Meta-Model… | Existing `handleExcelFileChange` |
| Export as XLSX… | Export Meta-Model | Existing `handleExportClick` |

## 3. Implementation Plan

### Phase 1: API Client
1. Create `src/api/modelApi.ts` with DTOs and fetch functions
2. Add environment variable support for API base URL

### Phase 2: ModelFileDialog Component
1. Create `src/components/file/ModelFileDialog.tsx`
2. Implement loading state, error handling, file list display
3. Implement both "open" and "saveAs" modes
4. Style to match existing Modal patterns

### Phase 3: Wire Up File Menu
1. Add dialog state to TopBar.tsx
2. Add handlers for backend open/save
3. Update FileMenu.tsx with new menu structure
4. Rename existing handlers appropriately

### Phase 4: Testing
1. Test API client functions
2. Test ModelFileDialog component
3. Test full workflow: open from backend, modify, save back
4. Verify JSON/XLSX import/export still works

## 4. Acceptance Criteria

### AC1 - Backend Open
- Clicking "Open…" shows ModelFileDialog with file list
- Selecting a file and clicking OK loads model into store
- Model appears in meta-model view and diagrams

### AC2 - Backend Save As
- Clicking "Save As…" shows ModelFileDialog with file list and input
- Entering/selecting filename and clicking OK saves model
- Success notification shown

### AC3 - JSON Import/Export Preserved
- "Import as JSON…" works exactly like old "Open…"
- "Export as JSON…" works exactly like old "Save"

### AC4 - XLSX Import/Export Preserved
- "Import as XLSX…" works exactly like old "Import Meta-Model…"
- "Export as XLSX…" works exactly like old "Export Meta-Model"

### AC5 - Error Handling
- API errors shown to user (not silent failures)
- Loading states shown during API calls

## 5. Files Summary

### Files to Create

| File | Description |
|------|-------------|
| `frontend/src/api/modelApi.ts` | API client for model endpoints |
| `frontend/src/components/file/ModelFileDialog.tsx` | File selection dialog |
| `frontend/src/components/file/ModelFileDialog.module.css` | Dialog styles |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | Add dialog state, backend handlers |
| `frontend/src/components/TopBar/FileMenu.tsx` | New menu structure, new props |
| `frontend/vite.config.ts` or `.env` | API base URL configuration (optional) |

### Files to Verify

| File | Verification |
|------|-------------|
| `frontend/src/utils/fileOperations.ts` | Existing handlers still work |
| `frontend/src/utils/excelOperations.ts` | Existing handlers still work |

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| API response format mismatch | Medium | High | Backend uses snake_case matching frontend |
| CORS issues | Low | Medium | Backend has CORS config for localhost |
| Breaking existing import/export | Low | High | Only renaming menu items, not changing handlers |

## 7. Technical Notes

### 7.1 Environment Variable

For Vite projects, use `VITE_API_BASE_URL`:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
```

In development with proxy, API_BASE can be empty string (same origin).

### 7.2 Model Compatibility

The backend returns `ArchitectureModel` with exact same structure as frontend:
- `metaModel.entities` - 16 entity arrays
- `metaModel.relationships` - 7 relationship arrays
- `diagrams` - Array of Diagram objects

No transformation needed - can dispatch directly to `LOAD_MODEL`.

### 7.3 Existing Modal Pattern

Use the existing `Modal` component from `src/components/common/Modal.tsx`:
```typescript
<Modal isOpen={isOpen} onClose={onClose} title="Open Model">
  {/* content */}
</Modal>
```
