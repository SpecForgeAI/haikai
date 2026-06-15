# Specification: MCP Tool - save_roadmap_structure

## Goal
Add an MCP tool that persists a high-level roadmap structure (Initiatives and Epics) as canonical work_items in the architecture-model-service, supporting both initial creation and subsequent updates via an externalRef-first, title-fallback upsert strategy.

## User Stories
- As an AI assistant (roadmap_pm persona), I want to call `save_roadmap_structure` so that I can persist a structured roadmap of initiatives and epics into the canonical work-item store without manual data entry.
- As a product manager, I want the tool to merge incoming roadmap changes with existing work items so that status, delivery team, and other fields I have manually curated are not overwritten.
- As a system integrator, I want the tool to match work items by external references (Jira keys) when available, falling back to case-insensitive title matching, so that re-imports and LLM-generated roadmaps resolve to the correct existing records.

## Specific Requirements

**Extend `archModelClient.ts` with work-item HTTP methods**
- Add `listWorkItems(projectId: string): Promise<WorkItemDto[]>` calling `GET /api/model/projects/{projectId}/work-items`
- Add `createWorkItem(projectId: string, dto: WorkItemDto): Promise<WorkItemDto>` calling `POST /api/model/projects/{projectId}/work-items`
- Add `updateWorkItem(projectId: string, workItemId: string, dto: WorkItemDto): Promise<WorkItemDto>` calling `PUT /api/model/projects/{projectId}/work-items/{id}`
- Define a `WorkItemDto` TypeScript interface matching the Java DTO fields: `id`, `project_id`, `type`, `parent_id`, `title`, `description`, `status`, `sort_order`, `priority`, `target_window`, `tags`, `external_system`, `external_key`, `external_url`, `created_at`, `updated_at`
- Follow the existing client patterns: use `this.client` (axios instance), `encodeURIComponent` on path params, return `response.data`
- The `WorkItemDto` interface should be defined in a new types file or within `archModelClient.ts`, consistent with how `ProjectDto` is defined there

**Create `roadmapStructureService.ts` in mcp-server**
- Export a main orchestrator function `saveRoadmapStructure(projectId: string, roadmapJson: string): Promise<SaveRoadmapStructureResult>` that coordinates the full flow
- Parse `roadmapJson` string into an object; throw 400 on invalid JSON
- Validate: `initiatives` array must be non-empty; every initiative and epic must have a non-empty `title`; initiative titles must be unique (case-insensitive) across the input; epic titles must be unique (case-insensitive) within each initiative
- Fetch all existing work items for the project via `archModelClient.listWorkItems(projectId)` to build upsert matching maps
- Build two matching maps from existing items: (1) externalRef map keyed by `{external_system}::{external_key}` per type, (2) type-scoped title map keyed by `{type}::{title.toLowerCase()}`
- Two-phase upsert: process all initiatives first (to obtain their IDs), then process all epics with `parent_id` set from the containing initiative's resolved ID
- Match priority for each item: first try externalRef match (`projectId` + `external_system` + `external_key`), then fall back to type-scoped case-insensitive title match
- On **create**: set `type` (INITIATIVE or EPIC), `title`, `description`, `status`="PLANNED", `sort_order` from array index (0, 1, 2...), `parent_id` (null for initiatives, resolved initiative ID for epics), `external_system` and `external_key` from `externalRef` if provided; leave `external_url` null, `delivery_team_id` null, `tags` null
- On **update**: set `title`, `description`, `sort_order` (overwrite from new position), `parent_id`, `external_system`, `external_key`; do NOT overwrite `status`, `delivery_team_id`, `tags`, or `external_url`

**Return value and warnings from `roadmapStructureService`**
- Return `{ createdInitiatives: number, updatedInitiatives: number, createdEpics: number, updatedEpics: number, warnings: string[] }`
- Add a warning when an externalRef match resolves to a different title than the input (possible rename scenario)
- Add a warning when a title-fallback match is used (no externalRef was available or matched)
- `externalRef.id` from the input is ignored entirely and never persisted

**Create `saveRoadmapStructureRoute.ts` in mcp-server**
- Create an Express Router exported as `saveRoadmapStructureRouter`
- Handle `POST /` (mounted at `/mcp/tools/save_roadmap_structure` by the tools router)
- Extract `sessionId`, `projectId`, `roadmapJson` from `req.body`
- Validate `sessionId` is a non-empty string; validate `projectId` is a valid UUID v4 (reuse the same regex pattern from `saveArchitectureBaselineRoute.ts`); validate `roadmapJson` is a non-empty string
- Call `getOrCreateSession(sessionId)` for session tracking
- Delegate to `saveRoadmapStructure(projectId, roadmapJson)` from the service
- Return the service result as JSON on success
- Return 400 for validation errors; return 502 for architecture-model-service communication failures
- Follow the error handling pattern from `saveArchitectureBaselineRoute.ts` (structured JSON error responses, 502 upstream error wrapping)

**Register route in mcp-server tools router**
- Import `saveRoadmapStructureRouter` in `mcp-server/src/routes/tools.ts`
- Mount with `toolsRouter.use('/save_roadmap_structure', saveRoadmapStructureRouter)`
- Place alongside existing tool route mounts

**Gateway tool registration**
- In `gateway/src/types/tools.ts`: add `'save_roadmap_structure'` to the `ToolName` union type and `ALLOWED_TOOL_NAMES` array
- Add a `SaveRoadmapStructureParams` interface with fields: `projectId: string` and `roadmapJson: string`
- Add `SaveRoadmapStructureParams` to the `ToolParams` union type
- Add a new entry to `TOOL_DEFINITIONS` with: name `save_roadmap_structure`, description explaining it persists initiative/epic roadmap structure, parameters `{ sessionId: string, projectId: string, roadmapJson: string }` with `required: ['projectId', 'roadmapJson']`
- In `gateway/src/services/toolExecutor.ts`: add `save_roadmap_structure: '/mcp/tools/save_roadmap_structure'` to `TOOL_ENDPOINTS`; add `save_roadmap_structure: ['projectId', 'roadmapJson']` to `TOOL_REQUIRED_PARAMS`; import the new params type

**Input schema for `roadmapJson`**
- The parsed JSON must conform to: `{ initiatives: [{ title: string, description?: string, externalRef?: { system: string, key: string, id?: string } | null, epics?: [{ title: string, description?: string, externalRef?: { system: string, key: string, id?: string } | null }] }] }`
- Define TypeScript interfaces for this structure in a new `mcp-server/src/types/saveRoadmapStructure.ts` file following the pattern of `saveArchitectureBaseline.ts`
- Export request, input, and response types from the mcp-server `types/index.ts` barrel

## Visual Design
No visual assets provided. This is a backend-only MCP tool with no UI component.

## Existing Code to Leverage

**`mcp-server/src/routes/saveArchitectureBaselineRoute.ts`**
- Closest analog route handler; copy its structure for the new route: UUID_V4_REGEX constant, sessionId/projectId/payload string validation, getOrCreateSession call, delegation to service, 400/502 error handling pattern
- Reuse the same Express Router + async handler + next(error) pattern

**`mcp-server/src/services/architectureBaselineService.ts`**
- Closest analog service; follow its pattern of: exported orchestrator function, `parseAndValidate` step, delegation to `archModelClient`, structured error throwing via `createHttpError`
- The roadmap service is simpler (no ID generation, no merge-with-existing model, no relationship building) but should follow the same function-per-step decomposition for testability

**`mcp-server/src/services/archModelClient.ts`**
- Singleton HTTP client class with axios instance; extend this class with three new methods for work-item CRUD
- Follow existing patterns: `this.client.get/post/put`, `encodeURIComponent` on path params, return `response.data`, let AxiosError propagate for caller handling
- `ProjectDto` interface already defined here; add `WorkItemDto` interface nearby or in the new types file

**`gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts`**
- Follow the exact pattern used by `save_architecture_baseline` for registration: add to ToolName union, ALLOWED_TOOL_NAMES array, TOOL_DEFINITIONS array, TOOL_ENDPOINTS record, TOOL_REQUIRED_PARAMS record, and create a params interface
- The `sessionId` is auto-injected by `executeTool` (merged into requestBody), so it is not listed in `TOOL_REQUIRED_PARAMS`

**`architecture-model-service` WorkItemController + WorkItemDto + WorkItemService (Java)**
- The REST API already exists: GET list (with optional type/parent_id filters), POST create (returns 201), PUT update (patch semantics preserving nulls)
- WorkItemDto fields include `external_system`, `external_key`, `external_url` for external reference matching
- The service enforces parent hierarchy rules: INITIATIVE must have null parent, EPIC must have INITIATIVE parent; the mcp-server must provide valid parent_id values
- No changes to the Java service are needed; the mcp-server calls it as-is

## Out of Scope
- Wiring `save_roadmap_structure` into the `roadmap_pm` chat confirmation flow (deferred to RM Increment 6)
- Jira import or any external system data fetch (handled in RM Increment 4)
- Scheduling fields: start_date, end_date, target_window on work items
- Delivery team assignment (`delivery_team_id` left null on create, unchanged on update)
- Work items below EPIC level (FEATURE, STORY are not created by this tool)
- Deletion of work items (tool only creates and updates)
- Merge/diff logic beyond simple two-key upsert (no conflict resolution UI)
- Tags or provenance metadata storage
- `external_url` construction (left null; populated separately by Jira import)
- `externalRef.id` persistence (ignored from input, never stored)
