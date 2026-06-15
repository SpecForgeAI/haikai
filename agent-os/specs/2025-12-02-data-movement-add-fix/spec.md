# Specification: Data Movement Add Fix

## Goal

Fix the bug where clicking "Add" on a Data Movement relationship in the Palette panel does nothing, even when the row is enabled. After this fix, enabled Data Movement rows will correctly create a diagram edge connecting the source and target Application Point nodes.

## User Stories

- As a diagram author, I want to click "Add" on an enabled Data Movement row and see an arrow with a label appear between the two application nodes on my diagram, so that I can visualize data flows.
- As a diagram author, I want the Data Movement row to be enabled only when both the source and target Application Points are already on my diagram, so I understand when adding is possible.

## Specific Requirements

**Missing onAddEdge prop in DiagramsView**
- The `PalettePanel` component accepts an optional `onAddEdge` prop but DiagramsView.tsx does not pass it (lines 1278-1293)
- Create a `handleAddEdge` callback in DiagramsView that dispatches an ADD_DIAGRAM_EDGE action
- Pass the handler as `onAddEdge={handleAddEdge}` to the PalettePanel component
- Follow the same pattern used by `handleAddNode` for consistency

**ADD_DIAGRAM_EDGE reducer action**
- The reducer in ArchitectureContext.tsx does not define an ADD_DIAGRAM_EDGE action type
- Add the action type: `{ type: 'ADD_DIAGRAM_EDGE'; payload: { diagramId: string; edge: DiagramEdge } }`
- Implement the reducer case to append the edge to the specified diagram's `diagram_edges` array
- Follow the same pattern as the existing ADD_DIAGRAM_NODE action

**Data Movement enable/disable logic correction**
- The `isDataMovementEnabledWithSets` function in relationshipUtils.ts (lines 481-511) checks `source_application_id` and `target_application_id`
- This is correct behavior - it finds Application Points via their `application_id` field
- Verify the enable logic does NOT depend on `data_entity_id` (Logical Data Entity) being on the diagram
- Ensure enabled state recomputes when diagram changes or nodes are added/removed

**getDataMovementNodes function fix**
- The `getDataMovementNodes` function (lines 921-959) uses `findAppPointNode` which only finds nodes with `entity_type === APPLICATION_POINT`
- Data Movements reference Application IDs, but diagrams often have APPLICATION nodes (not APPLICATION_POINT nodes)
- Update to search for APPLICATION, APP_COMPONENT, or SERVICE nodes whose `entity_id` matches the application_point's corresponding field
- Use the same abstraction pattern from `getEntitiesOnDiagram` (lines 89-177)

**Shared handler for consistency**
- Both left-click (`handleItemClick`) and right-click "Add" (`handleContextMenuAddRelationship`) in PalettePanel call `handleAddRelationship`
- The existing shared handler pattern is already correct
- Ensure no code path bypasses the shared handler

**Edge properties for Data Movement**
- The `createRelationshipEdge` function (lines 749-821) already handles DATA_MOVEMENT edges correctly:
  - `relationship_type: RELATIONSHIP_EDGE_TYPES.DATA_MOVEMENT`
  - `relationship_id: <data_movement.id>`
  - `line_type: 'SOLID'`
  - `arrow_end: 'ARROW'`
  - `label_text: <Logical Data Entity name>` via `getDataMovementEntityName`
  - `label_pos_x/y`: midpoint position
- No changes needed to edge creation logic

**Palette refresh on diagram state changes**
- The PalettePanel receives `diagram` as a prop, causing re-render when nodes change
- The `isRelationshipRowEnabled` function is called during render for each relationship row
- Verify this reactive pattern updates enabled state when diagram_nodes changes
- Diagram switch already causes re-render since `currentDiagramId` and `diagram` props change

## Visual Design

No visual assets provided.

## Existing Code to Leverage

**relationshipUtils.ts - createRelationshipEdge function (lines 749-821)**
- Already implements correct edge creation for DATA_MOVEMENT type
- Sets `line_type: 'SOLID'`, `arrow_end: 'ARROW'`, and label with midpoint positioning
- Calls `calculateEdgePoints` to generate the 2-point edge connecting source/target nodes

**relationshipUtils.ts - isDataMovementEnabledWithSets function (lines 481-511)**
- Implements enable/disable logic checking for Application Points via application_id
- Uses the pre-computed EntitiesOnDiagram sets for O(1) lookups
- Already correctly ignores Logical Data Entity presence

**PalettePanel.tsx - handleAddRelationship callback (lines 126-310)**
- Unified handler for adding relationships via left-click or context menu
- Lines 289-303 handle the DATA_MOVEMENT case specifically
- Calls `getDataMovementNodes` then `createRelationshipEdge` then `onAddEdge`

**ArchitectureContext.tsx - ADD_DIAGRAM_NODE action pattern (line 92)**
- Example of how to add elements to a diagram via reducer action
- Use same payload structure: `{ diagramId: string; edge: DiagramEdge }`

**getEntitiesOnDiagram function (lines 89-177)**
- Shows the abstraction pattern for mapping APPLICATION/APP_COMPONENT/SERVICE nodes to application_point IDs
- Same pattern should be applied in getDataMovementNodes for finding actual diagram nodes

## Out of Scope

- Changes to other relationship types (User-Process, Logical ER, etc.)
- Meta-model schema changes to DataMovement or ApplicationPoint types
- Visual styling changes beyond ensuring the arrow renders correctly
- Changes to edge rendering logic in Canvas or rendering.ts
- Refactoring the overall palette panel architecture
- Adding duplicate edge detection (preventing same edge added twice)
- Edge deletion functionality
- Changes to edge label dragging behavior
- Backend API changes
- Unit test implementation (covered by testing requirements in requirements.md)
