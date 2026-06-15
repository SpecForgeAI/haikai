# Task Breakdown: Product Roadmap Review Page

## Overview
Total Tasks: 18

This feature adds a read-only Roadmap review page to the Product area, enabling users to import the roadmap.md file and view INITIATIVE/EPIC work items in a hierarchical tree.

## Task List

### API Layer

#### Task Group 1: Roadmap API Client
**Dependencies:** None

- [x] 1.0 Complete roadmap API client module
  - [x] 1.1 Write 3-4 focused tests for roadmapApi functions
    - Test importRoadmap returns mapped ImportResult on success
    - Test importRoadmap throws specific error for HTTP 404
    - Test importRoadmap throws specific error for HTTP 409
    - Test importRoadmap throws generic error for other HTTP failures
  - [x] 1.2 Create roadmapApi.ts with ImportResult and ImportResultDto interfaces
    - File: `frontend/src/api/roadmapApi.ts`
    - ImportResultDto fields: project_id, artifact_revision, initiatives_created, epics_created (snake_case)
    - ImportResult fields: projectId, artifactRevision, initiativesCreated, epicsCreated (camelCase)
    - Reuse API_BASE pattern from workItemsApi.ts
  - [x] 1.3 Implement mapImportResultDtoToImportResult mapping function
    - Map snake_case DTO fields to camelCase frontend interface
    - Follow pattern from mapWorkItemDtoToWorkItem in workItemsApi.ts
  - [x] 1.4 Implement importRoadmap(projectId: string) function
    - Call POST /api/model/projects/{projectId}/roadmap/import
    - Handle 404: throw "roadmap.md not found at agent-os/product/roadmap.md"
    - Handle 409: throw "Import blocked because features/stories already exist (v1)"
    - Handle other errors: throw "Import failed: {status} {statusText}"
  - [x] 1.5 Ensure API layer tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify all error cases handled correctly

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- importRoadmap function properly calls backend endpoint
- DTO to frontend interface mapping works correctly
- Specific error messages for 404 and 409 responses

### Tab Routing Layer

#### Task Group 2: ProductView Tab Integration
**Dependencies:** Task Group 1

- [x] 2.0 Complete tab routing integration
  - [x] 2.1 Write 3-4 focused tests for roadmap tab routing
    - Test parseTabFromUrl returns 'roadmap' for ?tab=roadmap
    - Test tab switching to 'roadmap' updates URL correctly
    - Test roadmap tab renders ProductRoadmapPage component
    - Test default tab remains 'backlog' when no param specified
  - [x] 2.2 Extend ProductTab type to include 'roadmap'
    - File: `frontend/src/components/ProductView/ProductView.tsx`
    - Update type: `type ProductTab = 'backlog' | 'implement' | 'roadmap';`
  - [x] 2.3 Update parseTabFromUrl to recognize 'roadmap' tab
    - Add case for tabParam === 'roadmap' returning 'roadmap'
    - Keep default return value as 'backlog'
  - [x] 2.4 Add roadmap tab button to tab bar
    - Add third button with data-testid="roadmap-tab"
    - Apply activeTab styling when activeTab === 'roadmap'
    - Wire onClick to handleTabChange('roadmap')
  - [x] 2.5 Add conditional render for ProductRoadmapPage
    - Import ProductRoadmapPage component
    - Render when activeTab === 'roadmap'
  - [x] 2.6 Ensure tab routing tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify URL navigation works for all three tabs

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- /product?tab=roadmap renders ProductRoadmapPage
- Tab bar shows all three tabs with correct styling
- URL updates correctly when switching tabs

### Page Component Layer

#### Task Group 3: ProductRoadmapPage Component
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete ProductRoadmapPage component
  - [x] 3.1 Write 4-6 focused tests for ProductRoadmapPage
    - Test no-project state shows "Load a project to view roadmap."
    - Test loading state shows spinner during loadRoadmapItems
    - Test import button calls importRoadmap and refreshes tree on success
    - Test error display shows message with retry option
    - Test tree displays filtered INITIATIVE/EPIC items only
    - Test import result card displays counts after successful import
  - [x] 3.2 Create ProductRoadmapPage.tsx component shell
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - Get loadedFileName from useArchitecture context
    - Define state: loadingRoadmap, importing, errorMessage, importResult, roadmapItems, expandedIds
  - [x] 3.3 Implement loadRoadmapItems function
    - Call fetchWorkItems(projectId) from workItemsApi.ts
    - Filter to items where type is 'INITIATIVE' or 'EPIC'
    - Build tree using buildWorkItemTree from workItemTreeBuilder.ts
    - Initialize expandedIds with INITIATIVE item IDs
  - [x] 3.4 Implement handleImport function
    - Set importing=true, clear errorMessage
    - Call importRoadmap(projectId) from roadmapApi.ts
    - On success: set importResult, call loadRoadmapItems()
    - On error: set errorMessage with caught error message
    - Always set importing=false in finally block
  - [x] 3.5 Render action row with import and refresh buttons
    - Primary button: "Import roadmap.md" (disabled when importing or !loadedFileName)
    - Show spinner or "Importing..." text when importing
    - Secondary button: "Refresh" to call loadRoadmapItems
  - [x] 3.6 Render import status/summary card
    - If importResult: show artifactRevision, initiativesCreated, epicsCreated
    - If no importResult: show helper text "Imports agent-os/product/roadmap.md into the database."
  - [x] 3.7 Render roadmap tree using WorkItemTree component
    - Pass filtered tree nodes, expandedIds, toggle/select handlers
    - Handle expand/collapse but no selection highlighting needed
    - Show "No roadmap imported yet." when tree is empty
  - [x] 3.8 Handle all UI states (no-project, loading, error, empty, normal)
    - Reuse styles from ProductBacklogPage.module.css
    - Error state with retry button calling loadRoadmapItems
  - [x] 3.9 Ensure page component tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify all user flows work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- All UI states render correctly (no-project, loading, error, empty, normal)
- Import button triggers API call and refreshes tree
- Tree displays only INITIATIVE and EPIC items
- Error messages display with retry functionality

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 3-4 tests from roadmapApi (Task 1.1)
    - Review 3-4 tests from tab routing (Task 2.1)
    - Review 4-6 tests from ProductRoadmapPage (Task 3.1)
    - Total existing tests: approximately 10-14 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on import flow and tree rendering integration
    - Prioritize user-facing functionality over internal logic
  - [x] 4.3 Write up to 6 additional strategic tests if needed
    - Add integration test for full import-to-tree-display flow
    - Add test for 404/409 error display in UI
    - Add test for tree expand/collapse functionality
    - Skip edge cases and accessibility tests unless critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 16-20 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-20 tests total)
- Critical user workflows covered: import, error handling, tree display
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on Product Roadmap Review feature

## Execution Order

Recommended implementation sequence:
1. **API Layer** (Task Group 1) - Create roadmapApi.ts with importRoadmap function
2. **Tab Routing** (Task Group 2) - Extend ProductView with roadmap tab
3. **Page Component** (Task Group 3) - Build ProductRoadmapPage with all UI states
4. **Testing** (Task Group 4) - Review and fill critical test gaps

## Key Files

**New Files to Create:**
- `frontend/src/api/roadmapApi.ts` - Roadmap import API client
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx` - Main page component

**Existing Files to Modify:**
- `frontend/src/components/ProductView/ProductView.tsx` - Add roadmap tab

**Existing Files to Reuse (no modifications):**
- `frontend/src/api/workItemsApi.ts` - fetchWorkItems function
- `frontend/src/utils/workItemTreeBuilder.ts` - buildWorkItemTree function
- `frontend/src/components/ProductView/WorkItemTree.tsx` - Tree component
- `frontend/src/components/ProductView/ProductBacklogPage.module.css` - Shared styles
