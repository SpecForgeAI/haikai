# Task Breakdown: Product Implement Context Picker v1

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This feature adds a Context Picker to the Product Implement view, enabling users to link architecture meta-model entities and diagrams to work items. Selections are persisted locally via localStorage.

## Task List

### Foundation Layer

#### Task Group 1: Types and Local Persistence
**Dependencies:** None

- [x] 1.0 Complete types and localStorage utilities
  - [x] 1.1 Write 4 focused tests for contextStorage functionality
    - Test `loadContext` returns empty state for non-existent key
    - Test `saveContext` and `loadContext` round-trip with valid data
    - Test `loadContext` handles corrupt JSON gracefully (returns empty state)
    - Test localStorage key pattern `product_context::<projectId>::<workItemId>`
  - [x] 1.2 Create context data model types in `frontend/src/utils/contextStorage.ts`
    - Define `EntityRef` interface: `{ kind: "ENTITY", entity_type: string, entity_id: string, label: string }`
    - Define `DiagramRef` interface: `{ kind: "DIAGRAM", diagram_id: string, label: string }`
    - Define `ContextState` interface: `{ version: 1, entity_refs: EntityRef[], diagram_refs: DiagramRef[] }`
    - Export all types for use across components
  - [x] 1.3 Implement `loadContext(projectId, workItemId)` function
    - Build localStorage key using pattern `product_context::<projectId>::<workItemId>`
    - Parse JSON with try/catch wrapper
    - Return empty state `{version:1, entity_refs:[], diagram_refs:[]}` on error or missing data
    - Return parsed `ContextState` on success
  - [x] 1.4 Implement `saveContext(projectId, workItemId, state)` function
    - Build localStorage key using same pattern
    - Stringify and persist to localStorage
    - Handle edge cases (null projectId, null workItemId)
  - [x] 1.5 Ensure contextStorage tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all persistence behaviors work correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Types are properly exported and usable
- localStorage round-trip works correctly
- Corrupt data fallback returns empty state

**File Paths:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\contextStorage.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\contextStorage.test.ts`

---

### Utility Layer

#### Task Group 2: Pick List Builders
**Dependencies:** Task Group 1

- [x] 2.0 Complete pick list builder utilities
  - [x] 2.1 Write 4 focused tests for pick list builders
    - Test `buildArchitecturePickList` groups entities by collection key
    - Test `buildArchitecturePickList` resolves labels from `name` or `title` with fallback
    - Test `buildDiagramPickList` uses diagram `name` or generates fallback from type/id
    - Test empty model returns empty pick lists without errors
  - [x] 2.2 Create `buildArchitecturePickList(metaModelEntities)` function
    - File: `frontend/src/utils/contextPickListBuilders.ts`
    - Iterate over entity collection keys from `MetaModelEntities` interface
    - For each entity: resolve label from `item.name` or `item.title`, fallback to `<entity_type> <id>`
    - Return `Record<string, PickOption[]>` where key is collection key (e.g., "applications")
    - Define `PickOption` type: `{ value: string, label: string }`
  - [x] 2.3 Create `buildDiagramPickList(diagrams)` function
    - Accept `Diagram[]` from `model.diagrams`
    - For each diagram: use `diagram.name` if present, else `${diagram.diagram_type} (${id.slice(0,8)})`
    - Return `PickOption[]` array
  - [x] 2.4 Ensure pick list builder tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify label resolution logic works correctly

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- Entity grouping by collection key works
- Label fallback logic handles missing name/title
- Empty data produces empty arrays without errors

**File Paths:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\contextPickListBuilders.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\contextPickListBuilders.test.ts`

---

### Modal Component Layer

#### Task Group 3: ContextPickerModal Component
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete ContextPickerModal UI component
  - [x] 3.1 Write 5 focused tests for ContextPickerModal
    - Test modal renders when `isOpen=true` and hides when `isOpen=false`
    - Test tab switching between "Architecture" and "Diagrams" tabs
    - Test search filtering filters options by label substring (case-insensitive)
    - Test Apply button calls `onApply` with selected items merged into ContextState
    - Test Cancel button closes modal without calling onApply
  - [x] 3.2 Create ContextPickerModal component structure
    - File: `frontend/src/components/ProductView/ContextPickerModal.tsx`
    - Props: `isOpen`, `onClose`, `initialSelected: ContextState`, `architectureOptions`, `diagramOptions`, `onApply(ContextState)`
    - Follow modal patterns from `WorkItemCreateModal.tsx` (overlay, header, content, footer)
  - [x] 3.3 Implement tab switching UI
    - Two-tab layout: "Architecture" and "Diagrams" using button/div-based switching
    - Maintain internal `activeTab` state
    - Style active tab distinctly
  - [x] 3.4 Implement search and selection logic
    - Search input filters options by label substring (case-insensitive)
    - Maintain internal draft selection state for entities and diagrams
    - Checkboxes for each option, pre-checked based on `initialSelected`
  - [x] 3.5 Implement Architecture tab content
    - Render groups with collapsible headers (default expanded)
    - Each option has checkbox + label
    - Handle empty state: "No architecture entities available in this project."
  - [x] 3.6 Implement Diagrams tab content
    - Render flat list with checkbox + label
    - Handle empty state: "No diagrams available in this project."
  - [x] 3.7 Implement Apply and Cancel actions
    - Cancel: call `onClose` without changes
    - Apply: merge selections into new ContextState, deduplicate, call `onApply`
    - Deduplicate by (entity_type, entity_id) for entities, by diagram_id for diagrams
  - [x] 3.8 Create ContextPickerModal.module.css
    - Follow patterns from `WorkItemCreateModal.module.css`
    - Styles for tabs, search input, option lists, checkboxes
    - Collapsible group header styles
  - [x] 3.9 Ensure ContextPickerModal tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify modal behaviors work correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Modal opens/closes correctly
- Tab switching works
- Search filtering works (case-insensitive)
- Apply merges and deduplicates selections
- Empty states display correctly

**File Paths:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ContextPickerModal.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ContextPickerModal.module.css`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\ContextPickerModal.test.tsx`

---

### Integration Layer

#### Task Group 4: WorkItemSummaryPanel Integration and Context Section
**Dependencies:** Task Group 3

- [x] 4.0 Complete integration into WorkItemSummaryPanel and ProductImplementPage
  - [x] 4.1 Write 5 focused tests for Context section integration
    - Test "Add context" button renders in WorkItemSummaryPanel
    - Test clicking "Add context" opens ContextPickerModal
    - Test entity chips render with label and remove (x) icon
    - Test diagram chips render with label and remove (x) icon
    - Test removing a chip updates state and persists to localStorage
  - [x] 4.2 Add Context section to WorkItemSummaryPanel
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`
    - Replace or extend existing context placeholder (lines 170-191)
    - Add "Add context" button that triggers modal open
    - Render entity_refs as chips with entity label + remove icon
    - Render diagram_refs as chips with diagram label + remove icon
    - Chips should have subtle color coding (entities vs diagrams)
  - [x] 4.3 Add Context section styles to WorkItemSummaryPanel.module.css
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css`
    - Styles for context section container
    - Styles for "Add context" button
    - Chip styles: compact, entity color vs diagram color
    - Remove icon styles within chips
  - [x] 4.4 Wire ContextPickerModal into ProductImplementPage
    - File: `frontend/src/components/ProductView/ProductImplementPage.tsx`
    - Add state for modal visibility and current context
    - On page mount with workItemId: call `loadContext` and set state
    - When workItemId changes (URL navigation): reload context from storage
    - Pass architectureOptions from `state.model.metaModel.entities`
    - Pass diagramOptions from `state.model.diagrams`
  - [x] 4.5 Handle modal open/close and Apply flow
    - On "Add context" click: open modal with current context
    - On Apply: update page state, call `saveContext` to persist
    - Removing chip: update state, call `saveContext`
  - [x] 4.6 Ensure integration tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify end-to-end flow works correctly

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- Context section replaces/extends existing placeholder
- "Add context" button opens modal
- Chips display correctly with remove functionality
- Context persists across page refreshes
- Context reloads when navigating between work items

**File Paths:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\WorkItemSummaryPanel.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\WorkItemSummaryPanel.module.css`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ProductImplementPage.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\ContextSection.test.tsx`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Types and Local Persistence** (Foundation)
   - No dependencies
   - Creates core types and storage utilities
   - Specialist: TypeScript/utilities engineer

2. **Task Group 2: Pick List Builders** (Utilities)
   - Depends on Task Group 1 types
   - Creates data transformation utilities
   - Specialist: TypeScript/utilities engineer

3. **Task Group 3: ContextPickerModal Component** (UI)
   - Depends on Task Groups 1 and 2
   - Creates the modal UI component
   - Specialist: React/UI engineer

4. **Task Group 4: Integration** (Wiring)
   - Depends on Task Group 3
   - Wires modal into existing components
   - Specialist: React/integration engineer

---

## Test Summary

| Task Group | Tests Written | Focus Areas |
|------------|---------------|-------------|
| 1. Types & Persistence | 4 tests | localStorage round-trip, error handling |
| 2. Pick List Builders | 6 tests | Grouping, label resolution, empty handling |
| 3. ContextPickerModal | 13 tests | Modal behavior, tabs, search, apply/cancel |
| 4. Integration | 10 tests | Chips, removal, persistence, navigation |
| **Total** | **33 tests** | |

---

## Key Files Reference

### New Files Created
- `frontend/src/utils/contextStorage.ts` - Types and localStorage utilities
- `frontend/src/utils/contextPickListBuilders.ts` - Pick list builder functions
- `frontend/src/components/ProductView/ContextPickerModal.tsx` - Modal component
- `frontend/src/components/ProductView/ContextPickerModal.module.css` - Modal styles

### Existing Files Modified
- `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx` - Added Context section
- `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css` - Added chip styles
- `frontend/src/components/ProductView/ProductImplementPage.tsx` - Wired modal and context state

### Test Files Created
- `frontend/src/__tests__/contextStorage.test.ts`
- `frontend/src/__tests__/contextPickListBuilders.test.ts`
- `frontend/src/__tests__/ContextPickerModal.test.tsx`
- `frontend/src/__tests__/ContextSection.test.tsx`

---

## Patterns Followed

### Modal Pattern (from WorkItemCreateModal.tsx)
- Overlay with click-outside-to-close
- Header with title and close button
- Scrollable content area
- Footer with Cancel and Apply buttons
- Escape key to close

### Chip Pattern (from existing styles)
- Compact display with background color
- Text label + remove icon
- Click on chip body does nothing (remove only via x icon)
- Visual distinction via color coding

### Context Hook Pattern (from ArchitectureContext.tsx)
- Access `state.model.metaModel.entities` for architecture entities
- Access `state.model.diagrams` for diagram list
- Access `state.loadedFileName` as projectId
