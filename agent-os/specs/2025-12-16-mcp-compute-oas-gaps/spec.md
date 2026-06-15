# Spec: MCP Server - Compute OAS Gaps Tool

## Overview

Add a new MCP tool `compute_oas_gaps` that deterministically produces a GapReport (gaps + defaults + type mappings + operationId suggestions) for a given interface. This is an MCP-server-only change that relies on the existing `GET /api/model/interfaces/{id}` endpoint for InterfaceOasContext.

## Problem Statement

### Current State
- MCP server has `list_interfaces` and `get_interface_oas_context` tools
- Chat assistants can retrieve interface metadata but have no structured analysis of what's missing for OAS generation
- LLMs must guess what information is needed to generate valid OpenAPI specs

### Desired State
- Chat assistants can call `compute_oas_gaps` to get a structured, deterministic report of:
  - Missing/incomplete data that blocks or hinders OAS generation
  - Default values the system will assume
  - Logical type → OAS schema mappings for all attributes
  - Suggested operationIds in both camelCase and snake_case styles
- This enables LLMs to ask targeted questions and make informed decisions

## Solution

Add a new MCP tool endpoint that:
1. Fetches interface context from architecture-model-service
2. Analyzes the context deterministically to produce gaps, defaults, type mappings, and operationId suggestions
3. Returns a structured GapReport for LLM consumption

## Requirements

### Functional Requirements

#### New MCP Tool Endpoint

**POST /mcp/tools/compute_oas_gaps**

| Aspect | Specification |
|--------|---------------|
| Request Body | `{ sessionId: string, interfaceId: string, draftOas?: string }` |
| Response | `GapReport` (see Data Types below) |
| Session Effect | Stores `lastSelectedInterfaceId` in session |
| Validation | sessionId required, interfaceId required, draftOas optional (ignored for v1) |

**Error Handling:**

| Condition | Response |
|-----------|----------|
| sessionId missing/blank | 400 Bad Request |
| interfaceId missing/blank | 400 Bad Request |
| Interface not found (backend 404) | 404 Not Found |
| Backend 4xx | Pass through status and message |
| Backend 5xx or network failure | 502 Bad Gateway |

#### Gap Rules (Deterministic)

The gap computation must be deterministic and stateless - given the same InterfaceOasContextDto, it always produces the same GapReport.

**Gap Categories:**

| Code | Severity | Condition | Message |
|------|----------|-----------|---------|
| `SERVER_URL_MISSING` | BLOCKING | Always (no server URL in model) | No server base URL is specified for this API. |
| `SECURITY_NOT_SPECIFIED` | RECOMMENDED | Always (no security in model) | No authentication/security scheme is specified. |
| `INFO_VERSION_DEFAULTED` | INFO | Always (interface has no version field) | Interface has no explicit version; a default will be used. |
| `RESPONSES_UNDEFINED` | BLOCKING | Endpoint has operationVerb AND pathOrAddress | Response status codes and response schema are not specified. |
| `REQUEST_BODY_UNDEFINED` | BLOCKING | Endpoint verb is POST/PUT/PATCH | Request body schema is not specified for a write operation. |
| `PATH_PARAMS_NEED_SCHEMA` | RECOMMENDED | Path contains `{param}` patterns | Path parameters are present but types/formats are not specified. |
| `ENDPOINT_METHOD_MISSING` | BLOCKING | operationVerb is missing/blank | HTTP method is not specified for this endpoint. |
| `ENDPOINT_PATH_MISSING` | BLOCKING | pathOrAddress is missing/blank | Path/address is not specified for this endpoint. |
| `UNKNOWN_LOGICAL_TYPE_MAPPING` | RECOMMENDED | Logical type not in mapping dictionary | Logical type has no explicit mapping; defaulting to string. |
| `OPERATION_ID_COLLISION` | INFO | Multiple endpoints produce same operationId | Multiple operations produced the same operationId; suffixes were added. |

#### Default Assumptions

Always include these defaults:

| Code | Value | Rationale |
|------|-------|-----------|
| `DEFAULT_INFO_VERSION` | `"1.0.0"` | OpenAPI requires info.version; interface does not provide one. |
| `DEFAULT_MEDIA_TYPE` | `"application/json"` | Assume JSON for REST/HTTP endpoints unless specified otherwise. (Only if interfaceType is REST_API or any endpoint is HTTP_REST) |
| `SUGGESTED_SUCCESS_STATUS_BY_VERB` | `{ GET: 200, POST: 201, PUT: 200, PATCH: 200, DELETE: 204 }` | Common REST conventions; confirm per endpoint. |

#### Type Mappings

Map all logical data types found in the interface's logical entities to OAS schemas:

| Logical Type | OAS Schema |
|--------------|------------|
| `string` | `{ type: "string" }` |
| `string_uuid` | `{ type: "string", format: "uuid" }` |
| `string_date` | `{ type: "string", format: "date" }` |
| `string_date-time` | `{ type: "string", format: "date-time" }` |
| `string_password` | `{ type: "string", format: "password" }` |
| `string_byte` | `{ type: "string", format: "byte" }` |
| `string_binary` | `{ type: "string", format: "binary" }` |
| `boolean` | `{ type: "boolean" }` |
| `integer` | `{ type: "integer" }` |
| `integer_int32` | `{ type: "integer", format: "int32" }` |
| `integer_int64` | `{ type: "integer", format: "int64" }` |
| `number` | `{ type: "number" }` |
| `number_float` | `{ type: "number", format: "float" }` |
| `number_double` | `{ type: "number", format: "double" }` |
| `array` | `{ type: "array" }` |
| `object` | `{ type: "object" }` |
| Unknown | `{ type: "string" }` + emit `UNKNOWN_LOGICAL_TYPE_MAPPING` gap |

#### OperationId Suggestions

Generate operationId suggestions in both styles for each endpoint:

**Algorithm:**
1. Normalize operationVerb to lowercase (e.g., `GET` → `get`)
2. Parse pathOrAddress segments:
   - Split by `/`
   - Ignore empty segments
   - Replace `{param}` with `ByParam` (camelCase) or `by_param` (snake_case)
   - Convert kebab-case/snake_case segments to words
3. Generate both styles:
   - camelCase: `verb` + PascalCase(words) → `getResourcesById`
   - snake_case: `verb` + `_` + words → `get_resources_by_id`

**Collision Handling:**
- If duplicates occur within same interface (same style), append suffix: `_2`, `_3` (snake_case) or `2`, `3` (camelCase)
- Emit INFO gap `OPERATION_ID_COLLISION` with details

### Non-Functional Requirements

1. **Deterministic**: Same input always produces same output
2. **Stateless computation**: `computeOasGaps()` function must not call external services
3. **No side effects**: Gap computation does not modify any state

## Technical Design

### Data Types

Create new types file: `mcp-server/src/types/oasGaps.ts`

```typescript
export type GapSeverity = 'BLOCKING' | 'RECOMMENDED' | 'INFO';

export interface GapLocation {
  interfaceId?: string;
  endpointId?: string;
  method?: string;
  path?: string;
  paramName?: string;
}

export interface GapItem {
  code: string;
  severity: GapSeverity;
  message: string;
  location?: GapLocation;
  suggestedQuestions?: string[];
  data?: Record<string, unknown>;
}

export interface DefaultAssumption {
  code: string;
  value: unknown;
  rationale: string;
}

export interface TypeMapping {
  logicalType: string;
  oasSchema: Record<string, unknown>;
}

export interface OperationIdSuggestion {
  endpointId: string;
  method?: string;
  path?: string;
  style: 'camelCase' | 'snake_case';
  operationId: string;
}

export interface GapReport {
  interfaceId: string;
  generatedAt: string;
  gaps: GapItem[];
  defaults: DefaultAssumption[];
  typeMappings: TypeMapping[];
  operationIds: OperationIdSuggestion[];
}

export interface ComputeOasGapsRequest {
  sessionId: string;
  interfaceId: string;
  draftOas?: string;
}
```

### Files to Create

| File | Description |
|------|-------------|
| `mcp-server/src/types/oasGaps.ts` | GapReport and related type definitions |
| `mcp-server/src/services/logicalTypeToOas.ts` | Static mapping dictionary for logical types → OAS schemas |
| `mcp-server/src/services/operationId.ts` | OperationId generation with collision handling |
| `mcp-server/src/services/computeOasGaps.ts` | Main gap computation logic |
| `mcp-server/src/routes/computeOasGapsRoute.ts` | Route handler for POST /mcp/tools/compute_oas_gaps |
| `mcp-server/src/__tests__/computeOasGaps.test.ts` | Unit tests for gap computation |
| `mcp-server/src/__tests__/operationId.test.ts` | Unit tests for operationId generation |
| `mcp-server/src/__tests__/logicalTypeToOas.test.ts` | Unit tests for type mapping |

### Files to Modify

| File | Changes |
|------|---------|
| `mcp-server/src/routes/tools.ts` | Import and mount computeOasGapsRoute |
| `mcp-server/src/types/index.ts` | Re-export types from oasGaps.ts |
| `mcp-server/README.md` | Add documentation for compute_oas_gaps tool |

### Module Structure

```
mcp-server/src/
├── types/
│   ├── index.ts              # (modify) Re-export oasGaps types
│   └── oasGaps.ts            # (new) GapReport types
├── services/
│   ├── archModelClient.ts    # (existing) HTTP client
│   ├── sessionManager.ts     # (existing) Session management
│   ├── logicalTypeToOas.ts   # (new) Type mapping dictionary
│   ├── operationId.ts        # (new) OperationId generation
│   └── computeOasGaps.ts     # (new) Main gap computation
├── routes/
│   ├── tools.ts              # (modify) Mount new route
│   └── computeOasGapsRoute.ts# (new) Route handler
└── __tests__/
    ├── computeOasGaps.test.ts# (new) Gap computation tests
    ├── operationId.test.ts   # (new) OperationId tests
    └── logicalTypeToOas.test.ts # (new) Type mapping tests
```

### Computation Flow

```
POST /mcp/tools/compute_oas_gaps
        │
        ▼
┌─────────────────────────┐
│  Validate Request       │
│  - sessionId required   │
│  - interfaceId required │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Get/Create Session     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Fetch Interface Context│
│  GET /api/model/        │
│  interfaces/{id}        │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  computeOasGaps()       │
│  (deterministic)        │
│  - Compute gaps         │
│  - Generate defaults    │
│  - Map types            │
│  - Suggest operationIds │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Update Session         │
│  - lastSelectedInterface│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Return GapReport       │
└─────────────────────────┘
```

## Out of Scope

- OpenAPI generation (LLM will do that using the GapReport)
- Full OpenAPI validation engine
- Gateway/OpenAI integration
- Persistence of GapReports
- Changes to architecture-model-service
- Changes to frontend or database

## Acceptance Criteria

1. **Endpoint Works:**
   - POST /mcp/tools/compute_oas_gaps accepts valid request and returns GapReport
   - Returns 400 for missing sessionId or interfaceId
   - Returns 404 when interface not found
   - Returns 502 on backend failure

2. **Gap Detection:**
   - Always emits SERVER_URL_MISSING (BLOCKING)
   - Always emits SECURITY_NOT_SPECIFIED (RECOMMENDED)
   - Always emits INFO_VERSION_DEFAULTED (INFO)
   - Emits RESPONSES_UNDEFINED for endpoints with method and path
   - Emits REQUEST_BODY_UNDEFINED for POST/PUT/PATCH endpoints
   - Emits PATH_PARAMS_NEED_SCHEMA when path contains {param}
   - Emits ENDPOINT_METHOD_MISSING/ENDPOINT_PATH_MISSING for incomplete endpoints

3. **Defaults:**
   - Always includes DEFAULT_INFO_VERSION = "1.0.0"
   - Includes DEFAULT_MEDIA_TYPE = "application/json" when REST_API or HTTP_REST
   - Always includes SUGGESTED_SUCCESS_STATUS_BY_VERB

4. **Type Mappings:**
   - All logical types in interface attributes are mapped
   - Unknown types map to string and emit UNKNOWN_LOGICAL_TYPE_MAPPING gap

5. **OperationIds:**
   - Both camelCase and snake_case suggestions for each endpoint
   - Collisions handled with suffixes
   - OPERATION_ID_COLLISION gap emitted when collisions occur

6. **Determinism:**
   - Same InterfaceOasContextDto always produces same GapReport

## Verification Steps

### Unit Tests

1. **computeOasGaps.test.ts:**
   - Test with REST_API interface, 1 endpoint (GET /resources), 2 logical entities
   - Assert gaps include: SERVER_URL_MISSING, RESPONSES_UNDEFINED, SECURITY_NOT_SPECIFIED, INFO_VERSION_DEFAULTED
   - Assert defaults include: DEFAULT_INFO_VERSION, DEFAULT_MEDIA_TYPE, SUGGESTED_SUCCESS_STATUS_BY_VERB
   - Assert typeMappings include string_uuid mapping
   - Assert operationIds include getResources and get_resources

2. **Test with path params:**
   - Endpoint path "/resources/{id}"
   - Assert PATH_PARAMS_NEED_SCHEMA emitted with params ["id"]
   - Assert operationIds: getResourcesById, get_resources_by_id

3. **Test collision handling:**
   - Two endpoints that produce same operationId
   - Assert OPERATION_ID_COLLISION gap emitted
   - Assert suffixes added

4. **operationId.test.ts:**
   - Test various path patterns
   - Test collision detection and suffix generation

5. **logicalTypeToOas.test.ts:**
   - Test all known type mappings
   - Test unknown type fallback

### Manual Verification

1. Start backend and MCP server
2. Call list_interfaces to get an interface ID
3. Call compute_oas_gaps with that interface ID
4. Verify GapReport structure and content

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Gap rules too strict | Medium | Low | Severity levels allow flexibility |
| OperationId algorithm edge cases | Medium | Low | Comprehensive test cases |
| Unknown logical types | Low | Low | Fallback to string with warning gap |
| Performance with large interfaces | Low | Low | Algorithm is O(n) for endpoints/attributes |
