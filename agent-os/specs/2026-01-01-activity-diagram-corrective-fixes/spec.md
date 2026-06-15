# Specification: Activity Diagram Corrective Fixes

## Goal
Correct two Activity diagram improvements that did not work previously: (A) ensure all ActivityFlow edges anchor to node boundaries instead of centres, and (B) fix Activity and ActivityFlow label behaviour for proper alignment, movability, and persistence.

## User Stories
- As a user creating Activity diagrams, I want flow edges to connect at node boundaries so that diagrams look professional without arrows passing through shapes
- As a user editing Activity diagrams, I want to drag Decision labels and ActivityFlow labels independently so that I can position labels for optimal readability

## Specific Requirements

**A1: Boundary anchoring for ActivityFlow rendering**
- ActivityDiagramRenderer currently uses centre-to-centre coordinates (lines 388-395) which overrides boundary anchoring
- Update ActivityFlowElement to call `renderActivityFlowWithBoundary()` instead of `renderActivityFlow()` with centre points
- Pass source and target ActivityKind to enable correct shape-based boundary calculation
- Use existing `calculateFlowBoundaryPoints()` from activityNodeRendering.ts which already supports all shapes

**A2: Shape-to-boundary mapping for all activity kinds**
- Initial and Final nodes use Circle shape (ShapeKind.Circle)
- Action nodes use RoundedRect shape (ShapeKind.RoundedRect)
- Decision and Merge nodes use Diamond shape (ShapeKind.Diamond)
- geometryUtils.ts already exports `getShapeKindFromActivityKind()` which handles this mapping correctly
- Ensure boundary points are recalculated when nodes are moved

**A3: Arrowhead orientation preservation**
- Arrowhead must point in the direction of the final edge segment (from boundary to boundary)
- Use the boundary-adjusted target point for angle calculation in `calculateArrowhead()`
- The existing renderActivityFlow already handles this correctly once given boundary coordinates

**B1: Action label alignment using standard text layout**
- Stop hardcoding label position at node centre in ActivityNodeElement
- Use existing shared text layout utility pattern from rendering.ts `calculateTextPosition()`
- Respect `node.text_h_align` and `node.text_v_align` properties
- Default alignment for Action activities: CENTER horizontal, MIDDLE vertical

**B2: Decision label as independent decoration**
- Do NOT render Decision labels inline on the node shape
- Auto-create a LabelDecoration when a Decision activity node is created on diagram
- Default position: below diamond, horizontally centered (y = diamondBottom + decisionLabelOffset)
- LabelDecoration must be selectable, draggable, and resizable
- Moving the label decoration must NOT move the Decision node itself

**B3: ActivityFlow edge labels - draggable and persistent**
- Extend Canvas hit-testing to recognize ACTIVITY_FLOW edge labels as draggable targets
- Initialize `edge.label_pos_x` and `edge.label_pos_y` when ActivityFlow is created
- Use persisted label position for rendering instead of recalculating midpoint each frame
- Label drag updates only `label_pos_x` / `label_pos_y`, not the edge path itself

**B4: Label position persistence**
- Decision labels (as LabelDecoration elements) must save with diagram and restore on reload
- ActivityFlow label positions must persist via `edge.label_pos_x` / `edge.label_pos_y` fields
- Existing diagram save/load infrastructure handles these fields - no new storage needed

**B5: Backward compatibility for existing diagrams**
- Existing diagrams without LabelDecorations should continue to render with inline labels
- Use `hasExplicitLabel` check pattern already in place (ActivityDiagramRenderer lines 733, 765)
- Virtual labels render inline when no explicit decoration exists
- On first label drag, convert virtual label to explicit LabelDecoration

## Existing Code to Leverage

**geometryUtils.ts - Boundary calculation utilities**
- `getBoundaryAnchorPoint()` calculates intersection point on shape boundary
- `getShapeKindFromActivityKind()` maps ActivityKind to ShapeKind enum
- `getEdgeBoundaryPoints()` calculates both source and target boundaries in one call
- Already supports RoundedRect, Diamond, and Circle shapes

**activityNodeRendering.ts - Flow rendering with boundaries**
- `renderActivityFlowWithBoundary()` already exists and accepts source/target nodes with activity kinds
- `calculateFlowBoundaryPoints()` helper computes both anchor points
- `getDefaultLabelPosition()` calculates label position for Activity nodes by kind
- `getDefaultEdgeLabelPosition()` calculates default position for flow labels

**activityFlowCreation.ts - Edge creation with boundary points**
- `createActivityFlowDiagramEdge()` already computes boundary anchor points for edge_points
- Uses `getBoundaryAnchorPoint()` for both source and target
- Legacy `createActivityFlowDiagramEdgeLegacy()` available for comparison

**rendering.ts - Standard text layout utilities**
- `calculateTextPosition()` handles text_h_align and text_v_align properties
- `wrapText()` handles multi-line text wrapping within bounds
- `calculateTextBlockHeight()` computes total height for wrapped text

**model.ts - LabelDecoration support**
- `LabelDecoration` interface with x, y, width, height, textAnchor, fontSize properties
- `LABEL_DECORATION_DEFAULTS` provides decisionLabelOffset (8px) and edgeLabelOffset (5px)
- `createDefaultLabelDecoration()` factory function creates properly initialized labels

## Out of Scope
- No backend API or database schema changes
- No changes to non-Activity diagram types (State, Sequence, ER diagrams)
- No automatic re-routing of flows when nodes are moved (existing edge adjustment behaviour preserved)
- No changes to Activity node creation or deletion workflows
- No changes to ActivityFlow creation mode interaction patterns
- No changes to partition (swimlane) rendering or interaction
- No changes to zoom or pan behaviour
- No undo/redo enhancements for label operations
- No multi-select label drag operations
- No keyboard shortcuts for label editing
