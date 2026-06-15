# Specification: Relationship Visualisation and RHS Palette Behaviour

## Goal

Standardise how meta-model relationships are visualised on diagrams and how the RHS Relationships palette enables/disables rows and handles add interactions (left-click and context menu), ensuring each relationship type renders with its correct visual pattern.

## User Stories

- As an architect, I want relationship rows in the RHS palette to be enabled only when both endpoints are on the diagram, so I can quickly add visualisations for existing model relationships.
- As an architect, I want to add relationships via left-click or right-click context menu, with disabled rows blocking both interactions and showing visual feedback.

## Specific Requirements

**User-Process Relationship Visualisation**
- Meta-model: `business_user_processes`
- Draw a dashed line between Business User (stick-man) and Business Process (green box)
- Line connects to outer edges of nodes, not centres
- Use `line_type = DASHED` with default dash pattern from `edgeRendering.defaultDashedPattern`
- No arrow-heads or multiplicity labels required
- Create diagram_edge with source/target node IDs and edge_points for geometry

**App Point-Process Relationship (Containment)**
- Meta-model: `application_point_business_processes`
- Represented as containment, NOT a visible line
- Business Process appears as green box inside the blue Application Point node
- Application Point auto-sizes using existing compound layout: 5px horizontal padding, 5px vertical padding, 5px gap between stacked processes
- Use existing `calculateParentSizeWithHeights`, `calculateChildPositionWithHeights` from `compoundLayout.ts`
- Set `parent_node_id` on the Process node to reference the Application Point node

**Logical ER Relationship Visualisation**
- Meta-model: `logical_data_entity_relationships`
- Draw line between source and target logical entity nodes
- Display two multiplicity labels based on `relationship_type` cardinality:
  - ONE_TO_ONE: "1" near source, "1" near target
  - ONE_TO_MANY: "1" near source, "m" near target
  - MANY_TO_ONE: "m" near source, "1" near target
  - MANY_TO_MANY: "m" near source, "m" near target
- Labels positioned close to entity edges, both selectable and draggable
- Persist label positions in `label_pos_x`, `label_pos_y` (may need source/target variants)

**Logical-Physical Entity Relationship**
- Meta-model: `logical_data_entity_physical_data_entities`
- Simple solid line between logical entity node and physical entity node
- No labels or arrows required
- Uses default line style (SOLID) unless overridden

**Logical-Physical Attribute Relationship**
- Meta-model: `logical_data_attribute_physical_data_attributes`
- Simple solid line between logical attribute node and physical attribute node
- Rare usage but consistent behaviour with other simple relationships

**Data Movement Relationship Visualisation**
- Meta-model: `data_movements`
- Solid line with arrow-head at target Application Point
- Set `arrow_end = ARROW`, `line_type = SOLID`
- Default label text: `logical_data_entities[data_movement.data_entity_id].name`
- Label positioned at midpoint of edge_points, selectable and draggable
- Label supports existing font/colour styling from InspectorPanel

**RHS Relationships Panel Enable/Disable Logic**
- Each relationship row evaluates enable state based on endpoint presence on diagram
- User-Process: enabled if BOTH Business User node AND Business Process node on diagram
- App Point-Process: 3 cases - A present P missing (enabled, add P inside A), neither present (enabled, add both), both present (disabled)
- Logical ER: enabled if BOTH source and target logical entity nodes on diagram
- Logical-Physical Entities: enabled if BOTH logical entity AND physical entity nodes on diagram
- Logical-Physical Attributes: enabled if BOTH logical attribute AND physical attribute nodes on diagram
- Data Movements: enabled if BOTH source AND target Application Point nodes on diagram

**Relationship Row Interactions**
- Left-click on enabled row: immediately add relationship visualisation to diagram
- Right-click on enabled row: show context menu with "Add" option (same effect as left-click)
- Disabled rows: greyed text, both left-click and right-click "Add" are no-op
- Update `PaletteItem.tsx` to check endpoint presence and render disabled state for relationships
- Update `PaletteContextMenu.tsx` to disable "Add" menu item when row is disabled

**JSON Persistence for Relationships**
- Line relationships stored in `diagram_edges[]` with relationship_type, relationship_id, source_node_id, target_node_id
- Line geometry stored in `edge_points[]` with sequence_order, pos_x, pos_y
- Label positions stored in `label_pos_x`, `label_pos_y` fields on DiagramEdge
- Containment uses `parent_node_id` on child DiagramNode (no edge created)
- Extend DiagramEdge type if needed for source/target multiplicity label positions

## Existing Code to Leverage

**PalettePanel.tsx and related components**
- Already handles entity add via left-click and context menu
- `handleItemClick`, `handleContextMenuAdd` patterns to extend for relationships
- `handleAddWithBusinessProcesses` shows containment pattern with auto-sizing
- Relationship items currently marked `itemType: 'relationship'` but click is blocked

**Canvas.tsx edge rendering (lines 2200+)**
- Existing edge rendering with path, arrow-heads, labels
- `getEdgeDisplayLabel` for DATA_MOVEMENT label resolution
- `getEdgeStrokeStyle` for line styling (SOLID, DASHED, DOTTED)
- Label hit-testing and drag handling already implemented

**rendering.ts utilities**
- `calculateArrowhead` for arrow-head path calculation
- `getEdgeStrokeStyle` for dash patterns
- `isPointOnLabel`, `measureTextWidth` for label interactions
- `getEdgeDisplayLabel` for DATA_MOVEMENT entity name lookup

**compoundLayout.ts**
- `calculateParentSizeWithHeights`, `calculateChildPositionWithHeights` for containment sizing
- `findLinkedBusinessProcesses` for App Point-Process relationship lookup
- `PADDING`, `DEFAULT_CHILD_WIDTH` constants for layout calculations

**model.ts types**
- `DiagramEdge` with label_pos_x, label_pos_y, arrow_end, line_type fields
- Relationship interfaces: `BusinessUserProcess`, `ApplicationPointBusinessProcess`, etc.
- `LogicalDataEntityRelationship` has `relationship_type` for cardinality

## Out of Scope

- Changes to the underlying meta-model schema
- Adding new relationship types not currently in meta-model
- "Delete from diagram" functionality for relationships (unless already implemented)
- Backend API changes or server-side persistence logic
- Changes to how relationships are created or edited in the meta-model grid views
- Bulk relationship add operations (adding multiple relationships at once)
- Relationship routing or path-finding algorithms (use simple straight lines with edge_points)
- Custom relationship styling beyond existing line_type, line_color, arrow options
- Undo/redo support for relationship operations (unless already implemented at diagram level)
- Attribute-level nodes on diagram (logical/physical attributes rarely placed on diagrams)
