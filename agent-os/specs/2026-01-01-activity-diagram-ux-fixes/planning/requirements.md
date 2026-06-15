# Requirements: Activity Diagram UX Fixes

## Title
Fix Activity diagram: square-only symbol nodes, correct edge anchoring, RHS greying/delete, draggable flow labels, draggable decision labels

## Intent
Resolve remaining Activity diagram UX/rendering defects by:
1. Enforcing square-only resize + no minimums for Initial/Decision/Merge/Final nodes and ensuring resizing changes the symbol geometry
2. Anchoring ActivityFlow edges to the visible node boundary using a shared boundary-intersection utility with correct shape bounds
3. Greying out RHS items once added + context menu shows Delete
4. Making ActivityFlow labels draggable
5. Making Decision labels default below diamond and independently draggable

## Context / Problem
Current Activity diagram still has:
1. Initial/Decision/Merge/Final nodes can be resized to rectangles and are subject to minimum width/height, causing oversized selection boxes and mismatch between drawn symbol vs resize box.
2. ActivityFlow arrows do not terminate at visible symbol edges because anchor computations use node box (or wrong effective bounds) rather than symbol boundary.
3. Palette RHS list items (Activities / Activity Flows / Activity Partitions) do not grey out once added; right-click still shows Add rather than Delete.
4. ActivityFlow label text (e.g. decision branch condition) is not draggable.
5. Decision Activity text is still rendered centered inside diamond; it should default below diamond and be draggable independently.

## Goals
- For Activity kinds Initial, Decision, Merge, Final:
  - Resize handles enforce square aspect ratio (w == h).
  - No minimum width/height constraints (allow small symbols).
  - Resizing updates the rendered symbol geometry (diamond/circle/etc.) to match the node bounds.
- ActivityFlow edges:
  - Always anchor edge-to-edge on the visible symbol boundary for all activity kinds.
- RHS palette rows:
  - Once an item is on the diagram, its row is greyed/disabled.
  - Right click menu provides Delete-from-diagram, not Add.
- Labels:
  - ActivityFlow labels are draggable.
  - Decision node labels default to below the diamond, centered, and are draggable independently (without changing the node box).

## Non-goals
- No new zoom/scroll features.
- No changes to backend schema/API; this is front-end canvas + palette behavior only.

---

## Implementation Plan

### 1) Enforce square-only + no-minimum sizing for symbol Activities (Initial/Decision/Merge/Final)

#### 1.1 Identify Activity kind for a diagram node
- Add helper in `src/utils/activityNodeRendering.ts` (or a new `src/utils/activityDiagramHelpers.ts`):
  - `getActivityKindForNode(node, model): ActivityKind | null`
  - Looks up the Activity entity referenced by the diagram node (by node.entity_id / refId patterns used in this app) and returns activity_kind.

#### 1.2 Canvas resize constraints: aspect ratio + minimums
- In `src/components/DiagramsView/Canvas.tsx`:
  - Locate node resize handler logic where min width/height is applied (currently using defaults.diagramEditing.minNodeWidth/minNodeHeight and/or defaults.appConfig.node.minWidth/minHeight).
  - Add a conditional branch:
    - If node.entity_type == ACTIVITY and activity_kind in { INITIAL, DECISION, MERGE, FINAL } then:
      - Do NOT apply min width/height (treat min as 0 or 1).
      - Enforce square: when resizing, set height = width (or width = height) based on dominant delta.
  - Ensure the stored node.width/node.height remain square for these kinds.

#### 1.3 Ensure renderer uses node bounds as symbol bounds
- Confirm Activity rendering (`src/utils/activityNodeRendering.ts`) uses width/height passed in.
- If any symbol renderer uses fixed constants or clamps, remove those clamps for the square-only kinds so the symbol fills the node bounds.
  - Initial/Final: circle radius should be min(width,height)/2 (already OK once square enforced).
  - Decision/Merge: diamond vertices should touch the bounding box edges (already OK once square enforced).

### 2) Fix ActivityFlow edge anchoring to visible boundaries using a shared boundary-intersection utility

#### 2.1 Use effective symbol bounds for intersection
- Implement a single utility:
  - `getShapeBoundaryIntersection({ shape, fromCenter, toCenter, bounds }): Point`
  - Shapes: RECT (action), DIAMOND (decision/merge), CIRCLE (initial/final).
- Use node.pos_x/pos_y + node.width/height consistently as the symbol bounds for ALL activity kinds.
  - Because step (1) makes bounds match visual symbol for the special kinds.

#### 2.2 Apply to ActivityFlow edges
- In `src/components/DiagramsView/ActivityDiagramRenderer.tsx`:
  - Locate code that computes start/end points for edges (currently uses getBoundaryIntersectionPoints).
  - Replace with the shared utility:
    - Determine shape type for source and destination:
      - ACTIVITY + kind:
        - ACTION => RECT (rounded rect is fine approximated as RECT for intersection)
        - DECISION/MERGE => DIAMOND
        - INITIAL/FINAL => CIRCLE
    - Compute centers and intersect points against bounds.
  - Ensure arrows render from start intersection to end intersection.

### 3) Grey out RHS palette rows once added + right-click shows Delete

#### 3.1 Determine "already on diagram" for each row type
- In `src/components/DiagramsView/PalettePanel.tsx`:
  - Add helpers:
    - `isEntityOnDiagram(entityType, entityId, diagram)` -> checks diagram.nodes for matching entity_type/entity_id.
    - `isRelationshipOnDiagram(toRefKind, toRefId, diagram)` -> checks diagram.edges where to_ref_kind/id match (used for Logical ER etc).
  - Extend to ACTIVITY_FLOW:
    - `isActivityFlowOnDiagram(flowId, diagram)` -> checks diagram.edges for entity_type == ACTIVITY_FLOW and entity_id == flowId.

#### 3.2 Apply disabled styling + context menu swap
- For Activities / Activity Partitions / Activity Flows collapsible lists:
  - When row is already on diagram:
    - Render with disabled/greyed style.
    - Default click does nothing (or selects the element on diagram if supported).
    - Right click context menu contains Delete (remove node/edge from diagram) instead of Add.
- Ensure "Add" is only offered when not on the diagram.

### 4) Make ActivityFlow label draggable

#### 4.1 Ensure edges have default label position if missing
- When an ActivityFlow edge has label text (condition or label):
  - If edge.label_pos_x/y is null/undefined:
    - Compute default label position at midpoint of the rendered edge, slightly above (existing visual rule).
    - Store into edge.label_pos_x/y on creation OR lazily the first time it is interacted with.

#### 4.2 Canvas hit testing for edge labels
- In Canvas.tsx:
  - Update the label-hit detection logic to treat edges with missing label_pos as having the computed default position for hit-testing.
  - On mouse down within label bounds:
    - Enter label drag mode (existing edge label drag path).
    - When drag starts, persist label_pos_x/y onto the edge so it becomes movable thereafter.

#### 4.3 Renderer uses stored label_pos when present
- In ActivityDiagramRenderer.tsx:
  - When drawing the label:
    - If label_pos_x/y exists, use it.
    - Else use computed default (but do not prevent drag as per 4.2).

### 5) Decision Activity label default below diamond + independently draggable

#### 5.1 Store decision label position on the diagram node
- Extend diagram node model usage for Activity decision nodes:
  - Add optional fields (front-end only if already present in type, otherwise extend type):
    - node.label_pos_x
    - node.label_pos_y
- On creation of a DECISION activity node (where currently it adds a DiagramNode):
  - Initialize:
    - label_pos_x = node center x
    - label_pos_y = node.bottom + 16 (below diamond)
  - This is the DEFAULT; user can drag afterwards.

#### 5.2 Render decision label OUTSIDE the diamond
- In activity node rendering (`src/utils/activityNodeRendering.ts`):
  - For DECISION kind:
    - Do not render the activity name inside the diamond (set showLabel=false for the internal label).
- In ActivityDiagramRenderer.tsx:
  - If node is ACTIVITY kind DECISION:
    - Render a separate SVG text + background near (label_pos_x,label_pos_y).
    - Use the same selection/drag affordances style as edge labels (background rect, text).
    - This label should not affect node width/height.

#### 5.3 Make decision label draggable in Canvas
- In Canvas.tsx:
  - Extend label drag logic to also support node label dragging for DECISION activities:
    - Add hit test for decision label bounds (similar to edge label bounds).
    - On drag: update node.label_pos_x/y.
  - Ensure drag does not move the node itself; it only moves the label.

---

## Acceptance Criteria
- Resizing Initial/Decision/Merge/Final nodes:
  - Always maintains a square selection box.
  - Has no enforced minimum size (can be small).
  - Visually the symbol matches the box size.
- ActivityFlow edges:
  - Arrow endpoints touch visible symbol boundaries (not the center).
- RHS palette:
  - Items already on the diagram appear greyed/disabled.
  - Right click shows Delete (not Add) and removes the element from the diagram.
- Flow label:
  - Can click-drag the label to reposition; position persists.
- Decision label:
  - Defaults below diamond, centered.
  - Can click-drag label independently; position persists.
- No regressions to Action activity label alignment behavior (still supports standard H/V alignment; defaults center/middle).

---

## Files to Change (expected)
- `src/components/DiagramsView/Canvas.tsx`
- `src/components/DiagramsView/ActivityDiagramRenderer.tsx`
- `src/components/DiagramsView/PalettePanel.tsx`
- `src/utils/activityNodeRendering.ts` (and/or add a helper module)
- `src/types/*` (only if needed to add node.label_pos_x/y typing)

---

## Notes / Guidance
- Keep intersection logic centralized (single shared utility) so State diagram can reuse later.
- Prefer minimal new state; reuse diagram node/edge fields where possible.
