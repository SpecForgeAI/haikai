# Task Breakdown: MCP Tool - save_roadmap_structure

## Overview
Total Tasks: 4 Task Groups, 30 sub-tasks

This spec adds a new MCP tool (`save_roadmap_structure`) that persists a high-level roadmap structure (Initiatives and Epics) as canonical work_items in the architecture-model-service. The work spans two systems: **mcp-server** (route, service, client extension) and **gateway** (tool registration only).

## Task List

### MCP-Server Layer

#### Task Group 1: archModelClient Extension -- Work-Item HTTP Methods
**Dependencies:** None

- [x] 1.0 Complete archModelClient work-item methods and WorkItemDto type
  - [x] 1.1 Write 4-6 focused tests for archModelClient work-item methods
    - **File:** `mcp-server/src/__tests__/archModelClient.workItems.test.ts`
    - Test `listWorkItems` returns an array of WorkItemDto from GET endpoint
    - Test `listWorkItems` propagates AxiosError on non-200 responses
    - Test `createWorkItem` sends POST with correct body and returns created WorkItemDto
    - Test `updateWorkItem` sends PUT with correct path param and body, returns updated WorkItemDto
    - Test that `encodeURIComponent` is applied to path params (projectId, workItemId)
    - Mock axios instance following the pattern in existing archModelClient tests (e.g., `mcp-server/src/__tests__/archModelClient.saveBaseline.test.ts`)
  - [x] 1.2 Define WorkItemDto interface
    - **File:** `mcp-server/src/types/saveRoadmapStructure.ts` (new file, following pattern of `mcp-server/src/types/saveArchitectureBaseline.ts`)
    - Fields: `id: string`, `project_id: string`, `type: string`, `parent_id: string | null`, `title: string`, `description: string | null`, `status: string | null`, `sort_order: number | null`, `priority: string | null`, `target_window: string | null`, `tags: string | null`, `external_system: string | null`, `external_key: string | null`, `external_url: string | null`, `created_at: string | null`, `updated_at: string | null`
    - All fields nullable except `id`, `project_id`, `type`, `title`
  - [x] 1.3 Add `listWorkItems` method to ArchModelClient class
    - **File:** `mcp-server/src/services/archModelClient.ts`
    - Signature: `async listWorkItems(projectId: string): Promise<WorkItemDto[]>`
    - Calls `GET /api/model/projects/{projectId}/work-items`
    - Use `encodeURIComponent(projectId)` in the URL path
    - Return `response.data`
    - Import `WorkItemDto` from `../types/saveRoadmapStructure`
  - [x] 1.4 Add `createWorkItem` method to ArchModelClient class
    - **File:** `mcp-server/src/services/archModelClient.ts`
    - Signature: `async createWorkItem(projectId: string, dto: Partial<WorkItemDto>): Promise<WorkItemDto>`
    - Calls `POST /api/model/projects/{projectId}/work-items`
    - Use `encodeURIComponent(projectId)` in the URL path
    - Send `dto` as JSON request body
    - Return `response.data`
  - [x] 1.5 Add `updateWorkItem` method to ArchModelClient class
    - **File:** `mcp-server/src/services/archModelClient.ts`
    - Signature: `async updateWorkItem(projectId: string, workItemId: string, dto: Partial<WorkItemDto>): Promise<WorkItemDto>`
    - Calls `PUT /api/model/projects/{projectId}/work-items/{workItemId}`
    - Use `encodeURIComponent` on both `projectId` and `workItemId` in the URL path
    - Send `dto` as JSON request body
    - Return `response.data`
  - [x] 1.6 Ensure archModelClient tests pass
    - Run ONLY the tests written in 1.1
    - Verify all three new methods are correctly calling the expected HTTP endpoints
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- WorkItemDto interface is defined with all fields matching the Java DTO
- `listWorkItems`, `createWorkItem`, `updateWorkItem` methods exist on archModelClient
- Each method uses `encodeURIComponent` on path parameters
- Each method follows the existing axios client pattern (uses `this.client.get/post/put`, returns `response.data`)
- The 4-6 tests written in 1.1 all pass

---

#### Task Group 2: Roadmap Structure Service -- Validation, Matching, and Two-Phase Upsert
**Dependencies:** Task Group 1

- [x] 2.0 Complete roadmapStructureService with parse, validate, match, and upsert logic
  - [x] 2.1 Write 6-8 focused tests for roadmapStructureService
    - **File:** `mcp-server/src/__tests__/roadmapStructureService.test.ts`
    - Test `parseAndValidateRoadmapJson`: invalid JSON throws 400
    - Test `parseAndValidateRoadmapJson`: empty initiatives array throws 400
    - Test `parseAndValidateRoadmapJson`: duplicate initiative titles (case-insensitive) throws 400
    - Test `parseAndValidateRoadmapJson`: duplicate epic titles within same initiative (case-insensitive) throws 400; epics under different initiatives with same title is allowed
    - Test `buildMatchingMaps`: builds externalRef map keyed by `{external_system}::{external_key}` per type, and type-scoped title map keyed by `{type}::{title.toLowerCase()}`
    - Test full `saveRoadmapStructure` orchestrator: create-only scenario (no existing items) creates initiatives with sort_order from position, then epics with parent_id and sort_order; status="PLANNED"
    - Test full `saveRoadmapStructure` orchestrator: update scenario (existing items matched by externalRef) updates title, description, sort_order but does NOT overwrite status
    - Test full `saveRoadmapStructure` orchestrator: title-fallback match adds warning to response
    - Mock `archModelClient.listWorkItems`, `archModelClient.createWorkItem`, `archModelClient.updateWorkItem`
  - [x] 2.2 Define input and response TypeScript interfaces
    - **File:** `mcp-server/src/types/saveRoadmapStructure.ts` (extend file created in 1.2)
    - Add `SaveRoadmapStructureRequest` interface: `{ sessionId: string; projectId: string; roadmapJson: string }`
    - Add `RoadmapInput` interface: `{ initiatives: InitiativeInput[] }`
    - Add `InitiativeInput` interface: `{ title: string; description?: string; externalRef?: ExternalRefInput | null; epics?: EpicInput[] }`
    - Add `EpicInput` interface: `{ title: string; description?: string; externalRef?: ExternalRefInput | null }`
    - Add `ExternalRefInput` interface: `{ system: string; key: string; id?: string }`
    - Add `SaveRoadmapStructureResult` interface: `{ createdInitiatives: number; updatedInitiatives: number; createdEpics: number; updatedEpics: number; warnings: string[] }`
  - [x] 2.3 Export new types from barrel file
    - **File:** `mcp-server/src/types/index.ts`
    - Add `export * from './saveRoadmapStructure';` following the existing pattern (see how `saveArchitectureBaseline` is exported)
  - [x] 2.4 Implement `parseAndValidateRoadmapJson` function
    - **File:** `mcp-server/src/services/roadmapStructureService.ts` (new file)
    - Parse `roadmapJson` string via `JSON.parse`; throw 400 on invalid JSON using `createHttpError`
    - Validate `initiatives` array exists and is non-empty
    - Validate every initiative and every epic has a non-empty `title` (string, trimmed)
    - Validate initiative titles are unique case-insensitive across the input
    - Validate epic titles are unique case-insensitive within each initiative (epics under different initiatives may share titles)
    - Return parsed `RoadmapInput` on success
    - Follow `parseAndValidate` decomposition pattern from `architectureBaselineService.ts`
  - [x] 2.5 Implement `buildMatchingMaps` function
    - **File:** `mcp-server/src/services/roadmapStructureService.ts`
    - Accept `existingWorkItems: WorkItemDto[]`
    - Build externalRef map: `Record<string, WorkItemDto>` keyed by `{external_system}::{external_key}` for items that have both fields set
    - Build type-scoped title map: `Record<string, WorkItemDto>` keyed by `{type}::{title.toLowerCase()}`
    - Return both maps as a `{ externalRefMap, typeTitleMap }` object
    - Export function for testability
  - [x] 2.6 Implement `upsertWorkItem` helper function
    - **File:** `mcp-server/src/services/roadmapStructureService.ts`
    - Accept: `projectId`, input item fields, `type` (INITIATIVE or EPIC), `sortOrder`, `parentId`, matching maps, `warnings` accumulator
    - Match priority: first check externalRef map using `{system}::{key}` if `externalRef` is present on input; then fall back to type-scoped title map using `{type}::{title.toLowerCase()}`
    - On externalRef match where existing title differs from input title: push warning string to `warnings` array (possible rename)
    - On title-fallback match: push warning string to `warnings` array
    - On **create** (no match): call `archModelClient.createWorkItem` with: `type`, `title`, `description` (or null), `status: "PLANNED"`, `sort_order: sortOrder`, `parent_id: parentId`, `external_system` and `external_key` from externalRef if provided, all other fields null
    - On **update** (match found): call `archModelClient.updateWorkItem` with: `title`, `description`, `sort_order: sortOrder`, `parent_id: parentId`, `external_system` and `external_key` from externalRef if provided; do NOT send `status`, `delivery_team_id`, `tags`, or `external_url`
    - `externalRef.id` from input is always ignored (never sent to backend)
    - Return `{ action: 'created' | 'updated', workItem: WorkItemDto }`
  - [x] 2.7 Implement `saveRoadmapStructure` main orchestrator function
    - **File:** `mcp-server/src/services/roadmapStructureService.ts`
    - Signature: `export async function saveRoadmapStructure(projectId: string, roadmapJson: string): Promise<SaveRoadmapStructureResult>`
    - Step 1: Call `parseAndValidateRoadmapJson(roadmapJson)` to get parsed input
    - Step 2: Call `archModelClient.listWorkItems(projectId)` to fetch existing items; wrap in try/catch, throw 502 on communication failure using `createHttpError`
    - Step 3: Call `buildMatchingMaps(existingWorkItems)` to build matching maps
    - Step 4 (Phase 1 -- Initiatives): iterate `input.initiatives` with index; for each, call `upsertWorkItem` with type=INITIATIVE, sortOrder=index, parentId=null; collect resolved initiative IDs into a map (initiative array index -> resolved WorkItemDto.id)
    - Step 5 (Phase 2 -- Epics): iterate `input.initiatives` with index; for each initiative, iterate its `epics` (if any) with epicIndex; call `upsertWorkItem` with type=EPIC, sortOrder=epicIndex, parentId=resolved initiative ID from step 4
    - Step 6: Tally `createdInitiatives`, `updatedInitiatives`, `createdEpics`, `updatedEpics` counters from upsert results
    - Step 7: Return `{ createdInitiatives, updatedInitiatives, createdEpics, updatedEpics, warnings }`
    - Import `createHttpError` from `../middleware/errorHandler`
    - Import `archModelClient` from `./archModelClient`
  - [x] 2.8 Ensure roadmapStructureService tests pass
    - Run ONLY the tests written in 2.1
    - Verify parse/validate, matching, and upsert orchestration all work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `parseAndValidateRoadmapJson` correctly rejects invalid JSON, empty initiatives, missing titles, and duplicate titles
- `buildMatchingMaps` produces correct externalRef and type-scoped title maps from existing work items
- Two-phase upsert processes initiatives before epics, resolving parent_id correctly
- Create sets status="PLANNED"; update never overwrites status
- sort_order is set from array index for both create and update
- Warnings are emitted for externalRef title mismatches and title-fallback matches
- `externalRef.id` is never persisted
- The 6-8 tests written in 2.1 all pass

---

#### Task Group 3: Route Handler + MCP Router Mount + Gateway Registration
**Dependencies:** Task Group 2 (service must exist for route to call it)

- [x] 3.0 Complete route handler, router mount, and gateway tool registration
  - [x] 3.1 Write 4-6 focused tests for route handler and gateway registration
    - **File:** `mcp-server/src/__tests__/saveRoadmapStructureRoute.test.ts`
    - Test POST `/` returns 400 when `sessionId` is missing or empty
    - Test POST `/` returns 400 when `projectId` is not a valid UUID v4
    - Test POST `/` returns 400 when `roadmapJson` is missing or empty
    - Test POST `/` returns 200 with service result JSON on success (mock `saveRoadmapStructure` service)
    - Test POST `/` returns 502 when service throws a 502 error (upstream failure)
    - **File:** `gateway/src/__tests__/toolExecutor.saveRoadmapStructure.test.ts` (optional, 1-2 tests)
    - Test `isToolAllowed('save_roadmap_structure')` returns true
    - Test `validateToolArguments('save_roadmap_structure', { projectId: 'uuid', roadmapJson: '{}' })` returns `{ valid: true }`
  - [x] 3.2 Create saveRoadmapStructureRoute.ts route handler
    - **File:** `mcp-server/src/routes/saveRoadmapStructureRoute.ts` (new file)
    - Copy structure from `mcp-server/src/routes/saveArchitectureBaselineRoute.ts`
    - Define `UUID_V4_REGEX` constant (same regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`)
    - Export `saveRoadmapStructureRouter = Router()`
    - Handle `POST /` with async handler
    - Extract `{ sessionId, projectId, roadmapJson }` from `req.body` cast as `SaveRoadmapStructureRequest`
    - Validate `sessionId`: required, non-empty string; throw `createHttpError(400, ...)` on failure
    - Validate `projectId`: required, must match `UUID_V4_REGEX`; throw `createHttpError(400, ...)` on failure
    - Validate `roadmapJson`: required, non-empty string; throw `createHttpError(400, ...)` on failure
    - Call `getOrCreateSession(sessionId)` for session tracking
    - Call `saveRoadmapStructure(projectId, roadmapJson)` from the service
    - Return `res.json(response)` on success
    - Error handling: 400 for validation errors (check `error.statusCode === 400`), 502 for upstream failures (check `error.statusCode === 502` and return structured JSON error), fall through to `next(error)` for other errors
    - Import: `Router, Request, Response, NextFunction` from express; `getOrCreateSession` from sessionManager; `createHttpError` from errorHandler; `SaveRoadmapStructureRequest` from types; `saveRoadmapStructure` from roadmapStructureService
  - [x] 3.3 Register route in MCP tools router
    - **File:** `mcp-server/src/routes/tools.ts`
    - Add import: `import { saveRoadmapStructureRouter } from './saveRoadmapStructureRoute';`
    - Add mount: `toolsRouter.use('/save_roadmap_structure', saveRoadmapStructureRouter);`
    - Place alongside existing tool route mounts (after `save_architecture_baseline`)
  - [x] 3.4 Add `save_roadmap_structure` to gateway ToolName union and ALLOWED_TOOL_NAMES
    - **File:** `gateway/src/types/tools.ts`
    - Add `| 'save_roadmap_structure'` to the `ToolName` union type
    - Add `'save_roadmap_structure'` to the `ALLOWED_TOOL_NAMES` array
  - [x] 3.5 Add SaveRoadmapStructureParams interface and update ToolParams union
    - **File:** `gateway/src/types/tools.ts`
    - Add interface `SaveRoadmapStructureParams { projectId: string; roadmapJson: string; }`
    - Add `| SaveRoadmapStructureParams` to the `ToolParams` union type
  - [x] 3.6 Add TOOL_DEFINITIONS entry for save_roadmap_structure
    - **File:** `gateway/src/types/tools.ts`
    - Add new entry to `TOOL_DEFINITIONS` array:
      - `type: 'function'`
      - `function.name: 'save_roadmap_structure'`
      - `function.description`: `'Persist a roadmap structure of initiatives and epics as canonical work items. Supports both initial creation and subsequent updates via externalRef-first, title-fallback upsert matching.'`
      - `function.parameters.type: 'object'`
      - `function.parameters.required: ['projectId', 'roadmapJson']`
      - `function.parameters.properties`: `sessionId` (string, auto-injected), `projectId` (string, "Project UUID v4"), `roadmapJson` (string, "JSON string containing { initiatives: [{ title, description?, externalRef?, epics?: [{ title, description?, externalRef? }] }] }")
  - [x] 3.7 Add TOOL_ENDPOINTS and TOOL_REQUIRED_PARAMS entries in toolExecutor
    - **File:** `gateway/src/services/toolExecutor.ts`
    - Add to `TOOL_ENDPOINTS`: `save_roadmap_structure: '/mcp/tools/save_roadmap_structure'`
    - Add to `TOOL_REQUIRED_PARAMS`: `save_roadmap_structure: ['projectId', 'roadmapJson']`
    - Add `SaveRoadmapStructureParams` to the import list from `'../types'`
  - [x] 3.8 Ensure route and gateway registration tests pass
    - Run ONLY the tests written in 3.1
    - Verify route validation, success path, and error handling work correctly
    - Verify gateway tool registration compiles and validation recognizes the new tool
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Route handler validates sessionId, projectId (UUID v4), and roadmapJson (non-empty string)
- Route handler delegates to `saveRoadmapStructure` service and returns JSON result
- Route handler returns 400 for validation errors and 502 for upstream failures
- Route is mounted at `/mcp/tools/save_roadmap_structure` in the tools router
- Gateway recognizes `save_roadmap_structure` as an allowed tool
- Gateway TOOL_DEFINITIONS includes the tool with correct parameter schema
- Gateway TOOL_ENDPOINTS maps to correct MCP path
- Gateway TOOL_REQUIRED_PARAMS lists `['projectId', 'roadmapJson']`
- sessionId is auto-injected by gateway executeTool (not in TOOL_REQUIRED_PARAMS)
- The 4-6 tests written in 3.1 all pass

---

### Testing

#### Task Group 4: Integration Tests & Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 archModelClient tests from Task 1.1
    - Review the 6-8 service tests from Task 2.1
    - Review the 4-6 route + gateway tests from Task 3.1
    - Total existing tests: approximately 14-20 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical workflows that lack coverage
    - Focus ONLY on gaps related to the save_roadmap_structure feature
    - Prioritize end-to-end upsert workflows, edge cases in matching, and error propagation
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - **File:** `mcp-server/src/__tests__/roadmapStructureService.integration.test.ts` (new file for integration-level tests)
    - Potential gap-fill tests (select based on actual gap analysis):
      - End-to-end: full orchestrator with mixed create/update scenario (some initiatives matched by externalRef, some by title fallback, some new)
      - ExternalRef match where existing title differs from input title produces rename warning
      - Epic title uniqueness is scoped within initiative (same epic title under two different initiatives succeeds)
      - Update path: verify `status` field is NOT sent in the updateWorkItem DTO
      - Update path: verify `sort_order` IS overwritten to reflect new position
      - Create path: verify `status` is "PLANNED" and `delivery_team_id` is null
      - `externalRef.id` present in input is ignored (not included in create/update DTO)
      - Service throws 502 when `listWorkItems` fails; route correctly wraps and returns 502
      - Empty epics array on an initiative is handled gracefully (initiative created, zero epics)
      - Large roadmap: 10 initiatives each with 5 epics processes in correct phase order (initiatives before epics)
  - [x] 4.4 Run feature-specific tests only
    - Run ALL test files related to this feature:
      - `mcp-server/src/__tests__/archModelClient.workItems.test.ts`
      - `mcp-server/src/__tests__/roadmapStructureService.test.ts`
      - `mcp-server/src/__tests__/saveRoadmapStructureRoute.test.ts`
      - `mcp-server/src/__tests__/roadmapStructureService.integration.test.ts`
      - `gateway/src/__tests__/toolExecutor.saveRoadmapStructure.test.ts`
    - Expected total: approximately 24-30 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-30 tests total)
- Critical upsert workflows are covered (create-only, update-only, mixed create/update)
- ExternalRef matching, title-fallback matching, and warning generation are tested
- Two-phase ordering (initiatives before epics) is verified
- Status preservation on update is verified
- No more than 10 additional tests added in gap analysis
- Testing focused exclusively on save_roadmap_structure feature requirements

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: archModelClient Extension** -- Must come first; the service layer depends on these HTTP methods
2. **Task Group 2: Roadmap Structure Service** -- Depends on archModelClient methods from TG1; the route depends on this service
3. **Task Group 3: Route Handler + Gateway Registration** -- Route depends on service from TG2; gateway registration is technically independent but grouped here for coherence
4. **Task Group 4: Integration Tests & Gap Analysis** -- Depends on all prior groups being complete

Note: Gateway registration tasks (3.4-3.7) have no dependency on mcp-server tasks and could technically be implemented in parallel with Task Groups 1-2. However, they are grouped with the route handler (3.2-3.3) because they represent the final "wiring" step and are fast to implement.

## Files Created or Modified

### New Files
| File | Task | Purpose |
|------|------|---------|
| `mcp-server/src/types/saveRoadmapStructure.ts` | 1.2, 2.2 | WorkItemDto, input types, request/response types |
| `mcp-server/src/services/roadmapStructureService.ts` | 2.4-2.7 | Service: parse, validate, match, upsert orchestration |
| `mcp-server/src/routes/saveRoadmapStructureRoute.ts` | 3.2 | Express route handler for POST endpoint |
| `mcp-server/src/__tests__/archModelClient.workItems.test.ts` | 1.1 | Tests for new archModelClient methods |
| `mcp-server/src/__tests__/roadmapStructureService.test.ts` | 2.1 | Tests for service logic |
| `mcp-server/src/__tests__/saveRoadmapStructureRoute.test.ts` | 3.1 | Tests for route handler |
| `mcp-server/src/__tests__/roadmapStructureService.integration.test.ts` | 4.3 | Integration/gap-fill tests |
| `gateway/src/__tests__/toolExecutor.saveRoadmapStructure.test.ts` | 3.1 | Tests for gateway registration |

### Modified Files
| File | Task | Change |
|------|------|--------|
| `mcp-server/src/services/archModelClient.ts` | 1.3-1.5 | Add listWorkItems, createWorkItem, updateWorkItem methods |
| `mcp-server/src/types/index.ts` | 2.3 | Add `export * from './saveRoadmapStructure'` |
| `mcp-server/src/routes/tools.ts` | 3.3 | Import + mount saveRoadmapStructureRouter |
| `gateway/src/types/tools.ts` | 3.4-3.6 | ToolName union, ALLOWED_TOOL_NAMES, SaveRoadmapStructureParams, ToolParams, TOOL_DEFINITIONS |
| `gateway/src/services/toolExecutor.ts` | 3.7 | TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS, import |
