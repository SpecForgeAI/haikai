# Specification: Candidate Save-Back to Canonical Model

## Goal
Promote high-confidence discovery candidates from Phase 1d into the canonical architecture meta-model by implementing a new MCP tool that fetches eligible candidates, converts them to entity shapes, merges them into the existing model via GET-merge-PUT, and updates candidate status with provenance tracking.

## User Stories
- As an architect, I want to commit high-confidence discovery candidates into the canonical model so that the discovered architecture is reflected in the persistent meta-model without manual re-entry.
- As a discovery user, I want idempotent save-back so that re-running the commit does not create duplicate entities if candidates were already promoted.

## Specific Requirements

**MCP Tool Route: save_discovery_candidates_to_model**
- Create a new route file `mcp-server/src/routes/saveDiscoveryCandidatesRoute.ts` exporting `saveDiscoveryCandidatesRouter`
- Mount at `/mcp/tools/save_discovery_candidates_to_model` in `mcp-server/src/routes/tools.ts`
- POST body requires `sessionId` (string), `projectId` (UUID), and `runId` (UUID)
- Validate sessionId as non-empty string, validate projectId and runId against UUID v4 regex
- Call `getOrCreateSession(sessionId)` for session management
- Delegate to a new `saveDiscoveryCandidatesToModel` service function
- Return structured result: `{ projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }`
- Error responses: 400 for validation, 502 for upstream failures, following `saveProjectAnchorEntitiesRoute.ts` pattern

**MCP archModelClient: Candidate Fetching Methods**
- Add `getCandidatesByRun(projectId, runId, type?, status?)` to `mcp-server/src/services/archModelClient.ts`
- Calls `GET /api/model/projects/{projectId}/discovery/runs/{runId}/candidates` with optional query params
- Returns `DiscoveryCandidateDto[]` matching the shape from the architecture-model-service REST API
- Add `updateCandidate(projectId, runId, candidateId, update)` calling `PUT .../candidates/{candidateId}`
- Model the return type based on `DiscoveryCandidateDto` from `discovery-service/src/types/candidate.ts`

**Save-Back Service: candidateSaveBackService.ts**
- Create `mcp-server/src/services/candidateSaveBackService.ts` with a single exported async function `saveDiscoveryCandidatesToModel(projectId, runId)`
- Orchestration flow: (1) validate project via `getProjectById`, (2) fetch eligible candidates, (3) GET existing model, (4) topological sort, (5) convert and merge entities, (6) PUT model, (7) update candidate statuses, (8) persist provenance mappings, (9) return result summary
- Fail-fast: if any step fails (candidate fetch, model GET, entity conversion, parent resolution), throw immediately with a descriptive error message before `putModel` is called
- The single `putModel` call at the end provides natural atomicity -- no partial model state on failure

**High-Confidence Eligibility Filtering**
- Fetch all candidates for the run, then filter client-side to candidates with `confidence >= 0.75` (the `CANDIDATE_AUTO_ACCEPT_THRESHOLD` value)
- Exclude candidates with status `rejected`, `merged`, or `committed` (already processed)
- Include candidates with status `proposed` or `accepted` that meet the confidence threshold
- If no eligible candidates are found, return early with zero counts (not an error)

**CandidateType-to-Entity Mapping and Conversion**
- Map each `candidateType` to its target model array and `generateId` prefix: `application` -> `applications[]` / `app-`, `app_component` -> `app_components[]` / `comp-`, `service` -> `services[]` / `svc-`, `interface` -> `interfaces[]` / `ifc-`, `logical_entity` -> `logical_data_entities[]` / `lde-`, `physical_entity` -> `physical_data_entities[]` / `pde-`, `data_entity` -> `physical_data_entities[]` / `pde-`, `business_process` -> `business_processes[]` / `bp-`
- Derive `model_file_id` from `project.name` (same as `anchorEntitiesService`)
- Populate `name` from `candidate.name`, `description` from `candidate.data.description` or empty string
- Populate type-specific fields from candidate `data` payload when available: `service_type`, `core_tech` for services; `physical_type`, `database_name` for physical data entities; `tech_type` for app_components; `interface_type` for interfaces
- All nullable fields not provided default to `null` or empty string following the `anchorEntitiesService` patterns

**Topological Parent Resolution via parentCandidateId**
- Build a depth map from the candidate forest: candidates with no `parentCandidateId` are depth 0, children of depth-0 are depth 1, etc.
- Process candidates in ascending depth order so parents are always created/matched before children
- Maintain a `candidateIdToEntityId` map (`Record<string, string>`) tracking which candidate ID resolved to which entity ID (whether newly created or matched to existing)
- For child candidates, resolve the parent FK field (`application_id`, `service_id`, etc.) by looking up `parentCandidateId` in the `candidateIdToEntityId` map
- If a parent candidate was skipped (already existed), the map still holds its entity ID from the skip/reuse step
- If a child's parent candidate is not in the eligible set and not in the map, fail-fast with a descriptive error

**Skip/Reuse Idempotent Matching**
- Before creating an entity, check the target model array for an existing entity with the same `name` (case-sensitive, matching `anchorEntitiesService` pattern)
- If found, skip creation and record the existing entity's `id` in the `candidateIdToEntityId` map for downstream parent resolution
- Track skip vs. create counts separately in the result summary (`entitiesCreated` vs. `entitiesSkipped`)
- No update-existing behavior in this increment

**Dual Status Update (committed + entity reference)**
- Add `committed` to the `CandidateStatus` union in `discovery-service/src/types/candidate.ts`
- After successful `putModel`, iterate over each promoted candidate and call `updateCandidate` setting `status: 'committed'` and `data: { ...existingData, committedEntityId: '<resolved-entity-id>', committedEntityType: '<entity-array-key>' }`
- Status update failures after a successful `putModel` should be logged as warnings but not fail the overall operation (the model is already saved)

**Dedicated Provenance Mapping Table**
- Add a new Liquibase migration SQL file (next sequence number after `072-candidate-parent-candidate-id.sql`) creating `discovery_candidate_entity_mapping` table
- Columns: `id` (UUID PK), `candidate_id` (UUID FK to `discovery_candidate.id`), `run_id` (UUID, not null), `entity_type` (TEXT, not null -- the model array key like `applications`, `services`), `entity_id` (TEXT, not null -- the generated/matched entity ID string), `action` (TEXT -- `created` or `reused`), `created_at` (TIMESTAMPTZ default now)
- Add JPA entity `DiscoveryCandidateEntityMappingEntity`, DTO record, repository, service, and controller in the architecture-model-service following the existing discovery JPA stack pattern
- Controller base path: `/api/model/projects/{projectId}/discovery/runs/{runId}/candidate-entity-mappings`
- Expose POST (bulk insert) and GET (list by runId) endpoints
- The MCP save-back service calls POST to persist all mappings after successful `putModel`

**Gateway Proxy Route**
- This feature is invoked as an MCP tool call, not a direct gateway-to-discovery-service proxy
- No new gateway route is required because the MCP tool endpoint at `/mcp/tools/save_discovery_candidates_to_model` is already accessible through the existing MCP tool routing infrastructure
- The frontend or orchestration layer triggers the save via the standard MCP tool invocation path

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`mcp-server/src/services/anchorEntitiesService.ts` -- Primary GET-merge-PUT Template**
- Provides the exact orchestration pattern: `getProjectById` -> `getModel` -> `createEmptyModelShell` fallback -> name-based dedup loop -> `putModel`
- Entity creation shape with `generateId(prefix)`, default null/empty fields, and parent FK resolution by name
- This is the primary template; the save-back service follows the same flow but with multiple entity types and candidate-sourced data

**`mcp-server/src/services/architectureBaselineService.ts` -- Multi-Entity IdMaps Pattern**
- Demonstrates `IdMaps` pattern for tracking generated IDs across entity types during a single save operation
- Shows how to resolve cross-entity references (e.g., service -> application, interface -> service) using name-to-ID maps
- The `candidateIdToEntityId` map in save-back serves the same purpose but keyed by candidate ID rather than entity name

**`mcp-server/src/routes/saveProjectAnchorEntitiesRoute.ts` -- MCP Tool Route Skeleton**
- Exact route pattern to replicate: session validation, UUID v4 regex, service delegation, structured 400/502 error handling
- Import and mount pattern in `tools.ts` with `toolsRouter.use('/save_discovery_candidates_to_model', ...)`

**`discovery-service/src/services/archModelClient.ts` -- Candidate API Reference**
- Contains `getCandidatesByRun(projectId, runId, type?, status?)` and `updateCandidate(projectId, runId, candidateId, update)` method signatures to replicate in the MCP server's archModelClient
- Shows the REST URL patterns and query parameter conventions for the candidate endpoints

**Architecture-Model-Service Discovery JPA Stack Pattern**
- `DiscoveryCandidateEntity.java`, `DiscoveryCandidateDto.java`, `DiscoveryCandidateService.java`, `DiscoveryCandidateController.java`, `DiscoveryCandidateRepository.java` form the template for the new provenance mapping JPA stack
- Liquibase SQL migration files in `db/changelog/sql/` with sequential numbering, registered in `db.changelog-master.yaml`

## Out of Scope
- Human review UI for accepting/rejecting candidates before save-back
- Undo/rollback of committed entities from the canonical model
- Sophisticated incremental re-save behavior (detecting changes since last commit)
- Inter-candidate relationship creation (e.g., data_movements between services)
- Diagram node creation for committed entities
- Per-entity-type creation REST endpoints (using GET-merge-PUT instead)
- Update-existing mode for idempotent matching (skip/reuse only in this increment)
- Logical data entity creation from `data_entity` candidates (physical side only)
- Discovery-service direct orchestration of save-back (MCP-controlled path only)
- Endpoint entity creation from candidates (no endpoint candidate type exists yet)
