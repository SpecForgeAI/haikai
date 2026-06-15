# Task Breakdown: Dashboard Real Data

## Overview
Total Tasks: 27 (across 4 task groups)

Replace all mock data in the dashboard summary endpoint with real data sourced from the work-items database, meta-model summary, and filesystem artifact checks. This spans three layers: Java backend (new stats endpoint), Node gateway (full route rewrite + mock deletion), and React frontend (default scope change).

## Task List

### Java Backend (architecture-model-service)

#### Task Group 1: Work Item Stats Endpoint
**Dependencies:** None

This task group adds a new `GET /api/model/projects/{projectId}/work-items/stats` endpoint that returns work item counts grouped by type and status, plus a count of stories with acceptance criteria (non-empty description). All three sub-layers (repository, service, controller, DTO) are implemented together.

- [x] 1.0 Complete work item stats endpoint
  - [x] 1.1 Write 4-6 focused tests for the stats endpoint
    - Test that GET `/api/model/projects/{projectId}/work-items/stats` returns 200 with expected JSON shape (`typeCounts` map + `storiesWithAcCount` integer)
    - Test that `typeCounts` correctly groups by type AND status (e.g., `EPIC.PLANNED: 3, EPIC.IN_PROGRESS: 2`)
    - Test that `storiesWithAcCount` counts only STORYs where description is non-null and non-empty
    - Test that an empty project returns `typeCounts: {}` and `storiesWithAcCount: 0`
    - Test location: `architecture-model-service/src/test/java/com/example/architecturemodel/`
    - Follow existing test patterns in the project (Spring Boot test slices or integration tests)
  - [x] 1.2 Create `WorkItemStatsDto` record in the dto package
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemStatsDto.java`
    - Follow the Java record pattern used by `WorkItemDto.java` (record with `@JsonProperty` annotations)
    - Fields: `typeCounts` (`Map<String, Map<String, Long>>`) and `storiesWithAcCount` (`long`)
    - Use `@JsonProperty("type_counts")` and `@JsonProperty("stories_with_ac_count")` for snake_case JSON output
  - [x] 1.3 Add two new repository queries to `WorkItemRepository.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
    - Query 1 (type-status counts): `@Query(value = "SELECT type, status, COUNT(*) as cnt FROM work_item WHERE project_id = :projectId GROUP BY type, status", nativeQuery = true)` returning `List<Object[]>`
    - Query 2 (stories with AC): `@Query(value = "SELECT COUNT(*) FROM work_item WHERE project_id = :projectId AND type = 'STORY' AND description IS NOT NULL AND description != ''", nativeQuery = true)` returning `long`
    - Follow the `@Param` annotation pattern from the existing `searchByTitleOrDescription` method
  - [x] 1.4 Add `getWorkItemStats(UUID projectId)` method to `WorkItemService.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemService.java`
    - Execute both repository queries and assemble the `WorkItemStatsDto`
    - Transform the `List<Object[]>` rows into the nested `Map<String, Map<String, Long>>` structure (outer key = type, inner key = status, value = count)
    - Mark as `@Transactional(readOnly = true)` following existing read-only methods
  - [x] 1.5 Add `getStats` endpoint to `WorkItemController.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java`
    - `@GetMapping("/stats")` returning `ResponseEntity<WorkItemStatsDto>`
    - Accept `@PathVariable UUID projectId`
    - Delegate to `workItemService.getWorkItemStats(projectId)`
    - Add log.debug following the existing controller logging pattern
  - [x] 1.6 Verify stats endpoint tests pass
    - Run ONLY the tests written in 1.1
    - Verify the endpoint returns the correct JSON shape
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `GET /api/model/projects/{projectId}/work-items/stats` returns `{ "type_counts": { "EPIC": { "PLANNED": N, ... }, ... }, "stories_with_ac_count": N }`
- An empty project returns `{ "type_counts": {}, "stories_with_ac_count": 0 }`
- The endpoint follows the existing controller/service/repository pattern

---

### Node Gateway (gateway)

#### Task Group 2: Gateway Client + Dashboard Route Rewrite
**Dependencies:** Task Group 1 (the Java stats endpoint must exist for the gateway to call it)

This task group adds a new client function to call the stats endpoint, fully rewrites the dashboard route to assemble all card data from real sources, deletes the mock service, and fixes the org tech stack path.

- [x] 2.0 Complete gateway dashboard route rewrite
  - [x] 2.1 Write 4-6 focused tests for the gateway changes
    - Test that `fetchWorkItemStats` returns correctly typed data on 200 and returns null on error
    - Test that the dashboard route returns a valid `DashboardSummaryDto` shape with all 10 cards populated
    - Test that when stats endpoint returns null, all stats-derived fields default to 0
    - Test that the default scope fallback is `ENTIRE_PRODUCT` (not `NEXT_5_EPICS`)
    - Test location: `gateway/src/__tests__/`
    - Follow the existing test patterns in the gateway project
  - [x] 2.2 Add `WorkItemStatsResponse` interface and `fetchWorkItemStats` function to `architectureModelClient.ts`
    - File: `gateway/src/services/architectureModelClient.ts`
    - Interface: `WorkItemStatsResponse { typeCounts: Record<string, Record<string, number>>; storiesWithAcCount: number; }`
    - Note: The Java backend serializes as snake_case (`type_counts`, `stories_with_ac_count`), so use those field names in the interface OR parse with camelCase mapping -- follow whichever pattern the existing client functions use (they use the backend's casing directly)
    - Function: `fetchWorkItemStats(projectId: string): Promise<WorkItemStatsResponse | null>`
    - Follow the identical pattern of `fetchProductSummary`: config baseUrl, `GET` fetch, try-catch returning null on error, logger.warn on failure
    - URL: `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}/work-items/stats`
  - [x] 2.3 Create helper functions for stats extraction
    - Add in-line or in a small utility within the route file (or a new utility file if preferred)
    - `sumAllStatusesForType(typeCounts, type)`: sums all status values for a given type, returns 0 if type missing
    - `getStatusCount(typeCounts, type, status)`: returns count for a specific type+status combo, defaults to 0
    - These helpers make the card assembly code readable and avoid repetitive null-checking
  - [x] 2.4 Create helper function for file mtime lookup
    - `getFileMtimeFormatted(filePath: string): Promise<string>`: calls `fs.stat()`, formats `mtime` as DD/MM/YYYY, returns `'N/A'` on any error
    - Used for Product Definition `lastUpdatedLabel` and Test Strategy `lastUpdated`
  - [x] 2.5 Rewrite `dashboardSummary.ts` route handler to build DTO from real data
    - File: `gateway/src/routes/dashboardSummary.ts`
    - Remove import of `buildMockDashboardSummary` from `dashboardSummaryMockService`
    - Add import of `fetchWorkItemStats` from `architectureModelClient`
    - Change the default scope fallback from `'NEXT_5_EPICS'` to `'ENTIRE_PRODUCT'` (line ~69)
    - Use `Promise.all` to parallelize independent fetches: `[fetchProjectFolder(projectId), fetchProductSummary(projectId), fetchMetaModelSummary(projectId), fetchWorkItemStats(projectId)]`
    - Build the entire `DashboardSummaryDto` inline from the four data sources plus filesystem checks
    - Card-by-card assembly (see sub-tasks 2.6 through 2.11)
    - Maintain existing try-catch + logger.warn graceful degradation pattern throughout
  - [x] 2.6 Assemble Header stats from real data
    - `projectName`: projectId
    - `generatedAt`: `new Date().toISOString()`
    - `initiativesCount`: from `countRoadmapItems(productSummary).initiativeCount` (0 if no productSummary)
    - `epicsCount`: `sumAllStatusesForType(stats.typeCounts, 'EPIC')` (0 if stats is null)
    - `activeEpicsCount`: `getStatusCount(stats.typeCounts, 'EPIC', 'IN_PROGRESS')` (0 if stats is null)
    - `storiesInProgressCount`: `getStatusCount(stats.typeCounts, 'STORY', 'IN_PROGRESS')` (0 if stats is null)
    - `lastUpdatedLabel`: `'Just now'`
    - `mode`: `'GREENFIELD'`
  - [x] 2.7 Assemble Strategic Foundation cards from real data
    - **Product Definition**: missionExists from MISSION.MD `fs.access` check (keep existing pattern); lastUpdatedLabel from `getFileMtimeFormatted(missionPath)` -- check existence first, if file does not exist set to `'N/A'`
    - **Roadmap**: initiativesCount and epics from `countRoadmapItems(productSummary)` (keep existing pattern); completed = `getStatusCount(stats.typeCounts, 'EPIC', 'COMPLETED')` (default 0)
    - **Standards**: Fix org tech stack path to `path.join(artifactBasePath, '..', 'agent-os', 'profiles', 'default', 'standards', 'global', 'TECH-STACK.MD')` with case-insensitive fallback; keep product tech stack at `path.join(artifactBasePath, 'agent-os', 'product', 'TECH-STACK.MD')` with case-insensitive fallback
    - **High-Level Architecture**: keep existing `fetchMetaModelSummary` logic (services, interfaces, dataStores counts)
    - **Test Strategy**: exists from TEST-STRATEGY.MD `fs.access` check (keep existing pattern); lastUpdated from `getFileMtimeFormatted(testStrategyPath)` -- check existence first, if file does not exist set to `'N/A'`
    - **summaryInsight**: `{ enabled: false, message: null }`
  - [x] 2.8 Assemble Detailed Architecture card from meta-model data
    - `interfaceEndpoints`: `metaModel?.interfaces?.length ?? 0`
    - `logicalDataEntities`: count of items in `metaModel?.data_entities` where `entity_type === 'logicalDataEntities'` (default 0)
    - `physicalDataEntities`: count of items in `metaModel?.data_entities` where `entity_type === 'physicalDataEntities'` (default 0)
    - `processActivities`: `0` (no data source exists in current meta-model)
    - `overall`: sum of interfaceEndpoints + logicalDataEntities + physicalDataEntities + processActivities
  - [x] 2.9 Assemble Backlog and Implementation cards from stats endpoint
    - **Backlog**: epicsInScope = `sumAllStatusesForType(typeCounts, 'EPIC')`; features = `sumAllStatusesForType(typeCounts, 'FEATURE')`; stories = `sumAllStatusesForType(typeCounts, 'STORY')`; storiesWithAC = `stats?.storiesWithAcCount ?? 0`
    - **Implementation**: featuresInProgress = `getStatusCount(typeCounts, 'FEATURE', 'IN_PROGRESS')`; storiesInProgress = `getStatusCount(typeCounts, 'STORY', 'IN_PROGRESS')`; storiesComplete = `getStatusCount(typeCounts, 'STORY', 'COMPLETED')`
  - [x] 2.10 Assemble Testing Suite and Verification cards (hardcoded zeros)
    - **Testing Suite**: `endToEndTestCount: { label: 'E2E Tests', value: 0 }`, `functionalTestCount: { label: 'Functional Tests', value: 0 }`
    - **Verification**: `storiesVerifiedCount: { label: 'Stories Verified', value: 0 }`, `pendingReviewCount: { label: 'Pending Review', value: 0 }`
    - **postCoding summaryInsight**: `{ enabled: true, message: '...' }` -- keep the existing inline summary insight logic (enabled with static message text)
  - [x] 2.11 Delete mock service file and clean up imports
    - Delete file: `gateway/src/services/dashboardSummaryMockService.ts`
    - Remove all imports of `buildMockDashboardSummary` from `dashboardSummary.ts` (should already be removed in 2.5)
    - Remove any test files that ONLY test mock data generation for `dashboardSummaryMockService` (if they exist)
    - Verify no other files import from `dashboardSummaryMockService`
  - [x] 2.12 Verify gateway tests pass
    - Run ONLY the tests written in 2.1
    - Verify the dashboard route returns correct shape with real data assembly
    - Verify graceful degradation when stats endpoint is unavailable
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- `fetchWorkItemStats` is added to `architectureModelClient.ts` following existing client patterns
- The dashboard route builds the entire DTO from real data sources (no mock service calls)
- `dashboardSummaryMockService.ts` is deleted
- Default scope fallback is `ENTIRE_PRODUCT`
- Org tech stack path correctly points to `{projectParentFolder}/../agent-os/profiles/default/standards/global/TECH-STACK.MD`
- Product Definition and Test Strategy cards include `lastUpdated` dates from file mtime (DD/MM/YYYY format)
- All cards that lack a real data source (Testing Suite, Verification, processActivities) show 0
- Graceful degradation: if any data source fails, affected fields show 0 or `'N/A'` (not mock values)

---

### React Frontend

#### Task Group 3: Default Scope Change
**Dependencies:** Task Group 2 (gateway must return correct data for ENTIRE_PRODUCT scope)

This is a single-line change in the frontend to default the scope selector to ENTIRE_PRODUCT.

- [x] 3.0 Complete frontend default scope change
  - [x] 3.1 Write 2 focused tests for the default scope change
    - Test that `DashboardView` initializes with `selectedScope` set to `'ENTIRE_PRODUCT'`
    - Test that the scope selector `<select>` element has `'ENTIRE_PRODUCT'` as its default value on initial render
    - Test location: `frontend/src/components/DashboardView/__tests__/` (or existing test file if present)
  - [x] 3.2 Change default scope in `DashboardView.tsx`
    - File: `frontend/src/components/DashboardView/DashboardView.tsx`
    - Change line 161: `useState<ScopeType>('NEXT_5_EPICS')` to `useState<ScopeType>('ENTIRE_PRODUCT')`
    - No other frontend changes required (the DTO shape is unchanged)
  - [x] 3.3 Verify frontend tests pass
    - Run ONLY the 2 tests written in 3.1
    - Verify the scope selector defaults to ENTIRE_PRODUCT
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2 tests written in 3.1 pass
- The scope selector defaults to "Entire Product" on initial dashboard load
- No other frontend behavior is changed

---

### Cross-Layer Verification

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Task Group 1 (Java stats endpoint)
    - Review the 4-6 tests written by Task Group 2 (gateway client + route rewrite)
    - Review the 2 tests written by Task Group 3 (frontend default scope)
    - Total existing tests: approximately 10-14 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows that lack test coverage
    - Focus ONLY on gaps related to the dashboard real data feature
    - Do NOT assess entire application test coverage
    - Key areas to check for gaps:
      - End-to-end flow: stats endpoint -> gateway client -> route assembly -> DTO output
      - File mtime formatting edge cases (file not found, permission error)
      - Org tech stack path traversal (correct parent directory resolution)
      - Stats helper functions (sumAllStatusesForType, getStatusCount) with missing/null data
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points between layers
    - Priority gap areas:
      - Gateway route returns correct values when stats endpoint returns partial data (e.g., only EPIC counts, no STORY counts)
      - Gateway route returns correct values when metaModel is null (all architecture counts = 0)
      - Stats helper functions handle edge cases (empty typeCounts, missing type, missing status)
      - File mtime helper returns 'N/A' when file does not exist
      - Org tech stack path resolves correctly relative to projectParentFolder
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 20-24 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-24 tests total)
- Critical workflows for dashboard real data are covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Java Backend -- Work Item Stats Endpoint** (no dependencies)
   - Creates the new stats endpoint that Task Group 2 depends on
   - Can be built and tested independently against the database

2. **Task Group 2: Node Gateway -- Client + Route Rewrite** (depends on Task Group 1)
   - Adds the client function to call the new stats endpoint
   - Fully rewrites the dashboard route to use real data
   - Deletes the mock service
   - Cannot be completed until the Java endpoint from Task Group 1 is deployed/running

3. **Task Group 3: React Frontend -- Default Scope Change** (depends on Task Group 2)
   - Single-line change, but should be done after the gateway correctly handles ENTIRE_PRODUCT scope
   - Functionally independent but logically should follow the gateway rewrite

4. **Task Group 4: Cross-Layer Verification** (depends on Task Groups 1-3)
   - Reviews all tests and fills gaps
   - Must run after all implementation is complete

## Key Files Modified

### Java Backend (Task Group 1)
- **NEW**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemStatsDto.java`
- **MODIFIED**: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java`
- **MODIFIED**: `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemService.java`
- **MODIFIED**: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java`

### Node Gateway (Task Group 2)
- **MODIFIED**: `gateway/src/services/architectureModelClient.ts`
- **MODIFIED**: `gateway/src/routes/dashboardSummary.ts`
- **DELETED**: `gateway/src/services/dashboardSummaryMockService.ts`

### React Frontend (Task Group 3)
- **MODIFIED**: `frontend/src/components/DashboardView/DashboardView.tsx`
