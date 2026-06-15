# Spec Requirements: Dashboard Real Data

## Initial Description

Make the dashboard show real data instead of mock data for all 10 cards. Based on analysis:

- 5 cards are already real or partially real (Product Definition, Standards, HLA, Test Strategy, Roadmap partial)
- 3 cards need a new work item count/stats endpoint (Roadmap completed, Backlog, Implementation)
- 2 cards (Testing Suite, Verification) will show 0 for all metrics for now since no data model exists yet

Key decisions:
- Need a new stats/count endpoint on architecture-model-service for work item counts by type and status
- Stories with AC count needs a convention (check description content or add column)
- Detailed Architecture counts need entity-type grouping from meta-model
- Last Updated dates for Product Definition and Test Strategy should use file mtime
- Testing Suite and Verification cards will display 0s (no real data source yet)

## Requirements Discussion

### First Round Questions

**Q1:** I assume the new endpoint on architecture-model-service should return counts grouped by both type AND status in a single call (e.g., `GET /api/model/projects/{projectId}/work-items/stats` returning something like `{ "EPIC": { "PLANNED": 3, "IN_PROGRESS": 2, "COMPLETED": 1 }, "FEATURE": { ... }, "STORY": { ... } }`). Is that correct, or would you prefer separate count queries per card?

**Answer:** Single call returning counts grouped by type AND status.

**Q2:** The Roadmap card's "Completed" count is currently mock. I assume this should count EPICs with status = "COMPLETED" from the new stats endpoint. Is that correct?

**Answer:** Yes, count EPICs with status = "COMPLETED", but use `status IN ("COMPLETED")` as other statuses may be added to the completed list later. The IN clause makes it extensible.

**Q3:** The raw idea mentions needing a convention for "Stories with AC." I assume the simplest approach is to check if the story's description field is non-null and non-empty. Is that correct, or would you prefer a keyword pattern or new boolean column?

**Answer:** If the implementation conversation with the "Product Manager" LLM has begun, they will come back with Acceptance Criteria. So check the current details of the feature/story (i.e., check if the description/details field has content). Non-null and non-empty description means the story has AC.

**Q4:** The Standards card currently has "Product Tech Stack" as mock. Should the product tech stack simply mirror the org tech stack value, or is there a separate file or section that distinguishes them?

**Answer:** They are separate files at different levels of the filesystem hierarchy:
- Org-level: `{orgName}/agent-os/profiles/default/standards/global/TECH-STACK.MD`
- Product-level: `{orgName}/{productName}/agent-os/product/TECH-STACK.MD`

See follow-up question for full path resolution details.

**Q5:** Product Definition and Test Strategy cards both show a "Last Updated" date that is currently mock. I assume we should use `fs.stat()` to get the file's modification time. Any specific date format preference?

**Answer:** Format as DD/MM/YYYY.

**Q6:** For the Detailed Architecture card, I assume we should filter by entity_type to split counts from the meta-model summary. For "Process Activities" and "Interface Endpoints", should these come from existing arrays or do we need additional entity types?

**Answer:** Filter by entity_type to split counts -- all info comes from the current meta model. No additional entity types needed beyond what MetaModelSummaryDto already provides.

**Q7:** When switching to real data, should the work item stats endpoint support scope filtering, or should all scope variants show the same real totals for now?

**Answer:** It should support scoping BUT default to "Entire Product" in the drop-down, which means there are no filters for now. Scope filtering is a future enhancement; for now all scopes show the same real totals. The default scope selection in the UI should change from NEXT_5_EPICS to ENTIRE_PRODUCT.

**Q8:** Is there anything you want to explicitly exclude from this spec?

**Answer:** Delete the mock data service entirely (`dashboardSummaryMockService.ts`). There is no separate "header stats" concept -- there are 10 cards and as many as possible should show real data. For cards that become real, delete the corresponding mock data. Testing Suite and Verification cards will show 0s since no data source exists yet.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Work Item Stats -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/WorkItemRepository.java` -- Already has `countByProjectIdAndTypeIn()` which can inform the new stats query pattern
- Feature: Work Item Controller -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java` -- Endpoint pattern to follow for the new stats endpoint
- Feature: Meta-Model Summary Service -- Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/MetaModelSummaryService.java` -- Shows entity_type values: "services", "logicalDataEntities", "physicalDataEntities", "interfaces"
- Feature: Dashboard Summary Route -- Path: `gateway/src/routes/dashboardSummary.ts` -- Current hybrid real+mock route that needs full rewrite to real data
- Feature: Architecture Model Client -- Path: `gateway/src/services/architectureModelClient.ts` -- Has `fetchProductSummary()`, `fetchMetaModelSummary()`, `fetchProjectFolder()` already available
- Feature: Roadmap Summary Builder -- Path: `gateway/src/services/roadmapSummaryBuilder.ts` -- Has `countRoadmapItems()` for initiative/epic counts
- Feature: Dashboard Types -- Path: `gateway/src/types/dashboard.ts` -- Full type definitions for the DTO contract (may need extension)
- Feature: Dashboard Mock Service -- Path: `gateway/src/services/dashboardSummaryMockService.ts` -- TO BE DELETED; currently provides all mock data

### Follow-up Questions

**Follow-up 1:** You described the org-level tech stack at `{orgName}/agent-os/profiles/default/standards/global/` and the product-level at `{orgName}/{productName}/agent-os/product`. The current dashboard route checks `agent-os/product/TECH-STACK.MD` for the org tech stack. Should the spec use the actual on-disk paths? Specifically: Org Tech Stack checks `agent-os/standards/global/tech-stack.md` and Product Tech Stack checks `agent-os/product/tech-stack.md`?

**Answer:** The filesystem hierarchy has two levels:

```
{orgName}/                                              <-- org root
  agent-os/
    profiles/default/standards/global/TECH-STACK.MD     <-- org-level tech stack
  {productName}/                                        <-- product folder (= projectParentFolder)
    agent-os/
      product/TECH-STACK.MD                             <-- product-level tech stack
```

The `projectParentFolder` returned by `fetchProjectFolder(projectId)` points to `{orgName}/{productName}/` (the product folder). Therefore:
- **Product Tech Stack**: `{projectParentFolder}/agent-os/product/TECH-STACK.MD` (same level as current check)
- **Org Tech Stack**: `{projectParentFolder}/../agent-os/profiles/default/standards/global/TECH-STACK.MD` (go UP one level from product folder to the org folder, then into org's agent-os)

The current route's org tech stack check (`agent-os/product/TECH-STACK.MD`) is incorrect -- it was checking the product-level path for both. This spec corrects that by checking the proper org-level path.

Both checks should include the case-insensitive fallback pattern already used in the current route (try uppercase first, then lowercase).

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files found in `C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-03-06-dashboard-real-data/planning/visuals/`.

## Requirements Summary

### Functional Requirements

**New Backend Endpoint (architecture-model-service):**
- New `GET /api/model/projects/{projectId}/work-items/stats` endpoint returning counts grouped by type (INITIATIVE, EPIC, FEATURE, STORY) and status (PLANNED, IN_PROGRESS, COMPLETED, CANCELLED)
- Single call returns all counts in one response, e.g., `{ "EPIC": { "PLANNED": 3, "IN_PROGRESS": 2, "COMPLETED": 1 }, ... }`
- Needs a new repository query (likely a native query with GROUP BY type, status), a new service method, and a new controller endpoint

**Gateway Dashboard Route Rewrite:**
- Delete `gateway/src/services/dashboardSummaryMockService.ts` entirely
- Rewrite `gateway/src/routes/dashboardSummary.ts` to assemble all card data from real sources
- Remove all imports and calls to `buildMockDashboardSummary()`

**Card-by-Card Data Sources (10 cards):**

1. **Product Definition Card:**
   - Mission Exists: ALREADY REAL -- `MISSION.MD` file existence check (keep as-is)
   - Last Updated: NEW -- `fs.stat()` mtime of MISSION.MD, formatted as DD/MM/YYYY. Show "N/A" if file does not exist.

2. **Roadmap Card:**
   - Initiatives: ALREADY REAL -- from `fetchProductSummary()` + `countRoadmapItems()` (keep as-is)
   - Epics: ALREADY REAL -- from `fetchProductSummary()` + `countRoadmapItems()` (keep as-is)
   - Completed: NEW -- count EPICs with `status IN ('COMPLETED')` from the new work-items/stats endpoint. Use IN clause for future extensibility.

3. **Standards Card:**
   - Org Tech Stack: FIX PATH -- check `{projectParentFolder}/../agent-os/profiles/default/standards/global/TECH-STACK.MD` (currently incorrectly checking product-level path). Case-insensitive fallback.
   - Product Tech Stack: NEW -- check `{projectParentFolder}/agent-os/product/TECH-STACK.MD`. Case-insensitive fallback. Show "Generated" or "Not Generated".

4. **High-Level Architecture Card:**
   - Applications, Services, Data Stores: ALREADY REAL -- from `fetchMetaModelSummary()` (keep as-is)

5. **Test Strategy Card:**
   - Exists: ALREADY REAL -- `TEST-STRATEGY.MD` file existence check (keep as-is)
   - Last Updated: NEW -- `fs.stat()` mtime of TEST-STRATEGY.MD, formatted as DD/MM/YYYY. Show "N/A" if file does not exist.

6. **Backlog Card:**
   - Epics In Scope: NEW -- count of EPICs (all statuses) from work-items/stats endpoint
   - Features: NEW -- count of FEATUREs (all statuses) from work-items/stats endpoint
   - Stories: NEW -- count of STORYs (all statuses) from work-items/stats endpoint
   - Stories with AC: NEW -- count of STORYs where description is non-null and non-empty. Requires either a separate repository query or a dedicated field in the stats response.

7. **Detailed Architecture Card:**
   - Process Activities: NEW -- count of entities from meta-model summary where entity_type indicates process/activity type (from the services/data_entities/interfaces arrays in MetaModelSummaryDto). Note: the current meta-model does not have a dedicated "processActivities" entity type in the summary. This may need to show 0 or be derived from business process entities if available. The spec implementer should check what entity_types are present and map accordingly.
   - Interface Endpoints: NEW -- count of `interfaces` array items from `fetchMetaModelSummary()`
   - Logical Data Entities: NEW -- count of items in `data_entities` array where `entity_type === "logicalDataEntities"`
   - Physical Data Entities: NEW -- count of items in `data_entities` array where `entity_type === "physicalDataEntities"`

8. **Testing Suite Card:**
   - E2E Tests: SHOW 0 -- no data source exists yet
   - Functional Tests: SHOW 0 -- no data source exists yet

9. **Implementation Card:**
   - Features in Progress: NEW -- count of FEATUREs with `status = 'IN_PROGRESS'` from work-items/stats endpoint
   - Stories in Progress: NEW -- count of STORYs with `status = 'IN_PROGRESS'` from work-items/stats endpoint
   - Stories Complete: NEW -- count of STORYs with `status IN ('COMPLETED')` from work-items/stats endpoint

10. **Verification Card:**
    - Stories Verified: SHOW 0 -- no data source exists yet
    - Pending Review: SHOW 0 -- no data source exists yet

**UI Change:**
- Default scope selector value changes from `NEXT_5_EPICS` to `ENTIRE_PRODUCT`

**Graceful Degradation:**
- All real data fetches should follow the existing pattern: try-catch with logger.warn on failure
- If the new stats endpoint fails, cards should fall back to showing 0 values (not mock data)
- If file mtime fetch fails, show "N/A" for Last Updated

### Reusability Opportunities
- `WorkItemRepository.countByProjectIdAndTypeIn()` already exists and can inform the new stats query pattern
- `fetchProductSummary()`, `fetchMetaModelSummary()`, `fetchProjectFolder()` are already available in `architectureModelClient.ts`
- The file existence check pattern with case-insensitive fallback is already implemented in the dashboard route for MISSION.MD, TECH-STACK.MD, and TEST-STRATEGY.MD
- The `countRoadmapItems()` function in `roadmapSummaryBuilder.ts` is already used for initiative/epic counts
- `MetaModelSummaryService.java` already populates entity_type values ("services", "logicalDataEntities", "physicalDataEntities", "interfaces") that can be filtered client-side in the gateway

### Scope Boundaries

**In Scope:**
- New work-items/stats endpoint on architecture-model-service (repository query, service, controller)
- New gateway client function to call the stats endpoint
- Full rewrite of dashboardSummary route to use real data
- Deletion of dashboardSummaryMockService.ts
- File mtime lookups for Product Definition and Test Strategy "Last Updated" fields
- Corrected org-level tech stack path (fix from product path to org path)
- New product-level tech stack existence check
- Detailed Architecture counts from meta-model entity_type grouping
- Changing default scope from NEXT_5_EPICS to ENTIRE_PRODUCT
- "Stories with AC" count based on non-empty description field

**Out of Scope:**
- Scope filtering (all scopes return same totals; filtering is a future enhancement)
- Testing Suite real data (E2E test counts, functional test counts) -- show 0
- Verification real data (stories verified, pending review) -- show 0
- Summary Insight AI-generated text (keep existing inline/enabled logic)
- Header stats as a separate concept (header is not a card; focus is on the 10 cards)
- Any changes to the DashboardView.tsx frontend component beyond changing the default scope value
- Any changes to the dashboard TypeScript type definitions (unless new fields are needed for the stats response)

### Technical Considerations
- The new stats endpoint should use a single native SQL query with `GROUP BY type, status` for efficiency rather than multiple count queries
- The "Stories with AC" count (description non-empty) may require a separate query or an additional field in the stats response since it filters on description content, not just type/status
- The org-level tech stack path requires navigating UP from projectParentFolder (`../agent-os/profiles/default/standards/global/TECH-STACK.MD`). Care must be taken with path traversal security (ensure the resolved path stays within expected bounds)
- File mtime via `fs.stat()` returns an `mtime` Date object; format to DD/MM/YYYY string in the gateway route
- The MetaModelSummaryDto currently groups entities into `services`, `data_entities`, `interfaces` arrays. For the Detailed Architecture card, "Process Activities" does not have a direct mapping in the current summary -- the entity_type values available are "services", "logicalDataEntities", "physicalDataEntities", "interfaces". The implementer should check if BusinessProcessEntity or ProcessActivityEntity is captured in the meta-model summary, and if not, either extend the summary or show 0
- All real data assembly should be done in the gateway route (not in the frontend), maintaining the current architecture where the frontend calls a single `/api/dashboard/summary` endpoint
