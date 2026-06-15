# Specification: Fix Add Context Relationship Labels Rendering as "Unknown Relationship"

## Goal
Fix the Add Context modal in the Implement screen to display human-readable relationship labels using the pipe-separated "<name> [<TYPE>]" format by passing the meta-model entities map to the relationship pick-list builder function.

## User Stories
- As a user viewing the Add Context modal, I want to see relationship labels formatted as readable participant names and types (e.g., "Alice Admin [BUSINESS_USER] | Order Submission [BUSINESS_POINT]") so that I can understand what each relationship represents.
- As a user selecting relationships for context, I want to avoid seeing "Unknown Relationship" labels when the referenced entities exist in the model so that I can make informed selections.

## Specific Requirements

**Pass metaModelEntities to buildRelationshipPickList**
- Update the `relationshipOptions` useMemo in `ProductImplementPage.tsx` to pass `model.metaModel.entities` as the second argument to `buildRelationshipPickList()`
- The call should change from `buildRelationshipPickList(model.metaModel.relationships)` to `buildRelationshipPickList(model.metaModel.relationships, model.metaModel.entities)`
- Add `model.metaModel.entities` to the useMemo dependency array

**Relationship Label Format**
- Labels must use the pipe-separated format: `<name> [<TYPE>] | <name> [<TYPE>]`
- Each participant in the relationship should show its resolved name and entity type
- Example: `"Interface Name [INTERFACE] | Entity Name [LOGICAL_DATA_ENTITY]"`

**Fallback Behavior for Missing Entities**
- When a participant entity cannot be resolved (entity ID not found in metaModelEntities), use the placeholder format `"Unknown [<TYPE>]"` for that participant only
- Do not fall back to "Unknown Relationship" for the entire row when at least one participant can be resolved
- Only display "Unknown Relationship" when metaModelEntities is completely unavailable (null/undefined)

**No Backend Changes Required**
- This is a frontend-only fix
- No changes to DTOs, APIs, or backend services

## Visual Design
No visual mockups provided. The fix is a data-passing correction that enables existing label formatting logic.

## Existing Code to Leverage

**`frontend/src/utils/contextPickListBuilders.ts` - buildRelationshipPickList function (lines 291-340)**
- Already accepts optional second parameter `metaModelEntities?: MetaModelEntities`
- Contains logic to create `entityLookup` function from metaModelEntities when provided
- Uses `computeRelationshipLabel()` when metaModelEntities is available, falls back to `extractRelationshipLabelFallback()` otherwise
- No changes needed to this function; it already supports the required behavior

**`frontend/src/utils/contextRelationshipLabelUtils.ts` - computeRelationshipLabel function**
- Takes a relationship record, collection key, and entity lookup function
- Returns the pipe-separated label format with resolved names and types
- Handles missing entity resolution with "Unknown [<TYPE>]" placeholder

**`frontend/src/components/ProductView/ProductImplementPage.tsx` - architectureOptions useMemo (lines 277-280)**
- Shows existing pattern of using `model.metaModel.entities` in the same component
- Confirms `model.metaModel.entities` is already available in scope and being used

**`frontend/src/__tests__/contextPickerUxIntegration.test.ts` (lines 108-122)**
- Contains test example showing correct usage: `buildRelationshipPickList(mockRelationships, mockEntities)`
- Validates expected label format with entity names and types

**`frontend/src/__tests__/contextPickListBuildersRelationshipLabels.test.ts`**
- Contains comprehensive tests for buildRelationshipPickList with and without metaModelEntities
- Tests verify the pipe-separated format and entity resolution behavior

## Out of Scope
- Changes to backend relationship DTOs or APIs
- Changes to relationship selection persistence logic
- UI redesign of the Add Context modal (layout, styling, etc.)
- Adding new relationship types or collection keys
- Changes to how relationships are stored or retrieved
- Modifications to the contextPickListBuilders.ts utility functions
- Changes to the computeRelationshipLabel utility function
- Adding new entity lookup mechanisms or caching
- Changes to other screens or modals that may use relationship labels
