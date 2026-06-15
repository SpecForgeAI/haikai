# Specification: Fix Implement Assistant Context Injection

## Goal
Fix two defects preventing the Implement Assistant from providing correct business and technical context to the Planner LLM: (1) bootstrap phase not fetching product/architecture summaries, and (2) highlighted entities sent without type prefixes preventing resolution.

## User Stories
- As a developer using the Implementation Assistant, I want the bootstrap greeting to acknowledge my product backlog and architecture so that I know the assistant has relevant context.
- As a developer highlighting architecture entities (e.g., database tables), I want the assistant to reference them by name so that I can discuss concrete implementation details.

## Specific Requirements

**Gateway Bootstrap Phase Must Fetch Summaries**
- Root cause: `gateway/src/routes/chat.ts` imports `fetchProductSummary` and `fetchMetaModelSummary` but never calls them for bootstrap phase
- In POST /api/chat handler, when `context.mode === 'implement_feature'` AND `context.phase === 'bootstrap'`, add logic to call both fetch functions
- Pass `context.filename` as the projectId parameter to both fetch functions
- Pass fetched `productSummary` and `metaModelSummary` to `buildSystemPrompt()` as the 4th and 5th parameters
- Fetch calls should run in parallel using `Promise.all` for performance
- If either fetch fails or returns null, log a diagnostic but proceed with chat (do not crash)

**Frontend Must Send Typed Entity IDs**
- Root cause: `ImplementationAssistantPanel.tsx` line 284 sends only `ref.entity_id` without the `entity_type` prefix
- Change `buildContext()` to construct typed IDs in format `"<entity_type>::<entity_id>"`
- Use the `entity_type` from `EntityRef` (e.g., `"physicalDataEntities"`, `"services"`, `"interfaces"`)
- The `entity_type` values in `EntityRef` already match the keys expected by `ImplementContextResolutionService.java` switch statement
- Example transformation: `{ entity_type: "physicalDataEntities", entity_id: "pde-123" }` becomes `"physicalDataEntities::pde-123"`

**Gateway Passes Typed IDs Through Unchanged**
- Current `tryResolveImplementContext()` in `chat.ts` already passes `entityIds` array directly to `resolveImplementContext()`
- No changes needed in gateway for passing IDs - just ensure typed IDs flow through
- Current `architectureModelClient.ts` already sends IDs in `selected_entity_ids` body field

**Backend Entity ID Parsing Already Correct**
- `ImplementContextResolutionService.java` `parseEntityId()` method correctly parses `"entityType::entityId"` format
- The switch statement in `resolveEntity()` handles all entity types: services, classes, methods, interfaces, applications, appComponents, endpoints, businessProcesses, businessPoints, logicalDataEntities, physicalDataEntities, uiScreens
- No changes needed in architecture-model-service

**Backend Summary Endpoints Already Exist and Work**
- `ProductSummaryController.java`: GET `/api/projects/{projectId}/product-summary`
- `MetaModelSummaryController.java`: GET `/api/projects/{projectId}/meta-model-summary`
- Both services query by `projectId` (filename) and return non-empty results when data exists
- No changes needed in architecture-model-service endpoints

**Graceful Error Handling in Gateway**
- If `fetchProductSummary` returns null: log warning with projectId, pass null to `buildSystemPrompt()`
- If `fetchMetaModelSummary` returns null: log warning with projectId, pass null to `buildSystemPrompt()`
- `buildBootstrapPrompt()` in `promptBuilder.ts` already handles null/empty summaries with "No ... available" fallback text
- Never fail the chat request due to summary fetch failures

## Existing Code to Leverage

**gateway/src/services/architectureModelClient.ts**
- `fetchProductSummary(projectId)` function exists and is correctly implemented (lines 90-134)
- `fetchMetaModelSummary(projectId)` function exists and is correctly implemented (lines 147-194)
- Both functions return typed DTOs or null on error with appropriate logging
- Import path: already imported in `chat.ts` but never used

**gateway/src/services/promptBuilder.ts**
- `buildSystemPrompt()` signature already accepts `productSummary` and `metaModelSummary` as 4th and 5th parameters (line 246-252)
- `buildBootstrapPrompt()` correctly formats summaries using `formatProductSummary()` and `formatMetaModelSummary()` helpers (lines 393-416)
- Template `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` includes `{productSummary}` and `{metaModelSummary}` placeholders (lines 202-207)

**frontend/src/utils/contextStorage.ts**
- `EntityRef` interface defines both `entity_type` (string) and `entity_id` (string) fields (lines 20-29)
- The `entity_type` values used by the UI match the keys in `ImplementContextResolutionService` switch statement
- Type values: "services", "classes", "methods", "interfaces", "applications", "appComponents", "endpoints", "businessProcesses", "businessPoints", "logicalDataEntities", "physicalDataEntities", "uiScreens"

**architecture-model-service ImplementContextResolutionService.java**
- `parseEntityId()` correctly parses composite IDs with `"::"` delimiter (lines 120-139)
- `resolveEntity()` routes to correct resolver based on entity type (lines 149-176)
- All entity resolvers return `ResolvedEntitySummary` with name, type, category, and relevant_fields

## Out of Scope
- No changes to the UI selection/highlighting mechanics in the frontend tree views
- No changes to how entity refs or diagram refs are stored in localStorage
- No changes to diagram rendering or diagram persistence
- No transcript persistence changes (already handled by separate spec)
- No changes to the refine or handoff phase prompts (only bootstrap phase affected)
- No changes to the architecture-model-service endpoint response shapes
- No adding new context sources beyond product summary and meta-model summary
- No changes to how the product summary service queries work items
- No changes to how the meta-model summary service queries entities
- No schema changes to any database tables
