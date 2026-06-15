# Requirements: Default Generic Node Spawn Position at (100,100)

## Title
Default generic node spawn position at (100,100) instead of viewport/canvas center

## Scope
Frontend-only

## Increment
Single change — replace "spawn at viewport/canvas center" with deterministic (pos_x,pos_y)=(100,100) for generic add flows (General, ER, Activity, State). Preserve all existing child-layout rules for multi-node visualizations.

## Context
- We repeatedly attempted viewport-centered placement, but nodes ended up around the middle of the 2000x2000 canvas (often off-screen).
- We now want a simple deterministic rule:
  - Any "generic add flow" that creates a top-level DiagramNode places that top-level node at pos_x=100, pos_y=100.
- Exclusions:
  - Sequence diagram placement logic remains unchanged (participants/messages/fragments/layout).
  - Any child-node positioning rules (padding/margins/stacking inside parent) remain unchanged.
  - For multi-node adds (e.g., parent + children), ONLY the top-level parent's spawn origin changes to 100,100; all child placement calculations remain as-is.

## Acceptance Criteria

1. When adding a single node via palette (existing entity) on General/ER/Activity/State diagrams, the created DiagramNode has:
   - pos_x === 100
   - pos_y === 100

2. When using Create-and-Place (drawer) on General/ER/Activity/State diagrams, the created DiagramNode has:
   - pos_x === 100
   - pos_y === 100

3. For ER diagrams that create ERD-style nodes (data entities with embedded attributes), the ERD node has:
   - pos_x === 100
   - pos_y === 100

4. For multi-node visualizations that create a new parent + children in one action (e.g., Business Process/Application wrappers, nested parents):
   - the new parent's top-left is placed at (100,100)
   - children are still positioned using existing child layout helpers (no change to padding/margins/size rules)

5. No changes to Sequence diagram positioning.

## Implementation Details

### A) Introduce a single source of truth constant for spawn origin
- File: frontend/src/utils/nodeCreation.ts
  - Add export const DEFAULT_NODE_SPAWN_ORIGIN = { x: 100, y: 100 };
  - Update calculateNodePlacement() to return { pos_x: 100, pos_y: 100 } (remove cascading/center-left behavior).

### B) Make generic node creation ignore viewportCenter and always spawn at (100,100)
- File: frontend/src/utils/nodeCreation.ts
  1. createDiagramNodeFromEntity(...)
     - Remove viewportCenter-based positioning behavior.
     - Always set:
       - pos_x = DEFAULT_NODE_SPAWN_ORIGIN.x
       - pos_y = DEFAULT_NODE_SPAWN_ORIGIN.y
     - Keep all other fields unchanged.
     - Keep the viewportCenter parameter for compatibility (do not break call sites), but ignore it.

  2. createERDNodeFromEntity(...)
     - Same change: ignore viewportCenter and always set top-level ERD node pos_x/pos_y to (100,100).
     - Keep all ERD sizing/embedded_attribute_ids logic unchanged.

### C) Replace explicit "center at viewport" parent placement with (100,100) for multi-node parent spawns
- File: frontend/src/components/DiagramsView/PalettePanel.tsx
  Update any blocks of the form:
    const center = getCurrentViewportCenter();
    const pos_x = center.x - newSize.width / 2;
    const pos_y = center.y - newSize.height / 2;
  to:
    const pos_x = 100;
    const pos_y = 100;

  Specifically update the parent-placement blocks at/around:
  - ProcessActivity auto-create parent placement (isNewParent block)
  - Application/BusinessProcess wrapper parent placement blocks (the ones that recalc children after setting parent pos)
  - Any other isNewParent parent-centering blocks in this file

  IMPORTANT:
  - Do NOT change the child re-positioning code that runs after the parent is positioned (keep recalculation logic as-is).
  - Do NOT change child size rules, padding, margins, labelHeight calculations.

### D) Disable/stop using cascade offset and viewport center for create-and-place and palette add (generic add flows)
- File: frontend/src/components/DiagramsView/PalettePanel.tsx
  1. handleCreateAndPlace:
     - Remove offsetPosition logic based on viewport center and CASCADE_OFFSET for generic node creation.
     - Call createDiagramNodeFromEntity / createERDNodeFromEntity as today (can still pass offsetPosition if present), but since nodeCreation now ignores viewportCenter, the new node will spawn at (100,100).
     - Remove cascadeState.count increment if it becomes unused in this flow (or leave it but ensure it no longer affects position).

  2. handleAddExistingEntity (palette click add):
     - Remove dependence on getCurrentViewportCenter for placement.
     - Continue to call createDiagramNodeFromEntity / createERDNodeFromEntity as today; position will now be (100,100).
     - Ensure this path still preserves:
       - duplicate checks
       - special handling for PROCESS_ACTIVITY (which has its own parent/child logic and must now place new parent at 100,100 per section C)

  3. handleContextMenuAdd:
     - Remove viewport-center intent; continue to create node as today; position is now (100,100).

### E) Advanced Add layout: ensure root/top-level parent starts at (100,100)
- File: frontend/src/utils/compoundLayout.ts
  - In layoutAdvancedAddSelection(...):
    - Replace "Calculate root origin (centered at viewport)" with fixed origin:
      - rootX = 100
      - rootY = 100
    - Do this for BOTH grid and standard layout branches.
  - Keep spacing preset logic and size measurement logic unchanged.
  - This ensures the outermost wrapper (the root parent) is anchored at (100,100), and all children remain laid out relative to it using existing rules.

## Tests

### 1) Update viewport-centered node tests to fixed spawn origin
- File: frontend/src/__tests__/create-and-place-flow.test.ts
  - Replace "Viewport-Centered Node Positioning" describe-block with assertions that:
    - createDiagramNodeFromEntity(..., viewportCenter) returns pos_x=100 pos_y=100 (ignore viewportCenter input)
    - Include one test to ensure viewportCenter is ignored (e.g. pass {x:600,y:500} and still expect 100,100).

### 2) Remove or rewrite cascade offset tests
- File: frontend/src/__tests__/create-and-place-flow.test.ts
  - Remove "Cascade Offset for Consecutive Creates" tests OR rewrite to confirm cascade does not affect placement for generic nodes.
  - Preferred: remove the cascade helper test entirely since this behavior is explicitly no longer desired for generic node placement.

### 3) Update Advanced Add layout tests that assume centering
- Files:
  - frontend/src/__tests__/advanced-add-interface-layout.test.ts
  - frontend/src/__tests__/advanced-add-interface-parent-wrapping.test.ts
  - frontend/src/__tests__/advanced-add-interface-parity-integration.test.ts
  - Any other tests calling layoutAdvancedAddSelection(...)
  Update expectations so that the root/top-level node origin is now anchored at (100,100) instead of being centered around the provided viewportCenter.
  - Keep relative positioning expectations intact (i.e., children offsets relative to root should remain the same).
  - If tests assert absolute X/Y values derived from viewportCenter, recompute them assuming rootX=100/rootY=100.

## Non-Goals
- Do not change Sequence diagram placement, editor, or renderer.
- Do not change diagram persistence format or backend APIs.
- Do not introduce new auto-layout beyond anchoring root/top-level spawns to (100,100).

## Definition of Done
- All unit tests pass.
- Manual verification:
  - Add any single entity node from palette on General/ER/Activity/State → node appears at (100,100).
  - Create-and-place entity on those diagrams → node appears at (100,100).
  - Advanced Add / parent-wrapper flows → new parent appears at (100,100) with children correctly laid out inside.
  - Sequence diagrams unchanged.
