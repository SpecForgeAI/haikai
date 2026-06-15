# Task Breakdown: MCP Tool -- save_architecture_baseline

## Overview
Total Tasks: 8 Task Groups, 48 sub-tasks

## Task List

---

### Types and Shared Utilities

#### Task Group 1: Type Definitions and ID Generation Utility
**Dependencies:** None

- [x] 1.0 Complete types and shared utilities
  - [x] 1.1 Write 4 focused tests for type definitions and generateId utility
    - Test that `generateId('svc-')` returns a string starting with `svc-` and has a reasonable length (prefix + base36 timestamp + random suffix)
    - Test that `generateId` with each prefix (`svc-`, `ifc-`, `ep-`, `lde-`, `pde-`, `bl-`, `dm-`, `app-`, `comp-`, `ile-`, `ldepe-`, `apbl-`) produces correctly prefixed IDs
    - Test that two sequential calls to `generateId` with the same prefix produce different IDs (uniqueness)
    - Test that `ArchitectureBaselineInput` type allows valid payloads with all optional arrays and rejects when parsed with missing required fields via validation logic
  - [x] 1.2 Create type definitions in `mcp-server/src/types/saveArchitectureBaseline.ts`
    - Define `SaveArchitectureBaselineRequest` interface with fields: `sessionId: string`, `projectId: string`, `architectureBaselineJson: string`
    - Define `ArchitectureBaselineInput` interface with optional arrays: `services?: ServiceInput[]`, `interfaces?: InterfaceInput[]`, `interfaceEndpoints?: InterfaceEndpointInput[]`, `logicalDataEntities?: LogicalDataEntityInput[]`, `physicalDataEntities?: PhysicalDataEntityInput[]`, `businessLogic?: BusinessLogicInput[]`, `dataMovements?: DataMovementInput[]`
    - Define individual input interfaces for each entity type (e.g., `ServiceInput` with `name`, `description?`, `coreTech?`, `serviceType?`; `InterfaceInput` with `name`, `description?`, `interfaceType?`, `serviceRef`; `InterfaceEndpointInput` with `name`, `httpMethod?`, `path?`, `requestDataEntityRef?`, `responseDataEntityRef?`, `interfaceRef`; etc.)
    - Define `DataMovementInput` with `name`, `sourceServiceRef?`, `targetServiceRef?`, `interfaceRef?`, `dataEntityRefs?: string[]`, `direction?`
    - Define `SaveArchitectureBaselineResponse` interface with `success: boolean`, `projectId: string`, `filename: string`, `summary: Record<string, number>`, `createdEntities: Record<string, string[]>`
    - Define `SaveArchitectureBaselineErrorResponse` interface with `errors: string[]`
    - Define `ValidationError` type for structured validation failures
    - Files: `mcp-server/src/types/saveArchitectureBaseline.ts`
  - [x] 1.3 Export new types from `mcp-server/src/types/index.ts`
    - Add `export * from './saveArchitectureBaseline';` line following the existing pattern (see `export * from './saveProductArtifacts'` at line 160)
    - Files: `mcp-server/src/types/index.ts`
  - [x] 1.4 Create `generateId(prefix)` utility function
    - Create file `mcp-server/src/utils/generateId.ts`
    - Implement pattern: `prefix + Date.now().toString(36) + randomSuffix` where randomSuffix is 4-6 random alphanumeric characters
    - Export as named export: `export function generateId(prefix: string): string`
    - Support all prefixes from spec: `svc-`, `ifc-`, `ep-`, `lde-`, `pde-`, `bl-`, `dm-`, `app-`, `comp-`, `ile-`, `ldepe-`, `apbl-`
    - Files: `mcp-server/src/utils/generateId.ts`
  - [x] 1.5 Ensure types and utility tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds for new type files
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All input/output type interfaces compile without errors
- `generateId` produces unique, correctly prefixed IDs
- Types are properly exported from `mcp-server/src/types/index.ts`

---

### Architecture Model Client Extensions

#### Task Group 2: archModelClient New Methods
**Dependencies:** Task Group 1

- [x] 2.0 Complete archModelClient extensions
  - [x] 2.1 Write 6 focused tests for new archModelClient methods
    - Test that `getProjectById(projectId)` calls `GET /api/projects` and returns the matching project object with its `name` field
    - Test that `getProjectById(projectId)` returns null or throws 404 when no project matches the given projectId
    - Test that `getModel(filename)` calls `GET /api/model` with `params: { filename }` and returns the full `ArchitectureModelDto` payload
    - Test that `getModel(filename)` returns null (or empty shell) when backend returns 404 (model does not exist yet)
    - Test that `putModel(filename, dto)` calls `PUT /api/model` with `params: { filename }` and the full DTO as request body
    - Test that `putModel(filename, dto)` throws an AxiosError when backend returns 500 (error preserved for caller handling)
    - Follow the existing test pattern in `mcp-server/src/__tests__/archModelClient.test.ts` (mock axios, use `jest.resetModules()`, `jest.clearAllMocks()` in `beforeEach`)
    - Files: `mcp-server/src/__tests__/archModelClient.saveBaseline.test.ts`
  - [x] 2.2 Add `getProjectById(projectId)` method to `ArchModelClient` class
    - Call `GET /api/projects` to list all projects
    - Find the project where `project.id === projectId`
    - Return the matching project object (with `id`, `name`, and other fields) or throw a descriptive error if not found
    - Use the existing `this.client` axios instance from `archModelClient.ts`
    - Files: `mcp-server/src/services/archModelClient.ts`
  - [x] 2.3 Add `getModel(filename)` method to `ArchModelClient` class
    - Call `GET /api/model` with `params: { filename }`
    - Return the full response data as `ArchitectureModelDto` (use `any` or a broad type initially; the full DTO shape is complex)
    - Handle 404 by returning `null` (model does not exist yet, will start with empty shell)
    - Files: `mcp-server/src/services/archModelClient.ts`
  - [x] 2.4 Add `putModel(filename, dto)` method to `ArchModelClient` class
    - Call `PUT /api/model` with `params: { filename }` and the full merged DTO as the request body
    - Return the response data
    - Let AxiosError propagate to caller (consistent with existing pattern, e.g., `upsertProductDefinition`)
    - Files: `mcp-server/src/services/archModelClient.ts`
  - [x] 2.5 Ensure archModelClient tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all three new methods are callable and correctly wired
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- `getProjectById` correctly fetches project list and filters by ID
- `getModel` returns model data or null on 404
- `putModel` sends full DTO to backend PUT endpoint
- Error propagation is consistent with existing client methods

---

### Core Service Logic -- Validation and Entity Building

#### Task Group 3: parseAndValidate, generateIds, resolveRefs, buildEntities
**Dependencies:** Task Group 1

- [x] 3.0 Complete validation and entity building logic
  - [x] 3.1 Write 8 focused tests for validation and entity building
    - Test `parseAndValidate` rejects invalid JSON string with descriptive error
    - Test `parseAndValidate` rejects payload with duplicate service names (e.g., two services both named "OrderService") and returns error listing the duplicates
    - Test `parseAndValidate` rejects payload with empty entity names (e.g., a service with `name: ""`)
    - Test `parseAndValidate` rejects payload with unresolvable refs (e.g., an endpoint with `interfaceRef: "NonExistentInterface"` when no such interface is defined)
    - Test `generateIds` assigns IDs with correct prefixes to all entity types (services get `svc-`, interfaces get `ifc-`, etc.)
    - Test `resolveRefs` correctly maps `serviceRef` name to the generated service ID, and `interfaceRef` name to the generated interface ID
    - Test `buildEntities` creates placeholder "Core Application" (`app-` prefix) and "Core Component" (`comp-` prefix) and associates all services with them
    - Test `buildEntities` auto-generates `application_points` for Application, AppComponent, Service, and Interface entities using `ap_{entityId}` pattern, and `data_entity_points` for logical (`dep_log_`) and physical (`dep_phy_`) entities
    - Files: `mcp-server/src/__tests__/architectureBaselineService.validation.test.ts`
  - [x] 3.2 Create `mcp-server/src/services/architectureBaselineService.ts` with module structure
    - Export main function: `saveArchitectureBaseline(projectId: string, architectureBaselineJson: string): Promise<SaveArchitectureBaselineResponse>`
    - Define internal functions as named exports (for testability): `parseAndValidate`, `generateIds`, `resolveRefs`, `buildEntities`, `buildRelationships`, `mergeWithExisting`
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 3.3 Implement `parseAndValidate(architectureBaselineJson: string)`
    - Parse the JSON string; throw 400 with descriptive message on parse failure
    - Validate all entity names are non-empty strings
    - Validate no duplicate names within each entity type array (services, interfaces, etc.)
    - Validate all `*Ref` fields resolve to an entity name defined in the same payload (e.g., `endpoint.interfaceRef` must match an interface name in `interfaces[]`)
    - Validate `dataMovements` XOR constraint (if applicable from spec -- sourceServiceRef or targetServiceRef presence rules)
    - Collect all validation errors and return them as a `string[]`; do NOT fail on first error
    - Return the parsed `ArchitectureBaselineInput` object on success
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 3.4 Implement `generateIds(input: ArchitectureBaselineInput)`
    - Use `generateId` utility from Task 1.4
    - Generate IDs for all entities in the input: services (`svc-`), interfaces (`ifc-`), endpoints (`ep-`), logical data entities (`lde-`), physical data entities (`pde-`), business logic (`bl-`), data movements (`dm-`)
    - Generate IDs for placeholder Application (`app-`) and AppComponent (`comp-`)
    - Return a mapping structure: `{ entityType: { name: generatedId } }` for use by resolveRefs
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 3.5 Implement `resolveRefs(input, idMaps)`
    - Build name-to-ID lookup maps per entity type from the `idMaps` structure
    - Resolve all `*Ref` fields: `serviceRef` -> service ID, `interfaceRef` -> interface ID, `logicalDataEntityRef` -> logical data entity ID, `ownerServiceRef` -> service ID
    - For `requestDataEntityRef` and `responseDataEntityRef` on endpoints, resolve to `data_entity_point` IDs (using `dep_log_` or `dep_phy_` prefix patterns)
    - Collect all unresolvable refs and return them as errors
    - Return resolved ref mappings for use by buildEntities and buildRelationships
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 3.6 Implement `buildEntities(input, idMaps, resolvedRefs)`
    - Construct all entity DTOs matching the `ArchitectureModelDto` field shapes:
      - `applications[]` -- single "Core Application" placeholder (reuse existing ID if model already has one)
      - `app_components[]` -- single "Core Component" placeholder
      - `services[]` -- from input, associated with Core Application and Core Component
      - `interfaces[]` -- from input, with resolved serviceRef
      - `interface_endpoints[]` -- from input, with resolved interfaceRef
      - `logical_data_entities[]` -- from input
      - `physical_data_entities[]` -- from input
      - `business_logic[]` -- from input, with resolved ownerServiceRef
      - `data_movements[]` -- from input, with resolved service refs
    - Generate `application_points[]` for Application, AppComponent, each Service, and each Interface using `ap_{entityId}` pattern; follow exact `ApplicationPointDto` field shape
    - Generate `data_entity_points[]` for each logical entity (`dep_log_{entityId}`) and each physical entity (`dep_phy_{entityId}`); these must be included in the merged DTO since PUT does truncate-and-insert
    - Return all entity arrays ready for merge
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 3.7 Ensure validation and entity building tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify parseAndValidate catches all error types
    - Verify generateIds produces correct prefixes
    - Verify resolveRefs maps names to IDs
    - Verify buildEntities creates complete entity DTOs with placeholders and auto-generated points
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Invalid JSON, duplicate names, empty names, and unresolvable refs are all caught with clear error messages
- All entity IDs use correct prefixes
- Placeholder Application and AppComponent are created
- Application points and data entity points are auto-generated with correct patterns
- All `*Ref` fields are resolved to generated IDs

---

### Core Service Logic -- Relationships and Merge

#### Task Group 4: buildRelationships, mergeWithExisting, and main orchestration
**Dependencies:** Task Groups 2 and 3

- [x] 4.0 Complete relationship generation and merge logic
  - [x] 4.1 Write 6 focused tests for relationship generation and merge
    - Test `buildRelationships` generates `data_movements` entries with resolved `sourceApplicationPointId` and `targetApplicationPointId` from service refs via application_point IDs
    - Test `buildRelationships` generates `interface_logical_entities` from endpoint `requestDataEntityRef` and `responseDataEntityRef` fields (linking interfaces to logical data entities)
    - Test `buildRelationships` generates `logical_data_entity_physical_data_entities` from `logicalDataEntityRef` on physical data entities
    - Test `buildRelationships` generates `application_point_business_logics` from `ownerServiceRef` on business logic items (linking service application_points to business logic)
    - Test `mergeWithExisting` appends new entities to existing arrays without removing existing entities, and preserves existing `diagrams` array unchanged
    - Test `mergeWithExisting` starts with an empty shell when existing model is null (GET returned 404)
    - Files: `mcp-server/src/__tests__/architectureBaselineService.merge.test.ts`
  - [x] 4.2 Implement `buildRelationships(input, idMaps, resolvedRefs, applicationPoints)`
    - Generate `data_movements` relationship entries: resolve `sourceServiceRef` and `targetServiceRef` to `application_point` IDs (using `ap_{svcId}` pattern); include `interfaceRef` resolution and `dataEntityRefs` resolution
    - Generate `interface_logical_entities` (ILE) entries: for each endpoint with `requestDataEntityRef` or `responseDataEntityRef`, create an ILE linking the endpoint's interface to the resolved logical data entity; use prefix `ile-` for ILE IDs
    - Generate `logical_data_entity_physical_data_entities` (LDEPE) entries: for each physical data entity with `logicalDataEntityRef`, create a mapping record; use prefix `ldepe-` for LDEPE IDs
    - Generate `application_point_business_logics` (APBL) entries: for each business logic item with `ownerServiceRef`, link the service's `application_point` to the business logic entity; use prefix `apbl-` for APBL IDs
    - Return all relationship arrays
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 4.3 Implement `mergeWithExisting(existingModel, newEntities, newRelationships)`
    - If `existingModel` is null, start with an empty shell `ArchitectureModelDto` (empty arrays for all entity and relationship types, empty `diagrams` array)
    - For each entity array (applications, services, interfaces, etc.), append new entries to the existing array
    - For "Core Application" placeholder: if the existing model already contains an application named "Core Application", reuse its ID instead of creating a duplicate
    - Preserve existing `diagrams` array completely unchanged
    - Preserve all existing relationship arrays; append new relationship entries
    - Return the full merged `ArchitectureModelDto` ready for PUT
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 4.4 Implement main `saveArchitectureBaseline(projectId, architectureBaselineJson)` function
    - Step 1: Call `archModelClient.getProjectById(projectId)` to get project name; throw 404 if not found
    - Step 2: Derive `filename` from project name
    - Step 3: Call `parseAndValidate(architectureBaselineJson)` -- if errors, throw 400 with error array
    - Step 4: Call `generateIds(input)`
    - Step 5: Call `resolveRefs(input, idMaps)`
    - Step 6: Call `archModelClient.getModel(filename)` to get existing model (null if 404)
    - Step 7: Call `buildEntities(input, idMaps, resolvedRefs)` -- pass existing model for "Core Application" reuse check
    - Step 8: Call `buildRelationships(input, idMaps, resolvedRefs, applicationPoints)`
    - Step 9: Call `mergeWithExisting(existingModel, newEntities, newRelationships)`
    - Step 10: Call `archModelClient.putModel(filename, mergedDto)` -- if upstream failure, throw 502
    - Step 11: Return `SaveArchitectureBaselineResponse` with success, projectId, filename, summary counts, and createdEntities map
    - Files: `mcp-server/src/services/architectureBaselineService.ts`
  - [x] 4.5 Ensure relationship and merge tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify all four relationship types are correctly generated
    - Verify merge preserves existing data and handles null model
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- `data_movements` correctly resolve service refs to application_point IDs
- `interface_logical_entities` are auto-generated from endpoint data entity refs
- `logical_data_entity_physical_data_entities` are generated from logicalDataEntityRef on physical entities
- `application_point_business_logics` are generated from ownerServiceRef on business logic
- Merge appends new entities without removing existing ones
- Existing diagrams are preserved unchanged
- "Core Application" reuse prevents duplicate placeholders

---

### Route Handler

#### Task Group 5: Route Handler and Mount
**Dependencies:** Task Group 4

- [x] 5.0 Complete route handler
  - [x] 5.1 Write 5 focused tests for route handler
    - Test valid request returns 200 with success response shape (`success`, `projectId`, `filename`, `summary`, `createdEntities`)
    - Test missing `sessionId` returns 400 via `next(error)` with `error.statusCode === 400` and message containing "sessionId"
    - Test invalid `projectId` (non-UUID format) returns 400 via `next(error)` with message containing "projectId"
    - Test invalid `architectureBaselineJson` (not valid JSON string) returns 400 with descriptive validation errors
    - Test upstream PUT failure (archModelClient.putModel throws) results in 502 error response
    - Follow the test pattern from `mcp-server/src/__tests__/saveProductArtifactsRoute.test.ts`: mock axios, mock sessionManager, extract route handler from `router.stack`, invoke handler with mock req/res/next
    - Files: `mcp-server/src/__tests__/saveArchitectureBaselineRoute.test.ts`
  - [x] 5.2 Create `mcp-server/src/routes/saveArchitectureBaselineRoute.ts`
    - Export `saveArchitectureBaselineRouter` as an Express `Router()`
    - POST `/` handler:
      - Extract `{ sessionId, projectId, architectureBaselineJson }` from `req.body` as `SaveArchitectureBaselineRequest`
      - Validate `sessionId` (required, non-empty string) -- throw `createHttpError(400, ...)` if missing
      - Validate `projectId` (required, matches UUID v4 regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) -- throw `createHttpError(400, ...)` if invalid
      - Validate `architectureBaselineJson` (required, non-empty string) -- throw `createHttpError(400, ...)` if missing
      - Call `getOrCreateSession(sessionId)` from `sessionManager`
      - Delegate to `saveArchitectureBaseline(projectId, architectureBaselineJson)` from the service module
      - On success: respond with `res.json(response)` (200)
      - On validation errors (400): respond with `res.status(400).json({ errors })`
      - On upstream failure: respond with `res.status(502).json({ error: { code: 502, message } })`
      - Wrap all logic in try/catch, pass unexpected errors to `next(error)`
    - Follow the exact pattern from `saveProductArtifactsRoute.ts` (lines 1-186)
    - Files: `mcp-server/src/routes/saveArchitectureBaselineRoute.ts`
  - [x] 5.3 Mount route in `mcp-server/src/routes/tools.ts`
    - Import `saveArchitectureBaselineRouter` from `./saveArchitectureBaselineRoute`
    - Add `toolsRouter.use('/save_architecture_baseline', saveArchitectureBaselineRouter);` following the pattern of existing mounts (lines 21-27)
    - Files: `mcp-server/src/routes/tools.ts`
  - [x] 5.4 Ensure route handler tests pass
    - Run ONLY the 5 tests written in 5.1
    - Verify request validation, delegation to service, and response formatting
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 5.1 pass
- Route handler validates sessionId, projectId, and architectureBaselineJson
- Successful requests return 200 with correct response shape
- Validation failures return 400 with error details
- Upstream failures return 502
- Route is correctly mounted at `/mcp/tools/save_architecture_baseline`

---

### Gateway Registration

#### Task Group 6: Gateway Tool Registration
**Dependencies:** None (independent of mcp-server work)

- [x] 6.0 Complete gateway registration
  - [x] 6.1 Write 4 focused tests for gateway registration
    - Test `isToolAllowed('save_architecture_baseline')` returns `true`
    - Test `validateToolArguments('save_architecture_baseline', { projectId: 'uuid', architectureBaselineJson: '{}' })` returns `{ valid: true }`
    - Test `validateToolArguments('save_architecture_baseline', { architectureBaselineJson: '{}' })` (missing projectId) returns `{ valid: false }` with error containing "projectId"
    - Test `TOOL_DEFINITIONS` contains an entry with `function.name === 'save_architecture_baseline'` and `function.parameters.required` includes both `projectId` and `architectureBaselineJson`
    - Follow the test pattern from `gateway/src/__tests__/toolExecutor.test.ts`
    - Files: `gateway/src/__tests__/toolExecutor.saveArchitectureBaseline.test.ts`
  - [x] 6.2 Add `save_architecture_baseline` to `ToolName` union type
    - Add `| 'save_architecture_baseline'` to the `ToolName` type union (line 12-17 of `gateway/src/types/tools.ts`)
    - Add `'save_architecture_baseline'` to `ALLOWED_TOOL_NAMES` array (line 22-28)
    - Files: `gateway/src/types/tools.ts`
  - [x] 6.3 Add `SaveArchitectureBaselineParams` interface
    - Define interface with `projectId: string` and `architectureBaselineJson: string`
    - Add to `ToolParams` union type (line 155-160)
    - Files: `gateway/src/types/tools.ts`
  - [x] 6.4 Add `TOOL_DEFINITIONS` entry for `save_architecture_baseline`
    - Add new `ToolDefinition` object to the `TOOL_DEFINITIONS` array:
      ```
      {
        type: 'function',
        function: {
          name: 'save_architecture_baseline',
          description: 'Save an architecture baseline: persists services, interfaces, endpoints, data entities, business logic, and data movements into the architecture model using a GET-merge-PUT strategy that preserves existing model data',
          parameters: {
            type: 'object',
            required: ['projectId', 'architectureBaselineJson'],
            properties: {
              projectId: {
                type: 'string',
                description: 'Project UUID (v4 format)'
              },
              architectureBaselineJson: {
                type: 'string',
                description: 'JSON string containing the architecture baseline payload with optional arrays: services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements. All ref fields use human-readable names.'
              }
            }
          }
        }
      }
      ```
    - Files: `gateway/src/types/tools.ts`
  - [x] 6.5 Add `TOOL_ENDPOINTS` and `TOOL_REQUIRED_PARAMS` entries
    - Add `save_architecture_baseline: '/mcp/tools/save_architecture_baseline'` to `TOOL_ENDPOINTS` (line 23-29 of `gateway/src/services/toolExecutor.ts`)
    - Add `save_architecture_baseline: ['projectId', 'architectureBaselineJson']` to `TOOL_REQUIRED_PARAMS` (line 34-40)
    - Import `SaveArchitectureBaselineParams` in the imports section (line 8-18)
    - Files: `gateway/src/services/toolExecutor.ts`
  - [x] 6.6 Ensure gateway registration tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify tool is in allow-list, definitions are correct, and validation works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- `save_architecture_baseline` is in `ALLOWED_TOOL_NAMES` and `ToolName` union
- `TOOL_DEFINITIONS` contains the correct OpenAI function definition with two required string params
- `TOOL_ENDPOINTS` maps to `/mcp/tools/save_architecture_baseline`
- `TOOL_REQUIRED_PARAMS` lists `['projectId', 'architectureBaselineJson']`
- `SaveArchitectureBaselineParams` interface is defined and included in `ToolParams` union

---

### Test Review and Gap Analysis

#### Task Group 7: Test Review and Gap Fill
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4 tests from TG1 (types and generateId utility)
    - Review the 6 tests from TG2 (archModelClient methods)
    - Review the 8 tests from TG3 (validation and entity building)
    - Review the 6 tests from TG4 (relationships and merge)
    - Review the 5 tests from TG5 (route handler)
    - Review the 4 tests from TG6 (gateway registration)
    - Total existing tests: approximately 33 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack coverage
    - Check that the full orchestration flow (project lookup -> validate -> build -> merge -> save) has at least one integration-style test
    - Verify that error paths (404 project not found, 502 upstream failure) are covered
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 8 additional strategic tests to fill gaps
    - Add end-to-end integration test: valid full payload with all entity types produces correct merged DTO structure
    - Add test: `dataMovements` XOR constraint validation (if sourceServiceRef is provided, targetServiceRef handling)
    - Add test: "Core Application" reuse -- when existing model already has "Core Application", verify no duplicate is created and existing ID is reused
    - Add test: `resolveRefs` for `requestDataEntityRef` and `responseDataEntityRef` resolves to correct `data_entity_point` IDs (not entity IDs)
    - Add test: Response shape includes correct `summary` counts (e.g., `{ services: 3, interfaces: 2, ... }`) matching actual created entities
    - Add test: Empty `architectureBaselineJson` (parses to `{}` with no arrays) succeeds with zero entities created
    - Add test: Gateway `executeTool` routes `save_architecture_baseline` to correct MCP endpoint URL with correct request body structure
    - Add test: Route handler correctly differentiates between 400 (validation) and 502 (upstream) error responses
    - Files: `mcp-server/src/__tests__/architectureBaselineService.integration.test.ts`, `gateway/src/__tests__/toolExecutor.saveArchitectureBaseline.test.ts`
  - [x] 7.4 Run all feature-specific tests
    - Run all tests from TG1 through TG6 plus the new tests from 7.3
    - Expected total: approximately 33 + 8 = 41 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 41 tests total)
- Critical end-to-end orchestration flow is covered
- Error paths (404, 400, 502) are all tested
- "Core Application" reuse logic is verified
- Response shape and summary counts are tested
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

### Final Verification

#### Task Group 8: Cross-System Consistency and Compilation
**Dependencies:** Task Groups 1-7

- [x] 8.0 Final verification
  - [x] 8.1 TypeScript compilation check for mcp-server
    - Run `npx tsc --noEmit` in `mcp-server/` directory
    - Verify zero compilation errors in all new and modified files
    - Files: all files created/modified in TG1-TG5
  - [x] 8.2 TypeScript compilation check for gateway
    - Run `npx tsc --noEmit` in `gateway/` directory
    - Verify zero compilation errors in modified gateway files
    - Files: `gateway/src/types/tools.ts`, `gateway/src/services/toolExecutor.ts`
  - [x] 8.3 Cross-system consistency check
    - Verify `ToolName` union in gateway includes `save_architecture_baseline`
    - Verify `TOOL_ENDPOINTS` path (`/mcp/tools/save_architecture_baseline`) matches the actual mount path in `mcp-server/src/routes/tools.ts`
    - Verify `TOOL_REQUIRED_PARAMS` keys (`projectId`, `architectureBaselineJson`) match the fields destructured in the route handler
    - Verify the route handler's `SaveArchitectureBaselineRequest` type fields align with what the gateway sends
  - [x] 8.4 Run full feature test suite
    - Run all test files created for this feature:
      - `mcp-server/src/__tests__/generateIdAndTypes.test.ts`
      - `mcp-server/src/__tests__/archModelClient.saveBaseline.test.ts`
      - `mcp-server/src/__tests__/architectureBaselineService.validation.test.ts`
      - `mcp-server/src/__tests__/architectureBaselineService.merge.test.ts`
      - `mcp-server/src/__tests__/architectureBaselineService.integration.test.ts`
      - `mcp-server/src/__tests__/saveArchitectureBaselineRoute.test.ts`
      - `gateway/src/__tests__/toolExecutor.saveArchitectureBaseline.test.ts`
    - Verify all tests pass: **42 tests across 7 test suites (36 mcp-server + 6 gateway)**
    - Document final test count and any known limitations

**Acceptance Criteria:**
- Zero TypeScript compilation errors in both mcp-server and gateway
- All feature tests pass
- Gateway tool registration is consistent with mcp-server route mounting
- Request/response types are aligned across gateway and mcp-server boundaries

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Types and Shared Utilities** -- foundational types and generateId utility; no dependencies
2. **Task Group 6: Gateway Registration** -- can run in parallel with TG1; no dependency on mcp-server work
3. **Task Group 2: archModelClient Extensions** -- depends on TG1 for types; adds GET/PUT methods needed by service
4. **Task Group 3: Core Service Logic - Validation and Entity Building** -- depends on TG1 for types and generateId; core business logic
5. **Task Group 4: Core Service Logic - Relationships and Merge** -- depends on TG2 (client methods) and TG3 (entity building); completes the service module
6. **Task Group 5: Route Handler** -- depends on TG4 (complete service); wires everything together in mcp-server
7. **Task Group 7: Test Review and Gap Analysis** -- depends on TG1-TG6; fills critical coverage gaps
8. **Task Group 8: Final Verification** -- depends on all; compilation and cross-system consistency

**Parallelism opportunities:**
- TG1 and TG6 can run in parallel (no shared dependencies)
- TG2 and TG3 can run in parallel after TG1 completes (both depend on TG1 but not on each other)

## Files Summary

### New Files
| File | Task Group | Description |
|------|-----------|-------------|
| `mcp-server/src/types/saveArchitectureBaseline.ts` | TG1 | Type definitions for request, response, input payload, and validation errors |
| `mcp-server/src/utils/generateId.ts` | TG1 | Shared utility for prefixed ID generation |
| `mcp-server/src/services/architectureBaselineService.ts` | TG3, TG4 | Core business logic: validation, entity building, relationships, merge, orchestration |
| `mcp-server/src/routes/saveArchitectureBaselineRoute.ts` | TG5 | Express route handler for the MCP tool endpoint |
| `mcp-server/src/__tests__/archModelClient.saveBaseline.test.ts` | TG2 | Tests for new archModelClient methods |
| `mcp-server/src/__tests__/architectureBaselineService.validation.test.ts` | TG3 | Tests for validation and entity building |
| `mcp-server/src/__tests__/architectureBaselineService.merge.test.ts` | TG4 | Tests for relationship generation and merge |
| `mcp-server/src/__tests__/architectureBaselineService.integration.test.ts` | TG7 | Integration and gap-fill tests |
| `mcp-server/src/__tests__/saveArchitectureBaselineRoute.test.ts` | TG5 | Tests for route handler |
| `gateway/src/__tests__/toolExecutor.saveArchitectureBaseline.test.ts` | TG6, TG7 | Tests for gateway registration and tool execution routing |

### Modified Files
| File | Task Group | Changes |
|------|-----------|---------|
| `mcp-server/src/types/index.ts` | TG1 | Add `export * from './saveArchitectureBaseline'` |
| `mcp-server/src/services/archModelClient.ts` | TG2 | Add `getProjectById()`, `getModel()`, `putModel()` methods |
| `mcp-server/src/routes/tools.ts` | TG5 | Import and mount `saveArchitectureBaselineRouter` |
| `gateway/src/types/tools.ts` | TG6 | Add to ToolName union, ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, SaveArchitectureBaselineParams, ToolParams |
| `gateway/src/services/toolExecutor.ts` | TG6 | Add TOOL_ENDPOINTS and TOOL_REQUIRED_PARAMS entries, import new params type |
