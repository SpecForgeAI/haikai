# Requirements: Activity Diagram Corrective Fixes

## Title
Activity diagram corrective fixes — edge-to-edge flow anchoring + proper label behaviour

## Intent
Correct the two Activity-diagram improvements that did not work previously:
- (A) ensure ALL ActivityFlow edges anchor to node boundaries (not centres)
- (B) fix Activity + ActivityFlow label behaviour (alignment, movability, persistence)

## Scope
- Frontend only (diagram rendering + interaction)
- No backend or schema changes
- Applies ONLY to Activity diagrams

---

## A) ActivityFlow Edge Anchoring (Edge-to-Edge, All Activity Kinds)

### Problem
ActivityDiagramRenderer currently renders ActivityFlow edges using centre-to-centre coordinates, ignoring node geometry. This overrides any previous anchoring attempts.

### Requirements
- All ActivityFlow edges MUST anchor from the boundary of the source node to the boundary of the destination node.
- This must work for ALL activity kinds:
  - Action (rounded rectangle)
  - Decision (diamond)
  - Merge (small diamond)
  - Initial / Final (circle)
- Anchoring logic must be shared and reusable.

### Implementation Steps

1. **Create a shared geometry utility:**
   - Location: `src/utils/geometry/edgeAnchors.ts` (or equivalent)
   - Export function:
     ```typescript
     computeBoundaryIntersection(
       node: DiagramNode,
       targetPoint: { x: number; y: number },
       shape: "RECT" | "DIAMOND" | "CIRCLE"
     ): { x: number; y: number }
     ```

2. **Shape mapping:**
   - Action → RECT
   - Decision → DIAMOND
   - Merge → DIAMOND (scaled size)
   - Initial / Final → CIRCLE

3. **Update ActivityDiagramRenderer:**
   - STOP computing flow endpoints using node centres
   - Instead:
     ```
     sourceCenter = center(sourceNode)
     targetCenter = center(targetNode)
     sourceAnchor = computeBoundaryIntersection(sourceNode, targetCenter, sourceShape)
     targetAnchor = computeBoundaryIntersection(targetNode, sourceCenter, targetShape)
     ```

4. **Render ActivityFlow SVG paths using:**
   - sourceAnchor → targetAnchor
   - arrowhead orientation based on targetAnchor

5. **Ensure no Canvas-level logic overrides the renderer's computed anchors.**

### Acceptance Criteria
- No ActivityFlow line enters the interior of a node
- Decision / Merge diamonds correctly intersect at edges
- Behaviour is consistent regardless of node size or kind

---

## B) Activity + ActivityFlow Label Behaviour (Correct + Usable)

### Problem
- Activity node labels ignore standard alignment rules
- Decision labels are not independently movable
- ActivityFlow labels are not draggable (Canvas cannot hit-test them)

### Requirements

**Activity nodes:**
- Action:
  - Behaves like standard node text
  - Supports horizontal (L/C/R) + vertical (T/M/B) alignment
  - Defaults to CENTER / MIDDLE
- Decision:
  - Default position is BELOW the diamond, centered
  - Label must be movable independently of the node

**ActivityFlow edges:**
- Default label placement stays as-is (midpoint, just above arrow)
- Label must be clickable and draggable
- Label position must persist via diagram data

### Implementation Steps

1. **Action activity labels:**
   - In ActivityNode renderer:
     - STOP hardcoding label at node center
     - USE existing shared text layout utility (same logic as standard DiagramNode rendering)
   - Respect:
     - `node.text_h_align`
     - `node.text_v_align`
   - Default these to CENTER / MIDDLE for Action activities

2. **Decision activity labels:**
   - Do NOT render decision label as inline SVG text on the node
   - Instead:
     - Auto-create a DiagramDecoration when a Decision activity is created
     - Decoration contains:
       - text = activity name
       - position = below diamond (centered)
       - width = reasonable default
   - Decoration must be:
     - Selectable
     - Draggable
     - Resizable
   - Moving the decoration must NOT move the activity node

3. **ActivityFlow labels:**
   - Extend `getEdgeDisplayLabel()` to support entityType = ACTIVITY_FLOW
   - When an ActivityFlow is created:
     - Initialize `edge.label_pos_x` / `edge.label_pos_y`
   - Update ActivityDiagramRenderer:
     - Render flow labels using `edge.label_pos_x` / `edge.label_pos_y`
     - (NOT recomputed midpoint after initial creation)
   - Ensure Canvas hit-testing recognizes ACTIVITY_FLOW labels as draggable

4. **Persistence:**
   - Label positions for:
     - Decision labels (decorations)
     - ActivityFlow labels (edge label_pos)
   - Must be saved with the diagram and restored on reload.

### Acceptance Criteria
- Action activity labels align and behave exactly like standard nodes
- Decision labels appear below diamond by default and can be dragged independently
- ActivityFlow labels can be clicked and dragged without moving the edge
- Reloading the diagram preserves all label positions

---

## Non-Goals
- No changes to backend APIs or schema
- No changes to other diagram types
- No automatic rerouting of flows after user moves labels

## Notes
This spec intentionally corrects ONLY the two failed items from the previous Activity diagram UX improvement spec.
