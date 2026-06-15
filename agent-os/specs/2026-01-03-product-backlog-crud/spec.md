# Specification: Product Backlog CRUD for Features and Stories

## Goal
Extend the Product Backlog tree UI to allow manual creation, editing, and deletion of FEATURE and STORY work items, with clear cascade delete warnings and immediate tree synchronization.

## User Stories
- As a product owner, I want to create Features under Epics and Stories under Features so that I can build out my product backlog hierarchy manually.
- As a product owner, I want to edit and delete backlog items with explicit warnings about cascading deletions so that I maintain data integrity and avoid accidental loss.

## Specific Requirements

**Work Items API Client Extension**
- Add `createWorkItem(projectId, data)` function to `workItemsApi.ts` using POST to `/api/model/projects/{projectId}/work-items`
- Add `updateWorkItem(projectId, id, data)` function using PUT to `/api/model/projects/{projectId}/work-items/{id}`
- Add `deleteWorkItem(projectId, id)` function using DELETE to `/api/model/projects/{projectId}/work-items/{id}`
- Map snake_case API responses to camelCase frontend types (follow existing `mapWorkItemDtoToWorkItem` pattern)
- Map camelCase frontend data to snake_case for outgoing requests

**Work Item Form Data Model**
- Define `WorkItemFormData` interface with fields: title (required), description, status, priority, targetWindow
- Status options: PLANNED, READY, IN_PROGRESS, DONE
- Priority is optional number input
- Target window is optional text input (e.g., "2026-Q2")
- Validation: title must be non-empty string

**Create Work Item Modal (WorkItemCreateModal)**
- Single reusable modal component for creating both FEATURE and STORY items
- Accept `parentId` and `parentType` props to determine child type (EPIC parent -> FEATURE, FEATURE parent -> STORY)
- Modal title dynamically shows "Add Feature" or "Add Story" based on context
- Form fields: Title (required), Description (textarea), Status (dropdown), Priority (number), Target Window (text)
- Cancel and Create buttons in footer
- On successful create: call API, close modal, trigger tree refresh callback

**Edit Work Item Modal (WorkItemEditModal)**
- Reusable modal for editing FEATURE and STORY items
- Pre-populate form fields with existing item values on open
- Same form fields as create modal
- Save and Cancel buttons
- On successful save: call API, close modal, trigger tree refresh callback

**Delete Confirmation Modal (WorkItemDeleteConfirmModal)**
- Explicit cascade warning text: "Deleting this item will also delete all child items beneath it."
- Display count of descendant items that will be deleted (recursive count)
- Show item title and type being deleted
- Cancel and Delete buttons (Delete button in danger/red style)
- On confirm: call DELETE API, close modal, trigger tree refresh and clear selection if deleted item was selected

**Details Panel Action Buttons**
- When EPIC is selected: show "+ Add Feature" button
- When FEATURE is selected: show "+ Add Feature" button (for sibling) AND "+ Add Story" button, plus "Edit" and "Delete" buttons
- When STORY is selected: show "Edit" and "Delete" buttons only
- Buttons placed in header area of WorkItemDetailsPanel
- Actions open corresponding modals

**Tree and State Synchronization**
- After create/edit/delete operations, refetch work items from API to ensure consistency
- Preserve expanded state of tree nodes across refetch
- If deleted item was selected, clear selection
- New items should appear expanded under their parent

**Error Handling**
- Display inline error messages in modals when API calls fail
- Do not crash on network errors; show user-friendly error text
- Disable submit buttons while request is in flight (loading state)

## Existing Code to Leverage

**Modal Pattern from LogicalErCreateModal.tsx**
- Follow overlay/modal/header/content/footer structure
- Use form state management pattern with useState and validation
- Reuse CSS class patterns: .overlay, .modal, .header, .content, .footer, .fieldGroup, .primaryButton, .secondaryButton
- Implement keyboard handlers (Escape to close, click overlay to close)

**Work Items API Client (workItemsApi.ts)**
- Extend existing file with new CRUD functions
- Follow same snake_case to camelCase mapping pattern used in `mapWorkItemDtoToWorkItem`
- Use same error handling pattern with descriptive error messages

**WorkItemDetailsPanel Component**
- Add action buttons to existing component
- Use existing badge styling classes for consistency
- Extend props to accept callbacks for create/edit/delete actions

**ProductBacklogPage Component**
- Orchestrates modal state (open/close for each modal type)
- Manages selected item state and passes to modals
- Handles tree refresh after mutations via `loadWorkItems` callback

**workItemTreeBuilder Utilities**
- Use existing `buildWorkItemTree` for reconstructing tree after mutations
- Use `deriveParentChain` for getting parent context in modals
- Leverage `childrenByParent` map for calculating descendant counts for delete warning

## Out of Scope
- No Initiative or Epic CRUD (assume roadmap import provides these)
- No drag-and-drop reordering of work items
- No chat-driven or AI-assisted creation of work items
- No architecture/diagram linking to work items
- No bulk operations (multi-select delete/edit)
- No work item duplication/copy feature
- No external system sync (JIRA, etc.)
- No work item history or audit log display
- No inline editing in tree view (must use modal)
- No work item templates or defaults beyond status
