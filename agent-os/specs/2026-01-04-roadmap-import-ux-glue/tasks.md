# Task Breakdown: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX

## Overview
Total Tasks: 29 sub-tasks across 4 task groups

This spec enhances the Product Roadmap import experience with:
- Persisted "Last imported" status panel showing revision, timestamp, and source
- Detailed import counts (inserted/updated/archived/deleted for initiatives and epics)
- Actionable error messages with specific guidance
- "Go to Backlog" CTA after successful import

## Task List

### Backend Layer

#### Task Group 1: Enhanced DTO and Service with Detailed Counts
**Dependencies:** None

- [x] 1.0 Complete backend detailed counts implementation
  - [x] 1.1 Write 5 focused tests for detailed count tracking
    - Test inserted count: new item not in existing map returns inserted=1
    - Test updated count: existing item with field change returns updated=1
    - Test archived count: removed item with children returns archived=1
    - Test deleted count: removed item without children returns deleted=1
    - Test combined counts: mixed scenario with multiple operations returns correct totals
  - [x] 1.2 Enhance RoadmapImportResultDto with detailed count fields
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/RoadmapImportResultDto.java`
    - Add fields: initiativesInserted, initiativesUpdated, initiativesArchived, initiativesDeleted
    - Add fields: epicsInserted, epicsUpdated, epicsArchived, epicsDeleted
    - Use @JsonProperty annotations for snake_case JSON output (e.g., "initiatives_inserted")
    - Retain artifactRevision field
    - Deprecate or remove initiativesCreated/epicsCreated (or keep for backward compatibility)
  - [x] 1.3 Create DetailedImportCounts helper class
    - Create inner class or separate record to track counts per type
    - Fields: inserted, updated, archived, deleted (all int)
    - Create for both INITIATIVE and EPIC types
  - [x] 1.4 Modify upsertWorkItems to track inserted vs updated
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java`
    - In upsertInitiative: check if existingItemsById.get(computedId) is null (inserted) or not null (updated)
    - In upsertEpic: same logic for epics
    - Track field changes for updated items (title, description, parentId, sortOrder, status)
    - Return DetailedImportCounts objects instead of int[] counts
  - [x] 1.5 Modify archiveOrDeleteRemovedItems to track archived vs deleted
    - In archiveOrDeleteItem: track when childCount > 0 (archived) vs childCount == 0 (deleted)
    - Return counts separately for initiatives and epics
    - Update method signature to return archived/deleted counts
  - [x] 1.6 Update importFromAgentOsFile to aggregate and return detailed counts
    - Combine counts from upsert and archive/delete operations
    - Construct enhanced RoadmapImportResultDto with all 8 count fields
    - Log summary with detailed breakdown
  - [x] 1.7 Ensure backend detailed counts tests pass
    - Run ONLY the 5 tests written in 1.1
    - Verify all count categories are tracked correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- RoadmapImportResultDto includes all 8 detailed count fields
- Service correctly tracks inserted (new IDs) vs updated (existing IDs with changes)
- Service correctly tracks archived (has children) vs deleted (no children)
- JSON response uses snake_case field names
- The 5 tests written in 1.1 pass

---

#### Task Group 2: Latest-Metadata Endpoint for Artifact Status
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete latest-metadata endpoint implementation
  - [x] 2.1 Write 4 focused tests for latest-metadata endpoint
    - Test successful metadata retrieval: returns 200 with correct fields (projectId, artifactType, revision, createdAt, source)
    - Test 404 when no artifact exists: returns 404 with appropriate error message
    - Test invalid artifact type: returns 400 for types not in allowlist
    - Test metadata excludes content: response does not include content field
  - [x] 2.2 Create ProjectArtifactMetadataDto record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectArtifactMetadataDto.java`
    - Fields: projectId, artifactType, revision, createdAt, source (no content field)
    - Use @JsonProperty annotations for snake_case JSON output
  - [x] 2.3 Add getLatestArtifactMetadata method to ProjectArtifactService
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java`
    - Reuse existing findFirstByProjectIdAndArtifactTypeOrderByRevisionDesc query
    - Map to ProjectArtifactMetadataDto (exclude content)
    - Throw ResourceNotFoundException if no artifact found
  - [x] 2.4 Add latest-metadata endpoint to ProjectArtifactController
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectArtifactController.java`
    - Endpoint: GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata
    - Validate artifactType against allowlist (ROADMAP_MD, MISSION_MD)
    - Return ProjectArtifactMetadataDto
    - Return 404 if no artifact exists
  - [x] 2.5 Ensure latest-metadata endpoint tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify endpoint returns correct metadata structure
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- GET /{artifactType}/latest-metadata returns lightweight metadata without content
- Returns 404 when no artifact exists for project/type combination
- Validates artifactType against allowlist (ROADMAP_MD, MISSION_MD)
- Response includes: project_id, artifact_type, revision, created_at, source
- The 4 tests written in 2.1 pass

---

### Frontend Layer

#### Task Group 3: Frontend API Client and Types
**Dependencies:** Task Groups 1 and 2 (requires backend endpoints)

- [x] 3.0 Complete frontend API client updates
  - [x] 3.1 Write 4 focused tests for frontend API client
    - Test importRoadmap maps enhanced response correctly: all 8 count fields present
    - Test fetchLatestArtifactMetadata returns metadata on success
    - Test fetchLatestArtifactMetadata returns null on 404
    - Test error handling for 400/409 errors includes server message
  - [x] 3.2 Extend RoadmapImportResult type with detailed counts
    - File: `frontend/src/api/roadmapApi.ts`
    - Add to ImportResultDto: initiatives_inserted, initiatives_updated, initiatives_archived, initiatives_deleted
    - Add to ImportResultDto: epics_inserted, epics_updated, epics_archived, epics_deleted
    - Add to ImportResult (camelCase): initiativesInserted, initiativesUpdated, initiativesArchived, initiativesDeleted
    - Add to ImportResult (camelCase): epicsInserted, epicsUpdated, epicsArchived, epicsDeleted
    - Update mapImportResultDtoToImportResult to map all new fields
  - [x] 3.3 Create ArtifactMetadata type and DTO
    - Add ArtifactMetadataDto interface: project_id, artifact_type, revision, created_at, source
    - Add ArtifactMetadata interface: projectId, artifactType, revision, createdAt (Date), source
    - Add mapArtifactMetadataDtoToArtifactMetadata function
  - [x] 3.4 Implement fetchLatestArtifactMetadata function
    - Endpoint: GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata
    - Return Promise<ArtifactMetadata | null>
    - Return null on 404 (not found) instead of throwing
    - Throw on other errors (400, 500, etc.)
  - [x] 3.5 Update importRoadmap error handling
    - Extract error message from response body when available
    - 404: "roadmap.md not found. Expected at: agent-os/product/roadmap.md"
    - 400: "Couldn't parse roadmap.md. Supported formats: headings, lists, initiative bullets, tables."
    - 409: Use server error message + "Retry" suggestion
    - Other: Use server message if available, else generic message
  - [x] 3.6 Ensure frontend API client tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify type mapping is correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- ImportResult type includes all 8 detailed count fields
- ArtifactMetadata type defined with projectId, artifactType, revision, createdAt, source
- fetchLatestArtifactMetadata returns null on 404, metadata on success
- mapImportResultDtoToImportResult correctly maps all snake_case to camelCase fields
- Error messages are user-friendly and actionable
- The 4 tests written in 3.1 pass

---

#### Task Group 4: ProductRoadmapPage UI Enhancements
**Dependencies:** Task Group 3 (requires API client)

- [x] 4.0 Complete ProductRoadmapPage UI enhancements
  - [x] 4.1 Write 6 focused tests for UI components
    - Test persisted status panel shows "Not imported yet" when no metadata
    - Test persisted status panel shows revision/timestamp/source when metadata exists
    - Test import summary displays all 8 detailed counts with correct formatting
    - Test "Go to Backlog" button appears when active epics exist
    - Test "Go to Backlog" button hidden with hint when no active epics
    - Test error messages display correctly for 404/400/409 with Retry button
  - [x] 4.2 Add lastImportedMetadata state and useEffect for fetching
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - Add state: lastImportedMetadata: ArtifactMetadata | null
    - On component mount (when loadedFileName changes), call fetchLatestArtifactMetadata
    - Handle loading state while fetching metadata
    - Update state after successful import without manual refresh
  - [x] 4.3 Implement persisted "Last imported" status panel
    - If metadata is null: display "Not imported yet" message
    - If metadata exists: display revision number, formatted timestamp (relative or absolute), source badge
    - Position above or alongside the import button area
    - Style consistently with existing status card patterns
  - [x] 4.4 Implement detailed import summary card
    - After successful import, show compact summary with all counts
    - Format: "Initiatives: +X inserted / ~Y updated / Z archived / W deleted"
    - Format: "Epics: +X inserted / ~Y updated / Z archived / W deleted"
    - Use visual indicators: green for inserted (+), blue for updated (~), gray for archived, red for deleted (-)
    - Only show non-zero counts to keep display compact
  - [x] 4.5 Implement "Go to Backlog" CTA
    - After import success, check roadmapItems for active (status !== 'ARCHIVED') epics
    - If activeEpics.length > 0: display prominent "Go to Backlog" button
    - Button uses react-router navigation to /product/backlog
    - If no active epics: display hint "No active epics found. Edit roadmap.md and re-import."
    - Style button as secondary action below import summary
  - [x] 4.6 Implement actionable error UX
    - 404 error: "roadmap.md not found. Expected at: agent-os/product/roadmap.md"
    - 400 error: "Couldn't parse roadmap.md. Supported formats: headings, lists, initiative bullets, tables."
    - 409 error: Display server error message with "Retry" button
    - Other errors: Display server message with "Retry" button
    - Ensure all states (loading/importing/error/success) render gracefully without crashes
  - [x] 4.7 Add CSS styles for new UI elements
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.module.css` (create if needed)
    - Style for lastImportedPanel (revision badge, timestamp, source tag)
    - Style for import summary counts (color-coded: green/blue/gray/red)
    - Style for "Go to Backlog" button (prominent CTA)
    - Style for error messages with retry button
    - Ensure responsive behavior
  - [x] 4.8 Ensure ProductRoadmapPage UI tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify all UI states render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Persisted status panel shows revision/timestamp/source from metadata
- Panel shows "Not imported yet" when no prior imports
- Panel updates immediately after successful import
- Import summary displays all 8 counts with visual indicators
- "Go to Backlog" button navigates to /product/backlog when active epics exist
- Hint displays when no active epics found
- Error messages are actionable with specific guidance
- Retry button works for recoverable errors
- All UI states render gracefully (no crashes)
- The 6 tests written in 4.1 pass

---

### Integration and Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 5 tests written by backend engineer (Task 1.1)
    - Review the 4 tests written by backend engineer (Task 2.1)
    - Review the 4 tests written by frontend engineer (Task 3.1)
    - Review the 6 tests written by UI engineer (Task 4.1)
    - Total existing tests: approximately 19 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between backend and frontend
    - Prioritize: import flow -> metadata fetch -> UI update cycle
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 6 additional strategic tests maximum
    - Integration test: Full import flow updates both importResult and lastImportedMetadata
    - Integration test: Metadata persists across page refreshes (simulated)
    - Integration test: Error state clears on successful retry
    - End-to-end test: "Go to Backlog" navigation works after import
    - Edge case test: Import with all zeros (no changes) displays correctly
    - Edge case test: Very large counts display without overflow
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 25 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Backend (can run in parallel)
  |
  +-- Task Group 1: Enhanced DTO and Service with Detailed Counts
  |
  +-- Task Group 2: Latest-Metadata Endpoint for Artifact Status
  |
  v
Phase 2: Frontend API
  |
  +-- Task Group 3: Frontend API Client and Types
  |
  v
Phase 3: UI
  |
  +-- Task Group 4: ProductRoadmapPage UI Enhancements
  |
  v
Phase 4: Integration Testing
  |
  +-- Task Group 5: Test Review and Gap Analysis
```

## Key Files Modified/Created

### Backend
| File | Changes |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/RoadmapImportResultDto.java` | Add 8 detailed count fields |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/DetailedImportCounts.java` | New file - helper record for count tracking |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectArtifactMetadataDto.java` | New file - lightweight metadata DTO |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java` | Track inserted/updated/archived/deleted |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectArtifactService.java` | Add getLatestArtifactMetadata method |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectArtifactController.java` | Add latest-metadata endpoint |

### Frontend
| File | Changes |
|------|---------|
| `frontend/src/api/roadmapApi.ts` | Extend types, add fetchLatestArtifactMetadata |
| `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | Add metadata state, summary card, CTA, error UX |
| `frontend/src/components/ProductView/ProductRoadmapPage.module.css` | New file - styles for new UI elements |

### Tests
| File | Purpose |
|------|---------|
| `architecture-model-service/src/test/java/.../service/RoadmapImportServiceDetailedCountsTest.java` | Test detailed count tracking |
| `architecture-model-service/src/test/java/.../controller/ProjectArtifactControllerMetadataTest.java` | Test latest-metadata endpoint |
| `frontend/src/__tests__/roadmapApi.test.ts` | Test API client functions and type mapping |
| `frontend/src/__tests__/ProductRoadmapPage.test.ts` | Test UI states and interactions |
| `frontend/src/__tests__/roadmap-import-ux-glue-integration.test.ts` | Integration and edge case tests |
