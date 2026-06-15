# Specification: Activity Diagram UX Fixes

## Goal
Resolve remaining Activity diagram UX/rendering defects by enforcing square-only resize behavior for symbol nodes, fixing edge anchoring to visible boundaries, improving RHS palette item state management, and enabling draggable labels for flows and decisions.

## User Stories
- As a diagram author, I want Initial/Decision/Merge/Final nodes to maintain square aspect ratios so that standard UML symbols display correctly regardless of resize operations.
- As a diagram author, I want ActivityFlow edges to terminate at the visible symbol boundary so that arrows connect professionally without overlapping or disconnecting from shapes.

## Specific Requirements

**1. Square-only resize for symbol nodes (Initial/Decision/Merge/Final)**
- Enforce width == height constraint during resize for ActivityKind in {Initial, Decision, Merge, Final}
- Remove minimum width/height constraints (minWidth/minHeight) for these symbol kinds to allow small symbols
- In Canvas.tsx calculateResize function, detect ACTIVITY entity_type and lookup activity_kind via getActivityKindForNode helper
- When dragging corner handles (TL, TR, BL, BR), use max(|dx|, |dy|) to determine the dominant delta and apply equally to both dimensions
- When dragging edge handles (TC, BC, ML, MR), apply delta to the perpendicular dimension as well to maintain square
- Symbol rendering in activityNodeRendering.ts already uses node.width/height; ensure shapes fill the bounds (diamond polygon, circle radius)

**2. Correct edge anchoring using shared boundary-intersection utility**
- ActivityFlow edges must anchor to the visible symbol boundary, not the node center or bounding box
- Leverage existing geometryUtils.ts functions: getBoundaryAnchorPoint, getShapeKindFromActivityKind, getRectangleBoundaryPoint, getDiamondBoundaryPoint, getCircleBoundaryPoint
- Map ActivityKind to ShapeKind: Action -> RoundedRect, Decision/Merge -> Diamond, Initial/Final -> Circle
- In ActivityDiagramRenderer.tsx, renderActivityFlowWithBoundary already calls calculateFlowBoundaryPoints; verify this is used for all flows
- Ensure arrow endpoints use the boundary points, not center-to-center calculations

**3. RHS palette greying and delete context menu**
- In PalettePanel.tsx, add helper isActivityOnDiagram(activityId, diagram) checking diagram.diagram_nodes for entity_type == ACTIVITY and matching entity_id
- Add isActivityFlowOnDiagram(flowId, diagram) checking diagram.diagram_edges for relationship_type == ACTIVITY_FLOW and matching relationship_id
- Add isActivityPartitionOnDiagram(partitionId, diagram) checking diagram.diagram_nodes for entity_type == ACTIVITY_PARTITION and matching entity_id
- Apply greyed/disabled CSS styling (opacity: 0.5, cursor: default) to rows where entity is already on diagram
- Default left-click on greyed rows does nothing or selects the existing element on the canvas
- Right-click context menu shows "Delete from diagram" instead of "Add to diagram" for items already on the diagram
- Delete action removes the corresponding DiagramNode or DiagramEdge via dispatch

**4. Draggable ActivityFlow labels**
- ActivityFlow edges may have label text (condition_expression or trigger_label_text from the entity)
- Use DiagramEdge.label_pos_x and label_pos_y fields to store persisted label positions
- If label_pos is null/undefined, compute default position at edge midpoint using getDefaultEdgeLabelPosition from activityNodeRendering.ts
- In Canvas.tsx, extend label hit-testing to detect clicks within flow label bounds (similar to existing edge label drag logic)
- On drag start, if label_pos is not set, initialize it to the computed default position
- On drag move, update label_pos_x/y; on drag end, dispatch UPDATE_EDGE to persist the position
- ActivityDiagramRenderer.tsx already uses edge.label_pos_x ?? flowResult.labelPosition?.x; verify this renders correctly

**5. Decision node labels default below diamond and draggable**
- Decision labels should render below the diamond shape, not inside it, for better readability
- Use LabelDecoration mechanism: when a DECISION activity node is created, auto-create a LabelDecoration with targetKind=NODE, targetId=node.id
- Default label position: x = node center, y = node.pos_y + node.height + decisionLabelOffset (8px per LABEL_DECORATION_DEFAULTS)
- In ActivityDiagramRenderer.tsx, suppress inline label rendering for Decision nodes when a LabelDecoration exists (hasExplicitLabel check)
- Render Decision labels via LabelDecorationElement component with selection and drag affordances
- In Canvas.tsx, extend label drag logic to handle NODE-targeted LabelDecorations for Decision nodes
- On drag, update LabelDecoration.x and LabelDecoration.y; dispatch UPDATE_LABEL_DECORATION to persist

## Visual Design
No visual mockups were provided for this specification. Implementation should follow existing Activity diagram styling patterns and UML conventions for symbol shapes.

## Existing Code to Leverage

**geometryUtils.ts boundary calculations**
- getBoundaryAnchorPoint dispatches to shape-specific functions based on ShapeKind enum
- getShapeKindFromActivityKind maps ActivityKind to ShapeKind (Initial/Final -> Circle, Decision/Merge -> Diamond, Action -> RoundedRect)
- Reuse these for edge anchoring without duplication; consider exposing for State diagram reuse

**activityNodeRendering.ts shape and label functions**
- renderInitialNode, renderDecisionNode, renderMergeNode, renderFinalNode already accept customWidth/customHeight and use min(width,height)/2 for circles
- getDefaultLabelPosition returns Decision label position below the diamond with decisionLabelOffset
- createDecisionLabelDecoration creates a properly positioned LabelDecoration for Decision nodes
- calculateDefaultActivityFlowLabelPosition computes edge midpoint with -8px y offset for flow labels

**Canvas.tsx resize and drag infrastructure**
- calculateResize function applies minWidth/minHeight constraints; add conditional bypass for Activity symbol kinds
- Edge label drag path exists (selectedLabelEdgeId, previewLabelPos, UPDATE_EDGE dispatch); extend for ActivityFlow labels
- Decoration drag state (decorationDragState) supports move/resize; leverage for LabelDecoration dragging

**ActivityDiagramRenderer.tsx rendering patterns**
- ActivityFlowElement uses renderActivityFlowWithBoundary for boundary-anchored edges
- LabelDecorationElement renders explicit labels with selection handles and onClick handler
- nodeLabelDecMap and edgeLabelDecMap track which nodes/edges have explicit decorations

**PalettePanel.tsx context menu infrastructure**
- PaletteContextMenu component handles right-click actions
- isRelationshipRowEnabled pattern exists for other relationship types; apply similar pattern for Activity elements
- createRelationshipEdge pattern can inform delete-from-diagram action dispatch

## Out of Scope
- No new zoom/scroll features or behaviors
- No changes to backend schema or API; this is front-end canvas and palette behavior only
- No changes to Action node label behavior; Action labels continue to support standard H/V alignment inside the rounded rectangle
- No changes to partition (swimlane) sizing or layout behavior
- No changes to Activity entity creation or MetaModel editing
- No changes to State diagram rendering or behavior
- No changes to Sequence diagram rendering or behavior
- No changes to ER diagram rendering or behavior
- No mobile or touch-specific interaction changes
- No accessibility (a11y) enhancements in this scope
