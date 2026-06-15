# Task Breakdown: MCP Server - Compute OAS Gaps Tool

## Overview

**Total Tasks:** 25 subtasks across 5 task groups

**Summary:** Implement a new MCP tool endpoint `compute_oas_gaps` that analyzes interface context and produces a deterministic GapReport containing gaps, defaults, type mappings, and operationId suggestions for OpenAPI specification generation.

**Key Dependencies:**
- Existing MCP server structure in `mcp-server/src/`
- Existing `archModelClient` for backend calls
- Existing `sessionManager` for session state
- Existing route pattern in `src/routes/tools.ts`

---

## Task List

### Types Layer

#### Task Group 1: GapReport Type Definitions
**Dependencies:** None
**Assigned Role:** Backend Engineer

- [x] 1.0 Complete GapReport types module
  - [x] 1.1 Write 4 focused tests for oasGaps types
    - Test GapSeverity type values ('BLOCKING', 'RECOMMENDED', 'INFO')
    - Test GapItem interface structure with all required fields
    - Test GapReport interface structure completeness
    - Test ComputeOasGapsRequest interface validation
  - [x] 1.2 Create `mcp-server/src/types/oasGaps.ts` with type definitions
    - Define `GapSeverity` type union
    - Define `GapLocation` interface (interfaceId, endpointId, method, path, paramName)
    - Define `GapItem` interface (code, severity, message, location?, suggestedQuestions?, data?)
    - Define `DefaultAssumption` interface (code, value, rationale)
    - Define `TypeMapping` interface (logicalType, oasSchema)
    - Define `OperationIdSuggestion` interface (endpointId, method?, path?, style, operationId)
    - Define `GapReport` interface (interfaceId, generatedAt, gaps, defaults, typeMappings, operationIds)
    - Define `ComputeOasGapsRequest` interface (sessionId, interfaceId, draftOas?)
  - [x] 1.3 Modify `mcp-server/src/types/index.ts` to re-export oasGaps types
    - Add export statement: `export * from './oasGaps';`
  - [x] 1.4 Ensure type definition tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Files to Create:**
- `mcp-server/src/types/oasGaps.ts`

**Files to Modify:**
- `mcp-server/src/types/index.ts`

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All types compile without TypeScript errors
- Types are exported from `mcp-server/src/types/index.ts`
- Type definitions match spec exactly

---

### Service Layer - Utilities

#### Task Group 2: Type Mapping Service
**Dependencies:** Task Group 1
**Assigned Role:** Backend Engineer

- [x] 2.0 Complete logical type to OAS mapping service
  - [x] 2.1 Write 6 focused tests for logicalTypeToOas service
    - Test `string` maps to `{ type: "string" }`
    - Test `string_uuid` maps to `{ type: "string", format: "uuid" }`
    - Test `integer_int64` maps to `{ type: "integer", format: "int64" }`
    - Test `number_double` maps to `{ type: "number", format: "double" }`
    - Test `boolean` maps to `{ type: "boolean" }`
    - Test unknown type returns `{ type: "string" }` and emits warning flag
  - [x] 2.2 Create `mcp-server/src/services/logicalTypeToOas.ts`
    - Create `LOGICAL_TYPE_MAPPINGS` constant dictionary with all 15 mappings:
      - `string`, `string_uuid`, `string_date`, `string_date-time`, `string_password`, `string_byte`, `string_binary`
      - `boolean`
      - `integer`, `integer_int32`, `integer_int64`
      - `number`, `number_float`, `number_double`
      - `array`, `object`
    - Create `mapLogicalTypeToOas(logicalType: string): { schema: Record<string, unknown>, isUnknown: boolean }` function
    - Handle case-insensitive matching
    - Return `{ type: "string" }` with `isUnknown: true` for unknown types
  - [x] 2.3 Create `mcp-server/src/__tests__/logicalTypeToOas.test.ts`
    - Implement the 6 tests defined in 2.1
    - Follow existing test patterns from `tools.test.ts`
  - [x] 2.4 Ensure type mapping tests pass
    - Run ONLY the 6 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Files to Create:**
- `mcp-server/src/services/logicalTypeToOas.ts`
- `mcp-server/src/__tests__/logicalTypeToOas.test.ts`

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- All 15 logical type mappings implemented correctly
- Unknown types handled gracefully with fallback to string
- Function is pure and stateless

---

#### Task Group 3: OperationId Generation Service
**Dependencies:** Task Group 1
**Assigned Role:** Backend Engineer

- [x] 3.0 Complete operationId generation service
  - [x] 3.1 Write 8 focused tests for operationId service
    - Test `GET /resources` produces `getResources` (camelCase) and `get_resources` (snake_case)
    - Test `GET /resources/{id}` produces `getResourcesById` and `get_resources_by_id`
    - Test `POST /users` produces `postUsers` and `post_users`
    - Test kebab-case path `/user-profiles` converts correctly
    - Test nested path `/api/v1/users/{id}/orders` produces correct operationIds
    - Test collision detection with two identical endpoints
    - Test collision suffix generation (`_2`, `_3` for snake_case; `2`, `3` for camelCase)
    - Test empty/missing verb or path returns null suggestion
  - [x] 3.2 Create `mcp-server/src/services/operationId.ts`
    - Create `normalizeVerb(verb: string | null | undefined): string | null` helper
    - Create `parsePathSegments(path: string): string[]` helper
      - Split by `/`, ignore empty segments
      - Convert `{param}` to `ByParam` (camelCase) or `by_param` (snake_case)
      - Handle kebab-case and snake_case segment conversion
    - Create `generateOperationId(verb: string, path: string, style: 'camelCase' | 'snake_case'): string` function
    - Create `generateOperationIdsWithCollisionHandling(endpoints: InterfaceEndpointDto[]): { suggestions: OperationIdSuggestion[], collisions: GapItem[] }` function
      - Generate both styles for each endpoint
      - Track used operationIds per style
      - Add suffixes for collisions
      - Emit `OPERATION_ID_COLLISION` gap items when collisions occur
  - [x] 3.3 Create `mcp-server/src/__tests__/operationId.test.ts`
    - Implement the 8 tests defined in 3.1
    - Follow existing test patterns from `tools.test.ts`
  - [x] 3.4 Ensure operationId tests pass
    - Run ONLY the 8 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Files to Create:**
- `mcp-server/src/services/operationId.ts`
- `mcp-server/src/__tests__/operationId.test.ts`

**Acceptance Criteria:**
- The 8 tests written in 3.1 pass
- Both camelCase and snake_case styles generated correctly
- Path parameter patterns handled correctly
- Collision detection and suffix generation works
- Function is pure and deterministic

---

### Service Layer - Core Computation

#### Task Group 4: Gap Computation Service
**Dependencies:** Task Groups 1, 2, 3
**Assigned Role:** Backend Engineer

- [x] 4.0 Complete gap computation service
  - [x] 4.1 Write 8 focused tests for computeOasGaps service
    - Test REST_API interface with GET endpoint produces correct gaps (SERVER_URL_MISSING, SECURITY_NOT_SPECIFIED, INFO_VERSION_DEFAULTED, RESPONSES_UNDEFINED)
    - Test defaults include DEFAULT_INFO_VERSION, DEFAULT_MEDIA_TYPE, SUGGESTED_SUCCESS_STATUS_BY_VERB
    - Test POST endpoint produces REQUEST_BODY_UNDEFINED gap
    - Test path with `{param}` produces PATH_PARAMS_NEED_SCHEMA gap with param list
    - Test endpoint missing operationVerb produces ENDPOINT_METHOD_MISSING gap
    - Test endpoint missing pathOrAddress produces ENDPOINT_PATH_MISSING gap
    - Test logical entity attributes are mapped to typeMappings array
    - Test determinism: same input produces exact same output
  - [x] 4.2 Create `mcp-server/src/services/computeOasGaps.ts`
    - Import types from `../types`
    - Import `mapLogicalTypeToOas` from `./logicalTypeToOas`
    - Import `generateOperationIdsWithCollisionHandling` from `./operationId`
    - Create `computeInterfaceGaps(context: InterfaceOasContextDto): GapItem[]` function
      - Always emit `SERVER_URL_MISSING` (BLOCKING)
      - Always emit `SECURITY_NOT_SPECIFIED` (RECOMMENDED)
      - Always emit `INFO_VERSION_DEFAULTED` (INFO)
      - For each endpoint with operationVerb AND pathOrAddress: emit `RESPONSES_UNDEFINED` (BLOCKING)
      - For POST/PUT/PATCH endpoints: emit `REQUEST_BODY_UNDEFINED` (BLOCKING)
      - For paths with `{param}`: emit `PATH_PARAMS_NEED_SCHEMA` (RECOMMENDED) with extracted param names
      - For endpoints missing operationVerb: emit `ENDPOINT_METHOD_MISSING` (BLOCKING)
      - For endpoints missing pathOrAddress: emit `ENDPOINT_PATH_MISSING` (BLOCKING)
    - Create `computeDefaults(context: InterfaceOasContextDto): DefaultAssumption[]` function
      - Always include `DEFAULT_INFO_VERSION` = "1.0.0"
      - Include `DEFAULT_MEDIA_TYPE` = "application/json" if REST_API or HTTP_REST
      - Always include `SUGGESTED_SUCCESS_STATUS_BY_VERB` with verb-to-status mapping
    - Create `computeTypeMappings(context: InterfaceOasContextDto): { mappings: TypeMapping[], unknownTypeGaps: GapItem[] }` function
      - Extract all unique logical types from logicalEntities.attributes.dataType
      - Map each to OAS schema using `mapLogicalTypeToOas`
      - Emit `UNKNOWN_LOGICAL_TYPE_MAPPING` gap for unknown types
    - Create main `computeOasGaps(context: InterfaceOasContextDto): GapReport` function
      - Orchestrate all computation functions
      - Generate ISO timestamp for `generatedAt`
      - Merge all gaps (interface gaps + type gaps + operationId collision gaps)
      - Return complete GapReport
  - [x] 4.3 Create `mcp-server/src/__tests__/computeOasGaps.test.ts`
    - Implement the 8 tests defined in 4.1
    - Create mock `InterfaceOasContextDto` fixtures for each test scenario
    - Follow existing test patterns from `tools.test.ts`
  - [x] 4.4 Ensure gap computation tests pass
    - Run ONLY the 8 tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Files to Create:**
- `mcp-server/src/services/computeOasGaps.ts`
- `mcp-server/src/__tests__/computeOasGaps.test.ts`

**Acceptance Criteria:**
- The 8 tests written in 4.1 pass
- All 10 gap codes implemented per spec
- All 3 default assumptions implemented
- Type mappings extracted and converted correctly
- OperationId suggestions generated with collision handling
- Computation is deterministic and stateless

---

### Route Layer

#### Task Group 5: Route Handler and Integration
**Dependencies:** Task Group 4
**Assigned Role:** Backend Engineer

- [x] 5.0 Complete route handler and integration
  - [x] 5.1 Write 6 focused tests for computeOasGapsRoute
    - Test valid request returns GapReport with correct structure
    - Test missing sessionId returns 400 Bad Request
    - Test missing interfaceId returns 400 Bad Request
    - Test interface not found (backend 404) returns 404 Not Found
    - Test backend 5xx returns 502 Bad Gateway
    - Test session is updated with lastSelectedInterfaceId
  - [x] 5.2 Create `mcp-server/src/routes/computeOasGapsRoute.ts`
    - Import Router from express
    - Import `archModelClient` from `../services/archModelClient`
    - Import `getOrCreateSession`, `updateSession` from `../services/sessionManager`
    - Import `createHttpError` from `../middleware/errorHandler`
    - Import `computeOasGaps` from `../services/computeOasGaps`
    - Import `ComputeOasGapsRequest` from `../types`
    - Create `computeOasGapsRouter` Router instance
    - Implement `POST /` handler:
      1. Validate sessionId (required, non-empty string) - 400 if invalid
      2. Validate interfaceId (required, non-empty string) - 400 if invalid
      3. Get or create session
      4. Fetch interface context via `archModelClient.getInterfaceOasContext(interfaceId)`
      5. Handle backend errors (404 passthrough, 5xx as 502)
      6. Call `computeOasGaps(context)` to generate GapReport
      7. Update session with `lastSelectedInterfaceId`
      8. Return GapReport as JSON response
    - Export `computeOasGapsRouter`
  - [x] 5.3 Modify `mcp-server/src/routes/tools.ts` to mount new route
    - Add import: `import { computeOasGapsRouter } from './computeOasGapsRoute';`
    - Add route mount: `toolsRouter.use('/compute_oas_gaps', computeOasGapsRouter);`
  - [x] 5.4 Create `mcp-server/src/__tests__/computeOasGapsRoute.test.ts`
    - Implement the 6 tests defined in 5.1
    - Mock `archModelClient` and `sessionManager`
    - Follow existing test patterns from `tools.test.ts`
  - [x] 5.5 Ensure route handler tests pass
    - Run ONLY the 6 tests written in 5.1
    - Do NOT run the entire test suite at this stage

**Files to Create:**
- `mcp-server/src/routes/computeOasGapsRoute.ts`
- `mcp-server/src/__tests__/computeOasGapsRoute.test.ts`

**Files to Modify:**
- `mcp-server/src/routes/tools.ts`

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Endpoint accessible at `POST /mcp/tools/compute_oas_gaps`
- Request validation returns correct error codes
- Backend error handling follows spec (404 passthrough, 5xx as 502)
- Session updated correctly
- Response format matches GapReport interface

---

### Testing

#### Task Group 6: Test Review and Integration Verification
**Dependencies:** Task Groups 1-5
**Assigned Role:** QA Engineer

- [x] 6.0 Review existing tests and verify integration
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 4 tests from Task Group 1 (types)
    - Review 20 tests from Task Group 2 (logicalTypeToOas)
    - Review 22 tests from Task Group 3 (operationId)
    - Review 29 tests from Task Group 4 (computeOasGaps)
    - Review 9 tests from Task Group 5 (route handler)
    - Total existing tests: 84 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identified need for end-to-end integration tests
    - Focus ONLY on gaps related to compute_oas_gaps feature
    - Prioritized end-to-end integration scenarios
  - [x] 6.3 Write up to 4 additional integration tests if needed
    - End-to-end test: complete request through response flow
    - Test with complex interface (multiple endpoints, multiple entities)
    - Test determinism with repeated calls
    - Test edge case: interface with no endpoints
  - [x] 6.4 Run all feature-specific tests
    - Run all tests from `mcp-server/src/__tests__/`:
      - `oasGaps.types.test.ts` (4 tests)
      - `logicalTypeToOas.test.ts` (20 tests)
      - `operationId.test.ts` (22 tests)
      - `computeOasGaps.test.ts` (29 tests)
      - `computeOasGapsRoute.test.ts` (9 tests)
      - `computeOasGaps.integration.test.ts` (4 tests)
    - Total: 88 tests
    - All tests pass
  - [x] 6.5 Perform manual verification
    - Verified TypeScript compilation with `npm run build`
    - Reviewed the test results

**Files Created:**
- `mcp-server/src/__tests__/computeOasGaps.integration.test.ts`

**Acceptance Criteria:**
- [x] All 88 feature-specific tests pass
- [x] Integration tests verify end-to-end functionality
- [x] No regressions in existing MCP server functionality

---

## Execution Order

**Recommended implementation sequence:**

```
Phase 1: Foundation
  Task Group 1: GapReport Type Definitions (no dependencies)

Phase 2: Utility Services (can be parallelized)
  Task Group 2: Type Mapping Service (depends on Group 1)
  Task Group 3: OperationId Generation Service (depends on Group 1)

Phase 3: Core Logic
  Task Group 4: Gap Computation Service (depends on Groups 1, 2, 3)

Phase 4: Integration
  Task Group 5: Route Handler and Integration (depends on Group 4)

Phase 5: Verification
  Task Group 6: Test Review and Integration Verification (depends on Groups 1-5)
```

---

## File Summary

### Files to Create (8 files)

| File Path | Task Group | Description |
|-----------|------------|-------------|
| `mcp-server/src/types/oasGaps.ts` | 1 | GapReport and related type definitions |
| `mcp-server/src/services/logicalTypeToOas.ts` | 2 | Static mapping dictionary for logical types to OAS schemas |
| `mcp-server/src/__tests__/logicalTypeToOas.test.ts` | 2 | Unit tests for type mapping |
| `mcp-server/src/services/operationId.ts` | 3 | OperationId generation with collision handling |
| `mcp-server/src/__tests__/operationId.test.ts` | 3 | Unit tests for operationId generation |
| `mcp-server/src/services/computeOasGaps.ts` | 4 | Main gap computation logic |
| `mcp-server/src/__tests__/computeOasGaps.test.ts` | 4 | Unit tests for gap computation |
| `mcp-server/src/routes/computeOasGapsRoute.ts` | 5 | Route handler for POST /mcp/tools/compute_oas_gaps |
| `mcp-server/src/__tests__/computeOasGapsRoute.test.ts` | 5 | Unit tests for route handler |

### Files to Modify (2 files)

| File Path | Task Group | Changes |
|-----------|------------|---------|
| `mcp-server/src/types/index.ts` | 1 | Re-export types from oasGaps.ts |
| `mcp-server/src/routes/tools.ts` | 5 | Import and mount computeOasGapsRoute |

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Gap rules too strict for edge cases | Medium | Low | Severity levels (BLOCKING/RECOMMENDED/INFO) allow flexibility |
| OperationId algorithm edge cases | Medium | Low | Comprehensive test cases in Task Group 3 |
| Unknown logical types in production | Low | Low | Fallback to string with warning gap emitted |
| Performance with large interfaces | Low | Low | Algorithm is O(n) for endpoints/attributes |
| Type definition mismatches | Low | Medium | Types defined first (Group 1), verified by subsequent groups |

---

## Verification Checklist

### Endpoint Verification
- [x] POST /mcp/tools/compute_oas_gaps accepts valid request and returns GapReport
- [x] Returns 400 for missing sessionId
- [x] Returns 400 for missing interfaceId
- [x] Returns 404 when interface not found
- [x] Returns 502 on backend failure

### Gap Detection Verification
- [x] Always emits SERVER_URL_MISSING (BLOCKING)
- [x] Always emits SECURITY_NOT_SPECIFIED (RECOMMENDED)
- [x] Always emits INFO_VERSION_DEFAULTED (INFO)
- [x] Emits RESPONSES_UNDEFINED for endpoints with method and path
- [x] Emits REQUEST_BODY_UNDEFINED for POST/PUT/PATCH endpoints
- [x] Emits PATH_PARAMS_NEED_SCHEMA when path contains {param}
- [x] Emits ENDPOINT_METHOD_MISSING/ENDPOINT_PATH_MISSING for incomplete endpoints
- [x] Emits UNKNOWN_LOGICAL_TYPE_MAPPING for unmapped types
- [x] Emits OPERATION_ID_COLLISION when duplicates occur

### Defaults Verification
- [x] Always includes DEFAULT_INFO_VERSION = "1.0.0"
- [x] Includes DEFAULT_MEDIA_TYPE = "application/json" when REST_API or HTTP_REST
- [x] Always includes SUGGESTED_SUCCESS_STATUS_BY_VERB

### Type Mappings Verification
- [x] All 15 logical types mapped correctly
- [x] Unknown types map to string with gap emitted

### OperationIds Verification
- [x] Both camelCase and snake_case suggestions for each endpoint
- [x] Collisions handled with suffixes
- [x] OPERATION_ID_COLLISION gap emitted when collisions occur

### Determinism Verification
- [x] Same InterfaceOasContextDto always produces same GapReport
