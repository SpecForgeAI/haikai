# Specification: No-Database Mode Empty-State UX

## Overview

**Spec ID:** 2026-01-22-no-db-mode-empty-state-ux
**Status:** Draft
**Module:** Frontend (React/TypeScript)

This specification adds user-friendly empty-state handling and a mode indicator when the application runs with `app.features.include-database=false`. The backend (Phase 1) and FileMenu gating (Spec 2026-01-19) are already implemented; this spec focuses on:
1. Empty-state UX when no project is loaded
2. Graceful handling of 404 responses from `/api/projects/active` and `/api/projects/active/export`
3. A subtle "File Mode" indicator in the TopBar

---

## Background / Prior Implementation

### Already Implemented (No Changes Needed)
| Feature | Location | Spec |
|---------|----------|------|
| Bootstrap fetch & caching | `AppConfigContext.tsx` | 2026-01-19 |
| `useIncludeDatabase()` hook | `AppConfigContext.tsx` | 2026-01-19 |
| FileMenu DB CRUD gating | `FileMenu.tsx:287-338` | 2026-01-19 |
| 404 handling for `/api/projects/active` | `projectsApi.ts:250-252` | 2026-01-05 |
| 404 handling for `/api/projects/active/export` | `projectSnapshotApi.ts:228-230` | 2026-01-07 |
| Import JSON/XLSX always enabled | `FileMenu.tsx` | 2026-01-19 |

### What This Spec Adds
1. Empty-state component for Architecture & Design view
2. Empty-state component for Product & Delivery view
3. Toast message when Export is clicked with no active project
4. "File Mode" indicator in TopBar when `includeDatabase=false`

---

## Functional Requirements

### A) Empty-State Component for Architecture & Design View

**Trigger:** `includeDatabase=false` AND `activeProject===null` (404 from `/api/projects/active`)

**Location:** Main content area of Architecture & Design view

**Display:**
- Centered message: "No project loaded"
- Sub-text: "Import a project snapshot to begin working."
- Primary action button: "Import JSON" (opens Import JSON flow)
- Secondary action button: "Import XLSX" (opens Import XLSX flow)

**Behavior:**
- Empty-state replaces the normal grid/diagram content
- After successful import, the view should refresh and show the imported data
- No error toasts or console errors for the 404

**Out of Scope:**
- This empty-state only shows in no-DB mode; when `includeDatabase=true`, the existing "No active project" behavior remains unchanged

---

### B) Empty-State Component for Product & Delivery View

**Trigger:** `includeDatabase=false` AND `activeProject===null`

**Location:** Main content area of Product & Delivery view (when `includeDelivery=true`)

**Display:**
- Centered message: "No project loaded"
- Sub-text: "Import a project snapshot to begin working."
- Primary action button: "Import JSON" (opens Import JSON flow)
- Secondary action button: "Import XLSX" (opens Import XLSX flow)

**Behavior:**
- Empty-state replaces the normal roadmap/backlog content
- After successful import, the view should refresh and show the imported data

**Note:** If `includeDelivery=false`, this view is already hidden (Spec 2026-01-19), so no empty-state needed there.

---

### C) Export Empty-State Handling (Toast)

**Trigger:** User clicks "Export as JSON" or "Export as XLSX" when:
- `activeProject===null` (no project loaded), OR
- `exportActiveProjectSnapshot()` returns `null` (404)

**Behavior:**
- Show a toast notification: "Nothing to export yet — import a project snapshot first."
- Toast type: `info` (not error)
- Toast auto-dismisses after standard duration (3-5 seconds)
- User remains on current screen (no navigation change)
- No console errors logged for this state

**Location of Change:**
- `TopBar.tsx` handlers for Export JSON and Export XLSX

---

### D) File Mode Indicator in TopBar

**Trigger:** `includeDatabase=false`

**Location:** TopBar, after the "Project" menu button or in the right section

**Display:**
- Subtle badge or text: "File Mode"
- Styling: Muted color, small font, non-intrusive
- Optional: Tooltip on hover explaining "Database features are disabled. Use Import/Export for file-based workflows."

**Behavior:**
- Always visible when `includeDatabase=false`
- Does not appear when `includeDatabase=true`

---

## Non-Functional Requirements

### Error Suppression
- 404 responses from `/api/projects/active` and `/api/projects/active/export` must NOT:
  - Show error toasts
  - Log errors to console (warnings OK if needed for debugging)
  - Trigger global error handlers

### Performance
- No additional API calls; reuse existing `activeProject` state from `ProjectContext`
- Empty-state components should render immediately (no loading spinners for the empty state itself)

### Accessibility
- Empty-state buttons must be keyboard-accessible
- ARIA labels: "Import project from JSON file", "Import project from Excel file"

---

## UI/UX Specifications

### Empty-State Component Layout
```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                  [Icon - optional]                  │
│                                                     │
│               No project loaded                     │
│                                                     │
│     Import a project snapshot to begin working.     │
│                                                     │
│     ┌──────────────┐  ┌──────────────┐             │
│     │ Import JSON  │  │ Import XLSX  │             │
│     └──────────────┘  └──────────────┘             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### File Mode Indicator Layout
```
┌───────────────────────────────────────────────────────────────┐
│ [Logo]  Project ▼  [Architecture] [Diagrams] [Product]    File Mode │
└───────────────────────────────────────────────────────────────┘
```

---

## Technical Design

### A) Create Reusable NoProjectEmptyState Component

**File:** `frontend/src/components/EmptyState/NoProjectEmptyState.tsx`

```typescript
interface NoProjectEmptyStateProps {
  onImportJson: () => void;
  onImportXlsx: () => void;
}
```

**Usage:**
- Import and render in both Architecture view and Product view
- Pass import handlers from TopBar context or lift them up

### B) Modify Architecture View to Show Empty-State

**File:** Likely `App.tsx` or the main view component for Architecture & Design

**Logic:**
```typescript
const includeDatabase = useIncludeDatabase();
const activeProject = useProject(); // from ProjectContext

if (!includeDatabase && activeProject === null) {
  return <NoProjectEmptyState onImportJson={...} onImportXlsx={...} />;
}
// ... normal view rendering
```

### C) Modify Product View to Show Empty-State

**File:** Product & Delivery view component

**Logic:** Same pattern as Architecture view

### D) Modify TopBar Export Handlers

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Current Export JSON Handler (approximate location: handleExportJsonClick):**
```typescript
const handleExportJsonClick = async () => {
  // ADD: Check for no project in no-DB mode
  if (!includeDatabase && activeProject === null) {
    showToast('Nothing to export yet — import a project snapshot first.', 'info');
    return;
  }
  // ... existing export logic
};
```

**Apply same pattern to Export XLSX handler.**

### E) Add File Mode Indicator to TopBar

**File:** `frontend/src/components/TopBar/TopBar.tsx`

**Logic:**
```typescript
const includeDatabase = useIncludeDatabase();

// In render:
{!includeDatabase && (
  <span className={styles.fileModeIndicator} title="Database features are disabled. Use Import/Export for file-based workflows.">
    File Mode
  </span>
)}
```

**Styling:** Add `fileModeIndicator` class to `TopBar.module.css`

---

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/components/EmptyState/NoProjectEmptyState.tsx` | Reusable empty-state component |
| `frontend/src/components/EmptyState/NoProjectEmptyState.module.css` | Styles for empty-state |

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | Add File Mode indicator, update export handlers with toast |
| `frontend/src/components/TopBar/TopBar.module.css` | Add fileModeIndicator styles |
| `frontend/src/App.tsx` or main view component | Conditionally render empty-state for Architecture view |
| Product view component | Conditionally render empty-state for Product view |

---

## Testing Requirements

### Unit Tests

1. **NoProjectEmptyState Component Tests**
   - Renders "No project loaded" message
   - Renders Import JSON and Import XLSX buttons
   - Calls onImportJson when Import JSON clicked
   - Calls onImportXlsx when Import XLSX clicked

2. **TopBar File Mode Indicator Tests**
   - Shows "File Mode" when includeDatabase=false
   - Does not show "File Mode" when includeDatabase=true

3. **TopBar Export Handler Tests**
   - Shows toast when Export JSON clicked with no project in no-DB mode
   - Shows toast when Export XLSX clicked with no project in no-DB mode
   - Does not show toast when project is loaded

4. **View Empty-State Tests**
   - Architecture view shows empty-state when includeDatabase=false and no project
   - Product view shows empty-state when includeDatabase=false and no project
   - Views show normal content when project is loaded

### Integration Tests

1. **No-DB Mode Boot Flow**
   - App starts with includeDatabase=false
   - No error toasts or console errors
   - Empty-state is displayed
   - Import JSON works and loads project
   - After import, views show project data

---

## Acceptance Criteria

1. With `includeDatabase=false` and no project loaded:
   - Architecture view shows clean empty-state with Import buttons
   - Product view shows clean empty-state with Import buttons
   - No error toasts or console errors appear

2. Export actions when no project loaded (no-DB mode):
   - Show info toast: "Nothing to export yet — import a project snapshot first."
   - User stays on current screen

3. File Mode indicator:
   - Visible in TopBar when `includeDatabase=false`
   - Has tooltip explaining the mode
   - Not visible when `includeDatabase=true`

4. After importing a project:
   - Empty-states disappear
   - Views show imported project data
   - Export works normally

---

## Out of Scope

- Changes to backend endpoints (Phase 1 complete)
- Changes to FileMenu gating (Spec 2026-01-19 complete)
- New "local project create" workflow
- Filesystem persistence of session projects
- Changes to delivery panel beyond existing `includeDelivery` gating

---

## Dependencies

| Dependency | Status |
|------------|--------|
| Backend Session-Backed Active Project | Complete (Spec 2026-01-22) |
| Bootstrap Endpoint Feature Toggles | Complete (Spec 2026-01-19) |
| FileMenu UI Route Gating | Complete (Spec 2026-01-19) |
| AppConfigContext with useIncludeDatabase() | Complete (Spec 2026-01-19) |
| ProjectContext with activeProject state | Complete (existing) |
