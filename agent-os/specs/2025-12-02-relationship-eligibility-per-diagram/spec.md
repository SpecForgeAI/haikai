# Specification: Relationship Eligibility Per-Diagram Fix

## Goal

Fix the relationship enable/disable logic in the Palette panel so that it correctly reflects the state of the ACTIVE diagram only and always stays in sync as the diagram changes, addressing bugs where Data Movement rows show disabled even when both endpoints are on the diagram and eligibility state persists incorrectly when switching diagrams.

## User Stories

- As a diagram editor, I want relationship rows to be enabled only when both endpoints are on the current diagram so that I can clearly see which relationships I can add.
- As a user switching between diagrams, I want the palette eligibility state to immediately update to reflect the new diagram's nodes so that I always see accurate add-ability status.

## Specific Requirements

**Create getEntitiesOnDiagram Helper Function**
- Add a pure helper function in `relationshipUtils.ts` that accepts `metaModel` and `activeDiagram`
- Return a structure containing Set-based lookups for each entity type present on the diagram
- Map `diagram_nodes[]` to corresponding meta-model entity IDs using `entity_type` and `entity_id`
- Handle Application Point abstraction by mapping Application, Component, Service nodes to their `application_point.id`
- Return Sets: `applicationPointsOnDiagram`, `businessUsersOnDiagram`, `businessProcessesOnDiagram`, `logicalDataEntitiesOnDiagram`, `physicalDataEntitiesOnDiagram`, `logicalDataAttributesOnDiagram`, `physicalDataAttributesOnDiagram`

**Fix User Process Eligibility**
- Enabled when BOTH `business_user_id` is in `businessUsersOnDiagram` AND `business_process_id` is in `businessProcessesOnDiagram`
- Uses the new `getEntitiesOnDiagram` helper instead of checking nodes directly
- Current `isUserProcessEnabled` function must use the pre-computed Sets for performance

**Fix App Point Process Eligibility**
- Enabled if EITHER Application Point OR Business Process is NOT on the diagram (can still add containment)
- Disabled if BOTH Application Point AND its linked Business Process are already on the diagram with containment
- Current `getContainmentState` logic is correct but needs to use the active diagram's nodes specifically
- Tooltip should display "Already visualised on this diagram." when disabled due to existing containment

**Fix Logical ER Eligibility**
- Enabled when BOTH `source_entity_id` AND `target_entity_id` are in `logicalDataEntitiesOnDiagram`
- Update `isLogicalEREnabled` to use pre-computed Sets from the active diagram

**Fix Logical Physical Entity Eligibility**
- Enabled when BOTH `logical_entity_id` is in `logicalDataEntitiesOnDiagram` AND `physical_entity_id` is in `physicalDataEntitiesOnDiagram`
- Update `isLogicalPhysicalEntityEnabled` to use pre-computed Sets

**Fix Logical Physical Attribute Eligibility**
- Enabled when BOTH `logical_attribute_id` is in `logicalDataAttributesOnDiagram` AND `physical_attribute_id` is in `physicalDataAttributesOnDiagram`
- Update `isLogicalPhysicalAttributeEnabled` to use pre-computed Sets

**Fix Data Movement Eligibility**
- Enabled when BOTH `source_application_point_id` AND `target_application_point_id` are in `applicationPointsOnDiagram`
- The current `isDataMovementEnabled` function maps `source_application_id`/`target_application_id` to application_points, but needs to check the ACTIVE diagram's nodes only
- Ensure the mapping from Application ID to Application Point uses the `metaModel.entities.application_points` lookup correctly

**Wire Helper into PaletteSection Component**
- Modify `PaletteSection.tsx` to receive the active diagram explicitly (not just `diagram` prop which may be stale)
- The `getRelationshipEnabled` function must call `isRelationshipRowEnabled` with the CURRENT `diagram.diagram_nodes`
- Ensure React re-renders when `diagram.diagram_nodes` changes by using proper dependency tracking

**Trigger Eligibility Recomputation on Diagram Change**
- When user selects a different diagram from the dropdown (SELECT_DIAGRAM action), eligibility must recompute
- When user clicks +New or +Copy to create a new diagram, the new (empty or copied) diagram's nodes must be used
- PalettePanel receives `diagram` from props based on `currentDiagramId`, so ensure this prop is correctly derived from `state.model.diagrams`

**Trigger Eligibility Recomputation on Node Changes**
- When a node is added via ADD_DIAGRAM_NODE or ADD_DIAGRAM_NODES actions, eligibility must recompute
- When a node is removed via DELETE_DIAGRAM_ELEMENTS action, eligibility must recompute
- Node position or size changes (MOVE_NODE_WITH_CASCADE, UPDATE_DIAGRAM_NODE for pos/size) do NOT require eligibility recomputation

**Disabled Row Tooltip Messages**
- Default tooltip for disabled rows: "Both endpoints must be on diagram to add this relationship."
- For App Point Process when both already exist with containment: "Already visualised on this diagram."
- Tooltip is set in `PaletteItem.tsx` based on the `isRelationshipEnabled` prop

**Preserve Data Movement Arrow Rendering**
- When adding a Data Movement edge, `createRelationshipEdge` must set `line_type: 'SOLID'` and `arrow_end: 'ARROW'`
- The arrow points from source to target Application Point
- The label_text defaults to the Logical Data Entity name from `getDataMovementEntityName`
- This is existing behaviour in `relationshipUtils.ts` that MUST NOT regress

## Existing Code to Leverage

**relationshipUtils.ts**
- Contains `isRelationshipRowEnabled` master function that dispatches to per-type enable functions
- Contains `findNodeForEntity`, `areEndpointsOnDiagram`, `getContainmentState` utilities
- Contains `createRelationshipEdge` factory that handles edge styling per relationship type
- Add new `getEntitiesOnDiagram` helper here to compute Set-based lookups

**PaletteSection.tsx**
- Calls `isRelationshipRowEnabled` in `getRelationshipEnabled` function
- Receives `diagram` prop containing `diagram_nodes` array
- Need to ensure this is always the active diagram's data, not stale state

**PalettePanel.tsx**
- Receives `diagram` and `currentDiagramId` props
- Passes `diagram` to each `PaletteSection` component
- The `diagram` is derived from `state.model.diagrams.find(d => d.id === currentDiagramId)` in parent DiagramsView

**ArchitectureContext.tsx**
- Contains SELECT_DIAGRAM action that updates `selectedDiagramId`
- Contains ADD_DIAGRAM action that adds new diagram and selects it
- State structure: `model.diagrams[]` array with each diagram having `diagram_nodes[]`

**DiagramSelector.tsx**
- Handles +New and +Copy buttons that dispatch ADD_DIAGRAM action
- The new diagram is automatically selected after creation

## Out of Scope

- Changes to the meta-model JSON schema or relationship data structures
- Visual style changes to relationship lines or labels beyond ensuring existing arrowhead behaviour
- Caching optimizations for eligibility computation
- Changes to how relationships are created or added (beyond fixing eligibility checks)
- Batch operations or performance optimizations for large node counts
- Changes to the PaletteContextMenu component behaviour
- Changes to entity node enable/disable logic (only relationship rows are affected)
- Multi-diagram concurrent editing scenarios
- Undo/redo integration for eligibility state
- Keyboard shortcuts for relationship operations
