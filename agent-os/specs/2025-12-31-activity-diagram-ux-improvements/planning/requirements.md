title: Activity diagram UX + rendering improvements (partitions header label, flow anchoring, decision flow conditions modal, ACTIVITY_FLOW validation, movable/resizable labels + default text placement)

intent:
  Implement 5 improvements to Activity diagrams:
    1) Partition header name renders correctly for BOTH referenced and non-referenced partitions, centered in header bar.
    2) Activity Flow arrows anchor to node edges (not centers).
    3) When creating a new flow from a Decision activity, prompt for flow condition fields in a modal.
    4) Fix "unknown entity type ACTIVITY_FLOW" when adding existing flows from RHS list; unify both add paths to use ACTIVITY_FLOW.
    5) Add independent labels for Activity nodes + Activity Flow edges (moveable/resizable), and adjust default label positioning rules.

scope:
  in:
    - frontend diagram validation/entity-type registry
    - Activity diagram RHS add/create paths (new button + add-existing from list)
    - Activity diagram renderer (partition header, node label placement, flow anchoring, flow label)
    - diagram label overlay system (new label decorations per node/edge)
  out:
    - backend schema changes
    - advanced edge routing/waypoints
    - multi-condition editor beyond the 3 fields requested

acceptance_criteria:
  - A1 Partition header label:
      - For any ACTIVITY_PARTITION on canvas:
          - if partition.refKind/refId set -> header shows referenced entity name
          - else -> header shows partition.name (current behaviour)
        Header text is horizontally and vertically centered in the dark-purple header area.
  - A2 Flow anchoring:
      - Activity flow arrows connect from source shape boundary to destination shape boundary.
      - No arrow line starts/ends inside an activity's interior.
  - A3 Decision flow condition modal:
      - When user creates a NEW activity flow where source activity.kind == Decision:
          - immediately show a modal to edit:
              - condType
              - condRefKind/condRefId (your "Cond ID" pair)
              - conditionText/expression (your "Condition" column)
          - saving modal persists to the created ActivityFlow entity and updates label/rendering.
  - A4 ACTIVITY_FLOW validation + consistency:
      - Adding an existing Activity Flow from RHS "Activity Flows" list no longer throws "unknown entity type ACTIVITY_FLOW".
      - Both add paths (new flow + add existing) create the SAME diagram representation:
          - diagram edge references ACTIVITY_FLOW (not a node with entity_type ACTIVITY_FLOW).
  - A5 Labels:
      - Activity node labels are draggable and resizable independently from the node shape.
      - Activity flow edge labels are draggable and resizable independently from the edge.
      - Default label placement:
          - Action activity: label vertically centered within the rounded-rect.
          - Decision activity: label positioned BELOW the diamond by default (centered under it).
      - Existing diagrams without explicit label objects still render with sensible defaults.

================================================================================
1) PARTITION HEADER NAME (REFERENCE + MANUAL NAME)
================================================================================

1.1 Resolve displayName for partition header
  files:
    - src/components/DiagramsView/renderers/activity/ActivityPartitionRenderer.tsx (or equivalent)
    - src/utils/entityLabelResolver.ts (if exists) OR add helper

  logic:
    - if partition.refKind && partition.refId:
        displayName = resolveReferencedName(partition.refKind, partition.refId)
        fallback: partition.name (may be empty) then partition.id
      else:
        displayName = partition.name (existing behavior)

1.2 Render displayName centered in header bar
  - Ensure header text uses:
      text-anchor="middle"
      dominant-baseline="middle"
  - Place at:
      x = partitionRect.x + headerWidth/2
      y = partitionRect.y + headerHeight/2

================================================================================
2) ACTIVITY FLOW EDGE ANCHORING (EDGE-TO-EDGE)
================================================================================

2.1 Add generic "edge intersection with shape bounds" util
  file: src/utils/geometry.ts (or existing geometry helper)
  - add function:
      getBoundaryAnchorPoint(sourceRect, targetRect, shapeKind): {x,y}
    where shapeKind ∈ { RoundedRect, Diamond, Circle/Bullseye }
  - implementation approach:
      - compute line from center(source) -> center(target)
      - for rectangle/rounded-rect: intersect ray with rect bounds (standard)
      - for diamond: intersect ray with diamond polygon bounds
      - for circles: intersect with radius

2.2 Update ActivityFlow rendering to use boundary anchors
  files:
    - src/components/DiagramsView/renderers/activity/ActivityFlowRenderer.tsx (or equivalent)
  - instead of start/end = centers:
      start = boundaryAnchor(sourceShape, targetShape)
      end   = boundaryAnchor(targetShape, sourceShape)
  - keep arrowhead orientation based on end-start vector.

================================================================================
3) DECISION FLOW CONDITION MODAL (ON NEW FLOW)
================================================================================

3.1 Identify the NEW-flow creation path
  - This is the "+ New Activity Flow" button mode you added.
  - After creating ActivityFlow entity + diagram edge, you already exit creation mode.

3.2 If source activity kind is Decision, open modal after creation
  files:
    - src/components/DiagramsView/PalettePanel.tsx (activity create section)
    - src/components/DiagramsView/DiagramsView.tsx (state owner for creation mode)
    - src/components/DiagramsView/modals/EditActivityFlowConditionModal.tsx (new)

  behaviour:
    - on successful creation:
        if sourceActivity.activityKind === 'Decision':
          open EditActivityFlowConditionModal with flowId

3.3 Modal fields (map to existing ActivityFlow DTO fields)
  modal inputs:
    - condType (select)  -> ActivityFlow.condType (nullable)
    - condRefKind (select) + condRefId (select/input) -> ActivityFlow.condRefKind/condRefId (nullable)
    - conditionText (textarea) -> ActivityFlow.condition (nullable)

  - "Save" updates the ActivityFlow entity in ArchitectureContext and triggers model save.
  - "Skip" closes modal without changes.

  NOTE:
    - Use the same enums/options you already use in the meta-model grid (Cond Type dropdown etc.).
    - If condRefKind implies entity picking, reuse existing entity picker component if present.

================================================================================
4) ACTIVITY_FLOW VALIDATION + CONSISTENT DIAGRAM REPRESENTATION
================================================================================

4.1 Register ACTIVITY_FLOW as a known entity type (for validation)
  files:
    - src/utils/diagramValidation.ts (or wherever "known types" list lives)
    - any shared entityType registry
  - Add 'ACTIVITY_FLOW' to allowed/known entity types.

4.2 Ensure Activity Flows are represented as EDGES, not NODES
  - Fix the "add existing Activity Flow from RHS list" handler:
      - currently it likely adds a node with entity_type ACTIVITY_FLOW (causing validation + mismatch)
  - Change it to add a diagram edge:
      - fromNodeId = node that corresponds to flow.fromActivityId
      - toNodeId   = node that corresponds to flow.toActivityId
      - edge refKind/refId points at ACTIVITY_FLOW / flowId
  - If either activity node is missing from diagram:
      - show toast: "Add both activities to the diagram before adding this flow."
      - do not create dangling edge.

4.3 Unify both add paths
  - New-flow path already creates edge (confirm).
  - Existing-flow add path now creates same edge shape and same edge schema.

================================================================================
5) MOVEABLE/RESIZABLE LABELS + DEFAULT LABEL POSITIONING
================================================================================

5.1 Introduce label objects for nodes + edges (diagram decorations)
  - Use an existing "decorations" facility if present.
  - Add a new decoration type:
      - kind: 'LABEL'
      - targetKind: 'NODE' | 'EDGE'
      - targetId: nodeId | edgeId
      - x,y,w,h
      - text (optional override) OR derive from entity/flow
      - alignment defaults

  files:
    - src/types/diagram.ts (or similar) add LabelDecoration type
    - src/components/DiagramsView/decorations/LabelDecorationRenderer.tsx (new or extend)
    - src/components/DiagramsView/decorations/DecorationSelection.ts (if exists)

5.2 Auto-create default label decoration when rendering if missing
  - On render, for each Activity node and each Activity Flow edge:
      - if no label decoration exists for target:
          - compute default label box position and size
          - render label in "virtual mode" (not persisted) OR persist on first interaction.
    Prefer: persist immediately when node/edge is created (next bullet).

5.3 Persist label decorations on create
  - When creating:
      - New Activity -> create label decoration with default placement:
          - Action: centered inside rounded-rect
          - Decision: centered below diamond (y = diamondBottom + 8)
      - New Activity Flow -> create edge label decoration near midpoint, slightly above edge.
  - When adding existing Activity/Flow to diagram, also create labels if not present.

5.4 Make labels draggable/resizable independent of node/edge
  - Implement selection handles for label decorations:
      - drag moves x,y
      - resize changes w,h
  - Ensure label interactions do NOT move the underlying node/edge.

5.5 Text vertical alignment rules
  - Action activities:
      - default label alignment: center/center
  - Decision activities:
      - default label alignment: center/top within the label box (since box is under diamond)

================================================================================
MANUAL TEST PLAN
================================================================================

- Create Activity diagram with two partitions referencing entities:
    - header shows referenced names centered in dark bar.
- Add Action and Decision activities; confirm default label positions:
    - Action label centered within shape
    - Decision label below diamond
- Use "+ New Activity Flow":
    - arrow anchors to edges
    - if source is Decision, modal appears and saving condition updates the flow entity and (optionally) label
- Add an existing Activity Flow from RHS "Activity Flows" list:
    - no validation error
    - creates an edge (not node)
- Drag/resize an activity label and a flow label:
    - labels move/resize without moving shapes/edges
    - text wraps within label box

definition_of_done:
  - All 5 improvements implemented and verified via manual test plan.
