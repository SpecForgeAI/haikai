# Spec Requirements: Data Movement Add Fix

## Initial Description

We need to fix a bug in the Diagram view where Data Movement relationships from the right-hand "Palette" panel do not actually get added to the canvas, even when the row appears enabled.

## Context (Current Behaviour)

- In the Meta-model:
  - We have a Data Movement row:
    - source_application_point_id → Application "My App"
    - target_application_point_id → Application "Your App"
    - logical_data_entity_id → Logical Entity "Our Data"
- In the Diagram:
  - The "My App" and "Your App" application points are already on the canvas as nodes.
  - The Logical Entity "Our Data" is *not* on the canvas (this diagram is not an ERD).
- In the Palette (right-hand panel), under "Data Movements":
  - The Data Movement row is enabled (clickable).
  - Right-click → "Add" is available and can be clicked.
  - After clicking "Add", **nothing appears on the diagram** (no line, no arrow, no label).

## Intended Rules (to re-state and enforce)

### 1) Enable/disable logic for Data Movements

- A Data Movement palette row should be **enabled** if, and only if, BOTH:
  - The source Application Point is present as a diagram node in the currently selected diagram, AND
  - The target Application Point is present as a diagram node in the currently selected diagram.
- The presence (or absence) of the Logical Data Entity on the diagram should NOT affect whether the Data Movement can be added.
- Enabled state must be computed **per diagram**: switching diagrams should recompute the enabled/disabled state based on that diagram's nodes.

### 2) Add behaviour for Data Movements

When the user triggers "Add" (either by left-clicking the enabled row, or right-clicking → "Add"), the tool must:

- Create a new `diagram_edge` for the current diagram:
  - `relationship_type = "DATA_MOVEMENT"`
  - `relationship_id = <id of the Data Movement meta-model row>`
  - `source_node_id` = id of the diagram_node representing the source Application Point
  - `target_node_id` = id of the diagram_node representing the target Application Point
  - `edge_points`:
    - At minimum, 2 points:
      - Start point near the source node's border
      - End point near the target node's border
    - Use the existing line-placement utilities we already have for connecting nodes (similar to other relationships).
  - `line_type` = "SOLID" (unless overridden by existing defaults).
  - `arrow_end` = "ARROW" (pointing toward the target Application Point).
  - `label_text`:
    - If `label_text` is already set on the Data Movement's diagram_edge (e.g. previously drawn), keep it.
    - Otherwise, follow our existing default: label is the Logical Data Entity's `name` (e.g. "Our Data").
  - `label_pos_x`, `label_pos_y`:
    - Initial position: mid-point of the first and last edge_points.
- The new edge should immediately render on the diagram:
  - Solid line, with arrow head at the target node.
  - Label visible and draggable as per the existing label behaviour.

### 3) Consistency between click and context menu

Both interaction patterns must call a single shared handler, e.g. `addDataMovementToDiagram(dataMovementId, diagramId)`:
- Left-click row → calls shared handler.
- Right-click → "Add" → calls the same handler.

The shared handler should:
- Validate that both endpoint nodes exist on the current diagram.
- If endpoints are missing (this shouldn't happen for enabled rows), show the existing tooltip message and NO-OP, but also log a warning in the console for debugging.

### 4) Palette refresh when diagram changes

The palette's enabled/disabled state for all relationship rows (especially Data Movements) must be recomputed whenever:
- The selected diagram changes.
- Nodes are added to or removed from the current diagram.
- Nodes are deleted due to cascade from meta-model deletions.

This should reuse whatever "is relationship addable" logic we already have, but updated to match the rules above.

## Implementation Hints

In the React/TS frontend:
- Locate the selector / helper that determines whether a Data Movement row is enabled in the palette (likely something like `canAddRelationshipToDiagram` or relationship-specific helpers).
- Update that helper so that for Data Movements it only depends on the presence of source/target Application Point nodes in the current diagram, not on Logical Entity nodes.
- Implement or refactor the add handler so it:
  - Resolves source/target diagram_node ids from the Application Point ids.
  - Constructs a `diagram_edge` with the correct properties (including arrow_end and label logic).
  - Pushes the new edge into the current diagram's `diagram_edges` in the shared model store.
- Ensure the palette component subscribes to the diagram state so that changes to nodes cause a re-render and reevaluation of the enabled state.

## Testing Requirements

Add/extend tests to cover:

### 1) Enablement logic
- Given a diagram with both source and target app points, Data Movement row is enabled.
- Given a diagram missing either endpoint, Data Movement row is disabled with the tooltip "Both endpoints must be on diagram to add this relationship".

### 2) Add behaviour
- Clicking "Add" for an enabled Data Movement creates a `diagram_edge` with:
  - Correct relationship_type and relationship_id.
  - Correct source_node_id and target_node_id.
  - At least 2 edge_points.
  - `arrow_end = "ARROW"`.
  - `label_text` defaulting to the Logical Data Entity name when not pre-set.

### 3) Diagram switching
- Diagram A has both endpoints → row enabled; "Add" works.
- Diagram B has no endpoints → row disabled.
- Switching between A and B updates the enabled/disabled state correctly.

### 4) Click vs context menu
- Both interactions call the same handler and produce identical diagram_edge objects.

## Goal

After this change, when "My App" and "Your App" are on the diagram and a Data Movement exists between them in the meta-model, the Data Movement row in the palette is enabled and clicking "Add" visibly draws the arrowed line + label between the two application nodes on the current diagram.

## Visual Assets

No visual assets provided.

## Scope Boundaries

### In Scope

- Fix Data Movement add behaviour so edges are actually created
- Ensure enable/disable logic checks only Application Point presence (not Logical Entity)
- Implement shared handler for left-click and right-click "Add"
- Ensure proper edge properties (arrow_end, label_text, edge_points)
- Add tests for enablement, add behaviour, diagram switching

### Out of Scope

- Changes to other relationship types
- Meta-model schema changes
- Visual styling changes (beyond ensuring arrow renders)
- Changes to existing edge rendering logic
