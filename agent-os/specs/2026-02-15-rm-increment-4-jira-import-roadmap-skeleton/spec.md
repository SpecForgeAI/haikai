# Specification: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)

## Goal
Enable the Roadmap PM flow to import an existing roadmap skeleton from Jira using a user-provided JQL query, creating canonical INITIATIVE and EPIC work_items in the tool with external Jira references for future sync, using an additive upsert approach that is fully idempotent.

## User Stories
- As a Product Manager, I want to import my existing Jira Initiatives and Epics into the tool via a JQL query so that I can build on my current roadmap without re-entering data manually.
- As a Product Manager, I want to re-run the same import and have it update existing items rather than duplicate them so that my roadmap stays in sync with Jira.
- As a Product Manager, I want orphan Epics (those without a parent Initiative in the import) to be automatically grouped under a synthetic "Imported Roadmap" initiative so that no imported work is lost.

## Specific Requirements

**Liquibase Migration 046: Add `external_url` column and partial unique constraint**
- Create migration file `046-work-item-external-url.sql` in `architecture-model-service/src/main/resources/db/changelog/sql/`
- Add column: `ALTER TABLE work_item ADD COLUMN external_url TEXT NULL`
- Add partial unique index: `CREATE UNIQUE INDEX idx_work_item_external_ref ON work_item(project_id, external_system, external_key) WHERE external_key IS NOT NULL`
- Add changeset entry in `db.changelog-master.yaml` as id `046-work-item-external-url` with precondition checking that `external_url` column does not already exist on `work_item`, using the same author/pattern as existing changesets
- Do NOT add an `external_id` column -- `external_key` (e.g., ABC-123) is sufficient
- Do NOT modify the existing `external_system` or `external_key` columns (they exist since migration 012)

**Extend WorkItemEntity, WorkItemDto, and WorkItemMapper for `external_url`**
- Add `externalUrl` (String) field to `WorkItemEntity` with `@Column(name = "external_url")`
- Add `externalUrl` field to the `WorkItemDto` Java record with `@JsonProperty("external_url")`
- Update `WorkItemMapper.toDto()` to pass the new `externalUrl` field
- Update `WorkItemMapper.toEntity()` to set `externalUrl` from the DTO
- Update `WorkItemMapper.updateEntityFromDto()` to set `externalUrl` from the DTO
- The jira-service `WorkItemDto` does NOT need the `external_url` field -- the gateway constructs it

**Gateway: Jira import service module**
- Create new file `gateway/src/services/jiraImportService.ts` containing the orchestration logic
- Implement a function to call jira-service `GET /jira/issues` with query params: `jql`, `jiraProjectKey`, `toolProjectId` (= projectId), `maxResults`, `expandChildren=false`
- Use axios for the jira-service call, following the pattern in `gateway/src/routes/jiraIssues.ts`
- Implement a function to filter returned WorkItemDto items to only those with `type` of `INITIATIVE` or `EPIC`, emitting a warning for any items with other types (FEATURE, STORY, etc.)
- Implement parent linkage resolution: for each EPIC, check if its `parent_id` references an INITIATIVE in the filtered result set; if not, mark it as an orphan
- Implement synthetic "Imported Roadmap" initiative handling: create or find a single synthetic initiative with `external_system=null`, `external_key=null`, title "Imported Roadmap", type INITIATIVE, using a deterministic UUID derived from `projectId + ":IMPORTED_ROADMAP"` (UUIDv3, same algorithm as `DeterministicIdGenerator`)
- Implement `external_url` construction: for each item with `external_key`, build `${jiraBaseUrl}/browse/${external_key}` using the Jira base URL from gateway config (`getConfig().jiraServiceBaseUrl` base, but note the Jira browse URL may need a separate config entry or be derived from the existing `jiraServiceBaseUrl`)

**Gateway: Import route handler**
- Create new route file or add to existing routes: `POST /api/roadmap/jira/import`
- Register the route in `gateway/src/routes/index.ts` and wire it in the Express app
- Request body validation: `projectId` (required, UUID string), `jql` (required, non-empty string), `jiraProjectKey` (required, non-empty string), `maxResults` (optional number, default 200)
- Return 400 for validation errors with descriptive messages
- Response shape: `{ createdInitiatives: number, updatedInitiatives: number, createdEpics: number, updatedEpics: number, warnings: string[] }`
- Forward jira-service auth/connection errors as 502/503 with the upstream error details
- Forward architecture-model-service errors with appropriate status codes

**Two-phase upsert orchestration**
- Phase 0: Fetch all existing work items for the projectId via `GET /api/model/projects/{projectId}/work-items` from architecture-model-service (one call, list-once)
- Build a lookup map keyed by `external_system + ":" + external_key` for matching
- Phase 1 (Initiatives): For each INITIATIVE from the Jira result, check if a matching work item exists (by `external_system="JIRA"` + `external_key`); if match found, PUT to update (title, description, external_url); if no match, POST to create with the deterministic ID from jira-service
- Also create/find the synthetic "Imported Roadmap" initiative if orphan EPICs exist
- Phase 2 (Epics): For each EPIC, resolve parentId to its INITIATIVE's ID (either from the Jira parent linkage or the synthetic initiative); check existing, PUT or POST accordingly
- Use the architecture-model-service endpoints: `POST /api/model/projects/{projectId}/work-items` and `PUT /api/model/projects/{projectId}/work-items/{id}`, following the fetch-based client pattern in `architectureModelClient.ts`
- Track counts (createdInitiatives, updatedInitiatives, createdEpics, updatedEpics) and collect warnings

**Idempotency and safety requirements**
- Re-running the same JQL must update existing items (matched by external_system + external_key), never creating duplicates
- Parent linkage must be updated if a parent changes between imports
- Non-Jira work items (those without external_system="JIRA") must never be deleted, modified, or affected
- The synthetic "Imported Roadmap" initiative must be stable across re-imports (same deterministic ID)
- Items not present in the current JQL result are left untouched (no archive/delete semantics)

**Gateway config for Jira browse URL**
- The gateway needs to construct browse URLs like `https://<jira-host>/browse/PROJ-123`
- Add a `jiraBrowseBaseUrl` config entry (env var `JIRA_BROWSE_BASE_URL`) to `gateway/src/config.ts`, defaulting to `https://jira.example.com` or derived from `jiraServiceBaseUrl`
- This is distinct from `jiraServiceBaseUrl` which points to the jira-service Spring Boot app, not the actual Jira instance

## Existing Code to Leverage

**`architecture-model-service/.../service/RoadmapImportService.java`**
- Demonstrates the proven upsert pattern: load existing items, check by computed ID, update or insert
- Uses deterministic IDs for idempotent re-import
- Tracks detailed insert/update counts via mutable counters
- Processes initiatives first, then epics (two-phase ordering)
- Follow this same two-phase upsert strategy in the gateway orchestration

**`gateway/src/routes/jiraIssues.ts` and jira-service proxy pattern**
- Shows how to call jira-service from the gateway using axios with query params
- Includes error handling pattern: forward upstream HTTP errors, handle network errors as 503
- Reuse the `getJiraServiceUrl()` helper and `handleProxyError()` pattern for the import route

**`gateway/src/services/architectureModelClient.ts`**
- Shows how to call architecture-model-service from the gateway using native `fetch`
- Provides the URL construction pattern: `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/...`
- Follow this pattern for GET (list work items), POST (create), and PUT (update) calls

**`jira-service/.../util/DeterministicIdGenerator.java` and `JiraIssueMappingService.java`**
- DeterministicIdGenerator uses `UUID.nameUUIDFromBytes(UTF-8 bytes of "toolProjectId:externalKey")` (UUIDv3)
- The gateway must replicate this same algorithm in TypeScript for the synthetic "Imported Roadmap" initiative ID (using `projectId + ":IMPORTED_ROADMAP"`)
- JiraIssueMappingService already populates `external_system="JIRA"`, `external_key=issue.key()`, deterministic `id`, and `parent_id` on each returned WorkItemDto

**`architecture-model-service/.../controller/WorkItemController.java` and `WorkItemService.java`**
- WorkItemController exposes: GET (list with optional type/parentId filter), POST (create), PUT (update), DELETE
- WorkItemService validates parent hierarchy: INITIATIVE requires null parent, EPIC requires INITIATIVE parent -- this is why two-phase ordering is mandatory
- The PUT endpoint uses patch semantics (null type/parentId preserve existing values)

## Out of Scope
- Importing Features or Stories (only INITIATIVE and EPIC types are processed)
- Delivery team assignment on imported work items
- Due dates, scheduling fields, or target_window population
- Sync back to Jira (write operations to Jira)
- Deleting or replacing existing non-Jira work items (import is additive-only)
- Complex Jira hierarchy edge cases beyond single-level parent linkage
- Any jira-service code changes (rely entirely on existing GET /jira/issues endpoint and TypeMappingService)
- Frontend UI changes for triggering the import (the endpoint is API-only in this increment)
- Adding an `external_id` column (external_key is sufficient)
- Bulk upsert endpoint in architecture-model-service (use individual POST/PUT per item)
- Archive or delete semantics for items missing from JQL results
