# Specification: Fix Meta-Model UI Workflow Transitions Crash

## Goal
Prevent undefined.map crashes in the Meta-Model Grid component when UI entity arrays are missing from persisted models, and ensure UI entity tab keys correctly resolve to their stored array keys.

## User Stories
- As a user, I want to click on "UI Workflow Transitions" tab in Meta-Model view without the application crashing, so that I can view and manage workflow transitions.
- As a user, I want older saved projects without UI entity arrays to load successfully and render empty tables for UI domain tabs.

## Specific Requirements

**Harden Grid.tsx against missing entity arrays**
- Location: `frontend/src/components/Grid/Grid.tsx` line 69
- Current code: `const entities = state.model.metaModel.entities[entityType] as AnyEntity[];` assumes array exists
- Change to null-safe fallback: `const entities = (state.model?.metaModel?.entities?.[entityType] ?? []) as AnyEntity[];`
- Ensure all downstream usages (`.map()`, `.filter()`, `.find()`, `.length`) use the safe `entities` variable
- Also harden `columns` lookup: `const columns = gridConfigs[entityType] ?? [];` to prevent undefined config crashes
- This fix applies globally to all entity types, not just UI domain

**Fix UI Workflow Transitions data location mismatch**
- Currently `ui_workflow_transitions` is defined in `MetaModelRelationships` (model.ts line 1787) but the Grid reads from `entities`
- The tab configuration in `gridConfigs.ts` line 457 maps "UI Workflow Transitions" to `ui_workflow_transitions`
- Either move `ui_workflow_transitions` to `MetaModelEntities` to match Grid expectations, OR route the tab through RelationshipGrid
- Recommended approach: Move to entities since DOMAIN_ENTITY_TYPES already lists it as a UI domain entity type
- Update `MetaModelEntities` interface to include `ui_workflow_transitions: UIWorkflowTransition[]`
- Remove from `MetaModelRelationships` interface
- Update `buildModelFromData` in fileOperations.ts to load from entities namespace

**Normalize missing UI entity arrays on model load**
- Location: `frontend/src/contexts/ArchitectureContext.tsx` in `LOAD_MODEL` case (line 246-319)
- Current code already handles some array normalization (e.g., endpoints, app_business_points)
- Extend the `entitiesWithDefaults` object to include all UI entity arrays
- Add fallbacks: `ui_screens: action.payload.metaModel.entities.ui_screens || []`
- Add fallbacks: `ui_workflow_transitions: action.payload.metaModel.entities.ui_workflow_transitions || []`
- Add fallbacks: `ui_components: action.payload.metaModel.entities.ui_components || []`
- Add fallbacks: `ui_actions: action.payload.metaModel.entities.ui_actions || []`

**Update fileOperations.ts buildModelFromData function**
- Location: `frontend/src/utils/fileOperations.ts` lines 323-369
- Ensure `ui_workflow_transitions` is loaded from the entities namespace, not relationships
- Add `ui_workflow_transitions: getArrayOrDefault(entities.ui_workflow_transitions) as UIWorkflowTransition[]`
- Remove the duplicate entry from the relationships section (line 365)
- The UI workflow transitions table should behave like an entity table (Grid), not a relationship table (RelationshipGrid)

**Verify UI domain entityType keys in gridConfigs.ts**
- Location: `frontend/src/config/gridConfigs.ts` lines 456-459
- Confirm tab mappings exactly match the stored array keys in MetaModelEntities
- Expected mappings: "UI Screens" -> "ui_screens", "UI Workflow Transitions" -> "ui_workflow_transitions"
- Expected mappings: "UI Components" -> "ui_components", "UI Actions" -> "ui_actions"
- Verify DOMAIN_ENTITY_TYPES.ui array includes all four keys (already correct at line 534)

**Add regression tests**
- Create `frontend/src/__tests__/meta-model-grid-null-safe.test.ts` for Grid fallback behavior
- Test that Grid renders with 0 rows when `metaModel.entities[entityType]` is undefined or missing
- Test that Grid does not throw when entityType key is not present in entities object
- Create `frontend/src/__tests__/model-normalization-ui-entities.test.ts` for normalization
- Test that `buildModelFromData` backfills missing UI arrays with empty arrays
- Test that existing arrays in loaded data are preserved (not overwritten with empty)

## Visual Design
No visual mockups provided - this is a stability fix with no UI changes.

## Existing Code to Leverage

**ArchitectureContext.tsx LOAD_MODEL handler**
- Lines 246-319 already normalize missing arrays like `endpoints` and `app_business_points`
- Follow the same pattern: `array_name: action.payload.metaModel.entities.array_name || []`
- Existing code demonstrates the normalization approach to replicate for UI entities

**fileOperations.ts buildModelFromData function**
- Lines 307-379 use `getArrayOrDefault()` utility for null-safe array loading
- Pattern: `getArrayOrDefault(entities.array_name) as TypeName[]`
- This utility already exists and should be used for UI entity normalization

**gridConfigs.ts tabToEntityType mapping**
- Lines 431-460 define the complete mapping from tab names to entity type keys
- UI domain mappings are already defined at lines 456-459
- Keys should match exactly: `ui_screens`, `ui_workflow_transitions`, `ui_components`, `ui_actions`

**DOMAIN_ENTITY_TYPES constant**
- Line 534 in gridConfigs.ts defines UI domain entity types
- Confirms the intended entity types for the UI domain
- Used by relationship filtering logic in MetaModelView

**validation.ts getArrayOrDefault utility**
- Existing utility function that returns `[]` for null/undefined input
- Should be used consistently in buildModelFromData for all entity arrays

## Out of Scope
- No backend changes - this is frontend-only
- No UI behavior changes beyond making missing data render as empty tables
- No relationship modeling changes for other domains
- No changes to how existing UI data is saved or serialized
- No new UI features or functionality for the UI domain tabs
- No changes to the RelationshipGrid component
- No migration of existing persisted data (normalization happens on load)
- No changes to the data model beyond moving ui_workflow_transitions to entities
- No performance optimizations or refactoring unrelated to the crash fix
- No changes to diagram rendering or canvas components
