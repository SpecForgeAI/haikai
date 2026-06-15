# Raw Idea

## Title
SA Increment 4 – MCP Tool: save_architecture_baseline (Meta-Model Only, No Diagrams)

## Description
Introduce an MCP tool that persists an initial architecture baseline into architecture-model-service by creating meta-model entities and relationships across domains. This increment writes ONLY meta-model data. It does NOT create diagrams, layout, or modify existing entities.

## Key Scope
- New MCP tool `save_architecture_baseline` registered in mcp-server
- Tool writes services, interfaces, data entities, business logic, and relationships
- Creation of `data_movements` as part of the baseline
- Adherence to TECH-STACK naming conventions (snake_case entity names, camelCase JSON fields, etc.)
- Blind save semantics: creates new entities only, no overwrite/merge with existing data

## Excludes
- Diagram creation, layout, or any visual rendering
- Deletion or modification of existing entities
- Architecture diff/merge logic
- Retrieval of existing architecture data
- Versioning of architecture baselines
- UI changes of any kind

## Systems
- **Primary**: mcp-server (tool implementation lives here)
- **Dependency**: architecture-model-service (persistence target for all entity writes)
- **Gateway**: tool registration only (add to ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, map to mcp-server endpoint; no automatic invocation)

## MCP Tool Definition

### Tool Name
`save_architecture_baseline`

### Request Schema
The tool accepts a single JSON argument containing:
- `projectId` (string, required) - target project for the baseline
- `architectureBaselineJson` (object, required) - the architecture baseline payload

### architectureBaselineJson Shape
The baseline object contains arrays for each entity domain:

- `services[]` - application-layer services with name, description, coreTech, etc.
- `interfaces[]` - interface definitions with name, description, protocol, direction, etc.
- `interfaceEndpoints[]` - endpoints belonging to interfaces with httpMethod, path, requestDataEntity, responseDataEntity, etc.
- `logicalDataEntities[]` - logical data model entities with name, description, attributes[]
- `physicalDataEntities[]` - physical data model entities with name, description, logicalDataEntityRef, attributes[]
- `businessLogic[]` - business logic items with name, description, type, ownerServiceRef, etc.
- `relationships[]` - cross-entity relationships with sourceType, sourceRef, targetType, targetRef, relationshipType
- `dataMovements[]` - data movement definitions with name, sourceServiceRef, targetServiceRef, interfaceRef, dataEntityRefs[], direction, etc.

### Validation Rules
- All `*Ref` fields must resolve to an entity defined within the same baseline payload (intra-payload referential integrity)
- Required fields: each entity type has specific required fields (e.g., service requires name)
- No duplicate names within the same entity type array
- Entity names must follow TECH-STACK naming conventions
- `projectId` must be a valid, existing project in architecture-model-service

### Tool Behavior Steps
1. Receive and parse the `architectureBaselineJson` payload
2. Validate intra-payload referential integrity (all refs resolve within the payload)
3. Validate required fields and naming conventions
4. Create entities in dependency order: logicalDataEntities -> physicalDataEntities -> services -> interfaces -> interfaceEndpoints -> businessLogic -> dataMovements -> relationships
5. Map each entity to the appropriate architecture-model-service API endpoint
6. Execute POST calls to architecture-model-service for each entity
7. Collect results (created entity IDs) and return summary response
8. On any creation failure, report the failure but continue with remaining entities (partial success allowed)

### Naming Rules
- Entity `name` fields: follow existing TECH-STACK conventions (typically descriptive, human-readable names)
- JSON field names in the request: camelCase
- API endpoint paths to architecture-model-service: follow existing REST conventions in that service

### Error Handling
- Validation errors: return immediately with detailed validation failure messages before any writes
- Individual entity creation failures: log error, skip entity, continue with remaining entities
- Partial success: response includes both successfully created entities and failed entities with error reasons
- Network/service unavailability: fail fast with service unavailable error

### Response Shape
```json
{
  "success": true|false,
  "summary": {
    "totalEntities": <number>,
    "created": <number>,
    "failed": <number>
  },
  "created": {
    "services": [{ "name": "...", "id": "..." }],
    "interfaces": [{ "name": "...", "id": "..." }],
    "interfaceEndpoints": [{ "name": "...", "id": "..." }],
    "logicalDataEntities": [{ "name": "...", "id": "..." }],
    "physicalDataEntities": [{ "name": "...", "id": "..." }],
    "businessLogic": [{ "name": "...", "id": "..." }],
    "relationships": [{ "name": "...", "id": "..." }],
    "dataMovements": [{ "name": "...", "id": "..." }]
  },
  "errors": [
    { "entityType": "...", "entityName": "...", "error": "..." }
  ]
}
```

## Gateway Changes
- Add `save_architecture_baseline` to `ALLOWED_TOOL_NAMES` list
- Add tool definition to `TOOL_DEFINITIONS` with input schema
- Map tool invocation to mcp-server endpoint
- No automatic invocation: tool is only called when the LLM explicitly requests it

## Non-Functional Requirements
- Tool execution should complete within a reasonable timeout (e.g., 30 seconds for typical baseline sizes)
- Logging: all entity creation attempts should be logged at INFO level, failures at ERROR level
- Idempotency: not required for this increment (blind save, no merge)
- Payload size: support baselines with up to ~100 entities across all types

## Acceptance Criteria
- MCP tool `save_architecture_baseline` is registered and callable via the gateway
- Tool accepts a well-formed `architectureBaselineJson` and creates all specified entity types in architecture-model-service
- Intra-payload referential integrity is validated before any writes
- Entity creation follows dependency order
- Partial failures are handled gracefully with detailed error reporting
- Response includes summary of created and failed entities
- No diagrams, layouts, or visual elements are created
- No existing entities are modified or deleted
- Gateway correctly routes tool calls to mcp-server
- TECH-STACK naming conventions are enforced
