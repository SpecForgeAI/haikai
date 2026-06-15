# Specification: MCP Tool -- save_architecture_baseline

## Goal
Introduce a new MCP tool `save_architecture_baseline` that accepts a JSON payload of architecture entities (services, interfaces, endpoints, data entities, business logic, data movements) and persists them into architecture-model-service using a GET-merge-PUT strategy that preserves existing model data while appending new entities.

## User Stories
- As an AI agent, I want to save an architecture baseline from a structured JSON payload so that the architecture meta-model is populated without manual UI entry.
- As a solution architect, I want baseline entities to be appended to the existing model (not overwrite it) so that previously defined architecture data is preserved.
- As a gateway consumer, I want `save_architecture_baseline` registered as an invocable tool so that the LLM can call it during architecture analysis workflows.

## Specific Requirements

**R-1: MCP Route and Handler**
- Create `mcp-server/src/routes/saveArchitectureBaselineRoute.ts` exporting a `saveArchitectureBaselineRouter` (Express Router)
- Mount at `/save_architecture_baseline` inside `mcp-server/src/routes/tools.ts` following the same `toolsRouter.use(...)` pattern used for `saveProductArtifactsRouter`
- POST handler accepts `{ sessionId, projectId, architectureBaselineJson }` in the request body
- Validate `sessionId` (non-empty string), `projectId` (UUID v4 regex), and `architectureBaselineJson` (non-empty string that parses to valid JSON)
- Delegate to a new service module for all business logic; the route handler only does request parsing, validation of top-level params, and response formatting
- Return JSON response on success (200) or pass errors to Express `next(error)` using `createHttpError`

**R-2: architectureBaselineJson Input Schema**
- The caller provides `architectureBaselineJson` as a JSON **string**; the tool parses it internally
- The parsed object must conform to this shape (all arrays optional, default to empty):
  - `services[]` -- each: `{ name: string, description?: string, serviceType?: string, coreTech?: string, tags?: string }`
  - `interfaces[]` -- each: `{ name: string, description?: string, serviceRef: string, interfaceType?: string, tags?: string }`
  - `interfaceEndpoints[]` -- each: `{ name: string, description?: string, interfaceRef: string, endpointType?: string, pathOrAddress?: string, protocol?: string, operationVerb?: string, direction?: string, requestDataEntityRef?: string, responseDataEntityRef?: string }`
  - `logicalDataEntities[]` -- each: `{ name: string, description?: string, tags?: string }`
  - `physicalDataEntities[]` -- each: `{ name: string, description?: string, physicalType?: string, database?: string, logicalDataEntityRef?: string, tags?: string }`
  - `businessLogic[]` -- each: `{ name: string, descriptionMd?: string, typeText?: string, ownerServiceRef?: string, tags?: string }`
  - `dataMovements[]` -- each: `{ sourceServiceRef: string, targetServiceRef: string, dataEntityRef?: string, interfaceWithSchemaRef?: string, movementType?: string, description?: string, biDirectional?: boolean, tags?: string }`
- All `*Ref` fields use human-readable **names** (not IDs); see R-6 for resolution
- JSON field names in the payload are camelCase

**R-3: Project Lookup for Filename Derivation**
- Accept `projectId` (UUID) as a top-level request parameter (not inside architectureBaselineJson)
- Call `GET /api/projects` on architecture-model-service to list all projects
- Find the project matching the provided `projectId`; if not found, return 404 with message "Project not found: {projectId}"
- Extract the project `name` and use it as the `filename` parameter for all subsequent `GET /api/model?filename=...` and `PUT /api/model?filename=...` calls
- Add a `getProjectById(projectId: string): Promise<ProjectDto>` method to `archModelClient.ts` that calls `GET /api/projects`, filters by ID, and returns the matching project or throws

**R-4: Internal ID Generation**
- The tool generates all entity IDs; callers never provide IDs
- Use prefix + timestamp-hash + random-suffix pattern consistent with existing IDs in the system (e.g., `svc-mk8r1ccg-bd7tv`)
- ID generation function: produce IDs like `{prefix}{base36Timestamp}-{5charRandomAlphanumeric}` where the base36 timestamp is derived from `Date.now()` in base 36
- Prefix mapping: `svc-` (services), `ifc-` (interfaces), `ep-` (endpoints), `lde-` (logical data entities), `pde-` (physical data entities), `bl-` (business logic), `dm-` (data movements), `app-` (applications), `comp-` (app components), `ile-` (interface_logical_entities), `ldepe-` (logical_data_entity_physical_data_entities), `apbl-` (application_point_business_logics)
- Create a shared `generateId(prefix: string): string` utility in the service module

**R-5: Placeholder Application and AppComponent**
- Before processing payload entities, create one placeholder Application: `{ id: app-..., name: "Core Application", description: "", app_type: "", status: "", tags: "", ... }`
- Create one placeholder AppComponent: `{ id: comp-..., name: "Core Component", description: "", application_id: <placeholder app ID>, tags: "", ... }`
- All generated Service entities are assigned `application_id` = placeholder Application ID and `app_component_id` = placeholder AppComponent ID
- If the existing model already contains an Application named "Core Application", reuse its ID and its "Core Component" AppComponent ID instead of creating duplicates

**R-6: Name-Based Ref Resolution**
- All `*Ref` fields in the input payload contain entity **names** (not IDs)
- After ID generation, build a name-to-ID lookup map for each entity type: `{ [entityType]: { [name]: generatedId } }`
- Resolve every `*Ref` field against its target entity type's map: `serviceRef` resolves against services, `interfaceRef` against interfaces, `requestDataEntityRef` / `responseDataEntityRef` / `dataEntityRef` against the union of logical + physical data entities, `logicalDataEntityRef` against logical data entities, `ownerServiceRef` against services, `interfaceWithSchemaRef` against interfaces
- For `requestDataEntityRef` and `responseDataEntityRef`, resolve to the data_entity_point ID (dep_log_ or dep_phy_ prefix) since EndpointDto uses `request_data_entity_point_id` and `response_data_entity_point_id`
- If any ref cannot be resolved, collect the error and continue; report all unresolvable refs in the validation error response

**R-7: Auto-Generated Application Points**
- Generate `application_points` entries for each created Application, AppComponent, Service, and Interface
- Application point pattern: `{ id: "ap_{entityId}", name: <entity name>, kind: <APPLICATION|APP_COMPONENT|SERVICE|INTERFACE>, application_id: <resolved app id>, application_component_id: <if APP_COMPONENT kind>, service_id: <if SERVICE kind>, interface_id: <if INTERFACE kind>, ... }`
- Follow the exact field shape from `ApplicationPointDto`: id, name, description (""), kind, application_id, application_component_id, service_id, interface_id, target_type (null), target_ref_id (null), point_type (""), tags (""), valid_from (null), valid_to (null)
- For SERVICE kind: `application_id` = the service's `application_id`; `service_id` = the service's ID; other FKs null

**R-8: Auto-Generated Data Entity Points**
- Generate `data_entity_points` for each logical and physical data entity created
- Logical: `{ id: "dep_log_{ldeId}", point_kind: "LOGICAL_ENTITY", logical_entity_id: ldeId, physical_entity_id: null, ... }`
- Physical: `{ id: "dep_phy_{pdeId}", point_kind: "PHYSICAL_ENTITY", logical_entity_id: null, physical_entity_id: pdeId, ... }`
- This mirrors the `DataEntityPointEnsureService` logic in the backend, but must be included in the merged DTO since the PUT endpoint does truncate-and-insert (existing points would be lost if not included)

**R-9: GET-Merge-PUT Save Strategy**
- Step 1: `GET /api/model?filename={projectName}` to fetch existing `ArchitectureModelDto`; if 404 (no existing model), start with an empty model shell
- Step 2: For each entity array in `metaModel.entities` and each relationship array in `metaModel.relationships`, append all newly generated records to the existing arrays (preserve all existing records)
- Step 3: Preserve the existing `diagrams` array unchanged (no diagram creation or modification)
- Step 4: `PUT /api/model?filename={projectName}` with the full merged `ArchitectureModelDto`
- Add `getModel(filename: string): Promise<ArchitectureModelDto>` and `putModel(filename: string, model: ArchitectureModelDto): Promise<any>` methods to `archModelClient.ts`
- For the empty model shell, initialize all entity and relationship arrays as empty `[]` and diagrams as `[]`

**R-10: Relationship Generation (v0.1 Subset)**
- **data_movements**: Construct from `dataMovements[]` in payload. `source_application_point_id` = `ap_{svcId}` where svcId is the resolved ID of `sourceServiceRef`. Same pattern for `target_application_point_id`. `dataEntityPointId` = `dep_log_{ldeId}` or `dep_phy_{pdeId}` resolved from `dataEntityRef`. `interfaceWithSchemaId` = resolved interface ID from `interfaceWithSchemaRef`. Exactly one of dataEntityPointId or interfaceWithSchemaId must be set per record.
- **interface_logical_entities**: Auto-generated from `interfaceEndpoints[]`. For each endpoint with a `requestDataEntityRef` or `responseDataEntityRef`, create an `InterfaceLogicalEntityDto` linking the endpoint's interface to the data entity point. Deduplicate by (interface_id, dataEntityPointId) pair.
- **logical_data_entity_physical_data_entities**: Auto-generated from `physicalDataEntities[]` where `logicalDataEntityRef` is present. Create one record per physical entity with: `logical_entity_id` = resolved logical entity ID, `physical_entity_id` = physical entity ID.
- **application_point_business_logics**: If `businessLogic[]` items have `ownerServiceRef`, create records linking the service's application point (`ap_{svcId}`) to the business logic ID.

**R-11: Validation (Pre-Save)**
- Run ALL validations before constructing the merged DTO; collect all errors
- Non-empty `name` for every entity in every array
- No duplicate names within the same entity type array (case-sensitive comparison)
- All `*Ref` fields resolve to an entity defined within the same payload
- `dataMovements[]` XOR constraint: exactly one of `dataEntityRef` or `interfaceWithSchemaRef` must be provided per movement
- `architectureBaselineJson` must parse as valid JSON
- If any validation errors exist, return HTTP 400 with `{ success: false, errors: [{ field, entityType, entityName, message }] }` and do NOT attempt the PUT
- Do NOT transform entity names (no snake_case enforcement); do NOT reject on naming style

**R-12: Atomic Save**
- After successful validation, construct the full merged `ArchitectureModelDto` in memory
- Issue a single `PUT /api/model?filename={projectName}` call
- If the PUT fails, return HTTP 502 with the upstream error
- No partial success; no per-entity retries

**R-13: Response Shape**
- On success, return HTTP 200 with:
  ```
  {
    "success": true,
    "projectId": "<uuid>",
    "filename": "<project name>",
    "summary": {
      "applications": <count>,
      "appComponents": <count>,
      "services": <count>,
      "interfaces": <count>,
      "interfaceEndpoints": <count>,
      "logicalDataEntities": <count>,
      "physicalDataEntities": <count>,
      "businessLogic": <count>,
      "dataMovements": <count>,
      "applicationPoints": <count>,
      "dataEntityPoints": <count>,
      "interfaceLogicalEntities": <count>,
      "logicalPhysicalMappings": <count>,
      "applicationPointBusinessLogics": <count>
    },
    "createdEntities": {
      "services": [{ "name": "...", "id": "..." }],
      "interfaces": [{ "name": "...", "id": "..." }],
      ...
    }
  }
  ```
- On validation error, return HTTP 400 with `{ success: false, errors: [...] }`
- On upstream failure, return HTTP 502 with `{ success: false, error: "<message>" }`

**R-14: Gateway Tool Registration**
- Add `'save_architecture_baseline'` to the `ToolName` union type in `gateway/src/types/tools.ts`
- Add to `ALLOWED_TOOL_NAMES` array
- Add a `TOOL_DEFINITIONS` entry with `name: 'save_architecture_baseline'`, description, and parameters schema containing `projectId` (string, required) and `architectureBaselineJson` (string, required, description explains it is a JSON string with entity arrays)
- Add `SaveArchitectureBaselineParams` interface: `{ projectId: string; architectureBaselineJson: string }`
- Add to `ToolParams` union
- In `gateway/src/services/toolExecutor.ts`: add `save_architecture_baseline: '/mcp/tools/save_architecture_baseline'` to `TOOL_ENDPOINTS` and `save_architecture_baseline: ['projectId', 'architectureBaselineJson']` to `TOOL_REQUIRED_PARAMS`

**R-15: Service Module Structure**
- Create `mcp-server/src/services/architectureBaselineService.ts` containing all business logic
- Export a single main function: `saveArchitectureBaseline(projectId: string, baselineJson: string): Promise<SaveArchitectureBaselineResponse>`
- Internal functions: `parseAndValidate()`, `generateIds()`, `resolveRefs()`, `buildEntities()`, `buildRelationships()`, `mergeWithExisting()`, `generateId(prefix)`
- Create `mcp-server/src/types/saveArchitectureBaseline.ts` for all type definitions (request, response, input payload interfaces)
- Re-export from `mcp-server/src/types/index.ts`

## Visual Design
No visual assets were provided. This feature has no UI component.

## Existing Code to Leverage

**`mcp-server/src/routes/saveProductArtifactsRoute.ts` -- Route Handler Pattern**
- Follow the same Express Router export pattern (`saveArchitectureBaselineRouter`)
- Copy the validation structure: sessionId check, projectId UUID regex check, field presence checks
- Follow the same `try/catch` with `next(error)` error delegation
- Follow the same `createHttpError(statusCode, message)` pattern for validation errors
- Session management: call `getOrCreateSession(sessionId)` at start of handler

**`mcp-server/src/services/archModelClient.ts` -- Architecture Model Service Client**
- Add three new methods: `getProjectById()`, `getModel(filename)`, `putModel(filename, model)`
- `getModel`: `GET /api/model` with `params: { filename }`, returns `ArchitectureModelDto`
- `putModel`: `PUT /api/model` with `params: { filename }` and body = full `ArchitectureModelDto`
- `getProjectById`: `GET /api/projects`, filter result array by ID match, throw if not found
- Reuse existing `this.client` axios instance with its 30s timeout and JSON headers

**`gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts` -- Gateway Registration**
- Add to all four registries: `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_DEFINITIONS`, and `TOOL_ENDPOINTS` / `TOOL_REQUIRED_PARAMS`
- Follow the exact same structure as `save_product_artifacts` entries
- The tool definition `parameters` object should have only two required properties: `projectId` and `architectureBaselineJson` (both type string)

**`DataEntityPointEnsureService.java` -- Auto-Generation Pattern**
- Mirrors the logic for generating data entity points: `dep_log_` + entityId for logical, `dep_phy_` + entityId for physical
- The `point_kind` values are `LOGICAL_ENTITY` and `PHYSICAL_ENTITY`
- This backend service runs on DB save, but the MCP tool must include these in the DTO because PUT does truncate-and-insert, meaning existing points would be lost if omitted from the payload

**Backend DTO Structure (`ArchitectureModelDto` / `MetaModelDto` / `MetaModelEntitiesDto` / `MetaModelRelationshipsDto`)**
- `ArchitectureModelDto` = `{ metaModel: { entities: MetaModelEntitiesDto, relationships: MetaModelRelationshipsDto }, diagrams: DiagramDto[] }`
- Entity arrays use snake_case JSON keys (`business_users`, `services`, `app_components`, `application_points`, `logical_data_entities`, `physical_data_entities`, `data_entity_points`, `business_logics`, etc.)
- Relationship arrays use snake_case JSON keys (`data_movements`, `interface_logical_entities`, `logical_data_entity_physical_data_entities`, `application_point_business_logics`, etc.)
- All entity/relationship DTOs use snake_case for field-level JSON property names except `dataEntityPointId`, `interfaceWithSchemaId`, `biDirectional`, `fromDataEntityPointId`, `toDataEntityPointId` which are camelCase

## Out of Scope
- Logical data attributes and physical data attributes (excluded from v0.1)
- Diagram creation, layout, or any visual rendering
- Deletion or modification of existing entities in the model
- Architecture diff or merge conflict detection (append-only, no dedup against existing)
- Retrieval or query of existing architecture data as a standalone tool
- Versioning of architecture baselines
- UI changes of any kind
- Full JSON schema enumeration inside the OpenAI tool definition (description-only for v0.1)
- Name transformation or snake_case enforcement on entity names provided by the caller
- Per-entity partial success handling (atomic single PUT instead)
- Relationship types beyond the v0.1 subset (no `business_user_business_points`, `application_point_business_points`, `logical_data_entity_relationships`, `logical_data_attribute_physical_data_attributes`, `ui_workflow_transitions`)
