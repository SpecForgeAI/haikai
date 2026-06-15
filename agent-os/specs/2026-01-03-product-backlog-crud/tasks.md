# Task Breakdown: Product Backlog CRUD (Stage 4 - Increment 3)

## Overview
Total Tasks: 5 Task Groups with approximately 30 sub-tasks

This feature extends the Product Backlog tree UI to support manual CRUD operations for FEATURE and STORY work items, with cascade delete warnings and proper state synchronization.

## Task List

### Data Layer

#### Task Group 1: Type Definitions and API Client Extension
**Dependencies:** None
**Files:** `frontend/src/types/workItems.ts`, `frontend/src/api/workItemsApi.ts`

- [x] 1.0 Complete type definitions and API client extension
  - [x] 1.1 Write 4-6 focused tests for API client functions
    - Test createWorkItem calls POST with correct snake_case payload
    - Test updateWorkItem calls PUT with correct payload and ID
    - Test deleteWorkItem calls DELETE with correct endpoint
    - Test camelCase to snake_case mapping in request payloads
    - Test error handling for API failures
  - [x] 1.2 Extend WorkItem types in `workItems.ts`
    - Add WorkItemFormData interface: { title: string, description: string, status: string, priority: number | null, targetWindow: string | null }
    - Add WorkItemCreatePayload interface: { type: WorkItemType, parentId: string, title: string, description?: string, status?: string, priority?: number, targetWindow?: string, sortOrder: number }
    - Add WorkItemUpdatePayload interface: { title?: string, description?: string, status?: string, priority?: number, targetWindow?: string }
    - Add STATUS_OPTIONS constant: ['PLANNED', 'READY', 'IN_PROGRESS', 'DONE']
  - [x] 1.3 Add camelCase to snake_case mapper function
    - Create `mapWorkItemPayloadToDto(payload)` function in `workItemsApi.ts`
    - Map: parentId -> parent_id, targetWindow -> target_window, sortOrder -> sort_order
    - Reuse existing mapWorkItemDtoToWorkItem for responses
  - [x] 1.4 Implement createWorkItem API function
    - POST to `/api/model/projects/{projectId}/work-items`
    - Accept WorkItemCreatePayload, return Promise<WorkItem>
    - Map request payload to snake_case, response to camelCase
    - Include descriptive error messages on failure
  - [x] 1.5 Implement updateWorkItem API function
    - PUT to `/api/model/projects/{projectId}/work-items/{id}`
    - Accept WorkItemUpdatePayload, return Promise<WorkItem>
    - Map request payload to snake_case, response to camelCase
  - [x] 1.6 Implement deleteWorkItem API function
    - DELETE to `/api/model/projects/{projectId}/work-items/{id}`
    - Return Promise<void>
    - Include descriptive error messages on failure
  - [x] 1.7 Ensure API client tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all API functions work correctly with mocked fetch

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Type definitions compile without errors
- API functions correctly map between camelCase and snake_case
- Error handling provides descriptive messages

---

### UI Components - Modals

#### Task Group 2: Create, Edit, and Delete Modals
**Dependencies:** Task Group 1
**Files:**
- `frontend/src/components/ProductView/WorkItemCreateModal.tsx` (new)
- `frontend/src/components/ProductView/WorkItemCreateModal.module.css` (new)
- `frontend/src/components/ProductView/WorkItemEditModal.tsx` (new)
- `frontend/src/components/ProductView/WorkItemEditModal.module.css` (new)
- `frontend/src/components/ProductView/WorkItemDeleteConfirmModal.tsx` (new)
- `frontend/src/components/ProductView/WorkItemDeleteConfirmModal.module.css` (new)

- [x] 2.0 Complete modal UI components
  - [x] 2.1 Write 6-8 focused tests for modal components
    - Test WorkItemCreateModal renders with correct title based on typeToCreate prop
    - Test WorkItemCreateModal form submission calls createWorkItem with correct payload
    - Test WorkItemCreateModal validates title is required
    - Test WorkItemEditModal pre-populates form with existing item values
    - Test WorkItemEditModal calls updateWorkItem on save
    - Test WorkItemDeleteConfirmModal displays descendant count and warning text
    - Test WorkItemDeleteConfirmModal calls onConfirm when confirmed
    - Test all modals display inline error on API failure
  - [x] 2.2 Create WorkItemCreateModal component
    - Props: isOpen, onClose, parent (WorkItem), typeToCreate ("FEATURE" | "STORY"), onSuccess
    - Dynamic title: "Add Feature" or "Add Story" based on typeToCreate
    - Form fields: title (required input), description (textarea), status (dropdown with STATUS_OPTIONS), priority (number input), targetWindow (text input)
    - Default status to "PLANNED"
    - Compute sortOrder: find max sortOrder among siblings + 1 (pass siblings via prop or compute internally)
    - On submit: call createWorkItem, call onSuccess(newItem), close modal
    - Error handling: display inline error, keep modal open
    - Follow pattern from LogicalErCreateModal.tsx
  - [x] 2.3 Create WorkItemCreateModal.module.css
    - Reuse style patterns from LogicalErCreateModal.module.css
    - Styles: overlay, modal, header, content, footer, fieldGroup, input, textarea, select, primaryButton, secondaryButton, errorMessage
  - [x] 2.4 Create WorkItemEditModal component
    - Props: isOpen, onClose, item (WorkItem), onSuccess
    - Only render for FEATURE and STORY types (guard against INITIATIVE/EPIC)
    - Pre-populate form fields with item.title, item.description, item.status, item.priority, item.targetWindow
    - Same form fields as create modal
    - On save: call updateWorkItem, call onSuccess(updatedItem), close modal
    - Error handling: display inline error, keep modal open
  - [x] 2.5 Create WorkItemEditModal.module.css
    - Share styles with WorkItemCreateModal or create separate file
    - Consistent styling with other modals in codebase
  - [x] 2.6 Create WorkItemDeleteConfirmModal component
    - Props: isOpen, onClose, item (WorkItem), descendantCount (number), onConfirm
    - Display warning text: "Deleting this item will also delete all child items beneath it."
    - Show item title and type being deleted
    - Display descendant count: "{N} items will be deleted" (include the item itself in count or clarify)
    - Cancel button (secondary style)
    - Delete button (danger/red style)
    - On confirm: call onConfirm callback
    - Error state: accept optional error prop or handle via parent
  - [x] 2.7 Create WorkItemDeleteConfirmModal.module.css
    - Danger button styling (red/warning color)
    - Warning icon or text styling
    - Consistent with other modals
  - [x] 2.8 Ensure modal component tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all modal behaviors work correctly

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- WorkItemCreateModal creates items with correct type and parent
- WorkItemEditModal pre-populates and updates correctly
- WorkItemDeleteConfirmModal shows cascade warning with count
- All modals handle errors gracefully with inline messages

---

### UI Components - Details Panel

#### Task Group 3: Details Panel Action Buttons
**Dependencies:** Task Group 1
**Files:**
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` (modify)
- `frontend/src/components/ProductView/WorkItemDetailsPanel.module.css` (modify)

- [x] 3.0 Complete details panel action buttons
  - [x] 3.1 Write 4-6 focused tests for action buttons
    - Test INITIATIVE selected shows no action buttons
    - Test EPIC selected shows "+ Add Feature" button only
    - Test FEATURE selected shows "+ Add Story", "Edit", "Delete" buttons
    - Test STORY selected shows "Edit", "Delete" buttons only
    - Test button clicks call appropriate callback props
  - [x] 3.2 Extend WorkItemDetailsPanelProps interface
    - Add optional callbacks: onAddFeature?: () => void, onAddStory?: () => void, onEdit?: () => void, onDelete?: () => void
  - [x] 3.3 Implement action buttons in WorkItemDetailsPanel
    - Add action buttons section in header area (below badges or in separate row)
    - Conditionally render buttons based on item.type:
      - INITIATIVE: no buttons
      - EPIC: "+ Add Feature" button
      - FEATURE: "+ Add Story", "Edit", "Delete" buttons
      - STORY: "Edit", "Delete" buttons
    - Wire buttons to callback props
  - [x] 3.4 Add button styles to WorkItemDetailsPanel.module.css
    - Action button container styles
    - Primary action button style (Add Feature, Add Story)
    - Secondary action button style (Edit)
    - Danger action button style (Delete)
    - Responsive layout for button row
  - [x] 3.5 Ensure details panel tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify button visibility and callback wiring

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Correct buttons display for each work item type
- Button clicks trigger appropriate callbacks

---

### Integration Layer

#### Task Group 4: Page State Management and Modal Orchestration
**Dependencies:** Task Groups 1, 2, 3
**Files:**
- `frontend/src/components/ProductView/ProductBacklogPage.tsx` (modify)
- `frontend/src/utils/workItemTreeBuilder.ts` (extend if needed)

- [x] 4.0 Complete page-level state management and orchestration
  - [x] 4.1 Write 4-6 focused tests for page state management
    - Test modal open/close state transitions
    - Test handleCreateSuccess adds item to workItems and rebuilds tree
    - Test handleUpdateSuccess updates item in workItems
    - Test handleDeleteSuccess removes item and descendants, clears selection if needed
    - Test descendant count calculation for delete warning
  - [x] 4.2 Add modal state variables to ProductBacklogPage
    - createModalOpen: boolean (default false)
    - editModalOpen: boolean (default false)
    - deleteModalOpen: boolean (default false)
    - selectedParentForCreate: WorkItem | null
    - typeToCreate: "FEATURE" | "STORY" | null
    - itemToEdit: WorkItem | null
    - itemToDelete: WorkItem | null
  - [x] 4.3 Add descendant count helper function
    - Implement countDescendants(itemId, childrenByParent): number
    - Recursively count all descendants using childrenByParent map from tree result
    - Can be added to workItemTreeBuilder.ts or inline in page component
  - [x] 4.4 Implement modal open handlers
    - handleAddFeature: set selectedParentForCreate to current selection, typeToCreate to "FEATURE", createModalOpen to true
    - handleAddStory: set selectedParentForCreate to current selection, typeToCreate to "STORY", createModalOpen to true
    - handleEdit: set itemToEdit to selectedItem, editModalOpen to true
    - handleDelete: set itemToDelete to selectedItem, compute descendantCount, deleteModalOpen to true
  - [x] 4.5 Implement handleCreateSuccess mutation handler
    - Add new item to workItems array
    - Rebuild tree (triggers useMemo recalculation)
    - Optionally expand parent node to show new item
    - Select the newly created item
    - Close modal, reset create state
  - [x] 4.6 Implement handleUpdateSuccess mutation handler
    - Update item in workItems array (replace by id)
    - Tree rebuilds automatically via useMemo
    - Keep selection on updated item
    - Close modal, reset edit state
  - [x] 4.7 Implement handleDeleteSuccess mutation handler
    - Remove item and all descendants from workItems array
    - Use helper to collect all descendant IDs recursively
    - If deleted item was selected, clear selection
    - Tree rebuilds automatically
    - Close modal, reset delete state
  - [x] 4.8 Integrate modals into ProductBacklogPage render
    - Import and render WorkItemCreateModal with appropriate props
    - Import and render WorkItemEditModal with appropriate props
    - Import and render WorkItemDeleteConfirmModal with appropriate props
    - Pass loadedFileName as projectId to API calls within handlers
  - [x] 4.9 Wire WorkItemDetailsPanel callbacks
    - Pass onAddFeature, onAddStory, onEdit, onDelete handlers to WorkItemDetailsPanel
  - [x] 4.10 Ensure page integration tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify state management and modal orchestration work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Modal states open/close correctly
- Create/edit/delete operations update tree appropriately
- Selection state handled correctly after mutations

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 4-6 tests from Task Group 1 (API client)
    - Review 6-8 tests from Task Group 2 (modal components)
    - Review 4-6 tests from Task Group 3 (details panel)
    - Review 4-6 tests from Task Group 4 (page integration)
    - Total existing tests: approximately 18-26 tests
  - [x] 5.2 Analyze test coverage gaps for this feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus on: create flow from button to tree update, edit flow with form validation, delete flow with cascade warning
    - Check error handling paths are tested
    - Verify state synchronization after mutations
  - [x] 5.3 Write up to 10 additional strategic tests (if needed)
    - End-to-end create feature workflow: EPIC selected -> click Add Feature -> fill form -> submit -> verify tree updated
    - End-to-end create story workflow: FEATURE selected -> click Add Story -> fill form -> submit -> verify tree updated
    - End-to-end edit workflow: select FEATURE -> click Edit -> modify fields -> save -> verify details updated
    - End-to-end delete workflow: select FEATURE with children -> click Delete -> verify warning count -> confirm -> verify removal
    - Error recovery: API fails during create -> error displayed -> user can retry
    - Form validation: empty title -> submit blocked with error
    - Tree expansion: new item parent node expands to show created item
    - Selection after delete: deleted item was selected -> selection cleared
  - [x] 5.4 Run feature-specific tests
    - Run ONLY tests related to Product Backlog CRUD feature
    - Expected total: approximately 28-36 tests maximum
    - Verify all critical workflows pass
    - Do NOT run entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-36 tests total)
- Critical CRUD workflows covered end-to-end
- Error handling and edge cases verified
- No more than 10 additional tests added in gap analysis

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions and API Client Extension** - Foundation layer
   - Must complete first as all other groups depend on types and API functions

2. **Task Group 2: Create, Edit, and Delete Modals** - UI components
   - Can begin after Task Group 1 completes
   - Independent modal components with their own tests

3. **Task Group 3: Details Panel Action Buttons** - UI extension
   - Can run in parallel with Task Group 2
   - Only depends on type definitions from Task Group 1

4. **Task Group 4: Page State Management and Orchestration** - Integration
   - Must wait for Task Groups 1, 2, and 3 to complete
   - Connects all components together

5. **Task Group 5: Test Review and Gap Analysis** - Quality assurance
   - Final step after all implementation complete
   - Reviews and fills gaps in test coverage

---

## Files Summary

**New Files:**
- `frontend/src/components/ProductView/WorkItemCreateModal.tsx`
- `frontend/src/components/ProductView/WorkItemCreateModal.module.css`
- `frontend/src/components/ProductView/WorkItemEditModal.tsx`
- `frontend/src/components/ProductView/WorkItemEditModal.module.css`
- `frontend/src/components/ProductView/WorkItemDeleteConfirmModal.tsx`
- `frontend/src/components/ProductView/WorkItemDeleteConfirmModal.module.css`

**Modified Files:**
- `frontend/src/types/workItems.ts` - Add form data and payload types
- `frontend/src/api/workItemsApi.ts` - Add create, update, delete functions
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` - Add action buttons
- `frontend/src/components/ProductView/WorkItemDetailsPanel.module.css` - Add button styles
- `frontend/src/components/ProductView/ProductBacklogPage.tsx` - Add modal orchestration
- `frontend/src/utils/workItemTreeBuilder.ts` - Add descendant count helper (optional)

---

## Existing Code References

**Pattern Sources:**
- `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.tsx` - Modal structure, form state, validation, error handling
- `frontend/src/api/workItemsApi.ts` - API patterns, snake_case mapping
- `frontend/src/utils/workItemTreeBuilder.ts` - Tree building, childrenByParent usage
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` - Extend with buttons

**Style References:**
- `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.module.css` - Modal styling patterns
- `frontend/src/components/ProductView/WorkItemDetailsPanel.module.css` - Badge and button patterns

---

## Test Summary

**Total Tests: 80 passing tests across 5 test files**

- `workItemsApi.test.ts`: 16 tests (API client functions)
- `workItemModals.test.tsx`: 18 tests (modal component behavior)
- `workItemDetailsPanel.test.ts`: 11 tests (action buttons)
- `productBacklogPageState.test.ts`: 13 tests (page state management)
- `productBacklogCrudIntegration.test.ts`: 22 tests (integration and edge cases)
