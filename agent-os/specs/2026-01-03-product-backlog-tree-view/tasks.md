# Task Breakdown: Product Backlog Tree View (Stage 4)

## Overview
Total Tasks: 27 (across 4 task groups)

This feature implements a read-only hierarchical tree view for Work Items (Initiatives, Epics, Features, Stories) within the Product Backlog area. It includes API integration, type definitions, tree-building utilities, and UI components for tree rendering and detail display.

## Task List

### Type Definitions and API Layer

#### Task Group 1: Type Definitions and API Client
**Dependencies:** None

- [x] 1.0 Complete type definitions and API client layer
  - [x] 1.1 Write 4-6 focused tests for WorkItems API and type definitions
    - Test `fetchWorkItems` returns expected array structure
    - Test snake_case to camelCase field mapping
    - Test error handling for failed API requests
    - Test handling of empty work items array response
    - Test handling of null/undefined optional fields
  - [x] 1.2 Create WorkItem type definitions in `frontend/src/types/workItems.ts`
    - Define `WorkItemType = "INITIATIVE" | "EPIC" | "FEATURE" | "STORY" | string`
    - Define `WorkItem` interface with fields:
      - `id: string`
      - `projectId: string`
      - `type: WorkItemType`
      - `parentId: string | null`
      - `title: string`
      - `description: string | null`
      - `status: string`
      - `sortOrder: number`
      - `priority: number | null`
      - `targetWindow: string | null`
      - `tags: Record<string, unknown> | null`
      - `externalSystem: string | null`
      - `externalKey: string | null`
      - `createdAt: string`
      - `updatedAt: string`
    - Define `WorkItemTreeNode` interface with fields:
      - `item: WorkItem`
      - `children: WorkItemTreeNode[]`
      - `depth: number`
      - `isExpanded: boolean`
    - Define `WorkItemTreeResult` interface for builder output:
      - `roots: WorkItemTreeNode[]`
      - `byId: Map<string, WorkItem>`
      - `childrenByParent: Map<string | null, WorkItem[]>`
  - [x] 1.3 Create API client in `frontend/src/api/workItemsApi.ts`
    - Follow patterns from `modelApi.ts` for API_BASE constant and error handling
    - Implement `fetchWorkItems(projectId: string): Promise<WorkItem[]>`
    - Use endpoint: `GET /api/model/projects/{projectId}/work-items`
    - Map snake_case response fields to camelCase:
      - `project_id` -> `projectId`
      - `parent_id` -> `parentId`
      - `sort_order` -> `sortOrder`
      - `target_window` -> `targetWindow`
      - `external_system` -> `externalSystem`
      - `external_key` -> `externalKey`
      - `created_at` -> `createdAt`
      - `updated_at` -> `updatedAt`
    - Throw descriptive Error for non-OK responses
  - [x] 1.4 Ensure API layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify type definitions compile correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4-6 tests from 1.1 pass
- `WorkItem`, `WorkItemTreeNode`, and `WorkItemTreeResult` types are properly defined
- `fetchWorkItems` function correctly fetches and transforms API response
- Error handling works for API failures

**Files to Create:**
- `frontend/src/types/workItems.ts`
- `frontend/src/api/workItemsApi.ts`
- `frontend/src/__tests__/workItemsApi.test.ts`

**Existing Code to Reference:**
- `frontend/src/api/modelApi.ts` - API client patterns
- `frontend/src/types/model.ts` - Type definition patterns

---

### Utility Layer

#### Task Group 2: Tree Model Builder Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete tree model builder utilities
  - [x] 2.1 Write 4-6 focused tests for tree builder functions
    - Test `buildWorkItemTree` correctly groups items by parentId
    - Test sorting: `sortOrder` asc -> `createdAt` asc -> `id` asc fallback
    - Test items with null parentId become roots
    - Test items with missing/invalid parent are treated as roots (orphan handling)
    - Test `deriveParentChain` walks up to root correctly
    - Test `deriveParentChain` handles circular reference gracefully
  - [x] 2.2 Create tree builder in `frontend/src/utils/workItemTreeBuilder.ts`
    - Implement `buildWorkItemTree(items: WorkItem[]): WorkItemTreeResult`
      - Build `byId` Map for O(1) lookups
      - Build `childrenByParent` Map grouping by parentId
      - Identify root items (null parentId or missing parent in byId)
      - Recursively build `WorkItemTreeNode` objects
      - Set `depth` and default `isExpanded` (true for INITIATIVE, false otherwise)
      - Apply sorting: `sortOrder` asc, then `createdAt` asc, then `id` asc
      - Return `{ roots, byId, childrenByParent }`
  - [x] 2.3 Implement parent chain derivation in `frontend/src/utils/workItemTreeBuilder.ts`
    - Implement `deriveParentChain(itemId: string, byId: Map<string, WorkItem>): WorkItem[]`
    - Walk parentId chain until null or missing parent
    - Track seen IDs to prevent infinite loops (circular reference protection)
    - Return array ordered from root to immediate parent (not including the selected item)
  - [x] 2.4 Ensure utility tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify tree building produces correct hierarchical structure
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 4-6 tests from 2.1 pass
- `buildWorkItemTree` correctly builds hierarchical tree from flat list
- Orphan items are gracefully handled as roots
- `deriveParentChain` returns correct ancestor path
- Circular references do not cause infinite loops

**Files to Create:**
- `frontend/src/utils/workItemTreeBuilder.ts`
- `frontend/src/__tests__/workItemTreeBuilder.test.ts`

**Existing Code to Reference:**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - Tree building patterns (buildTreeData, findNodeByKey, getDescendantKeys)
- `frontend/src/types/advancedAdd.ts` - TreeNodeData patterns

---

### UI Components

#### Task Group 3: UI Components and Integration
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete UI components for Product Backlog
  - [x] 3.1 Write 6-8 focused tests for UI components
    - Test ProductBacklogPage loading state shows spinner
    - Test ProductBacklogPage error state shows message and Retry button
    - Test ProductBacklogPage empty state shows "No work items yet." message
    - Test WorkItemTree renders nodes hierarchically with indentation
    - Test WorkItemTree expand/collapse chevron toggles children visibility
    - Test WorkItemTree clicking node triggers onSelect callback
    - Test WorkItemDetailsPanel shows placeholder when no item selected
    - Test WorkItemDetailsPanel displays item details correctly when selected
  - [x] 3.2 Create ProductBacklogPage component in `frontend/src/components/ProductView/ProductBacklogPage.tsx`
    - Import `useArchitecture` to access `loadedFileName` as projectId
    - Maintain local state: `loading`, `error`, `workItems`, `selectedId`
    - On mount (useEffect): fetch work items via `fetchWorkItems(projectId)`
    - Handle loading state: show spinner in tree area
    - Handle error state: show error message with Retry button
    - Handle empty state: show "No work items yet." centered message
    - Use `buildWorkItemTree` to compute tree structure from workItems
    - Track `selectedId` and derive `selectedItem`, `parentChain`, `childrenCount`
    - Render two-column layout: WorkItemTree (left), WorkItemDetailsPanel (right)
  - [x] 3.3 Create ProductBacklogPage.module.css
    - Two-column layout: left panel (~300-400px) + right panel (flex-grow)
    - Left panel: scrollable, border-right separator
    - Right panel: padding for readability
    - Loading spinner centered in tree area
    - Error/empty state centered with appropriate styling
    - Follow existing CSS patterns from ProductView.module.css
  - [x] 3.4 Create WorkItemTree component in `frontend/src/components/ProductView/WorkItemTree.tsx`
    - Props: `nodes: WorkItemTreeNode[]`, `selectedId: string | null`, `onSelect: (id: string) => void`, `onToggle: (id: string) => void`
    - Recursive rendering with indentation (16-20px per depth level)
    - Chevron toggle for expand/collapse (triangle icon: right = collapsed, down = expanded)
    - Highlight selected node with distinct background color
    - Row content: title (primary text), type badge (muted secondary style)
    - Default expansion: INITIATIVE nodes expanded, others collapsed (handled by tree builder)
    - Use CSS module for styling
  - [x] 3.5 Create WorkItemTree.module.css
    - Tree node row styling with hover effect
    - Selected node highlight (e.g., light blue background)
    - Indentation via padding-left
    - Chevron/toggle styling (clickable, cursor pointer)
    - Type badge styling (small, muted color, rounded)
    - Title text styling (primary weight and color)
  - [x] 3.6 Create WorkItemDetailsPanel component in `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
    - Props: `item: WorkItem | null`, `parentChain: WorkItem[]`, `childrenCount: number`
    - Default state (no selection): "Select an item to see details."
    - When item selected, display:
      - Title as h2 heading
      - Type with badge/label styling
      - Status with badge styling
      - Description (or dash "-" if empty/null)
      - Parent chain as breadcrumb (e.g., "Initiative > Epic > Feature")
      - Children count label
    - Follow patterns from SelectionInspector.tsx for field layout
  - [x] 3.7 Create WorkItemDetailsPanel.module.css
    - Panel layout with padding
    - Header/title styling
    - Field group styling (label + value pairs)
    - Badge styling for type and status
    - Breadcrumb styling for parent chain
    - Empty state/placeholder styling
    - Follow patterns from SelectionInspector.module.css
  - [x] 3.8 Integrate ProductBacklogPage into ProductView
    - Update `frontend/src/components/ProductView/ProductView.tsx`
    - Replace backlog placeholder with `<ProductBacklogPage />` component
    - Keep ProductView as container with tabs, delegate backlog content to new component
  - [x] 3.9 Ensure UI component tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify components render correctly in all states
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- All 6-8 tests from 3.1 pass
- Loading state displays spinner
- Error state displays message with working Retry button
- Empty state displays friendly message (not error)
- Tree renders hierarchically with proper indentation
- Nodes can be expanded/collapsed
- Clicking node shows its details in the panel
- Details panel shows title, type, status, description, parent chain, children count

**Files to Create:**
- `frontend/src/components/ProductView/ProductBacklogPage.tsx`
- `frontend/src/components/ProductView/ProductBacklogPage.module.css`
- `frontend/src/components/ProductView/WorkItemTree.tsx`
- `frontend/src/components/ProductView/WorkItemTree.module.css`
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
- `frontend/src/components/ProductView/WorkItemDetailsPanel.module.css`
- `frontend/src/__tests__/ProductBacklogPage.test.tsx`

**Files to Modify:**
- `frontend/src/components/ProductView/ProductView.tsx`

**Existing Code to Reference:**
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - TreeNodeComponent pattern
- `frontend/src/components/DiagramsView/SelectionInspector.tsx` - Details panel layout
- `frontend/src/components/DiagramsView/SelectionInspector.module.css` - Panel styling
- `frontend/src/components/ProductView/ProductView.module.css` - Existing ProductView styles
- `frontend/src/contexts/ArchitectureContext.tsx` - loadedFileName access pattern

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written for API layer (Task 1.1)
    - Review the 4-6 tests written for tree builder utilities (Task 2.1)
    - Review the 6-8 tests written for UI components (Task 3.1)
    - Total existing tests: approximately 14-20 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows lacking coverage
    - Focus ONLY on gaps related to Product Backlog Tree View requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified gaps
    - Priority areas:
      - Integration: Load work items -> build tree -> render -> select -> show details
      - Edge case: Deep nesting (3+ levels) renders correctly
      - Edge case: Work item with no children shows 0 children count
      - Edge case: Work item at root level (no parent) shows empty breadcrumb
      - Error recovery: Retry button successfully reloads data
      - UX: Collapsed node hides children in DOM/accessibility tree
    - Skip exhaustive edge cases, performance tests unless critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Product Backlog Tree View
    - Expected total: approximately 24-30 tests maximum
    - Test files to run:
      - `frontend/src/__tests__/workItemsApi.test.ts`
      - `frontend/src/__tests__/workItemTreeBuilder.test.ts`
      - `frontend/src/__tests__/ProductBacklogPage.test.tsx`
    - Do NOT run the entire application test suite
    - Verify all feature-specific tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-30 tests total)
- Critical user workflows for Product Backlog Tree View are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

**Files to Create/Modify:**
- Potentially add tests to existing test files if gaps identified

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions and API Client** (Foundation)
   - Create type definitions first as they are referenced by all other layers
   - API client depends on types and provides data for UI

2. **Task Group 2: Tree Model Builder Utilities** (Data Processing)
   - Depends on WorkItem types from Task Group 1
   - Provides tree structure for UI rendering

3. **Task Group 3: UI Components and Integration** (User Interface)
   - Depends on API client and tree builder utilities
   - ProductBacklogPage orchestrates data loading and state
   - WorkItemTree and WorkItemDetailsPanel are presentational components

4. **Task Group 4: Test Review and Gap Analysis** (Quality Assurance)
   - Runs after all implementation to review coverage
   - Fills critical gaps with targeted tests

---

## Notes

### API Endpoint Assumption
The spec references `GET /api/model/projects/{projectId}/work-items`. This assumes the backend endpoint exists. If the endpoint is not available, mock data or a stub implementation should be used for frontend development.

### Field Mapping Reference
| Backend (snake_case) | Frontend (camelCase) |
|---------------------|---------------------|
| id | id |
| project_id | projectId |
| type | type |
| parent_id | parentId |
| title | title |
| description | description |
| status | status |
| sort_order | sortOrder |
| priority | priority |
| target_window | targetWindow |
| tags | tags |
| external_system | externalSystem |
| external_key | externalKey |
| created_at | createdAt |
| updated_at | updatedAt |

### Out of Scope Reminders
- No CRUD operations (create, update, delete)
- No drag-and-drop reordering
- No filtering/search
- No inline editing
- No work item creation wizard

---

## Implementation Summary

**Completed:** 2026-01-03

**Files Created:**
- `frontend/src/types/workItems.ts` - Type definitions
- `frontend/src/api/workItemsApi.ts` - API client
- `frontend/src/utils/workItemTreeBuilder.ts` - Tree building utilities
- `frontend/src/components/ProductView/ProductBacklogPage.tsx` - Main page component
- `frontend/src/components/ProductView/ProductBacklogPage.module.css` - Page styles
- `frontend/src/components/ProductView/WorkItemTree.tsx` - Tree component
- `frontend/src/components/ProductView/WorkItemTree.module.css` - Tree styles
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` - Details panel component
- `frontend/src/components/ProductView/WorkItemDetailsPanel.module.css` - Details panel styles
- `frontend/src/__tests__/workItemsApi.test.ts` - 6 tests
- `frontend/src/__tests__/workItemTreeBuilder.test.ts` - 12 tests
- `frontend/src/__tests__/ProductBacklogPage.test.tsx` - 14 tests
- `frontend/src/__tests__/workItemsEdgeCases.test.ts` - 9 tests

**Files Modified:**
- `frontend/src/components/ProductView/ProductView.tsx` - Integrated ProductBacklogPage
- `frontend/src/components/ProductView/ProductView.module.css` - Updated for flex layout

**Test Results:**
- Total tests: 41 (exceeds expected 24-30)
- All tests passing
