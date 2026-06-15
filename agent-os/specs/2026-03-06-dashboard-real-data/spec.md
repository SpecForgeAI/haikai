# Specification: Dashboard Real Data

## Goal
Replace all mock data in the dashboard summary endpoint with real data sourced from the work-items database, meta-model summary, and filesystem artifact checks, so every dashboard card reflects the actual state of the project.

## User Stories
- As a product owner, I want the dashboard to show real counts for backlog items, roadmap progress, and implementation status so that I can make decisions based on accurate data instead of hardcoded mock values.
- As an architect, I want the detailed architecture card to reflect actual entity counts from the meta-model so that I can see the true scope of the system design at a glance.

## Specific Requirements

**New Work Item Stats Endpoint on architecture-model-service**
- Add `GET /api/model/projects/{projectId}/work-items/stats` to `WorkItemController`
- Returns a JSON object with two top-level fields: `typeCounts` and `storiesWithAcCount`
- `typeCounts` is a nested map: `{ EPIC: { PLANNED: 3, IN_PROGRESS: 2, COMPLETED: 1 }, FEATURE: { ... }, STORY: { ... }, INITIATIVE: { ... } }`
- `storiesWithAcCount` is an integer counting STORYs where `description IS NOT NULL AND description != ''`
- Add a new native query to `WorkItemRepository` using `SELECT type, status, COUNT(*) FROM work_item WHERE project_id = :projectId GROUP BY type, status`
- Add a separate repository query for stories-with-AC count: `SELECT COUNT(*) FROM work_item WHERE project_id = :projectId AND type = 'STORY' AND description IS NOT NULL AND description != ''`
- Create a new `WorkItemStatsDto` record in the dto package to hold the response shape
- Add a `getWorkItemStats(UUID projectId)` method to `WorkItemService` that executes both queries and assembles the DTO

**New Gateway Client Function for Stats Endpoint**
- Add `fetchWorkItemStats(projectId: string)` to `architectureModelClient.ts`
- Calls `GET {baseUrl}/api/model/projects/{projectId}/work-items/stats`
- Returns a typed response matching the stats DTO shape, or null on error
- Follow the existing try-catch + logger.warn pattern used by `fetchProductSummary` and `fetchMetaModelSummary`
- Add a corresponding TypeScript interface (e.g., `WorkItemStatsResponse`) in gateway types or inline in the client

**Gateway Dashboard Route Full Rewrite**
- Remove the import and call to `buildMockDashboardSummary()` entirely
- Build the entire `DashboardSummaryDto` from real data sources in the route handler
- Construct the DTO in-line, calling: `fetchProjectFolder`, `fetchProductSummary`, `fetchMetaModelSummary`, `fetchWorkItemStats` (new), and filesystem checks
- Use `Promise.all` or `Promise.allSettled` where possible to parallelize independent data fetches (stats, productSummary, metaModelSummary can all run concurrently)
- Change the default scope fallback from `'NEXT_5_EPICS'` to `'ENTIRE_PRODUCT'`

**Delete Mock Service**
- Delete `gateway/src/services/dashboardSummaryMockService.ts` entirely
- Remove all imports of `buildMockDashboardSummary` from `dashboardSummary.ts`
- Remove any test files that only test mock data generation for this service

**Card-by-Card Real Data Assembly**
- Product Definition: keep existing MISSION.MD existence check; add `fs.stat()` mtime lookup on the found MISSION.MD path, format as DD/MM/YYYY, fallback to "N/A" if file does not exist
- Roadmap: keep existing `fetchProductSummary` + `countRoadmapItems` for initiatives and epics counts; derive `completed` from stats endpoint as count of EPICs with `status IN ('COMPLETED')`
- Standards: fix org tech stack path to `{projectParentFolder}/../agent-os/profiles/default/standards/global/TECH-STACK.MD` with case-insensitive fallback; keep product tech stack at `{projectParentFolder}/agent-os/product/TECH-STACK.MD` (the path currently labelled "org" in the route)
- High-Level Architecture: keep existing `fetchMetaModelSummary` logic for services, interfaces, dataStores
- Test Strategy: keep existing TEST-STRATEGY.MD existence check; add `fs.stat()` mtime lookup, format as DD/MM/YYYY, fallback to "N/A"

**Detailed Architecture Card from Meta-Model**
- Interface Endpoints: count of items in `metaModel.interfaces` array
- Logical Data Entities: count of items in `metaModel.data_entities` where `entity_type === 'logicalDataEntities'`
- Physical Data Entities: count of items in `metaModel.data_entities` where `entity_type === 'physicalDataEntities'`
- Process Activities: the current meta-model does not have a "processActivities" entity_type -- set this to 0 for now (no data source exists in MetaModelSummaryService)
- Overall: sum of interfaceEndpoints + logicalDataEntities + physicalDataEntities + processActivities

**Backlog and Implementation Cards from Stats Endpoint**
- Backlog epicsInScope: sum all status counts for type EPIC from `typeCounts`
- Backlog features: sum all status counts for type FEATURE
- Backlog stories: sum all status counts for type STORY
- Backlog storiesWithAC: use `storiesWithAcCount` from the stats response
- Implementation featuresInProgress: `typeCounts.FEATURE.IN_PROGRESS` (default 0)
- Implementation storiesInProgress: `typeCounts.STORY.IN_PROGRESS` (default 0)
- Implementation storiesComplete: `typeCounts.STORY.COMPLETED` (default 0, using IN clause logic for future extensibility)

**Header Stats from Real Data**
- `initiativesCount`: from `countRoadmapItems(productSummary).initiativeCount`
- `epicsCount`: sum all status counts for type EPIC from stats endpoint
- `activeEpicsCount`: `typeCounts.EPIC.IN_PROGRESS` (default 0)
- `storiesInProgressCount`: `typeCounts.STORY.IN_PROGRESS` (default 0)
- `lastUpdatedLabel`: keep "Just now" (generated at request time)
- `mode`: keep "GREENFIELD" hardcoded (no data source for mode yet)

**Testing Suite and Verification Cards Hardcoded to Zero**
- Testing Suite: `endToEndTestCount = 0`, `functionalTestCount = 0` (no data source exists yet)
- Verification: `storiesVerifiedCount = 0`, `pendingReviewCount = 0` (no data source exists yet)

**Frontend Default Scope Change**
- In `DashboardView.tsx`, change `useState<ScopeType>('NEXT_5_EPICS')` to `useState<ScopeType>('ENTIRE_PRODUCT')`
- No other frontend changes required since the DTO shape is not changing

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**WorkItemRepository.java (architecture-model-service)**
- Already has `countByProjectIdAndTypeIn()` which demonstrates the pattern for count queries scoped to a project
- The `searchByTitleOrDescription` native query shows the pattern for adding a `@Query(nativeQuery = true)` method
- New stats query should follow the same `@Param` annotation pattern and `nativeQuery = true` approach

**architectureModelClient.ts (gateway)**
- `fetchProductSummary()`, `fetchMetaModelSummary()`, `fetchProjectFolder()` are already imported and used in the dashboard route
- The new `fetchWorkItemStats()` function should follow the identical pattern: config baseUrl, fetch with GET, try-catch returning null on error, logger.warn on failure
- The `WorkItemRaw` interface inside this file shows the existing pattern for raw response types

**dashboardSummary.ts route (gateway)**
- Already has the filesystem check pattern for MISSION.MD, TECH-STACK.MD, TEST-STRATEGY.MD with case-insensitive fallback (try uppercase, catch, try lowercase)
- The `fs.stat()` mtime pattern should be added alongside each existing `fs.access()` check rather than replacing it -- access confirms existence, stat gets the mtime
- The try-catch with `logger.warn` graceful degradation pattern is already established and should be maintained for all new data fetches

**MetaModelSummaryService.java and MetaModelSummaryDto types**
- Entity types returned by the service are: `"services"`, `"logicalDataEntities"`, `"physicalDataEntities"`, `"interfaces"` -- there is no `"processActivities"` type
- The gateway TypeScript `MetaModelSummaryDto` interface has `data_entities` array where each item has an `entity_type` field for filtering logical vs physical

**roadmapSummaryBuilder.ts (gateway)**
- `countRoadmapItems()` is already used in the route to derive initiative and epic counts
- `hasExistingRoadmap()` is used to check if a roadmap exists before counting -- both should be preserved in the rewrite

## Out of Scope
- Scope filtering logic (all scopes return the same real totals; scope-based filtering is a future enhancement)
- Real data for Testing Suite card (E2E test counts, functional test counts) -- hardcode 0
- Real data for Verification card (stories verified, pending review) -- hardcode 0
- AI-generated Summary Insight text (keep existing static/enabled logic in the post-coding section)
- Any new entity types in MetaModelSummaryService for "processActivities" -- show 0 until a data source exists
- Changes to the DashboardSummaryDto type definitions (gateway or frontend) -- the existing type shape is sufficient
- Changes to the DashboardView.tsx component beyond the default scope value change
- Scope-dependent data branching in the gateway route (previously done by mock service for different scope sizes)
- Dashboard header `mode` field derivation from real data (keep "GREENFIELD" hardcoded)
- Push notifications or real-time dashboard updates
