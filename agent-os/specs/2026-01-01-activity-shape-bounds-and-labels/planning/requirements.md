# Requirements: Activity Diagram Shape Bounds and Interactive Labels

## Title
Activity diagram fixes — make Decision + Flow labels interactive, and unify shape geometry with node bounds for correct resizing + edge anchoring

## Intent
Fix the remaining Activity diagram issues:
1. Decision Activity label defaults below diamond and is draggable (independent of node).
2. ActivityFlow labels are clickable + draggable (persisted via edge label_pos).
3. Activity shapes (Decision/Merge/Circle) MUST be rendered from node bounds (w/h) so resizing changes the visible shape.
4. ActivityFlow edge anchoring must intersect the TRUE visible boundary (now equal to node bounds).

## Scope
- Frontend only
- Activity diagram renderer + Canvas label interaction integration
- No backend/schema changes

---

## A) Unify Visual Shapes with Node Bounds (Fix Resize + Anchoring)

### Problem
Activity nodes currently have a resizable transparent bounding box (node.w/node.h), but the visible shape (diamond/circle) does not match or scale with that box. Edges anchor to the bounding box, not the visible shape.

### Requirements
- For ALL Activity node kinds, the visible shape MUST be derived directly from node.w/node.h.
- Resizing a node MUST resize the visible shape.
- Merge diamond must be smaller by default, but still scales with node size when resized.

### Implementation

1. **Update Activity node rendering to use node bounds for SVG geometry:**
   - **Action:** Render rounded rectangle using full node bounds (0..w, 0..h) with padding for stroke.
   - **Decision:** Render diamond polygon that fills node bounds:
     ```
     points = [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
     ```
   - **Merge:** Same diamond rendering as Decision (fill bounds), BUT default node.w/node.h is much smaller at creation (≈ 1/3 size of Decision defaults).
   - **Initial/Final:** Render circle/target using radius = min(w,h)/2, centered in bounds.

2. **Remove any "fixed-size diamond" logic.**
   - No hardcoded pixel-size diamonds.
   - The diamond must always follow node.w/h.

3. **Ensure resize handles apply to node.w/h (existing behaviour)**, and visible shape uses node.w/h so they stay aligned.

### Acceptance Criteria
- The merge diamond visible shape matches the resize box.
- Resizing merge/decision changes diamond size.
- Edges computed from node bounds now align to visible edges.

---

## B) ActivityFlow Anchoring Uses Boundary Intersection Against Shape

### Problem
Existing anchor math intersects against the node bounding box, but because the visible shape didn't match bounds, it looked wrong.

### Requirements
- After section A, node bounds == visible shape, so anchors must be recomputed using:
  - RECT for Action
  - DIAMOND for Decision/Merge
  - CIRCLE for Initial/Final
- All ActivityFlow edges anchor edge-to-edge.

### Implementation

1. **Keep/introduce shared boundary intersection utility:**
   - Location: `src/utils/geometry/edgeAnchors.ts`
   - Function: `computeBoundaryIntersection(node, targetPoint, shape)`

2. **In ActivityDiagramRenderer, compute anchors:**
   ```
   sourceAnchor = computeBoundaryIntersection(sourceNode, targetCenter, sourceShape)
   targetAnchor = computeBoundaryIntersection(targetNode, sourceCenter, targetShape)
   ```

3. **Render edge path from sourceAnchor to targetAnchor.**

### Acceptance Criteria
- Edges touch visible boundaries for all shapes.
- No line runs through node interiors.

---

## C) Decision Labels — Default Below Diamond and Draggable

### Problem
Decision label is still rendered as normal node text (center/middle), and is not independently draggable.

### Requirements
- Decision label default position:
  - Horizontally centered
  - Placed BELOW the diamond
- Decision label must be draggable independently (because it can clash with flow arrows)
- Label must persist in the diagram JSON

### Design Choice
Use a DiagramDecoration for the decision label (text-only), because:
- Decorations are already selectable/drag-resizable in Canvas
- It persists cleanly
- It avoids creating a new label-object model

### Implementation

1. **When rendering a Decision node:**
   - Do NOT render the node's internal text for Decision kind.
   - Decision diamond should have no internal label text.

2. **Auto-create a decoration when a Decision node is created:**
   - In the code path that handles "+ New Activity" when kind=Decision:
     - Create DiagramNode as before
     - Create DiagramDecoration:
       ```
       decoration.entity_type = "ACTIVITY_LABEL"
       decoration.text = activity.name
       decoration.pos_x = node.pos_x + node.w/2 - defaultLabelW/2
       decoration.pos_y = node.pos_y + node.h + 8
       decoration.w/h = defaults suitable for wrapping (e.g. 140x40)
       decoration.parent_node_id = node.id (or store in decoration.metadata_json)
       ```
   - Persist decoration with the diagram.

3. **Backfill existing diagrams:**
   - On diagram load, if Decision nodes exist and no corresponding label decoration exists, auto-generate the decoration in-memory and save on next diagram save (do NOT block load).
   - Matching rule:
     - `decoration.metadata_json.parentNodeId == decisionNode.id`
     - OR decoration.text == node label and near node bounds

### Acceptance Criteria
- Decision label appears below diamond by default.
- Clicking the label selects it.
- Dragging moves only the label, not the node.
- Label persists across reload.

---

## D) ActivityFlow Labels — Clickable + Draggable (Persisted via edge.label_pos)

### Problem
ActivityFlow label is rendered as plain SVG text, not integrated with Canvas label dragging.

### Requirements
- Default label position stays current (midpoint just above line)
- Label must be clickable and draggable
- Dragging updates edge.label_pos_x/y and persists in diagram JSON

### Implementation

1. **Ensure ACTIVITY_FLOW edges have label_pos_x/y:**
   - When creating an ACTIVITY_FLOW diagram edge:
     - If label_pos_x/y not set: set to midpoint(sourceAnchor, targetAnchor) with y offset -8

2. **Extend getEdgeDisplayLabel() to support ACTIVITY_FLOW:**
   - Resolve the referenced ActivityFlow relationship (by edge.toRefId or equivalent)
   - Build label:
     - If flow.condition_text exists, use it (e.g. ">= 50")
     - Else if flow.trigger_label exists, use that
     - Else empty string

3. **Render edge labels using the same interactive mechanism used for other edges:**
   - If Canvas already has "draggable edge label" support: ensure ACTIVITY_FLOW edges opt into it (no filtering by type)
   - Otherwise implement:
     - Label rendered at (edge.label_pos_x, edge.label_pos_y)
     - pointerdown starts label-drag mode
     - mousemove updates label_pos in state
     - mouseup commits

4. **Ensure ActivityDiagramRenderer does NOT override label positions after drag:**
   - If label_pos_x/y is set, always use it.

### Acceptance Criteria
- Flow label can be clicked (shows selection handles if applicable).
- Dragging moves label only.
- Saved diagram preserves label position.

---

## Non-Goals
- No routing/avoidance algorithm for edge overlaps
- No snap-to-grid required
- No changes to State/Sequence rendering

## Definition of Done
- Merge/Decision shapes resize visually with the node bounds.
- ActivityFlow arrows anchor to visible edges.
- Decision labels default below diamond and are draggable.
- ActivityFlow labels are draggable and persisted.
