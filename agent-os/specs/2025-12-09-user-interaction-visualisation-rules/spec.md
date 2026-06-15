# Specification: User Interaction Visualisation and Enable/Disable Rules

## Goal
Finalise the behaviour of User Interactions as a relationship (not an entity), defining how they are visualised as dotted edges with labels, and establishing clear enable/disable rules for the RHS palette based on node presence and existing edges.

## User Stories
- As a solution architect, I want to add User Interactions as dotted lines between App_Business_Point nodes so that I can visualise user journeys without cluttering the diagram with extra nodes.
- As a diagram editor, I want the RHS palette to correctly enable/disable User Interaction rows based on whether required nodes exist and edges are already present so that I can only add valid interactions.

## Specific Requirements

**User Interaction is a relationship, not an entity**
- Interactions are NEVER drawn as a node/box on the diagram
- Visualised purely as dotted edges with an attached moveable label
- Interaction rows appear in the RHS palette "User Interactions" section below "App Point <-> Business Point"

**Two edge types for User Interactions**
- MAIN edge: For Case A, connects Primary and Secondary App_Business_Point nodes; For Case B, connects User node and Primary App_Business_Point node
- USER_LINK edge (Case A only): Connects User node to the midpoint of the MAIN edge
- Both edges use `line_style: 'dotted'` and `relationship_type: 'USER_INTERACTION'`
- Store as DiagramEdge with a `subType` field of "MAIN" or "USER_LINK"

**Interaction label rendering**
- Label displays the Interaction `name` field attached to the MAIN edge
- Initially positioned at geometric centre of the MAIN edge
- Label is moveable via drag (updates `label_pos_x`, `label_pos_y` in edge storage)
- Deleting edges does NOT delete the underlying Interaction meta-model row

**Case A: Interaction with Primary + Secondary App_Business_Point**
- Requires `primary_app_business_point_id` = P (non-null) and `secondary_app_business_point_id` = S (non-null)
- RHS row ENABLED when: P node on diagram, S node on diagram, NO interaction edges (MAIN or USER_LINK) for this Interaction exist
- User node presence is NOT required for row enablement
- Adding draws MAIN edge between P and S; if User node exists, also draws USER_LINK to midpoint

**Case B: Interaction with only Primary App_Business_Point**
- Requires `primary_app_business_point_id` = P and `secondary_app_business_point_id` = null
- RHS row ENABLED when: P node on diagram, U (User) node on diagram, NO interaction edges for this Interaction exist
- Adding draws single MAIN edge between User and Primary App_Business_Point
- No separate USER_LINK edge needed in Case B

**Temporal validity pre-filter**
- Interaction visible in RHS only if I.valid_from <= T <= I.valid_to (null treated as open-ended)
- User, Primary, and Secondary entities must also be valid at T
- All edge evaluation uses diagram-level view_quarter (T) for filtering

**Deleting USER_LINK edge only (Case A)**
- MAIN edge remains, interaction still considered present on diagram
- RHS row remains DISABLED
- User can later re-add USER_LINK via separate action (future enhancement)

**Deleting MAIN edge**
- If USER_LINK exists, automatically cascade-delete the orphaned USER_LINK edge
- After removing all edges for Interaction I at T, RHS row becomes ENABLED again (if required nodes still present)

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**DiagramEdge interface in types/model.ts**
- Existing edge structure with `relationship_type`, `relationship_id`, `source_node_id`, `target_node_id`
- Already supports `label_text`, `label_pos_x`, `label_pos_y` for moveable labels
- Has `line_type`, `line_dashes` fields for styling; use dotted line configuration
- Add new `subType?: 'MAIN' | 'USER_LINK'` field for User Interaction edges

**RELATIONSHIP_EDGE_TYPES constant in types/model.ts**
- Already defines `USER_INTERACTION: 'USER_INTERACTION'` for edge relationship_type
- Use this constant when creating new interaction edges

**relationshipUtils.ts enable/disable pattern**
- `isRelationshipRowEnabled()` function provides pattern for enable/disable logic
- `getEntitiesOnDiagram()` returns Sets for O(1) entity presence lookups
- `findNodeForEntity()` helper finds diagram nodes by entity type and ID
- Replicate pattern for User Interaction enable logic with added edge-presence check

**interactionRendering.ts utilities**
- `calculateInteractionPaths()` already calculates path geometry for interaction edges
- `generateLinePath()` and `getStrokeDasharray()` handle dotted line rendering
- Extend or reuse for MAIN and USER_LINK edge path calculation

**PalettePanel.tsx relationship handling**
- `handleAddRelationship()` provides pattern for adding relationship edges
- RHS palette section rendering with enable/disable styling
- `getRelationshipsForSection()` retrieves relationship arrays from meta-model

## Out of Scope
- Creating Interaction meta-model rows from the diagram (editing happens in grid views)
- Context menu actions on interaction edges (beyond standard edge operations)
- Drag-to-create interaction edges between nodes
- Animation or transition effects when adding/removing interaction edges
- Re-adding USER_LINK edge after deletion (future enhancement)
- Version-splitting logic for temporal edge changes (handled by existing infrastructure)
- Interaction node visualisation (explicitly excluded - interactions are edges only)
- User Interaction hover tooltips or detailed inspector panel
- Batch operations for adding/removing multiple interaction edges
- Undo/redo for interaction edge operations (use existing undo infrastructure)
