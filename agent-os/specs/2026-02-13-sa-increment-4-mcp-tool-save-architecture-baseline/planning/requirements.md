# Spec Requirements: SA Increment 4 -- MCP Tool: save_architecture_baseline

## Initial Description

Introduce an MCP tool that persists an initial architecture baseline into architecture-model-service by creating meta-model entities and relationships across domains. This increment writes ONLY meta-model data. It does NOT create diagrams, layout, or modify existing entities.

### Key Scope from Raw Idea
- New MCP tool `save_architecture_baseline` registered in mcp-server
- Tool writes services, interfaces, data entities, business logic, and relationships
- Creation of `data_movements` as part of the baseline
- Adherence to TECH-STACK naming conventions (camelCase JSON fields)
- Save semantics refined via Q&A: GET-merge-PUT (preserve existing entities, append new ones)

### Excludes (from Raw Idea)
- Diagram creation, layout, or any visual rendering
- Deletion or modification of existing entities
- Architecture diff/merge logic
- Retrieval of existing architecture data
- Versioning of architecture baselines
- UI changes of any kind

### Systems (from Raw Idea)
- **Primary**: mcp-server (tool implementation lives here)
- **Dependency**: architecture-model-service (persistence target for all entity writes)
- **Gateway**: tool registration only (add to ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, map to mcp-server endpoint; no automatic invocation)

---

## Requirements Discussion

### First Round Questions

**Q1: Full-model save vs. per-entity POST endpoints**
Context: The architecture-model-service uses `PUT /api/model?filename=...` with a full `ArchitectureModelDto` (truncate-and-insert semantics). The question was whether to use this full-model PUT or individual per-entity POST endpoints.
**Answer:** Use (a): GET /api/model?filename=... then merge-by-append (preserve existing), then PUT full ArchitectureModelDto back; do NOT refuse/overwrite-wipe in v0.1 (blind save = no "are you sure" gate, but we still preserve existing by merging).

**Q2: Project-to-model-file mapping**
Context: The PUT endpoint requires a filename query parameter. The question was how to determine which model file to write to.
**Answer:** Look up the Project by projectId to obtain project name and use that as the model filename; do not require filename passed from caller.

**Q3: Application Points and Data Entity Points**
Context: The architecture-model-service expects `application_points` and `data_entity_points` arrays in the model. The question was whether callers must provide these or they should be auto-generated.
**Answer:** Yes -- auto-generate application_points and data_entity_points deterministically using the same internal rules the model-service expects (do not require them in payload).

**Q4: Scope of entity types**
Context: Services need to be associated with Applications and AppComponents in the meta-model. The question was whether to require these in the payload or handle them automatically.
**Answer:** Create minimal placeholder Application + AppComponent (e.g., "Core Application", "Core Component") and associate new Services to them, unless the DTO supports nulls (prefer explicit minimal records for stability).

**Q5: ID generation strategy**
Context: Each entity in the model needs a unique ID with specific prefixes. The question was who generates IDs.
**Answer:** Tool generates all IDs internally (caller provides names/refs only).

**Q6: Ref resolution -- name-based vs. ID-based**
Context: Entities in the payload reference each other (e.g., dataMovements reference services). The question was how these cross-references work.
**Answer:** Use name-based refs in payload and resolve internally to generated IDs (no temp IDs needed).

**Q7: Relationship types**
Context: The meta-model supports many relationship types. The question was which to support in v0.1.
**Answer:** Limit to a subset for v0.1: data_movements, interface_logical_entities, logical_data_entity_physical_data_entities, and (optionally) application_point_business_logics if you're persisting business logic associations.

**Q8: Logical-to-physical data entity mapping**
Context: Physical data entities can be mapped to logical data entities. The question was how to express this in the payload.
**Answer:** Yes -- accept logicalDataEntityRef on physical entities (or explicit mapping list) and create logical_data_entity_physical_data_entities records.

**Q9: Data attributes -- included or excluded?**
Context: Logical and physical data entities can have attributes. The question was whether to support attributes in v0.1.
**Answer:** Exclude attributes in v0.1 (no logical_data_attributes / physical_data_attributes yet).

**Q10: TECH-STACK naming convention enforcement**
Context: The raw idea mentioned enforcing naming conventions on entity names. The question was how strict to be.
**Answer:** Best-effort validation only: non-empty names, no duplicates within each type; do NOT transform names (no snake_case enforcement); JSON stays camelCase.

**Q11: Error handling -- validation-first then atomic save?**
Context: The raw idea mentioned partial success handling. The question was whether to validate everything first or allow partial saves.
**Answer:** Yes -- validate -> construct merged DTO -> single PUT call is acceptable (no per-entity partial success needed).

**Q12: Gateway registration pattern**
Context: The tool needs to be registered in the gateway for LLM invocation. The question was about the registration approach.
**Answer:** Yes -- follow the existing gateway registration patterns; in the OpenAI tool definition, keep architectureBaselineJson as a single string param with a clear description (no need to fully enumerate schema in the tool definition for v0.1).

---

### Existing Code to Reference

The following files and patterns were identified during codebase research and should be referenced by the spec-writer:

**MCP Server -- Closest Existing Tool Pattern:**
- `mcp-server/src/routes/saveProductArtifactsRoute.ts` -- closest existing tool implementation pattern to follow for the new save_architecture_baseline route

**Architecture Model Service Client:**
- `mcp-server/src/services/archModelClient.ts` -- existing HTTP client for communicating with architecture-model-service; provides GET and PUT for model files

**Gateway Tool Registration (all in gateway service):**
- `gateway/src/types/tools.ts` -- contains `ALLOWED_TOOL_NAMES`, `TOOL_DEFINITIONS`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`
- `gateway/src/services/toolExecutor.ts` -- tool execution dispatch logic

**Architecture Model Service -- Key Backend References:**
- `PUT /api/model?filename=...` -- full model save endpoint (truncate-and-insert)
- `GET /api/model?filename=...` -- full model read endpoint (returns ArchitectureModelDto)
- `DataEntityPointEnsureService` -- service that auto-generates data_entity_points; reference for understanding the auto-generation pattern
- `MetaModelEntitiesDto` -- the DTO structure for meta-model entities within ArchitectureModelDto
- `example_project_payload.json` -- reference file showing the full shape of an architecture model payload

**Entity ID Prefix Conventions:**
- Services: `svc-`
- Interfaces: `ifc-`
- Interface Endpoints: `ep-`
- Physical Data Entities: `pde-`
- Logical Data Entities: `lde-`
- Applications: `app-`
- App Components: `comp-`
- Business Logic: (prefix to be confirmed from codebase)
- Data Movements: (prefix to be confirmed from codebase)

**Auto-Generated Point Patterns:**
- Application Points: `ap_{entityId}` pattern (e.g., `ap_svc-xxx`)
- Data Entity Points (logical): `dep_log_{entityId}` pattern
- Data Entity Points (physical): `dep_phy_{entityId}` pattern

---

### Follow-up Questions

No follow-up questions were asked. All 12 questions were answered comprehensively in the first round.

---

## Visual Assets

### Files Provided:
No visual assets provided. The `planning/visuals/` folder exists but is empty.

### Visual Insights:
Not applicable -- no visual assets were submitted.

---

## Requirements Summary

### Functional Requirements

1. **MCP Tool Registration**: Register `save_architecture_baseline` as a new MCP tool in mcp-server with a corresponding route handler, following the pattern of `saveProductArtifactsRoute.ts`.

2. **Gateway Registration**: Add the tool to `ALLOWED_TOOL_NAMES`, `TOOL_DEFINITIONS`, `TOOL_ENDPOINTS`, and `TOOL_REQUIRED_PARAMS` in the gateway. The `architectureBaselineJson` parameter should be a single string param in the OpenAI tool definition with a descriptive explanation (no full schema enumeration).

3. **Input Payload**: The tool accepts:
   - `projectId` (string, required) -- used to look up the Project and derive the model filename
   - `architectureBaselineJson` (string, required) -- JSON string containing the architecture baseline with arrays for:
     - `services[]` -- name, description, coreTech, etc.
     - `interfaces[]` -- name, description, protocol, direction, etc.
     - `interfaceEndpoints[]` -- httpMethod, path, requestDataEntity, responseDataEntity, interfaceRef, etc.
     - `logicalDataEntities[]` -- name, description (no attributes in v0.1)
     - `physicalDataEntities[]` -- name, description, logicalDataEntityRef (no attributes in v0.1)
     - `businessLogic[]` -- name, description, type, ownerServiceRef, etc.
     - `dataMovements[]` -- name, sourceServiceRef, targetServiceRef, interfaceRef, dataEntityRefs[], direction, etc.

4. **Project Lookup**: Look up the Project by `projectId` to obtain the project name, then use the project name as the model filename for the GET/PUT calls.

5. **ID Generation**: The tool generates all entity IDs internally using the established prefix conventions (svc-, ifc-, ep-, pde-, lde-, app-, comp-, etc.). Callers provide human-readable names only.

6. **Name-Based Ref Resolution**: All `*Ref` fields in the payload use entity names (not IDs). The tool resolves these to generated IDs internally.

7. **Auto-Generated Points**:
   - Generate `application_points` for each service/component using `ap_{entityId}` pattern
   - Generate `data_entity_points` for logical entities using `dep_log_{entityId}` pattern
   - Generate `data_entity_points` for physical entities using `dep_phy_{entityId}` pattern

8. **Placeholder Application and Component**: Create a minimal placeholder Application (e.g., "Core Application") and AppComponent (e.g., "Core Component") and associate new Services with them, ensuring structural stability in the model.

9. **GET-Merge-PUT Save Strategy**:
   - GET the existing model via `GET /api/model?filename=...`
   - Merge new entities by appending to existing arrays (preserve all existing entities)
   - PUT the full merged `ArchitectureModelDto` back via `PUT /api/model?filename=...`
   - No overwrite-wipe; no "are you sure" confirmation gate

10. **Relationship Types (v0.1 Subset)**:
    - `data_movements` (explicit entity in payload)
    - `interface_logical_entities` (auto-generated from interface/endpoint data entity refs)
    - `logical_data_entity_physical_data_entities` (from `logicalDataEntityRef` on physical entities)
    - `application_point_business_logics` (optional, if business logic associations are present)

11. **Logical-to-Physical Mapping**: Accept `logicalDataEntityRef` on physical data entities and auto-create `logical_data_entity_physical_data_entities` relationship records.

12. **Validation (Pre-Save)**:
    - Non-empty names for all entities
    - No duplicate names within each entity type
    - All `*Ref` fields resolve to an entity defined within the same payload
    - Do NOT transform names (no snake_case enforcement)
    - JSON field names remain camelCase
    - Validation runs first; if any errors, return them all before attempting save

13. **Atomic Save**: After successful validation, construct the merged DTO and issue a single PUT call. No per-entity partial success handling needed.

14. **Response Shape**: Return a summary indicating success/failure, counts of entities created, and details of any errors encountered.

### Reusability Opportunities

- **saveProductArtifactsRoute.ts**: Direct pattern to follow for route structure, request parsing, and response formatting
- **archModelClient.ts**: Existing client with GET/PUT methods for architecture-model-service communication; extend or reuse directly
- **Gateway tool registration**: Existing constants and patterns in `gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts` to follow exactly
- **DataEntityPointEnsureService**: Reference for understanding how data_entity_points are auto-generated in the backend (mirror logic in mcp-server or rely on backend if it runs automatically on PUT)
- **example_project_payload.json**: Reference for the full ArchitectureModelDto shape to ensure the merged payload is structurally correct

### Scope Boundaries

**In Scope:**
- New MCP tool `save_architecture_baseline` in mcp-server
- Route handler following saveProductArtifactsRoute pattern
- Gateway registration (ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS)
- GET-merge-PUT save strategy against architecture-model-service
- Project lookup by projectId to derive filename
- Internal ID generation with established prefix conventions
- Name-based ref resolution within payload
- Auto-generation of application_points and data_entity_points
- Placeholder Application + AppComponent creation
- Validation: non-empty names, no duplicates, ref integrity
- Relationship subset: data_movements, interface_logical_entities, logical_data_entity_physical_data_entities, application_point_business_logics
- Logical-to-physical data entity mapping via logicalDataEntityRef
- Entity types: services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, businessLogic, dataMovements

**Out of Scope:**
- Data attributes (logical_data_attributes / physical_data_attributes) -- excluded from v0.1
- Diagram creation, layout, or any visual rendering
- Deletion or modification of existing entities
- Architecture diff/merge conflict detection
- Retrieval/query of existing architecture data (beyond the GET needed for merge)
- Versioning of architecture baselines
- UI changes of any kind
- Full schema enumeration in the OpenAI tool definition
- Name transformation / snake_case enforcement
- Per-entity partial success handling (atomic single PUT instead)
- Relationship types beyond the v0.1 subset

### Technical Considerations

- **Save Strategy**: The architecture-model-service PUT endpoint uses truncate-and-insert semantics. To preserve existing data, the tool MUST first GET the current model, merge new entities by appending, then PUT the full merged model back.
- **archModelClient.ts**: Already provides the HTTP client for GET/PUT against architecture-model-service. The tool should use or extend this client.
- **ArchitectureModelDto / MetaModelEntitiesDto**: The merged payload must conform to these DTO structures. Reference `example_project_payload.json` for the full shape.
- **DataEntityPointEnsureService**: The backend may auto-generate data_entity_points on save. Investigate whether the mcp-server needs to generate these explicitly or if the backend handles it. If the backend handles it, the tool only needs to generate application_points.
- **Entity ID Prefixes**: Must follow established conventions (svc-, ifc-, ep-, pde-, lde-, app-, comp-). Confirm business logic and data movement prefixes from codebase.
- **Point ID Patterns**: application_points use `ap_{entityId}`, data_entity_points use `dep_log_{entityId}` and `dep_phy_{entityId}`.
- **Tool Definition**: In the gateway OpenAI tool definition, `architectureBaselineJson` is a single string parameter with a descriptive explanation. The LLM constructs the JSON string; the tool parses and validates it.
- **Project Lookup**: Need to confirm which API endpoint or method resolves projectId to project name for filename derivation.

### Files Expected to Change

**mcp-server (new + modified):**
- New: `mcp-server/src/routes/saveArchitectureBaselineRoute.ts` -- new route handler
- New: `mcp-server/src/services/architectureBaselineService.ts` (or similar) -- business logic for validation, ID generation, ref resolution, merge, and save
- Modified: `mcp-server/src/services/archModelClient.ts` -- may need extensions for GET model support if not already present
- Modified: Route registration file (wherever routes are wired up in mcp-server)

**gateway (modified):**
- Modified: `gateway/src/types/tools.ts` -- add to ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS
- Modified: `gateway/src/services/toolExecutor.ts` -- if any tool-specific dispatch logic is needed (may not be needed if pattern-based)

**Tests:**
- New: Tests for the route handler
- New: Tests for the baseline service (validation, ID generation, ref resolution, merge logic)
