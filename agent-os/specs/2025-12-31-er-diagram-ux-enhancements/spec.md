# Specification: ER Diagram UX + Rendering Enhancements

## Goal

Enhance the ER diagram experience by implementing a Create+Add modal for LogicalER relationships, preventing duplicate edges on diagrams, ensuring live meta-model sync for ER nodes, and rendering UML-style relationship symbols with cardinality labels on ER edges.

## User Stories

- As a diagram author, I want to create a new Logical ER relationship and immediately add it to my ER diagram in one flow, so that I can quickly model data relationships without switching views.
- As a diagram author, I want the RHS palette to prevent adding duplicate Logical ER edges and provide a context menu to delete existing edges, so that my diagram stays clean and I have clear control over what is visualized.

## Specific Requirements

**A1: Create LogicalErCreateModal Component**
- Create new file: `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.tsx`
- Implement form fields: From Kind (select), From Entity (entity picker), To Kind (select), To Entity (entity picker), Cardinality (select), Relationship (select), Description (textarea optional)
- Follow existing modal/drawer pattern from `CreateAndPlaceDrawer.tsx` for consistent styling and form validation
- Use CSS module for styling following existing patterns in `CreateAndPlaceDrawer.module.css`
- Form validation: both From and To endpoints required before enabling "Create & Add" button

**A2: Wire "+ New Logical ER" Button to Open Modal**
- Modify `frontend/src/components/DiagramsView/PalettePanel.tsx`
- Update `handleCreateButtonClick` for `LOGICAL_DATA_ENTITY_RELATIONSHIP` case to open the new modal instead of immediately creating a blank relationship
- Add modal state management: `logicalErModalOpen: boolean`
- Pass `metaModel` to modal for entity picker options

**A3: Implement Create & Add Flow**
- On modal submit: dispatch `ADD_RELATIONSHIP` action to create LogicalER in meta-model
- Call `createRelationshipEdge` from `relationshipUtils.ts` to create the diagram edge
- Dispatch `ADD_DIAGRAM_EDGE` to add edge to current diagram
- Auto-add missing endpoint nodes if needed using `createERDNodeFromEntity` pattern
- Close modal on success

**B1: Compute IsOnDiagram for LogicalER Rows**
- In `frontend/src/utils/relationshipUtils.ts`, add function `isLogicalEREdgeOnDiagram(relationshipId: string, diagramEdges: DiagramEdge[]): boolean`
- Check if any edge has `relationship_type === 'LOGICAL_DATA_ENTITY_RELATIONSHIP'` and `relationship_id === relationshipId`
- Use this in palette item rendering to determine enabled/disabled state

**B2: Disable Click + Grey Styling for On-Diagram Items**
- In `PalettePanel.tsx`, compute `isOnDiagram` for each LogicalER row when rendering the palette section
- Apply disabled CSS class (greyed out, cursor: not-allowed) when `isOnDiagram === true`
- Block click handler when item is already on diagram

**B3: Context Menu with Delete for On-Diagram Items**
- Extend context menu in `PaletteContextMenu.tsx` to show "Delete from Diagram" option for on-diagram LogicalER items
- Implement delete handler that removes edge from diagram but NOT the meta-model relationship
- Use existing `onDeleteEdges` callback pattern from User Interaction implementation

**C1: Live Meta-Model Sync for ER Nodes**
- ER diagram nodes already derive entity names from `ArchitectureContext.model.metaModel` on each render
- Verify that `ERDNode` rendering in Canvas reads entity name from metaModel (not from a cached value)
- Attributes displayed in ERD nodes should read from `getAttributesForEntity(metaModel, ...)` on each render

**C2: Live Meta-Model Sync for ER Edges**
- Edge labels and multiplicity should derive from current `LogicalDataEntityRelationship` values in metaModel
- When rendering cardinality labels, call `getMultiplicityLabels(relationship.cardinality)` using current relationship from metaModel

**D1: Edge Endpoint Boundary Intersection**
- Use existing `calculateEdgePoints` function in `relationshipUtils.ts` which already computes boundary intersection points
- Ensure cardinality labels are positioned near these intersection points, not at node centers

**D2: Render Cardinality Labels Near Endpoints**
- Extend ER edge rendering to display `source_label_text` and `target_label_text` fields
- Use `getMultiplicityLabels(relationship.cardinality)` mapping: ONE_TO_ONE -> (1,1), ONE_TO_MANY -> (1,M), MANY_TO_ONE -> (M,1), MANY_TO_MANY -> (M,M)
- Position labels 10-15px offset from edge endpoints perpendicular to edge direction
- Font: 10px, color: #616161 (or edge line_color)

**D3: Render UML Relationship Symbols**
- Create new file `frontend/src/utils/erEdgeSymbols.ts` with SVG path definitions for each symbol type
- GENERALIZATION: hollow triangle (line fill, stroke only) at TARGET end, solid line
- REALIZATION: hollow triangle at TARGET end, dashed line (stroke-dasharray: 6,3)
- COMPOSITION: filled diamond at SOURCE end, solid line
- AGGREGATION: hollow diamond at SOURCE end, solid line
- ASSOCIATION: no symbol, solid line
- DEPENDENCY: open arrowhead (V shape) at TARGET end, dashed line
- Symbol size: 12px wide x 10px tall for triangles/diamonds

## Visual Design

No mockups provided. Follow existing ER diagram visual conventions in the codebase.

## Existing Code to Leverage

**`frontend/src/components/DiagramsView/CreateAndPlaceDrawer.tsx`**
- Provides modal/drawer pattern with form fields, validation, and submission flow
- Use same CSS patterns for consistent look and feel
- Copy field configuration pattern with `FieldConfig` interface for dynamic form rendering

**`frontend/src/utils/relationshipUtils.ts`**
- Contains `getMultiplicityLabels()` function already mapping cardinality to source/target labels
- Contains `createRelationshipEdge()` for creating DiagramEdge from relationship
- Contains `isLogicalEREnabledWithSets()` for checking if endpoints are on diagram
- Extend with `isLogicalEREdgeOnDiagram()` function

**`frontend/src/utils/erdUtils.ts`**
- Contains ERD node sizing and attribute formatting utilities
- Use `getAttributesForEntity()` for live attribute lookup
- Use `formatAttribute()` for consistent attribute display

**`frontend/src/contexts/ArchitectureContext.tsx`**
- Central state management with `ADD_RELATIONSHIP`, `ADD_DIAGRAM_EDGE` actions
- Live state updates automatically trigger re-renders of consuming components
- ER diagram components reading from context will automatically reflect meta-model changes

**`frontend/src/utils/userInteractionEdgeRendering.ts`**
- Provides pattern for custom edge styling (dotted lines, colors, opacity)
- Follow similar structure for ER edge symbol rendering functions
- Use `shouldRenderAsUserInteractionEdge()` pattern for ER symbol detection

## Out of Scope

- Backend API changes for LogicalDataEntityRelationship persistence (already handled)
- Schema changes to LogicalDataEntityRelationship model (already has required fields)
- Meta-Model View table editing of LogicalER (already exists and works)
- Non-ER diagram types (General, Activity, State, Sequence diagrams)
- Edge label dragging/repositioning (use default positioned labels)
- Undo/redo support for the new modal flow
- Keyboard shortcuts for modal actions
- Bulk operations (multi-select and delete multiple relationships)
- Filtering or searching within the LogicalER palette section
- Tooltip explanations for UML symbol meanings
