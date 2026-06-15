# Spec Requirements: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)

## Initial Description
Enable the Roadmap PM flow to import an existing roadmap skeleton from Jira using a user-provided JQL, creating canonical INITIATIVE and EPIC work_items in the tool, while storing external Jira references on each imported work item for future sync. This increment performs import + persistence of INITIATIVE/EPIC only. No LLM saving workflow changes beyond collecting JQL (handled in RM-2/RM-1).

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea says to add four new external reference fields to work_item: `external_system`, `external_key`, `external_id`, and `external_url`. However, I found that `external_system` (TEXT NULL) and `external_key` (TEXT NULL) already exist on the work_item table since migration 012 and are already mapped in both the WorkItemEntity, WorkItemDto, and WorkItemMapper in architecture-model-service. The jira-service JiraIssueMappingService already populates `external_system="JIRA"` and `external_key=issue.key()`. Given this, I assume the migration (046) only needs to add the two NEW columns: `external_id` (TEXT NULL) and `external_url` (TEXT NULL), plus the proposed partial unique constraint on `(project_id, external_system, external_key) WHERE external_key IS NOT NULL`. Is that correct, or should we also change anything about the existing two columns?
**Answer:** Do not change external_system or external_key (they already exist and are sufficient). Migration 046 should only add external_url (TEXT NULL) and the partial unique constraint if not already present. No external_id column -- it is not needed.

**Q2:** The raw idea specifies a unique constraint: `UNIQUE (project_id, external_system, external_key) WHERE external_key IS NOT NULL`. The existing DB uses Liquibase (not Flyway) with a changelog master YAML file. The latest migration is 045. I assume the new migration will be `046-work-item-external-reference-fields.sql` with a corresponding changeset in `db.changelog-master.yaml` using the established pattern (preCondition: column `external_id` does not exist on `work_item`). Is that correct?
**Answer:** Yes -- Liquibase migration 046 (e.g., 046-work-item-external-url.sql) with preconditions to skip if the column/constraint already exists.

**Q3:** The jira-service already has a `GET /jira/issues` endpoint that accepts `jql`, `jiraProjectKey`, `toolProjectId`, `maxResults`, and `expandChildren` parameters. It already maps Jira issues to WorkItemDto objects with deterministic UUIDs (via DeterministicIdGenerator using `toolProjectId + ":" + issue.key()`), external_system="JIRA", external_key, parent linkage, and type resolution via configurable type-mapping. The gateway already has a proxy route (`jiraIssuesRouter`) that forwards to this endpoint using axios. The raw idea proposes a new `POST /api/roadmap/jira/import` endpoint in the gateway. I assume this new gateway endpoint will: (a) call the existing jira-service `GET /jira/issues` to fetch mapped WorkItemDtos, (b) filter/classify them as INITIATIVE or EPIC, (c) handle orphan EPICs by creating a synthetic "Imported Roadmap" initiative, and (d) upsert them into architecture-model-service via the existing work item CRUD API. Is this the intended orchestration flow, or should the jira-service itself be extended with new logic?
**Answer:** The gateway should call existing jira-service GET /jira/issues, filter to INITIATIVE/EPIC, handle orphan EPICs, then upsert into architecture-model-service. Do not extend jira-service in this increment.

**Q4:** The jira-service TypeMappingService uses a per-project type-mapping configuration (in `application.yml`) to resolve Jira issue types. Currently the only mapping is for project "ABM": `Epic->INITIATIVE, Story->FEATURE, Task->STORY, Bug->STORY`. The raw idea says to classify issues as INITIATIVE or EPIC "by issue type name." I see two possible approaches: (a) rely on the existing jira-service type-mapping config to resolve types (meaning users need to configure their Jira project's type mapping to produce INITIATIVE/EPIC), or (b) have the gateway classify based on raw Jira issue type names (e.g., "Initiative"/"Epic") regardless of jira-service config. Which approach should we use? If (a), should we add a new type-mapping entry for the target Jira project, or make the gateway import endpoint accept a type-mapping parameter?
**Answer:** Rely on existing TypeMappingService config in jira-service. Do not classify in gateway and do not add a type-mapping parameter to the import request.

**Q5:** The jira-service DeterministicIdGenerator produces UUIDv3 from `toolProjectId + ":" + externalKey`. The existing RoadmapImportService (which imports from roadmap.md files) uses its own deterministic ID generation based on normalized titles. When we upsert Jira-imported work items, I assume we should use the jira-service's deterministic IDs (based on external_key) since those enable idempotent re-import. However, the WorkItemService.createWorkItem() validates parent hierarchy strictly (EPIC requires an INITIATIVE parent, INITIATIVE must have null parent). Since we need to create initiatives first and then link epics, I assume the gateway will need to: (1) create/upsert all INITIATIVEs first, (2) then create/upsert EPICs with parentId set. Is this sequencing acceptable, or should we add a bulk upsert endpoint to architecture-model-service that handles ordering internally?
**Answer:** Create/upsert INITIATIVEs first, then EPICs (two-phase) to satisfy parent hierarchy validation.

**Q6:** For the upsert behavior, the raw idea says re-running the same JQL should update existing items instead of duplicating. The existing architecture-model-service WorkItemController has separate POST (create) and PUT (update) endpoints. The WorkItemService.createWorkItem generates a new UUID if none is provided. For upsert, I assume the gateway will: (a) for each Jira-mapped WorkItemDto, check if a work item with that deterministic ID already exists (via GET), (b) if yes, PUT to update, (c) if no, POST to create with the deterministic ID pre-set. Alternatively, should we add a dedicated upsert endpoint (e.g., `PUT /api/model/projects/{projectId}/work-items/upsert`) to architecture-model-service that handles this in a single call? The single-item approach means N+1 HTTP calls per import; a bulk endpoint would be more efficient.
**Answer:** Perform list-once + POST-or-PUT per item in gateway. Do not introduce a bulk upsert endpoint in this increment.

**Q7:** The raw idea says "orphan EPICs grouped under synthetic 'Imported Roadmap' initiative." I assume this synthetic initiative would be created with: type=INITIATIVE, title="Imported Roadmap", external_system="JIRA", external_key=null (since it has no Jira counterpart), and a deterministic ID computed from the project ID + a fixed seed like "IMPORTED_ROADMAP" so it's idempotent. On re-import, new orphan epics would be added under this same synthetic initiative. Is that the intended behavior? Also, should we set external_system="JIRA" or leave it null for the synthetic initiative since it doesn't correspond to an actual Jira issue?
**Answer:** Synthetic "Imported Roadmap" initiative should have external_system = NULL and external_key = NULL.

**Q8:** The `POST /api/roadmap/jira/import` endpoint body specifies `projectId (UUID)`, `jql (string)`, and `maxResults (number, default 200)`. The existing jira-service `GET /jira/issues` endpoint also requires `jiraProjectKey` as a mandatory parameter. Should the new gateway import endpoint also require `jiraProjectKey` in the request body? Or should the gateway extract it from the JQL string? Or should we make jiraProjectKey optional in the jira-service when a full JQL is provided (the jira-service currently uses jiraProjectKey for type-mapping lookup even when custom JQL is given)?
**Answer:** Yes -- require jiraProjectKey in the import request body so jira-service type mapping works correctly.

**Q9:** The jira-service `GET /jira/issues` endpoint has an `expandChildren` parameter that fetches one level of child issues. For roadmap skeleton import (INITIATIVE + EPIC only), I assume we should call it with `expandChildren=true` so that if the JQL returns top-level initiatives, their child epics are automatically fetched. Is that correct? Or should the user be expected to write JQL that returns both initiatives and epics in a single query?
**Answer:** Require the user's JQL to return both Initiatives and Epics. Do not rely on expandChildren in this increment.

**Q10:** The raw idea says the import response returns counts: `importedInitiatives, importedEpics, updatedInitiatives, updatedEpics` plus warnings. I notice the existing RoadmapImportResultDto in architecture-model-service has a detailed counts pattern (inserted/updated/archived/deleted). Should the Jira import response follow the same pattern (including archived/deleted counts), or keep it simpler since Jira import is additive-only (no archive/delete of items not in the JQL results)?
**Answer:** Keep response simple and additive-only: counts for created and updated (plus warnings). No archived/deleted semantics.

**Q11:** The raw idea mentions the `external_url` field for each imported work item. The jira-service JiraIssueFields does not currently return a `self` or `browseUrl` field. To populate `external_url`, I assume we would construct it from the Jira base URL + issue key (e.g., `https://<jira-host>/browse/PROJ-123`). The jira-service config has `baseUrl` available. Should the jira-service be extended to return a computed `externalUrl` field in its WorkItemDto, or should the gateway construct the URL? And is the jira-service baseUrl the correct base for browse URLs (some Jira Cloud instances differ)?
**Answer:** Gateway should construct external_url from configured Jira base URL + issue key. jira-service does not need to change.

**Q12:** Regarding the `external_id` field -- the Jira REST API returns a numeric `id` field on each issue (distinct from the human-readable `key` like "PROJ-123"). Should `external_id` store this Jira numeric ID? Currently the JiraIssue record only captures `key` and `fields`, not the top-level `id`. If we need `external_id`, the JiraIssue record in jira-service would need to be extended. Is storing the Jira numeric ID in `external_id` necessary for this increment, or can it be deferred?
**Answer:** Do not add or store Jira's numeric internal id. external_key (e.g., ABC-123) is sufficient.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Existing Roadmap Import (from roadmap.md) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/RoadmapImportService.java` -- upsert logic, deterministic IDs, detailed counts pattern
- Feature: RoadmapImportController - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/RoadmapImportController.java`
- Feature: RoadmapImportResultDto / DetailedImportCounts - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/roadmap/`
- Feature: Jira Issues Gateway Proxy Route - Path: `gateway/src/routes/jiraIssues.ts` -- existing pattern for gateway-to-jira-service communication using axios
- Feature: Jira Issue Mapping Service - Path: `jira-service/src/main/java/com/example/jiraservice/service/JiraIssueMappingService.java` -- deterministic ID generation, type mapping, external_system/external_key population
- Feature: DeterministicIdGenerator - Path: `jira-service/src/main/java/com/example/jiraservice/util/DeterministicIdGenerator.java` -- UUIDv3 generation for idempotent imports
- Feature: WorkItem CRUD - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemController.java` and `service/WorkItemService.java` -- existing create/update/validation logic
- Feature: WorkItemMapper - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/WorkItemMapper.java` -- entity-to-DTO mapping including external fields
- Feature: Gateway architectureModelClient - Path: `gateway/src/services/architectureModelClient.ts` -- pattern for calling architecture-model-service from gateway (uses native fetch)
- Feature: Gateway config - Path: `gateway/src/config.ts` -- has `jiraServiceBaseUrl` and `architectureModelServiceBaseUrl` already configured
- Feature: TypeMappingService - Path: `jira-service/src/main/java/com/example/jiraservice/service/TypeMappingService.java` -- Jira issue type to WorkItem type resolution
- Feature: ChildExpansionService - Path: `jira-service/src/main/java/com/example/jiraservice/service/ChildExpansionService.java` -- fetches child issues via batched JQL queries

### Follow-up Questions
No follow-up questions needed. All decisions were clear from the first round of answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- New gateway endpoint `POST /api/roadmap/jira/import` that orchestrates the Jira import flow
- Request body requires: `projectId` (UUID), `jql` (string), `jiraProjectKey` (string), and optional `maxResults` (number, default 200)
- Call jira-service `GET /jira/issues` with user's JQL (no expandChildren); rely on jira-service TypeMappingService for type resolution
- Filter returned WorkItemDtos to INITIATIVE and EPIC types only
- Two-phase upsert: create/upsert all INITIATIVEs first, then create/upsert EPICs to satisfy parent hierarchy validation
- Upsert via list-once + POST-or-PUT per item against architecture-model-service (no bulk endpoint)
- Group orphan EPICs (no parent INITIATIVE in result set) under a synthetic "Imported Roadmap" initiative with external_system=NULL and external_key=NULL
- Gateway constructs external_url from configured Jira base URL + issue key (e.g., `https://<jira-host>/browse/PROJ-123`)
- Populate external_system="JIRA" and external_key=issue.key on each imported item (already done by jira-service)
- Return simple additive-only response: counts for created and updated initiatives/epics, plus warnings array
- Idempotent: re-running same JQL updates existing items via deterministic IDs, no duplicates

### Architecture-model-service Changes
- Add `external_url` (TEXT NULL) column to work_item table via Liquibase migration 046 (046-work-item-external-url.sql)
- Add partial unique constraint: `UNIQUE (project_id, external_system, external_key) WHERE external_key IS NOT NULL` (with preconditions to skip if already exists)
- NO external_id column -- not needed
- Extend WorkItemEntity with `externalUrl` field
- Extend WorkItemDto with `external_url` field
- Update WorkItemMapper to map the new field

### Jira-service Changes
- No changes to jira-service in this increment
- Rely entirely on existing GET /jira/issues endpoint and TypeMappingService configuration

### Gateway Changes
- New `POST /api/roadmap/jira/import` route
- Request body: `{ projectId, jql, jiraProjectKey, maxResults? }`
- Orchestration logic: call jira-service GET /jira/issues, filter to INITIATIVE/EPIC types, resolve parents, create synthetic "Imported Roadmap" initiative for orphan EPICs, two-phase upsert via architecture-model-service CRUD API
- Construct external_url from configured Jira base URL + issue key
- Response: counts (createdInitiatives, updatedInitiatives, createdEpics, updatedEpics) + warnings array

### Reusability Opportunities
- Reuse existing `jiraIssuesRouter` pattern in gateway for HTTP calls to jira-service (axios-based)
- Reuse existing `architectureModelClient.ts` pattern for HTTP calls to architecture-model-service (fetch-based)
- Reuse existing jira-service `GET /jira/issues` endpoint (without expandChildren)
- Reuse DeterministicIdGenerator from jira-service for stable UUIDs
- Reuse TypeMappingService for Jira issue type resolution (requires appropriate config entries)
- Follow RoadmapImportService upsert pattern for insert/update logic
- Reuse Liquibase migration pattern from existing changesets for 046

### Scope Boundaries
**In Scope:**
- Gateway import endpoint orchestration (two-phase upsert)
- DB migration for external_url column + partial unique constraint
- Extending WorkItemEntity/Dto/Mapper for external_url
- Upsert logic for INITIATIVE and EPIC work items from Jira
- Orphan EPIC grouping under synthetic initiative (external_system=NULL, external_key=NULL)
- Gateway-side external_url construction from Jira base URL
- Idempotent import (re-run updates, no duplicates)
- Simple additive-only import result counts and warnings

**Out of Scope:**
- external_id column (not needed; external_key is sufficient)
- Bulk upsert endpoint in architecture-model-service
- expandChildren usage (user JQL must return both Initiatives and Epics)
- Any jira-service code changes
- Gateway-side type classification (delegated to jira-service TypeMappingService)
- Archive/delete semantics in import response
- Importing Features/Stories (only INITIATIVE and EPIC)
- Delivery team assignment
- Due dates / scheduling fields
- Sync back to Jira
- Complex Jira hierarchy edge cases beyond parent linkage best-effort
- Frontend UI changes (minimal or none this increment)
- LLM saving workflow changes (handled in RM-2/RM-1)

### Technical Considerations
- DB migration system is Liquibase (not Flyway), next migration number is 046
- Migration file should be named 046-work-item-external-url.sql with preconditions to skip if column/constraint already exists
- WorkItem table already has `external_system` and `external_key` columns since migration 012
- jira-service already maps issues to WorkItemDto with deterministic IDs and external fields
- Gateway already has config entries for both jiraServiceBaseUrl and architectureModelServiceBaseUrl
- WorkItemService enforces strict parent hierarchy validation (INITIATIVE=null parent, EPIC=INITIATIVE parent) -- hence two-phase upsert
- Gateway proxy route to jira-service uses axios; gateway client to architecture-model-service uses native fetch
- jira-service type-mapping is per-project config in application.yml -- must have appropriate mapping entries for the target Jira project
- User's JQL must return both Initiatives and Epics in one query (no expandChildren reliance)
- Synthetic "Imported Roadmap" initiative uses deterministic ID but has NULL external_system and external_key
