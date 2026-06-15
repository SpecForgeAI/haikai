# Specification: Context Bundles Backend Expansion

## Goal

Implement backend bundle expansion logic that transforms context bundle selections (entity_type + entity_id + bundle_type) into an expanded, de-duplicated set of related entities/diagrams, then resolves them into human-readable context for injection into the Planner LLM prompt.

## User Stories

- As a developer, I want the system to automatically expand my interface selection to include its endpoints and schemas so that the LLM understands the full interface contract.
- As a developer, I want service selections to include their parent application/component and child interfaces so that the LLM sees the service hierarchy.

## Specific Requirements

**New expand-resolve endpoint in architecture-model-service**
- Add POST endpoint at `/api/projects/{projectId}/implement-context/expand-resolve`
- Request body accepts `selected_entities` array with objects containing `entity_type`, `entity_id`, `bundle_type`
- Request body accepts `selected_diagrams` array with objects containing `diagram_id`, `bundle_type`
- Response includes `expanded_entity_ids`, `expanded_diagram_ids`, `resolved_entities`, `resolved_diagrams`
- Add new DTO records: `ExpandResolveRequestDto`, `EntityBundleSelection`, `DiagramBundleSelection`, `ExpandResolveResponseDto`
- Controller at `ImplementContextResolutionController.java` (line 21) gains new `/expand-resolve` POST mapping

**Bundle expansion service implementation**
- Create new service class `ContextBundleExpansionService.java` in `/service/` directory
- Implement expansion methods for each bundle type with deterministic ordering
- Use existing repository patterns from `ImplementContextResolutionService.java` (lines 39-57) for entity lookups
- Inject EndpointRepository, InterfaceLogicalEntityRepository, LogicalDataEntityRelationshipRepository for relationship traversal
- Return expanded IDs as canonical format `<entityType>::<entityId>`

**Interface bundle expansion rules**
- `interface_only`: return only the interface entity
- `interface_with_endpoints`: query `EndpointRepository.findByInterfaceId()` to include all endpoints for the interface
- `interface_with_endpoints_and_schemas`: expand endpoints plus query `InterfaceLogicalEntityRepository.findByInterfaceId()` to get dataEntityPointIds, resolve to logical/physical data entities
- Parse dataEntityPointId format (`dep_log_<id>` or `dep_phy_<id>`) to determine entity type and ID

**Service bundle expansion rules**
- `service_only`: return only the service entity
- `service_with_parents_and_children`: from `ServiceEntity` (lines 23-25), traverse `applicationId` to Application, `applicationComponentId` to ApplicationComponent
- Query `InterfaceRepository.findByModelFileId()` filtering by serviceId to find child interfaces
- For each child interface, optionally include endpoints via `EndpointRepository.findByInterfaceId()`
- Include `packageSetId` link if present (for implementation structure)

**Data entity bundle expansion rules**
- `entity_only`: return only the data entity (logical or physical)
- `entity_with_attributes_and_relationships`: for physical entities, query `PhysicalDataAttributeRepository` by physicalEntityId to include attributes
- Query `LogicalDataEntityRelationshipRepository.findByModelFileId()` and filter for relationships where entity is source or target via dataEntityPointId
- Depth=1 only: do not traverse multi-hop relationships
- Include attribute details (name, dataType, isPrimaryKey, isNullable) in resolved summaryFields

**Diagram bundle expansion rules**
- `diagram_only`: include the diagram entity
- Optionally resolve referenced entities from `DiagramNodeRepository.findByDiagramId()` if they are not already included by other bundle expansions
- Do not auto-expand beyond the diagram's direct node references

**Bounding and safety limits**
- Add configurable limits: `maxExpandedEntities` (default 250), `maxExpandedDiagrams` (default 50)
- Implement deterministic truncation when limits exceeded (sort by entity type then ID)
- Include `truncated: true` flag in response when truncation occurs
- Add `truncation_reason` string when truncation happens

**Gateway integration for expand-resolve**
- Add new function `expandResolveContext()` in `architectureModelClient.ts` (after line 150)
- Accept `projectId`, `selectedEntities: EntityBundleSelection[]`, `selectedDiagrams: DiagramBundleSelection[]`
- Call the new `/expand-resolve` endpoint and return typed response
- Update `tryResolveImplementContext()` in `chat.ts` (line 181) to use expand-resolve when bundle_type is present in context

**Prompt injection for expanded context**
- Modify `formatHighlightedContext()` in `promptBuilder.ts` (line 561) to handle expanded entities
- Group resolved entities by category (application, data, business, ui) for readability
- Include relationship metadata in output format when available
- Inject expanded context into "HIGHLIGHTED FEATURE CONTEXT" section for refine phase

## Existing Code to Leverage

**ImplementContextResolutionService.java (lines 37-550)**
- Reuse `canonicalizeEntityType()` method (line 75) for entity type normalization
- Reuse `parseEntityId()` method (line 154) for parsing composite IDs
- Reuse individual resolve methods (resolveService, resolveInterface, resolveEndpoint, etc.) for entity resolution
- Reuse repository injection pattern and model file lookup logic

**architectureModelClient.ts (lines 92-150)**
- Follow same pattern as `resolveImplementContext()` for HTTP POST request
- Reuse `normalizeEntityTypeId()` function for entity type canonicalization
- Follow error handling pattern with logger warnings on failure

**contextStorage.ts (lines 20-44)**
- `EntityRef` interface already includes `bundle_type?: string` field
- `DiagramRef` interface already includes `bundle_type?: string` field
- Frontend already persists bundle_type selections - no frontend changes needed

**EndpointRepository.java (lines 10-17)**
- `findByInterfaceId(String interfaceId)` method exists for interface-to-endpoint expansion

**InterfaceLogicalEntityRepository.java (lines 10-17)**
- `findByInterfaceId(String interfaceId)` method exists for interface-to-data-entity expansion

## Out of Scope

- No condensed LLM DTO payload format changes (keep current resolved output structure)
- No explicit relationship selection UI in frontend Context Picker
- No multi-hop relationship traversal beyond depth=1 for data entities
- No persistence or status tracking changes for work item context
- No changes to bundle type selection UI (already implemented in Iteration 1)
- No streaming endpoint support for expand-resolve
- No caching layer for expansion results
- No async/parallel expansion optimization
- No backward compatibility shim for old resolve endpoint (both endpoints coexist)
- No changes to bootstrap phase prompt - only refine phase uses expanded context
