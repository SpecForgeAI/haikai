# Specification: Fix Implement Context Resolution Entity Type Canonicalization

## Goal

Ensure all highlighted entity types--including physical data entities--resolve correctly by canonicalizing snake_case entity type keys to the camelCase format expected by the model-service resolver, with backwards-compatible alias handling in the backend.

## User Stories

- As a user of the Implementation Assistant, I want physical data entities I select as context to be resolved to their human-readable names so that the assistant can reference table names rather than IDs.
- As a developer, I want a clear mapping between frontend entity type keys and backend resolver keys so that all entity types resolve consistently.

## Specific Requirements

**Root Cause Analysis**
- Frontend `contextPickListBuilders.ts` uses snake_case entity type keys from the MetaModelEntities interface (e.g., `physical_data_entities`, `logical_data_entities`, `app_components`)
- These keys are stored in EntityRef.entity_type and passed to `ImplementationAssistantPanel.buildContext()`
- The typed ID format `<entity_type>::<entity_id>` is constructed at line 298 of `ImplementationAssistantPanel.tsx`
- Backend `ImplementContextResolutionService.java` switch statement (line 158-176) expects camelCase keys: `physicalDataEntities`, `logicalDataEntities`, `appComponents`
- Unknown entity types fall through to default case at line 171 and return null, dropping the entity from resolution

**Canonical Entity Type Mapping Table**
- Create a single source of truth mapping table in the Gateway
- Map snake_case keys (from frontend) to camelCase keys (expected by resolver):
  - `physical_data_entities` -> `physicalDataEntities`
  - `logical_data_entities` -> `logicalDataEntities`
  - `app_components` -> `appComponents`
  - `business_processes` -> `businessProcesses`
  - `business_points` -> `businessPoints`
  - `process_activities` -> `processActivities` (maps to businessPoints in resolver)
  - `ui_screens` -> `uiScreens`
- Keys that are already identical need no transformation: `services`, `classes`, `methods`, `interfaces`, `applications`, `endpoints`

**Gateway Normalization (Primary Fix)**
- Implement normalization in `gateway/src/services/architectureModelClient.ts` before calling resolve endpoint
- In `resolveImplementContext()` function, parse each entity ID from the `entityIds` array
- Split on `::` delimiter to extract entityType and entityId parts
- Normalize entityType using the canonical mapping table
- Reconstruct the typed ID with the canonical entityType
- Log a debug warning for any unmapped entity types (leave unchanged and pass through)
- This ensures the resolver always receives canonical types regardless of frontend behavior

**Model Service Alias Support (Defense-in-Depth)**
- In `ImplementContextResolutionService.java`, add alias handling before the switch statement
- Create a helper method `canonicalizeEntityType(String entityType)` that normalizes snake_case to camelCase
- Aliases to add at minimum:
  - `physical_data_entities` as alias of `physicalDataEntities`
  - `logical_data_entities` as alias of `logicalDataEntities`
  - `app_components` as alias of `appComponents`
- Call canonicalization in `resolveEntity()` before the switch/dispatch
- Unknown types continue to be safely logged and skipped (no crashes)

**Prompt Output Verification**
- After fix, resolved entities include physical data entities with:
  - `id` matching the original `pde-...` ID
  - `name` populated with table/entity name
  - `entity_type` as `physicalDataEntities`
  - `category` as `data`
  - `relevant_fields` containing `database` and `physicalType` if available

## Existing Code to Leverage

**gateway/src/services/architectureModelClient.ts**
- Contains `resolveImplementContext()` function at line 24-76
- Already receives `entityIds` array in typed format
- Add normalization logic before the fetch call at line 41-49
- Use the existing logger for debug/warning output

**architecture-model-service/.../ImplementContextResolutionService.java**
- Contains `parseEntityId()` at line 120-140 and `resolveEntity()` at line 149-176
- Add alias/canonicalization before the switch at line 158
- Existing `resolvePhysicalDataEntity()` at line 468-491 handles the actual resolution once the type is recognized

**frontend/src/utils/contextPickListBuilders.ts**
- Defines `ARCHITECTURE_ENTITY_KEYS` array at line 40-60 with all snake_case keys
- These are the source of entity_type values stored in EntityRef
- No changes needed here; normalization happens in Gateway

**gateway/src/types/chat.ts**
- `ResolvedEntitySummary` interface at line 395-406 defines the expected output format
- The `entity_type` field will contain the canonical camelCase value after resolution

## Out of Scope

- No changes to how entity selections are stored in localStorage
- No changes to the frontend EntityRef interface or contextStorage types
- No changes to diagram resolution behavior
- No changes to backlog/meta-model bootstrap injection
- No frontend code changes (normalization is Gateway responsibility)
- No changes to the ContextPickerModal or buildArchitecturePickList
- No changes to the ImplementationAssistantPanel buildContext logic
- No migration of existing stored context states
- No changes to streaming endpoint (does not use implement_feature mode)
- No changes to OAS assistant mode behavior
