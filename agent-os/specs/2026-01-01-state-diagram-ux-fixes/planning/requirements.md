# Requirements: State Diagram UX Fixes

## Title
State diagram fixes: resize drives rendering (square initial/final), add StateTransition via 2-click flow, normal-state label alignment defaults + toolbar controls

## Intent
Bring State diagram UX/rendering in line with Activity diagrams by:
1. Making node resize change the rendered state shape (square-only for Initial/Final, rectangular for Normal)
2. Implementing [+ New State Transition] creation via 2-click source/target selection exactly like Activity Flow
3. Ensuring Normal state labels default to center/middle and respond to the toolbar H/V alignment controls like Action activities

## Scope
Frontend-only changes (no backend schema/API changes) to State diagram rendering and diagram-view creation flow.

## Problems to Fix
1. Resizing state nodes changes the selection box but not the rendered shape.
2. [+ New State Transition] enters selection mode but does not add the transition edge after selecting 2 states.
3. Normal state label default alignment is not center/middle and does not behave like Action activity label alignment via toolbar H/V controls.

---

## Goals / Acceptance Criteria

### A. Resizing
- **Initial State and Final State:**
  - Resize is square-only (w == h).
  - No enforced minimums (allow small sizes).
  - Rendered symbol scales with node width/height.
- **Normal State:**
  - Resize is rectangular.
  - Rendered rounded rectangle scales with node width/height.

### B. State Transition Creation
- In State diagram RHS:
  - Clicking [+ New State Transition] starts a 2-click mode:
    - Click #1 selects source State node
    - Click #2 selects target State node and commits the transition
    - Esc cancels mode
- The committed transition:
  - Creates a diagram edge with entity_type == STATE_TRANSITION and entity_id == newly created StateTransition id
  - Edge connects source and target state nodes and appears immediately
- Behaviour mirrors Activity diagram "New Activity Flow" UX and code structure.

### C. Normal State Labels
- Default label alignment for Normal states is H=C, V=M.
- User can change H/V alignment using toolbar buttons; changes apply to the selected Normal state node.
- Alignment persists (stored on the node or node-label fields consistent with current node text alignment implementation used by Action activities).

---

## Implementation Plan

### 1) Make State diagram renderer use node bounds for visible shape and enforce square resize for Initial/Final

#### 1.1 Detect state kind for a diagram node
- Add helper (reuse existing patterns from Activity helpers if present):
  - `getStateKindForNode(node, metaModel): StateKind | null`
  - Looks up the State entity referenced by the node (node.entity_type == STATE, node.entity_id).
  - Returns kind enum (INITIAL | NORMAL | FINAL).

#### 1.2 Enforce resize constraints in Canvas for State nodes
- In `src/components/DiagramsView/Canvas.tsx`, in the node resize handler:
  - Add branch for node.entity_type == STATE:
    - If stateKind in { INITIAL, FINAL }:
      - Do NOT apply min width/height constraints.
      - Enforce square: set height = width (or width = height) based on dominant resize delta.
    - Else (NORMAL):
      - Keep existing min rules for general rectangles (or current defaults).
      - Allow rectangular resize.

#### 1.3 Ensure State rendering uses node.width/height
- In `src/components/DiagramsView/StateDiagramRenderer.tsx`:
  - Ensure the visual shape uses node.width/node.height (NOT fixed constants).
  - INITIAL/FINAL:
    - Render as circle sized to fit bounding box: radius = min(width,height)/2
  - NORMAL:
    - Render rounded rectangle with width/height from node.

### 2) Implement [+ New State Transition] 2-click creation like Activity Flow

#### 2.1 Add/create UI state for "create transition" mode
- Locate state diagram palette/editor component (likely PalettePanel state section).
- Add state:
  - `isCreatingStateTransition: boolean`
  - `stateTransitionSourceNodeId: string | null`
- Clicking [+ New State Transition]:
  - sets isCreatingStateTransition=true, sourceNodeId=null
  - button changes to [Cancel Transition] and displays instructions.

#### 2.2 Wire Canvas click handling for selection mode
- In `Canvas.tsx`, mirror the Activity Flow implementation:
  - When `isCreatingStateTransition` is true:
    - Only accept clicks on nodes where node.entity_type == STATE
    - First valid click sets `stateTransitionSourceNodeId`
    - Second valid click:
      - Creates a new StateTransition meta-model entity
      - Creates a DiagramEdge:
        - edge.entity_type = STATE_TRANSITION
        - edge.entity_id = newTransitionId
        - edge.from_node_id = sourceNodeId
        - edge.to_node_id = targetNodeId
        - edge.arrow_kind = ARROW
      - Persist diagram update immediately
      - Exit mode: isCreatingStateTransition=false, sourceNodeId=null
  - Esc key cancels mode.

#### 2.3 Ensure StateTransition is in validation/known entity types
- Add STATE_TRANSITION to the known/valid diagram entity types list used during diagram load validation.

#### 2.4 Render the transition edge
- In StateDiagramRenderer:
  - Render state transition edges like activity flow edges:
    - Compute anchor points from node boundary intersections:
      - NORMAL uses RECT intersection
      - INITIAL/FINAL uses CIRCLE intersection
    - Use shared boundary-intersection utility.
  - If edge has label text (method/event), render centered above edge.

### 3) Normal state label defaults + toolbar alignment controls

#### 3.1 Default alignment on creation
- When creating a new NORMAL state node:
  - Initialize node.text_align_h = 'CENTER'
  - Initialize node.text_align_v = 'MIDDLE'

#### 3.2 Apply toolbar H/V to selected NORMAL state
- In the toolbar handling:
  - When a node is selected and node.entity_type == STATE:
    - Apply H/V alignment updates using the same mechanism as for Action activity nodes.
  - For INITIAL/FINAL:
    - Ignore alignment toggles or keep centered.

#### 3.3 Render label according to alignment
- In StateDiagramRenderer:
  - For NORMAL state nodes:
    - Render text using node alignment settings (same helper used for generic nodes / action activities).
  - For INITIAL/FINAL:
    - Keep existing label behaviour (typically none or centered).

---

## Files Expected to Change
- `src/components/DiagramsView/Canvas.tsx`
- `src/components/DiagramsView/StateDiagramRenderer.tsx`
- `src/components/DiagramsView/PalettePanel.tsx` or StateEditor panel component
- `src/components/DiagramsView/DiagramsView.tsx` (if toolbar alignment logic is centralized there)
- `src/utils/*` boundary intersection helper (reuse existing; do not duplicate)
- `src/types/*` (only if STATE_TRANSITION missing from validation enums / union types)

---

## Test Checklist
- Create State diagram:
  - Add Initial, Normal, Final states; resize each:
    - Initial/Final remain square; visual scales; no minimum constraints.
    - Normal resizes rectangular; visual scales.
- Select Normal state:
  - Default label alignment is center/middle.
  - Toggle H/V alignment buttons; label moves accordingly.
- Click [+ New State Transition]:
  - Select source, then target; transition edge appears immediately.
  - Esc cancels selection mode.
  - Transition persists after reload (diagram save/load).
