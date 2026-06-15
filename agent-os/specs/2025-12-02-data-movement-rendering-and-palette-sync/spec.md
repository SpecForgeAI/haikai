# Specification: Data Movement Rendering and Palette Synchronisation Fix

## Goal

Fix TWO critical bugs preventing Data Movement edges from rendering on the canvas after "Add" is clicked:
1. **Bug 1:** `getRelationshipEndpointEntities()` incorrectly includes Logical Data Entity, causing edge filtering to fail
2. **Bug 2:** `getDataMovementNodes()` only looks for APPLICATION_POINT nodes, but palette adds APPLICATION nodes

Also ensure Palette enabled/disabled states remain synchronised with diagram changes.

## User Stories

- As a diagram author, I want Data Movement edges to appear on the canvas when I click "Add" so that I can visualise data flows between applications without needing to add the Logical Data Entity as a node.
- As a diagram author, I want the Palette to correctly enable/disable relationship rows when I add or remove nodes so that I only see actionable options for the current diagram state.

## Specific Requirements

**Data Movement Edge Rendering Fix**
- Data Movement edges must render when both source and target Application Point nodes are present on the diagram
- The Logical Data Entity does NOT need to be on the diagram as a node for the edge to render
- The edge should display as: solid line, arrow at target end, label text = Logical Data Entity name
- Edge must be visible if both endpoint Application Point nodes pass time filtering

**Bug 1 Fix: getRelationshipEndpointEntities for DATA_MOVEMENT**
- Location: `frontend/src/utils/rendering.ts`, function `getRelationshipEndpointEntities`
- Currently returns `[sourceApp, targetApp, dataEntity]` - the dataEntity causes the filter failure
- Must be changed to return ONLY `[sourceApp, targetApp]` for DATA_MOVEMENT relationship type
- The logical data entity should NOT be included in the endpoint entities array for temporal visibility checking
- **Status: IMPLEMENTED** - Line 218 removed (`if (dataEntity) endpoints.push(dataEntity);`)

**Bug 2 Fix: getDataMovementNodes Application Abstraction**
- Location: `frontend/src/utils/relationshipUtils.ts`, function `getDataMovementNodes` (lines 921-959)
- The function was using `findAppPointNode()` which ONLY finds nodes with `entity_type === 'APPLICATION_POINT'`
- When users add an "Application" from the palette, it creates a node with `entity_type = 'APPLICATION'`
- The eligibility check (`isDataMovementEnabledWithSets`) correctly maps APPLICATION → application_points, so the row shows as **enabled**
- But `getDataMovementNodes()` returned null because it couldn't find `APPLICATION_POINT` nodes, so no edge was created
- **Fix:** Update `getDataMovementNodes()` to check for all node types that can represent an application:
  1. Direct `APPLICATION` node matching by `application_id`
  2. `APPLICATION_POINT` node where `ap.application_id` matches
  3. `APP_COMPONENT` node where `ap.application_component_id` matches
  4. `SERVICE` node where `ap.service_id` matches
- This mirrors the same abstraction logic used in `getEntitiesOnDiagram()` for the enabled/disabled eligibility check
- **Status: IMPLEMENTED** - Function rewritten with `findNodeForApplication()` helper

**getEdgesForDiagram Filtering Logic**
- Location: `frontend/src/utils/rendering.ts`, function `getEdgesForDiagram`
- For DATA_MOVEMENT edges, the filter must check: (1) relationship visible in current period, (2) source Application Point node visible, (3) target Application Point node visible
- The Logical Data Entity temporal visibility must NOT affect edge renderability
- Existing filtering for other relationship types remains unchanged

**Console Warning for Filtered Edges**
- Add console.warn when an edge is filtered out due to missing endpoints or time filtering
- Format: `console.warn("Filtered out edge", { edgeId, relationshipType, reason })`
- Reasons to log: "missing_source_node", "missing_target_node", "relationship_not_visible", "endpoint_not_visible"
- Helps developers debug edge rendering issues during development

**Palette Row Enabled/Disabled Rules for Data Movements**
- Data Movement row is ENABLED if: source Application Point on diagram AND target Application Point on diagram AND relationship effective for current time period
- Data Movement row is DISABLED otherwise, with tooltip: "Source and target Applications must be on this diagram to add this data movement"
- Logical Data Entity node presence must NOT be required for enabling the row
- The existing `isDataMovementEnabledWithSets` function in relationshipUtils.ts is correct and should be preserved

**Palette State Synchronisation with Diagram**
- Palette enabled/disabled states must recompute when: selected diagram changes, node added/removed, time period changes
- Current implementation in `PaletteSection.tsx` already recomputes `entitiesOnDiagram` on each render which is correct
- Verify that ADD_DIAGRAM_NODE and DELETE_DIAGRAM_ELEMENTS actions trigger re-render of PaletteSection
- Add short-circuit in Add handlers to prevent adding relationships when not eligible (double-check validation)

**Unified Relationship Availability Helper**
- Create or refine `getRelationshipAvailabilityForDiagram(diagram, metaModel, currentPeriod)` helper
- Returns availability status per relationship type/id: "enabled", "disabled_missing_endpoints", "disabled_already_present"
- Use in both Palette UI (row enabled/disabled + tooltip) and Add handlers (short-circuit if ineligible)
- Consolidates logic to prevent UI/backend state drift

**Time Filtering for Data Movement Edges**
- Data Movement edge visible if: relationship.valid_from/valid_to passes current period check
- Source Application visible in current period (via Application Point -> Application lookup)
- Target Application visible in current period (via Application Point -> Application lookup)
- Logical Data Entity temporal visibility does NOT affect edge visibility

## Existing Code to Leverage

**`frontend/src/utils/rendering.ts` - getRelationshipEndpointEntities**
- Lines 145-228: Switch statement handling each relationship type
- DATA_MOVEMENT case (lines 208-219) currently adds dataEntity to endpoints - this is the bug to fix
- Remove the dataEntity from the returned array for DATA_MOVEMENT type

**`frontend/src/utils/rendering.ts` - getEdgesForDiagram**
- Lines 676-729: Edge filtering logic with time-based visibility checks
- Uses getRelationshipEndpointEntities for temporal filtering
- After fixing getRelationshipEndpointEntities, this function will correctly handle DATA_MOVEMENT

**`frontend/src/utils/relationshipUtils.ts` - isDataMovementEnabledWithSets**
- Lines 481-511: Correctly checks only source/target Application Points on diagram
- Does NOT require Logical Data Entity - this is the correct behaviour to match in rendering

**`frontend/src/components/DiagramsView/PaletteSection.tsx`**
- Lines 43-45: entitiesOnDiagram computed on every render (correct reactive behaviour)
- Lines 48-67: getRelationshipInfo uses getRelationshipEligibility for enabled/disabled state
- This component already synchronises with diagram changes correctly

**`frontend/src/components/DiagramsView/PalettePanel.tsx` - handleAddRelationship**
- Lines 126-310: Handles adding relationships to the diagram
- Lines 139-143: Already checks isRelationshipRowEnabled before proceeding
- Validates relationship eligibility before creating edge

## Out of Scope

- Changes to other relationship type rendering logic (User-Process, Logical ER, etc.)
- Meta-model schema changes or database structure modifications
- UI styling changes beyond ensuring arrow renders correctly on Data Movement edges
- Performance optimisations for palette state computation
- Changes to the Application Point abstraction layer in `getEntitiesOnDiagram()` (already correct)
- Modification of edge creation logic in createRelationshipEdge (already correct)
- Backend API changes or server-side validation
- Unit test framework or testing infrastructure changes
- Documentation or README updates

## Implementation Status

| Bug | Location | Status |
|-----|----------|--------|
| Bug 1: getRelationshipEndpointEntities | `rendering.ts` line 218 | ✅ IMPLEMENTED |
| Bug 2: getDataMovementNodes | `relationshipUtils.ts` lines 921-979 | ✅ IMPLEMENTED |
| Console warnings | `rendering.ts` getEdgesForDiagram | ✅ IMPLEMENTED |

Both fixes have been implemented and TypeScript compiles successfully.
