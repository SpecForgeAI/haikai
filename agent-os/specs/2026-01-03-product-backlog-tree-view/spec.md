# Specification: Product Backlog Tree View (Stage 4)

## Goal
Implement the first functional UI inside the Product area that loads Work Items from the backend, renders them in a hierarchical Tree view based on parent_id relationships, and displays a read-only Details panel for the selected item.

## User Stories
- As a product owner, I want to view my project's work items (Initiatives, Epics, Features, Stories) in a hierarchical tree so that I can understand the breakdown structure at a glance.
- As a user, I want to select any work item and see its details (title, type, status, description, parent chain) in a side panel so that I can quickly review item information without editing.

## Specific Requirements

**API Client for Work Items**
- Create `frontend/src/api/workItemsApi.ts` extending the pattern from `modelApi.ts`
- Implement `fetchWorkItems(projectId: string): Promise<WorkItemDto[]>` function
- Use `API_BASE` constant pattern from existing `modelApi.ts`
- Map snake_case fields from backend (id, project_id, type, parent_id, title, description, status, sort_order, created_at, updated_at) to frontend types
- Handle HTTP errors and throw descriptive Error objects

**Work Item Types Definition**
- Create `frontend/src/types/workItems.ts` for type definitions
- Define `WorkItemType = "INITIATIVE" | "EPIC" | "FEATURE" | "STORY" | string` (string fallback for extensibility)
- Define `WorkItem` interface with: id, projectId, type, parentId (nullable), title, description (nullable), status, sortOrder, createdAt, updatedAt
- Define `WorkItemTreeNode` interface extending WorkItem with children array for tree building

**Product Backlog Page Data Loading**
- Implement data loading in `frontend/src/components/ProductView/ProductBacklogPage.tsx`
- Use `loadedFileName` from ArchitectureContext as the projectId (filename = project identifier)
- On mount: set loading state, call fetchWorkItems(projectId), handle success/error
- Maintain local state: workItems array, isLoading boolean, error string | null
- Provide Retry button that re-triggers the fetch on error state

**Tree Model Builder Helper**
- Create pure helper function `buildWorkItemTree(items: WorkItem[])` in `frontend/src/utils/workItemTreeBuilder.ts`
- Return structure: `{ roots: WorkItemTreeNode[], byId: Map<string, WorkItem>, childrenByParent: Map<string|null, WorkItem[]> }`
- Group items by parentId (null/undefined = root level)
- Sort siblings by: sortOrder asc, createdAt asc, id asc (fallback chain)
- Items with non-existent parent_id: treat as roots (orphan handling)

**Tree View Component**
- Create `frontend/src/components/ProductView/WorkItemTree.tsx` for the tree rendering
- Implement collapsible nodes with chevron toggle (expand/collapse)
- Indentation per depth level (use consistent 16-20px per level)
- Highlight selected node with distinct background color
- Default expansion state: expand all INITIATIVE nodes, collapse others
- Row rendering: title (primary text), type label badge (secondary, muted style)
- Support keyboard navigation (arrow keys, Enter to select) as enhancement

**Selection State and Details Panel**
- Maintain `selectedWorkItemId: string | null` in ProductBacklogPage state
- Create `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` for details display
- Default state (no selection): show "Select an item to see details." message
- Details panel shows: Title (h2), Type (badge/label), Status (badge), Description (or dash if empty), Parent chain breadcrumb, Children count

**Parent Chain Derivation**
- Implement `getParentChain(itemId: string, byIdMap: Map<string, WorkItem>): WorkItem[]` helper
- Walk parent_id links up to root, return array from root to immediate parent
- Render as breadcrumb: "Initiative > Epic > Feature" with type labels
- Handle circular reference edge case (stop if seen IDs detected)

**UX States**
- Loading: show spinner or skeleton placeholder in tree area
- Empty (no work items): show "No work items yet." centered message
- Error: show error message with "Retry" button that calls fetchWorkItems again
- Ensure error state does not crash the app; display gracefully

## Visual Design
No visual mockups provided. Follow existing ProductView styling patterns:
- Two-column layout within content area
- Left column (tree): scrollable, ~300-400px width, border-right separator
- Right column (details): flex-grow, sticky or scrollable, padding for readability
- Use existing CSS module patterns from ProductView.module.css and MetaModelView.module.css

## Existing Code to Leverage

**`frontend/src/api/modelApi.ts`**
- Pattern for API client structure with API_BASE constant
- Error handling pattern with descriptive messages
- Async/await fetch pattern to replicate

**`frontend/src/types/advancedAdd.ts` (TreeNodeData, TreeSelectionState)**
- Tree node interface pattern with key, label, children, isExpanded fields
- Selection state tracking pattern with node key mapping
- Can reference for tree node structure inspiration

**`frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`**
- Tree building functions: buildTreeData, getDescendantKeys, findNodeByKey patterns
- TreeNodeComponent rendering pattern with expand/collapse, indentation, selection
- Recursive tree rendering approach to replicate

**`frontend/src/components/DiagramsView/SelectionInspector.tsx`**
- Details panel layout pattern with header and content sections
- Field rendering pattern with labels and values
- CSS module styling approach for inspector/details panels

**`frontend/src/contexts/ArchitectureContext.tsx`**
- Access pattern for loadedFileName (use as projectId)
- State management pattern if needed for work items in future

## Out of Scope
- No CRUD actions (create, update, delete work items)
- No drag-and-drop reordering of work items
- No chat assistant integration or behavior
- No roadmap.md parsing, import, or export functionality
- No inline editing of work item fields
- No filtering or search within the tree
- No bulk selection or multi-select operations
- No work item creation wizard or modal
- No integration with external issue trackers (Jira, GitHub Issues)
- No persistence of tree expansion state across sessions
