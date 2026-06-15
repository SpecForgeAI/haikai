# Specification: Product Roadmap Review Page

## Goal
Add a read-only Roadmap review page under the Product area that enables users to import the Agent-OS roadmap.md file into the database and view the resulting INITIATIVE and EPIC work items in a hierarchical tree structure.

## User Stories
- As a product manager, I want to import our roadmap.md file into the database so that Epics exist in the system before creating Features/Stories under them in Backlog.
- As a team member, I want to review the imported roadmap structure so that I can understand the initiative and epic hierarchy before working on features.

## Specific Requirements

**Add Roadmap tab to ProductView**
- Add "Roadmap" as a third tab option in ProductView alongside existing "Backlog" and "Implement" tabs
- Extend ProductTab type to include 'roadmap' value
- Update parseTabFromUrl to recognize 'roadmap' tab parameter
- Update updateUrl and tab click handlers to support roadmap navigation
- Route /product?tab=roadmap should render ProductRoadmapPage component
- Default /product redirect remains /product?tab=backlog (unchanged)

**Create roadmapApi.ts API client module**
- Create new file at frontend/src/api/roadmapApi.ts following patterns from workItemsApi.ts
- Implement importRoadmap(projectId: string) function calling POST /api/model/projects/{projectId}/roadmap/import
- Define ImportResult interface with fields: projectId, artifactRevision, initiativesCreated, epicsCreated (camelCase)
- Define ImportResultDto interface with snake_case fields for API response mapping
- Handle HTTP 404 response by throwing error with message "roadmap.md not found at agent-os/product/roadmap.md"
- Handle HTTP 409 response by throwing error with message "Import blocked because features/stories already exist (v1)"
- Handle other errors with generic "Import failed: {status} {statusText}" message

**Create ProductRoadmapPage component**
- Create new file at frontend/src/components/ProductView/ProductRoadmapPage.tsx
- Use loadedFileName from ArchitectureContext as projectId (same pattern as ProductBacklogPage)
- Manage state: loadingRoadmap (boolean), importing (boolean), errorMessage (string|null), importResult (ImportResult|null), roadmapItems (WorkItem[])
- On mount, call loadRoadmapItems() to fetch and filter work items
- Show "Load a project to view roadmap." when no loadedFileName

**Implement loadRoadmapItems function**
- Reuse fetchWorkItems(projectId) from workItemsApi.ts
- Filter results to include only items where type is 'INITIATIVE' or 'EPIC'
- Use buildWorkItemTree from workItemTreeBuilder.ts to create hierarchy
- Initialize INITIATIVE nodes as expanded by default (existing behavior)

**Implement import button functionality**
- On "Import roadmap.md" button click: set importing=true, call importRoadmap(projectId)
- On success: set importResult, call loadRoadmapItems() to refresh display, set importing=false
- On error: set errorMessage with specific 404/409 messages or generic error, set importing=false
- Button should show loading indicator during import (spinner or disabled state with text)

**Render top action row**
- Primary button: "Import roadmap.md" (disabled when importing or no project loaded)
- Optional secondary button: "Refresh" to manually call loadRoadmapItems()
- Buttons styled consistently with existing ProductView patterns

**Render import status/summary card**
- If importResult exists: show card with artifact revision and counts (initiatives_created, epics_created)
- If no import yet: show helper text "Imports agent-os/product/roadmap.md into the database."
- Card should be visually distinct but unobtrusive

**Render roadmap tree (read-only)**
- Reuse WorkItemTree component from ProductBacklogPage
- Display INITIATIVE nodes at root level, EPIC nodes as children
- Sort by (sortOrder, createdAt, id) using existing compareWorkItems logic
- No selection highlighting or detail panel needed (read-only view)
- If no initiatives/epics exist: show "No roadmap imported yet." empty state

**Handle error display**
- Display errorMessage in styled error container with retry option
- Clear error on successful import or refresh
- Use existing errorContainer/errorMessage styles from ProductBacklogPage.module.css

## Existing Code to Leverage

**frontend/src/components/ProductView/ProductView.tsx**
- Tab switching pattern with parseTabFromUrl, updateUrl, handleTabChange functions
- ProductTab type union and activeTab state management
- Tab bar rendering with styles.tab and styles.activeTab classes
- Content area conditional rendering based on activeTab value

**frontend/src/api/workItemsApi.ts**
- fetchWorkItems(projectId) function for loading work items from API
- API_BASE constant pattern for environment-aware URL construction
- snake_case to camelCase DTO mapping pattern (mapWorkItemDtoToWorkItem)
- Error handling pattern with descriptive error messages

**frontend/src/utils/workItemTreeBuilder.ts**
- buildWorkItemTree(items) for creating hierarchical structure from flat array
- compareWorkItems for sorting by sortOrder, createdAt, id
- WorkItemTreeResult with roots, byId, childrenByParent maps

**frontend/src/components/ProductView/WorkItemTree.tsx**
- TreeNode recursive rendering with expand/collapse functionality
- Type badge rendering with getTypeBadgeClass (INITIATIVE, EPIC styles exist)
- Indentation and chevron toggle patterns

**frontend/src/components/ProductView/ProductBacklogPage.module.css**
- Loading state styles (loadingContainer, spinner, spin animation)
- Error state styles (errorContainer, errorMessage, retryButton)
- Empty state styles (emptyContainer, emptyMessage)
- No project state styles (noProjectContainer, noProjectMessage, noProjectHint)

## Out of Scope
- No roadmap editing functionality in the UI
- No markdown display or editor for viewing roadmap.md source file
- No frontend parsing of roadmap.md (backend owns all parsing logic)
- No feature/story creation from roadmap page (handled in Backlog)
- No selection highlighting or detail panel for roadmap items (read-only tree only)
- No epic "Use in backlog" navigation from roadmap page (future enhancement)
- No manual creation of INITIATIVE or EPIC items from roadmap page
- No drag-and-drop reordering in roadmap tree
- No search or filtering within roadmap tree
- No export or download functionality for roadmap data
