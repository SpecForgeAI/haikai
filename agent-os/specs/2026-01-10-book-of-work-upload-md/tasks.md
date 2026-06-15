# Task Breakdown: Upload Book of Work from Markdown

## Overview
Total Tasks: 32

This feature enables users to upload a Book of Work markdown file from the Roadmap screen, parse the 4-level hierarchy (Initiative, Epic, Feature, Story) server-side, persist the work items with parent/child relationships, and display the imported hierarchy in the UI.

## Task List

### Backend Layer

#### Task Group 1: Parser Implementation
**Dependencies:** None

- [x] 1.0 Complete Book of Work parser implementation
  - [x] 1.1 Write 4-6 focused tests for BookOfWorkParser functionality
    - Test H2 heading parsed as INITIATIVE with correct title extraction
    - Test H3 heading parsed as EPIC with parent linkage to nearest prior INITIATIVE
    - Test H4 heading parsed as FEATURE with parent linkage to nearest prior EPIC
    - Test H5 heading parsed as STORY with parent linkage to nearest prior FEATURE
    - Test incomplete hierarchy (Initiative with no children) parses successfully
    - Test file with zero valid headings (H2-H5) throws appropriate error
  - [x] 1.2 Create BookOfWorkParser.java following RoadmapParser patterns
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/util/BookOfWorkParser.java`
    - Implement heading level mapping: H2=INITIATIVE, H3=EPIC, H4=FEATURE, H5=STORY
    - Walk headings in document order building parent/child relationships
    - Each child attaches to nearest prior heading of immediately higher level
    - Collect text between headings as description
  - [x] 1.3 Create parser node classes for FEATURE and STORY
    - Create FeatureNode.java following EpicNode pattern
    - Create StoryNode.java following EpicNode pattern
    - Include: title, normalizedTitle, computedId, description, sortOrder, children list
  - [x] 1.4 Extend StableIdGenerator for FEATURE and STORY types
    - Add generateFeatureId(projectId, parentNormalizedTitle, normalizedTitle)
    - Add generateStoryId(projectId, parentNormalizedTitle, normalizedTitle)
    - Key format: `work_item|{projectId}|FEATURE|{epicNormalizedTitle}|{normalizedTitle}`
    - Key format: `work_item|{projectId}|STORY|{featureNormalizedTitle}|{normalizedTitle}`
  - [x] 1.5 Implement tolerance for incomplete hierarchies
    - Allow branches to stop at any level (Initiative with no Epics, Epic with no Features)
    - Handle orphan headings: attach to nearest valid ancestor or skip with warning
    - Log warnings for skipped items but do not fail import
  - [x] 1.6 Ensure parser tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all heading level mappings work correctly
    - Verify parent/child relationships are built correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- Parser correctly maps H2-H5 headings to work item types
- Parent/child relationships are built based on heading hierarchy
- Incomplete hierarchies parse without errors
- Files with no valid headings return clear error

**Reference Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/util/RoadmapParser.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/util/StableIdGenerator.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/EpicNode.java`

---

#### Task Group 2: DTOs and Service Layer
**Dependencies:** Task Group 1

- [x] 2.0 Complete DTOs and service layer
  - [x] 2.1 Write 4-6 focused tests for BookOfWorkUploadService
    - Test successful upload creates all work items with correct types and parent relationships
    - Test destructive sync deletes existing work items before inserting new ones
    - Test all imported items have status PLANNED
    - Test import returns correct counts (initiatives, epics, features, stories)
    - Test validation rejects empty content
    - Test validation rejects content exceeding 500KB
  - [x] 2.2 Create BookOfWorkUploadRequestDto
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/bookofwork/BookOfWorkUploadRequestDto.java`
    - Fields: content (String, the markdown content)
    - Add @Size annotation for max 500KB validation
  - [x] 2.3 Create BookOfWorkUploadResultDto
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/bookofwork/BookOfWorkUploadResultDto.java`
    - Fields: projectId, workItems (list of WorkItemDto), importSummary
    - importSummary contains: initiativesCreated, epicsCreated, featuresCreated, storiesCreated
  - [x] 2.4 Create BookOfWorkUploadService.java
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/BookOfWorkUploadService.java`
    - Inject BookOfWorkParser, WorkItemRepository, StableIdGenerator
    - Implement uploadBookOfWork(projectId, content) method
    - Delete all existing work items for project before inserting (destructive sync)
    - Generate deterministic UUIDs using StableIdGenerator
    - Set all items to status PLANNED
    - Return BookOfWorkUploadResultDto with counts and work items
  - [x] 2.5 Ensure service layer tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify destructive sync behavior
    - Verify count aggregation

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- DTOs correctly represent request and response structures
- Service implements destructive sync (delete-then-insert)
- Deterministic IDs generated for all work items
- Import counts accurately reflect created items by type

**Reference Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/RoadmapImportResultDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`

---

#### Task Group 3: API Controller Layer
**Dependencies:** Task Group 2

- [x] 3.0 Complete API controller layer
  - [x] 3.1 Write 3-5 focused tests for BookOfWorkController
    - Test POST endpoint returns 200 with valid markdown content
    - Test POST endpoint returns 404 when project not found
    - Test POST endpoint returns 400 for empty content
    - Test POST endpoint returns 400 for content exceeding size limit
    - Test response contains all work items and accurate counts
  - [x] 3.2 Create BookOfWorkController.java
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/BookOfWorkController.java`
    - Endpoint: POST /api/projects/{projectId}/book-of-work/upload
    - Accept JSON body with BookOfWorkUploadRequestDto
    - Validate projectId exists (return 404 if not)
    - Return BookOfWorkUploadResultDto on success
    - Follow RoadmapImportController patterns
  - [x] 3.3 Add validation error handling
    - Return 400 for empty content or no valid headings
    - Return 400 for content exceeding 500KB
    - Include descriptive error messages with line references when available
  - [x] 3.4 Ensure controller tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Verify all HTTP status codes are correct
    - Verify response structure matches DTO

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- POST endpoint accepts JSON body and returns proper responses
- 404 returned for non-existent project
- 400 returned for validation failures with clear messages
- 200 returned with work items and counts on success

**Reference Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/RoadmapImportController.java`

---

### Frontend Layer

#### Task Group 4: API Client
**Dependencies:** Task Group 3 (Backend API must be available)

- [x] 4.0 Complete frontend API client
  - [x] 4.1 Write 3-4 focused tests for bookOfWorkApi
    - Test uploadBookOfWork sends correct request format
    - Test successful response maps to camelCase correctly
    - Test 400 error returns meaningful message
    - Test 404 error returns "project not found" message
  - [x] 4.2 Create bookOfWorkApi.ts
    - Location: `frontend/src/api/bookOfWorkApi.ts`
    - Define BookOfWorkUploadResultDto interface (snake_case from API)
    - Define BookOfWorkUploadResult interface (camelCase for frontend)
    - Create mapBookOfWorkResultDtoToResult function
    - Implement uploadBookOfWork(projectId, content) async function
    - Follow roadmapApi.ts patterns for error handling
  - [x] 4.3 Ensure API client tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify request/response mapping

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- API client correctly sends markdown content as JSON body
- Response correctly mapped from snake_case to camelCase
- Errors provide user-friendly messages

**Reference Files:**
- `frontend/src/api/roadmapApi.ts`

---

#### Task Group 5: UI Components
**Dependencies:** Task Group 4

- [x] 5.0 Complete UI components for Book of Work upload
  - [x] 5.1 Write 4-6 focused tests for Upload Book of Work functionality
    - Test button renders in Roadmap control row beside existing import button
    - Test button is disabled when no active project
    - Test file chooser opens on button click and accepts only .md files
    - Test loading indicator displays during upload
    - Test error message displays in error card on failure
    - Test tree refreshes after successful upload
  - [x] 5.2 Add "Upload Book of Work" button to ProductView.tsx
    - Add button in roadmapControlRow beside "Import/Refresh roadmap.md" button
    - Use controlRowButton class from ProductView.module.css
    - Disable button when no active project (same pattern as existing import)
    - Add hidden file input with accept=".md,text/markdown"
  - [x] 5.3 Implement file selection and upload flow
    - On button click, trigger hidden file input
    - Use FileReader API to read file content as text
    - Call uploadBookOfWork API with projectId and content
    - Show loading state using importing pattern from ProductRoadmapPage
  - [x] 5.4 Add upload state to RoadmapControlState interface
    - Add uploadingBookOfWork boolean field
    - Add handleUploadBookOfWork handler function
    - Update ProductRoadmapPage to manage and expose this state
  - [x] 5.5 Implement error handling and display
    - Display backend errors in existing errorCard UI
    - Show line/heading references when available from backend
    - Use errorMessage/errorStatus pattern from ProductRoadmapPage
  - [x] 5.6 Implement post-upload refresh
    - After successful upload, call fetchWorkItems to refresh data
    - Rebuild tree display to show newly imported hierarchy
    - No manual page reload required
  - [x] 5.7 Ensure UI component tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify button placement and styling
    - Verify file chooser behavior
    - Verify error display

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- "Upload Book of Work" button appears beside existing import button
- Button disabled when no active project
- File chooser accepts only .md files
- Loading indicator shows during upload
- Errors display in error card with actionable messages
- Tree refreshes immediately after successful upload

**Reference Files:**
- `frontend/src/components/ProductView/ProductView.tsx`
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
- `frontend/src/components/ProductView/ProductView.module.css`

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 parser tests (Task 1.1)
    - Review the 4-6 service tests (Task 2.1)
    - Review the 3-5 controller tests (Task 3.1)
    - Review the 3-4 API client tests (Task 4.1)
    - Review the 4-6 UI component tests (Task 5.1)
    - Total existing tests: approximately 18-27 tests
  - [x] 6.2 Analyze test coverage gaps for Book of Work upload feature
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize integration tests over unit test gaps
  - [x] 6.3 Write up to 8 additional strategic tests if needed
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on end-to-end workflow: button click -> file select -> API call -> tree refresh
    - Test complete hierarchy import (4 levels deep)
    - Test partial hierarchy scenarios
    - Do NOT write exhaustive edge case tests
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to Book of Work upload feature
    - Expected total: approximately 26-35 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-35 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: Parser Implementation
   - BookOfWorkParser and node classes
   - StableIdGenerator extensions
   - No external dependencies

2. Task Group 2: DTOs and Service Layer
   - Request/Response DTOs
   - BookOfWorkUploadService
   - Depends on: Task Group 1 (parser)

3. Task Group 3: API Controller Layer
   - BookOfWorkController
   - Validation and error handling
   - Depends on: Task Group 2 (service)

4. Task Group 4: API Client
   - bookOfWorkApi.ts
   - Depends on: Task Group 3 (API endpoint exists)

5. Task Group 5: UI Components
   - Button, file chooser, upload flow
   - Error handling, tree refresh
   - Depends on: Task Group 4 (API client)

6. Task Group 6: Test Review and Gap Analysis
   - Review all tests from groups 1-5
   - Fill critical gaps only
   - Depends on: Task Groups 1-5 (all implementation)
```

---

## Summary Table

| Task Group | Description | Task Count | Dependencies |
|------------|-------------|------------|--------------|
| 1 | Parser Implementation | 6 | None |
| 2 | DTOs and Service Layer | 5 | Task Group 1 |
| 3 | API Controller Layer | 4 | Task Group 2 |
| 4 | API Client | 3 | Task Group 3 |
| 5 | UI Components | 7 | Task Group 4 |
| 6 | Test Review and Gap Analysis | 4 | Task Groups 1-5 |
| **Total** | | **32** | |

---

## Key Files to Create

### Backend (Java)
- `architecture-model-service/src/main/java/com/example/architecturemodel/util/BookOfWorkParser.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/FeatureNode.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/parser/StoryNode.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/bookofwork/BookOfWorkUploadRequestDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/bookofwork/BookOfWorkUploadResultDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/BookOfWorkUploadService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/BookOfWorkController.java`

### Frontend (TypeScript)
- `frontend/src/api/bookOfWorkApi.ts`

### Files to Modify
- `architecture-model-service/src/main/java/com/example/architecturemodel/util/StableIdGenerator.java` (extend with FEATURE/STORY)
- `frontend/src/components/ProductView/ProductView.tsx` (add upload button)
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx` (add upload state/handlers)

---

## Notes

- **Destructive Sync**: V1 uses delete-all-then-insert strategy for simplicity
- **Deterministic IDs**: Use StableIdGenerator pattern for repeatable imports
- **File Size Limit**: 500KB maximum to prevent abuse
- **Heading Hierarchy**: H2=Initiative, H3=Epic, H4=Feature, H5=Story
- **Status**: All imported items start as PLANNED
