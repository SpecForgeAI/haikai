# Task Breakdown: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)

## Overview
Total Tasks: 4 Task Groups, ~30 sub-tasks

This spec spans three systems:
1. **architecture-model-service** (Java/Spring Boot) -- Migration 046, Entity/DTO/Mapper extension
2. **gateway** (TypeScript/Node.js) -- Jira import service + route handler + config
3. **Tests** across both systems

## Task List

### Architecture-Model-Service Layer

#### Task Group 1: Migration 046 + WorkItemEntity/DTO/Mapper Extension for `externalUrl`
**Dependencies:** None

- [x] 1.0 Complete architecture-model-service database and entity changes
  - [x] 1.1 Write 4 focused tests for the migration and entity/DTO/mapper changes
    - **Test file:** `architecture-model-service/src/test/java/com/example/architecturemodel/migration/WorkItemExternalUrlMigrationTest.java`
    - **Test 1:** Verify `WorkItemEntity` has `externalUrl` field mapped to `@Column(name = "external_url")` via reflection (follow pattern in `DeliveryTeamMigrationTest.workItemEntityHasDeliveryTeamIdField()` -- the work_item table uses JSONB which H2 cannot create, so verify at the entity/reflection level)
    - **Test 2:** Verify `WorkItemEntity.builder()` accepts `externalUrl`, and getter returns the set value; also verify null is accepted
    - **Test 3:** Verify `WorkItemMapper.toDto()` maps the `externalUrl` field from entity to DTO (construct an entity with `externalUrl` set, call `toDto()`, assert `dto.externalUrl()` matches)
    - **Test 4:** Verify `WorkItemMapper.updateEntityFromDto()` sets `externalUrl` on an existing entity from a DTO that has the field set
  - [x] 1.2 Create Liquibase migration SQL file `046-work-item-external-url.sql`
    - **File:** `architecture-model-service/src/main/resources/db/changelog/sql/046-work-item-external-url.sql`
    - Statement 1: `ALTER TABLE work_item ADD COLUMN external_url TEXT NULL;`
    - Statement 2: `CREATE UNIQUE INDEX idx_work_item_external_ref ON work_item(project_id, external_system, external_key) WHERE external_key IS NOT NULL;`
    - Do NOT add an `external_id` column
    - Do NOT modify `external_system` or `external_key` (exist since migration 012)
  - [x] 1.3 Add changeset entry in `db.changelog-master.yaml`
    - **File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Changeset id: `046-work-item-external-url`
    - Author: `architecture-tool` (matches existing pattern)
    - Precondition: `onFail: MARK_RAN`, `not: columnExists: tableName: work_item, columnName: external_url`
    - sqlFile path: `db/changelog/sql/046-work-item-external-url.sql` with `relativeToChangelogFile: false`, `splitStatements: true`, `stripComments: true`
    - Append after the existing `045-work-item-delivery-team-id` changeset
  - [x] 1.4 Extend `WorkItemEntity` with `externalUrl` field
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemEntity.java`
    - Add field: `@Column(name = "external_url") private String externalUrl;`
    - Place it after the `externalKey` field (line ~73) for logical grouping with other external fields
    - Lombok `@Getter/@Setter/@Builder` annotations on the class will auto-generate accessors
  - [x] 1.5 Extend `WorkItemDto` Java record with `externalUrl` field
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/WorkItemDto.java`
    - Add record component: `@JsonProperty("external_url") String externalUrl`
    - Place it after the `externalKey` component (line ~53) for logical grouping
    - Note: this changes the record constructor signature -- all call sites of `new WorkItemDto(...)` must be updated to include the new parameter
  - [x] 1.6 Update `WorkItemMapper` for the new field
    - **File:** `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/WorkItemMapper.java`
    - `toDto()`: Add `entity.getExternalUrl()` as the new parameter in the `WorkItemDto` constructor call (after `entity.getExternalKey()`, before `entity.getCreatedAt()`)
    - `toEntity()`: Add `.externalUrl(dto.externalUrl())` to the builder chain (after `.externalKey(dto.externalKey())`)
    - `updateEntityFromDto()`: Add `entity.setExternalUrl(dto.externalUrl());` (after the `setExternalKey` line)
  - [x] 1.7 Fix any other compilation sites broken by the WorkItemDto record change
    - The `WorkItemDto` record is used in several places; search for `new WorkItemDto(` across the codebase
    - Key files likely affected: `RoadmapImportService.java`, any test data builders, any controller tests that construct `WorkItemDto` instances directly
    - Add the `externalUrl` parameter (pass `null` where not applicable)
  - [x] 1.8 Ensure architecture-model-service tests pass
    - Run ONLY the 4 tests written in 1.1: `mvn test -pl architecture-model-service -Dtest=WorkItemExternalUrlMigrationTest`
    - Verify the migration SQL file is syntactically valid
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Migration SQL is syntactically correct and idempotent (precondition guards re-run)
- `WorkItemEntity` has `externalUrl` field with correct `@Column` mapping
- `WorkItemDto` includes `external_url` in JSON serialization
- `WorkItemMapper` round-trips the field in `toDto()`, `toEntity()`, and `updateEntityFromDto()`
- All existing compilation sites of `WorkItemDto` are updated to compile cleanly

---

### Gateway -- Import Service Module

#### Task Group 2: Jira Import Service (`jiraImportService.ts`)
**Dependencies:** Task Group 1 (architecture-model-service must accept `external_url` on work items)

- [x] 2.0 Complete the gateway Jira import service module
  - [x] 2.1 Write 8 focused tests for the import service orchestration logic
    - **Test file:** `gateway/src/services/__tests__/jiraImportService.test.ts`
    - Use Jest with mocked `axios` (for jira-service calls) and mocked `fetch` (for architecture-model-service calls)
    - **Test 1:** `filterToInitiativesAndEpics` -- given mixed types (INITIATIVE, EPIC, FEATURE, STORY), returns only INITIATIVEs and EPICs and emits warnings for filtered-out items
    - **Test 2:** `resolveOrphanEpics` -- given EPICs whose `parent_id` does not match any INITIATIVE in the set, marks them as orphans
    - **Test 3:** `generateDeterministicId` -- given `projectId + ":IMPORTED_ROADMAP"`, produces the same UUIDv3 as Java's `UUID.nameUUIDFromBytes()` with UTF-8 encoding
    - **Test 4:** `constructExternalUrl` -- given `jiraBrowseBaseUrl = "https://jira.example.com"` and `external_key = "PROJ-123"`, returns `"https://jira.example.com/browse/PROJ-123"`
    - **Test 5:** Full orchestration (happy path) -- calls jira-service, filters, upserts INITIATIVEs then EPICs via architecture-model-service, returns correct counts `{ createdInitiatives: N, updatedInitiatives: N, createdEpics: N, updatedEpics: N, warnings: [] }`
    - **Test 6:** Idempotent re-import -- when existing work items match by `external_system + external_key`, uses PUT (update) instead of POST (create), counts as updated
    - **Test 7:** Orphan EPIC grouping -- when an EPIC has no matching parent INITIATIVE in the import set, creates/finds the synthetic "Imported Roadmap" initiative (with `external_system=null`, `external_key=null`) and assigns orphans to it
    - **Test 8:** Synthetic initiative stability -- re-running import with orphans reuses the same deterministic ID for the "Imported Roadmap" initiative (no duplicate creation)
  - [x] 2.2 Create the `jiraImportService.ts` file with type definitions
    - **File:** `gateway/src/services/jiraImportService.ts`
    - Define `JiraImportRequest` interface: `{ projectId: string, jql: string, jiraProjectKey: string, maxResults?: number }`
    - Define `JiraImportResult` interface: `{ createdInitiatives: number, updatedInitinumber, createdEpics: number, updatedEpics: number, warnings: string[] }`
    - Define `WorkItemDto` interface (gateway-side, matching architecture-model-service JSON contract): `{ id: string, project_id: string, type: string, parent_id: string | null, title: string, description: string | null, status: string, sort_order: number, priority: number | null, target_window: string | null, tags: Record<string, unknown> | null, external_system: string | null, external_key: string | null, external_url: string | null, created_at: string | null, updated_at: string | null }`
  - [x] 2.3 Implement `fetchJiraIssues()` helper
    - Use axios to call `GET ${getJiraServiceUrl()}/jira/issues` with query params: `jql`, `jiraProjectKey`, `toolProjectId` (= projectId), `maxResults`, `expandChildren=false`
    - Follow the pattern from `gateway/src/routes/jiraIssues.ts` (axios with timeout, error handling)
    - Return the raw array of `WorkItemDto` from jira-service
    - Re-export or import `getJiraServiceUrl()` from the jiraIssues route, or extract to a shared utility
  - [x] 2.4 Implement `filterToInitiativesAndEpics()` helper
    - Input: array of `WorkItemDto`
    - Output: `{ initiatives: WorkItemDto[], epics: WorkItemDto[], warnings: string[] }`
    - For each item, check `item.type`: keep `INITIATIVE` and `EPIC`, emit a warning string for any other type (e.g., `"Skipped item ${external_key} with type ${type} (only INITIATIVE and EPIC are imported)"`)
  - [x] 2.5 Implement `generateDeterministicId()` helper (UUIDv3)
    - Replicate Java's `UUID.nameUUIDFromBytes(input.getBytes(StandardCharsets.UTF_8))` algorithm in TypeScript
    - This is UUIDv3 (MD5-based): compute MD5 hash of the UTF-8 input bytes, set version bits (0x30 on byte 6) and variant bits (0x80 on byte 8), format as UUID string
    - Use Node.js `crypto.createHash('md5')` -- no external dependency needed
    - Test against known Java output for `"someProjectId:IMPORTED_ROADMAP"` to verify cross-language compatibility
  - [x] 2.6 Implement `constructExternalUrl()` helper
    - Input: `jiraBrowseBaseUrl: string`, `externalKey: string`
    - Output: `${jiraBrowseBaseUrl}/browse/${externalKey}`
    - Strip trailing slash from base URL if present
  - [x] 2.7 Implement orphan detection and synthetic initiative creation
    - `resolveOrphanEpics()`: for each EPIC, check if its `parent_id` matches the `id` of any INITIATIVE in the filtered set; collect orphans
    - `buildSyntheticInitiative()`: construct a `WorkItemDto` for the "Imported Roadmap" initiative with:
      - `id`: `generateDeterministicId(projectId + ":IMPORTED_ROADMAP")`
      - `type`: `"INITIATIVE"`
      - `title`: `"Imported Roadmap"`
      - `external_system`: `null`
      - `external_key`: `null`
      - `external_url`: `null`
      - `status`: `"PLANNED"`
      - `project_id`: projectId
  - [x] 2.8 Implement two-phase upsert orchestration
    - **Phase 0 -- List existing:** Call `GET ${architectureModelServiceBaseUrl}/api/model/projects/${projectId}/work-items` via native fetch (follow `architectureModelClient.ts` pattern). Build lookup map: `Map<string, WorkItemDto>` keyed by `"${external_system}:${external_key}"` for items where `external_key` is non-null
    - **Phase 1 -- Upsert INITIATIVEs:** For each INITIATIVE from filtered Jira results:
      - Enrich with `external_url` via `constructExternalUrl()`
      - Look up by `"JIRA:${external_key}"` in existing map
      - If found: `PUT /api/model/projects/${projectId}/work-items/${id}` (update title, description, external_url) -- increment `updatedInitiatives`
      - If not found: `POST /api/model/projects/${projectId}/work-items` with the deterministic ID from jira-service -- increment `createdInitiatives`
    - Also create/find the synthetic "Imported Roadmap" initiative if orphan EPICs exist (check existing map first)
    - **Phase 2 -- Upsert EPICs:** For each EPIC:
      - Resolve `parent_id`: if its original `parent_id` matches an INITIATIVE in the set, use that ID; if orphan, use the synthetic initiative's ID
      - Enrich with `external_url`
      - Look up by `"JIRA:${external_key}"` in existing map
      - If found: PUT to update -- increment `updatedEpics`
      - If not found: POST to create -- increment `createdEpics`
    - Use native `fetch` for all architecture-model-service calls (not axios), following `architectureModelClient.ts` patterns
    - Collect all warnings from filtering + any HTTP errors into the warnings array
  - [x] 2.9 Implement the main `importJiraRoadmap()` export function
    - Signature: `async function importJiraRoadmap(request: JiraImportRequest): Promise<JiraImportResult>`
    - Orchestrate: `fetchJiraIssues()` -> `filterToInitiativesAndEpics()` -> `resolveOrphanEpics()` -> two-phase upsert
    - Add structured logging via `logger` at each phase (follow existing service logging patterns)
    - Return the `JiraImportResult` with counts and warnings
  - [x] 2.10 Ensure import service tests pass
    - Run ONLY the 8 tests written in 2.1: `npx jest --testPathPattern=jiraImportService.test.ts`
    - Verify all mocks are correctly set up for axios (jira-service) and fetch (architecture-model-service)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 2.1 pass
- `fetchJiraIssues()` calls jira-service with correct query params and `expandChildren=false`
- `filterToInitiativesAndEpics()` correctly separates types and emits warnings
- `generateDeterministicId()` produces cross-language-compatible UUIDv3 output
- `constructExternalUrl()` builds correct Jira browse URLs
- Orphan EPICs are detected and grouped under the synthetic initiative
- Two-phase upsert creates/updates in the correct order (INITIATIVEs first, EPICs second)
- Idempotent re-import updates existing items by matching on `external_system + external_key`
- The synthetic "Imported Roadmap" initiative uses a stable deterministic ID

---

### Gateway -- Route Handler + Config

#### Task Group 3: Import Route Handler (`POST /api/roadmap/jira/import`) + Config
**Dependencies:** Task Group 2 (import service module must exist)

- [x] 3.0 Complete the gateway route handler and config wiring
  - [x] 3.1 Write 6 focused tests for the route handler
    - **Test file:** `gateway/src/routes/__tests__/jiraImport.test.ts`
    - Use Jest with supertest (or mock Express req/res) and mock `importJiraRoadmap` from the service
    - **Test 1:** Valid request returns 200 with correct `JiraImportResult` shape (`createdInitiatives`, `updatedInitiatives`, `createdEpics`, `updatedEpics`, `warnings`)
    - **Test 2:** Missing `projectId` returns 400 with descriptive error message
    - **Test 3:** Missing `jql` (empty string) returns 400 with descriptive error message
    - **Test 4:** Missing `jiraProjectKey` returns 400 with descriptive error message
    - **Test 5:** jira-service upstream error (e.g., axios 502) is forwarded as 502/503 with upstream error details
    - **Test 6:** `maxResults` defaults to 200 when not provided in request body
  - [x] 3.2 Add `jiraBrowseBaseUrl` to gateway config
    - **File:** `gateway/src/config.ts`
    - Add `jiraBrowseBaseUrl: string` to the `Config` interface (after `jiraServiceBaseUrl` on line ~43)
    - Add to `loadConfig()`: `jiraBrowseBaseUrl: process.env.JIRA_BROWSE_BASE_URL || 'https://jira.example.com'`
    - Add a comment: `// Jira Browse Base URL for constructing external_url links (distinct from jiraServiceBaseUrl which points to the jira-service app)`
    - Note: `jiraServiceBaseUrl` points to the jira-service Spring Boot app; `jiraBrowseBaseUrl` points to the actual Jira instance for browse links
  - [x] 3.3 Create the route handler file
    - **File:** `gateway/src/routes/jiraImport.ts`
    - Create `jiraImportRouter = Router()`
    - Implement `POST /import` handler:
      - Extract `{ projectId, jql, jiraProjectKey, maxResults }` from `req.body`
      - Validate: `projectId` required and must be non-empty string; `jql` required and must be non-empty string; `jiraProjectKey` required and must be non-empty string; `maxResults` optional, default to 200 if absent
      - Return 400 for validation failures with `{ message: "...", field: "..." }` shape
      - Call `importJiraRoadmap({ projectId, jql, jiraProjectKey, maxResults })` from `jiraImportService.ts`
      - On success: return 200 with the `JiraImportResult` JSON body
      - On jira-service errors (axios errors): forward as 502 (if upstream returned error) or 503 (if network error), following `handleProxyError()` pattern from `jiraIssues.ts`
      - On architecture-model-service errors: forward with appropriate status code
      - Add structured logging with `requestId` pattern
  - [x] 3.4 Register the route in the gateway routes index
    - **File:** `gateway/src/routes/index.ts`
    - Add export: `export { jiraImportRouter } from './jiraImport';`
    - Add comment: `// Jira Import route (Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton)`
  - [x] 3.5 Wire the route in the Express app
    - **File:** Locate the main Express app file (likely `gateway/src/index.ts` or `gateway/src/app.ts`) where other routers are mounted
    - Mount: `app.use('/api/roadmap/jira', jiraImportRouter)` so that the POST handler at `/import` resolves to `POST /api/roadmap/jira/import`
    - Ensure the route is registered after body-parser/json middleware
  - [x] 3.6 Ensure route handler tests pass
    - Run ONLY the 6 tests written in 3.1: `npx jest --testPathPattern=jiraImport.test.ts`
    - Verify 400 responses for invalid input
    - Verify 200 response with correct shape for valid input
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- `POST /api/roadmap/jira/import` accepts valid requests and returns `JiraImportResult`
- 400 returned for missing/invalid `projectId`, `jql`, or `jiraProjectKey`
- `maxResults` defaults to 200 when omitted
- jira-service errors forwarded as 502/503
- `jiraBrowseBaseUrl` config entry reads from `JIRA_BROWSE_BASE_URL` env var with sensible default
- Route is registered in Express app and accessible

---

### Integration Tests & Gap Analysis

#### Task Group 4: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written in TG1 (`WorkItemExternalUrlMigrationTest.java`)
    - Review the 8 tests written in TG2 (`jiraImportService.test.ts`)
    - Review the 6 tests written in TG3 (`jiraImport.test.ts`)
    - Total existing tests: 18 tests across 3 files
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Check: Is the `WorkItemMapper.toEntity()` -> `externalUrl` mapping tested? (TG1 tests cover `toDto` and `updateEntityFromDto`, but `toEntity` may need a test)
    - Check: Is the two-phase ordering enforced? (INITIATIVEs must be upserted before EPICs to satisfy parent hierarchy validation in WorkItemService)
    - Check: Are warning messages generated when non-INITIATIVE/EPIC types are filtered out?
    - Check: Is the `jiraBrowseBaseUrl` config value correctly passed through to `constructExternalUrl()`?
    - Check: Is the parent_id update scenario tested (parent changes between imports)?
    - Check: Does the existing work-item lookup map correctly handle items with null external_key (they should not be in the map)?
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 10 additional strategic tests to fill identified gaps
    - **Architecture-model-service gap tests** (add to `WorkItemExternalUrlMigrationTest.java` or new file):
      - Test: `WorkItemMapper.toEntity()` correctly maps `externalUrl` from DTO to entity
      - Test: `WorkItemDto` record serializes `external_url` in JSON output (via Jackson ObjectMapper round-trip)
    - **Gateway import service gap tests** (add to `jiraImportService.test.ts` or new file `gateway/src/services/__tests__/jiraImportService.gap.test.ts`):
      - Test: Two-phase ordering -- verify INITIATIVEs are persisted before EPICs (mock fetch to track call order)
      - Test: Parent_id update -- when an EPIC's parent changes between imports, the PUT call includes the new parent_id
      - Test: Existing work items with null `external_key` are excluded from the lookup map (no false matches)
      - Test: `jiraBrowseBaseUrl` trailing slash is stripped correctly before URL construction
      - Test: When jira-service returns an empty array, the function returns all counts as 0 with no errors
    - **Gateway route handler gap tests** (add to `jiraImport.test.ts` or new file):
      - Test: architecture-model-service returning 500 during upsert propagates as an error with appropriate status
      - Test: Verify `maxResults` is passed through as a number (not string) to `importJiraRoadmap`
      - Test: Concurrent re-import does not create duplicate synthetic initiatives (deterministic ID)
    - Do NOT exceed 10 additional tests total across all systems
  - [x] 4.4 Run feature-specific tests only
    - **Architecture-model-service:** `mvn test -pl architecture-model-service -Dtest=WorkItemExternalUrlMigrationTest`
    - **Gateway import service:** `npx jest --testPathPattern=jiraImportService`
    - **Gateway route handler:** `npx jest --testPathPattern=jiraImport.test`
    - Expected total: approximately 18-28 tests across all files
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass end-to-end

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-28 tests total)
- Critical user workflows covered: import new items, re-import for idempotent update, orphan EPIC grouping, type filtering with warnings, external_url construction
- No more than 10 additional tests added in gap analysis
- Testing focused exclusively on this spec's feature requirements
- Two-phase upsert ordering verified (INITIATIVEs before EPICs)
- Deterministic ID cross-language compatibility verified

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Architecture-Model-Service -- Migration + Entity Extension** (no dependencies)
   - Must be completed first because the gateway import service needs architecture-model-service to accept the `external_url` field on work item POST/PUT requests
   - Estimated: Migration SQL + entity/DTO/mapper changes + 4 tests

2. **Task Group 2: Gateway -- Jira Import Service Module** (depends on TG1)
   - Core orchestration logic; the largest task group
   - Estimated: New `jiraImportService.ts` with 7 helper functions + main orchestrator + 8 tests

3. **Task Group 3: Gateway -- Import Route Handler + Config** (depends on TG2)
   - Thin HTTP layer that validates input and delegates to the import service
   - Estimated: Route file + config change + Express wiring + 6 tests

4. **Task Group 4: Integration Tests & Gap Analysis** (depends on TG1-3)
   - Review all tests, identify and fill gaps, run final verification
   - Estimated: Up to 10 additional tests + full feature test run

## Key Implementation Notes

### Cross-Language UUIDv3 Compatibility
The `generateDeterministicId()` function in TypeScript must produce identical UUIDs to Java's `UUID.nameUUIDFromBytes()`. Both use MD5 with version 3 bits set. Test with a known input/output pair from the Java side to verify.

### Two-Phase Upsert is Mandatory
The architecture-model-service `WorkItemService` enforces that EPIC work items must have an INITIATIVE parent. Creating an EPIC before its parent INITIATIVE will fail with a validation error. The gateway MUST create all INITIATIVEs (Phase 1) before any EPICs (Phase 2).

### Dual HTTP Client Pattern
The gateway uses **axios** for jira-service calls and **native fetch** for architecture-model-service calls. This is an existing pattern -- do not unify them in this increment.

### Synthetic Initiative is Not a Jira Item
The "Imported Roadmap" synthetic initiative has `external_system=null` and `external_key=null`. It will NOT match any Jira lookup key in the existing-items map. Its presence/absence must be checked by its deterministic ID directly.

### No jira-service Changes
This increment relies entirely on the existing `GET /jira/issues` endpoint. The jira-service TypeMappingService must already have appropriate type-mapping configuration for the target Jira project.

### No Frontend Changes
This increment is API-only. The `POST /api/roadmap/jira/import` endpoint will be consumed by a future UI increment.
