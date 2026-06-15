# Specification: Fix Context Bundle + Depth Wiring End-to-End

## Goal
Ensure that when users select physical data entities with depth >= 1 and/or bundle types in the Context Picker, the Implement Assistant chat requests use the expand-resolve path and the LLM receives resolved context containing entity names, attribute lists (name + type), and relationship metadata.

## User Stories
- As a developer using the Implement Assistant, I want the Planner LLM to see my selected physical data entities' attributes so that it can write accurate specifications referencing table columns.
- As a developer, I want depth=2 selections to include expanded relationships so that the LLM understands the full data model context around my selected entities.

## Specific Requirements

**Frontend: Include structured architectureContext in chat payload**
- Update `buildContext()` in `ImplementationAssistantPanel.tsx` to construct `architectureContext.entities[]` array
- Each entity object must include: `entity_type`, `entity_id`, `bundle_type`, `depth` (when applicable)
- Source `bundle_type` from `contextState.entity_refs[].bundle_type` (stored by Context Picker)
- Source `depth` from `contextState.entity_refs[].depth` (defaults to 1 if undefined)
- Construct `architectureContext.diagrams[]` array with `diagram_id`, `bundle_type` from `contextState.diagram_refs[]`
- Maintain backward-compatible `entityIds` and `diagramIds` arrays for legacy code paths

**Frontend: Update ArchitectureContextPayload type**
- Extend `ArchitectureContextPayload` in `frontend/src/api/chatApi.ts` to include optional `entities` and `diagrams` arrays
- Define `EntityBundleSelection` and `DiagramBundleSelection` interfaces matching gateway types
- Keep existing `entityIds` and `diagramIds` fields for backward compatibility

**Gateway: Prefer expand-resolve when structured entities present**
- In `tryResolveImplementContextWithBundles()`, detect when `architectureContext.entities[]` contains items with `bundle_type`
- Current implementation already routes to expand-resolve when `hasBundleTypeSelections()` returns true
- Ensure `depth` field is passed through to the model-service request

**Gateway: Normalize entity_type before sending to model service**
- Current `ENTITY_TYPE_CANONICAL_MAP` in `architectureModelClient.ts` handles snake_case to camelCase conversion
- Verify that entity_type normalization applies to the structured entities array (not just legacy entityIds)
- Add normalization step to map `physical_data_entities` to `physicalDataEntities` in the entities array

**Gateway: Validate PDE attributes in expand-resolve response**
- After receiving `ExpandResolveResponseDto`, check resolved physical data entities for attributes
- For each `ResolvedEntitySummary` where `entity_type === 'physicalDataEntities'`, verify `relevant_fields.attributes` exists
- Log error with entity IDs if attributes missing; add `[WARNING: attributes missing]` marker to prompt context
- Continue processing but make visibility clear for debugging

**Model Service: Add depth field to EntityBundleSelection DTO**
- Extend `EntityBundleSelection.java` record to include optional `depth` field (Integer, nullable)
- Use `@JsonProperty("depth")` annotation for JSON mapping
- Default to depth=1 when field is null/absent

**Model Service: Return attributes for PDEs at depth >= 1**
- In `ContextBundleExpansionService.expandDataEntityWithAttributesAndRelationships()`, attributes are already queried via `physicalDataAttributeRepository.findByPhysicalEntityId()`
- Ensure `ImplementContextResolutionService.resolveEntity()` populates `relevant_fields.attributes` for physical data entities
- Attributes must include at minimum: name, type (and pk, nullable when available)

**Model Service: Handle depth=2 for expanded relationships**
- When `depth=2` is specified for a data entity, expand relationships to 2-hop neighbors
- Current implementation expands only depth=1; add conditional logic for depth=2 traversal
- Apply truncation limits to prevent unbounded expansion

## Visual Design
No visual mockups provided; this is a backend/API contract fix.

## Existing Code to Leverage

**`frontend/src/utils/contextStorage.ts` - EntityRef with bundle_type and depth**
- `EntityRef` interface already has `bundle_type?: string` and `depth?: 1 | 2` fields
- Context Picker persists these values to localStorage; ImplementationAssistantPanel receives them via `contextState` prop
- Reuse this structure when constructing the chat payload

**`frontend/src/api/chatApi.ts` - ArchitectureContextPayload**
- Existing interface has `entityIds: string[]` and `diagramIds: string[]`
- Gateway types already define `EntityBundleSelection` and `DiagramBundleSelection` in `gateway/src/types/chat.ts`
- Frontend should mirror these type definitions for consistency

**`gateway/src/services/architectureModelClient.ts` - hasBundleTypeSelections() and expandResolveContext()**
- `hasBundleTypeSelections()` checks if entities/diagrams arrays have bundle_type
- `expandResolveContext()` calls the model-service expand-resolve endpoint
- `tryResolveImplementContextWithBundles()` orchestrates the decision between standard vs expand-resolve paths

**`architecture-model-service/.../ContextBundleExpansionService.java` - Expansion logic**
- `expandDataEntityWithAttributesAndRelationships()` already queries attributes for physical entities
- `expandAndResolve()` is the main entry point; it calls `resolveEntities()` which delegates to `ImplementContextResolutionService`
- Relationship discovery is handled in `discoverRelationships()` method

**`architecture-model-service/.../EntityBundleSelection.java` - Request DTO**
- Current record has `entityType`, `entityId`, `bundleType` fields
- Needs extension to add `depth` field for depth-controlled expansion

## Out of Scope
- No changes to Context Picker UI bundle type or depth selection controls
- No new bundle types beyond existing interface/service/entity bundles
- No relationship manual selection UI
- No changes to conversation persistence or transcript writing
- No changes to bootstrap phase or meta-model summary fetching
- No condensed DTO format redesign (use existing resolved entity format)
- No changes to diagram expansion beyond existing diagram_only behavior
- No changes to handoff planning or orchestration execution
- No changes to SSE streaming endpoint
