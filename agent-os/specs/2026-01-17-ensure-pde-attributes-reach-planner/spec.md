# Specification: Ensure Physical Data Entity Attributes Reach Planner LLM

## Goal
Guarantee that physical data entity (PDE) attributes (columns) deterministically appear in the Planner LLM highlighted context by persisting bundle_type and depth selections per entity and ensuring the expand-resolve endpoint returns attributes in resolved output.

## User Stories
- As a developer implementing a feature, I want my selected physical data entities to include their column definitions in the LLM context so that the Planner can generate accurate implementation guidance referencing actual schema details.
- As a user returning to a feature, I want my previously selected bundle_type and depth settings to persist so that I do not need to reconfigure context expansion each session.

## Specific Requirements

**1. Backend Persistence of Structured Selections**
- Update `WorkItemImplementContextEntity` to add two new JSONB columns: `selected_entity_selections` and `selected_diagram_selections`
- Each entity selection stores: `{ entity_type, entity_id, bundle_type, depth? }`
- Each diagram selection stores: `{ diagram_id, bundle_type }`
- Update `ImplementContextDto` and `SaveContextRequest` in `WorkItemImplementContextController` to include structured selection arrays alongside legacy ID arrays
- Backward compatibility: when loading legacy contexts that only have `selected_entity_ids`/`selected_diagram_ids`, infer structured selections using defaults: interfaces -> `interface_with_endpoints_and_schemas`, services -> `service_with_parents_and_children`, physical/logical data entities -> `entity_with_attributes_and_relationships` with depth=1

**2. Frontend Persistence Integration**
- Update `implementContextApi.ts` to send structured entity/diagram selections when saving context
- Extend `ImplementContextDto` interface to include `selected_entity_selections` and `selected_diagram_selections` arrays
- Update `mapDtoToContextState()` to populate `bundle_type` and `depth` from persisted structured selections
- Update `saveImplementContext()` to include bundle_type and depth from `EntityRef`/`DiagramRef` in the request body
- Ensure `loadContext()` from localStorage also preserves bundle_type and depth when available

**3. Gateway Chat Integration with Expand-Resolve**
- In `tryResolveImplementContextWithBundles()`, when `architectureContext.entities` exists with bundle_type, call `expandResolveContext()` with the structured selections
- Pass the depth parameter from each entity selection to the expand-resolve request DTO
- Ensure entity_type normalization via `normalizeEntitiesForExpandResolve()` applies before the API call

**4. Expand-Resolve Depth Parameter Support**
- `EntityBundleSelection` already has depth field with `effectiveDepth()` helper - no DTO changes needed
- In `ContextBundleExpansionService.expandDataEntityWithAttributesAndRelationships()`, when depth >= 1 and entity is physical data entity, query `PhysicalDataAttributeRepository.findByPhysicalEntityId()` to get attributes
- Attributes are already expanded as separate `physicalDataAttributes::<id>` entities but must also be embedded in the parent PDE's resolved summary

**5. Include Attributes in Resolved Entity Summary**
- Update `ImplementContextResolutionService.resolvePhysicalDataEntity()` to query and include attributes in `relevant_fields.attributes`
- Inject `PhysicalDataAttributeRepository` into the resolution service
- Build attributes array with fields: `name` (attribute name), `type` (data type), `pk` (boolean primary key), `nullable` (boolean nullable flag)
- Format: `relevantFields.put("attributes", List.of(Map.of("name", attr.getName(), "type", attr.getDataType(), "pk", attr.isPrimaryKey(), "nullable", attr.isNullable())))`

**6. Gateway Prompt Builder Attribute Handling**
- In `buildEntityAndAttributesDtos()`, verify that `extractAttributes()` correctly reads from `relevant_fields.attributes` array
- Existing implementation already handles this pattern - confirm no changes needed if backend populates correctly
- In `formatHighlightedContext()`, attributes from `relevant_fields` are already included in output via the loop over `entity.relevant_fields`

**7. PDE Attribute Validation and Warning**
- `validatePdeAttributes()` in `architectureModelClient.ts` already validates and logs errors for PDEs missing attributes
- Extend to add a warning line in the prompt when PDEs are missing attributes: `[WARNING: Physical Data Entity <id> is missing attribute metadata]`
- Update `buildImplementPlannerPrompt()` to inject warning if validation fails

**8. Database Migration**
- Create Flyway migration script to add `selected_entity_selections JSONB` and `selected_diagram_selections JSONB` columns to `work_item_implement_context` table
- Default new columns to empty JSON arrays `'[]'::jsonb`
- No data migration needed - legacy contexts will be handled by inference logic on read

**9. Test Coverage**
- Model service test: expand-resolve called with PDE at depth=1 returns `resolved_entities[].relevant_fields.attributes` with length > 0
- Gateway test: when receiving structured selections with PDEs, prompt contains attribute names
- Persistence test: save context with bundle_type/depth, reload, verify values match
- Backward compatibility test: load legacy context with only IDs, verify defaults are applied

**10. End-to-End Attribute Flow Verification**
- Log attribute count at each stage: expansion service, resolution service, gateway client, prompt builder
- Add debug log in `buildCondensedContextForPrompt()` showing attribute counts per entity
- If any PDE has zero attributes after resolution, log warning with entity ID and hint to check depth parameter

## Existing Code to Leverage

**WorkItemImplementContextEntity and Controller**
- Entity at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java` stores `selected_entity_ids` and `selected_diagram_ids` as JSONB
- Controller at `WorkItemImplementContextController.java` handles GET/PUT for context persistence
- Extend with new structured selection fields following same JSONB pattern

**ContextBundleExpansionService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ContextBundleExpansionService.java`
- Already queries `PhysicalDataAttributeRepository.findByPhysicalEntityId()` and adds attribute IDs to expanded set
- Leverage existing depth-aware expansion logic in `expandDataEntityWithAttributesAndRelationships()`

**ImplementContextResolutionService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java`
- `resolvePhysicalDataEntity()` method needs enhancement to include attributes in relevant_fields
- Follow pattern from other entity resolution methods that populate relevantFields map

**Gateway architectureModelClient.ts**
- Located at `gateway/src/services/architectureModelClient.ts`
- `expandResolveContext()` already sends structured selections with depth to backend
- `validatePdeAttributes()` already validates and logs missing attributes

**Gateway promptBuilder.ts**
- Located at `gateway/src/services/promptBuilder.ts`
- `extractAttributes()` and `buildEntityAndAttributesDtos()` already handle attributes array extraction
- `formatHighlightedContext()` includes relevant_fields in output

## Out of Scope
- No changes to the Context Picker UI component layout or design
- No new bundle types beyond existing ones (interface_only, interface_with_endpoints, etc.)
- No changes to orchestration/executor API calls or handoff flow
- No manual relationship selection UI
- No changes to how diagrams are resolved (only entity attribute handling)
- No support for logical data entity attributes (only physical data entities)
- No attribute filtering or selection (all attributes are included)
- No attribute ordering customization (use database order)
- No changes to the truncation limits for expanded entities
- No changes to the condensed DTO schema beyond ensuring attributes are populated
