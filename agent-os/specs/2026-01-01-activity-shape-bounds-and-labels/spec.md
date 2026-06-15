# Specification: Activity Diagram Shape Bounds and Interactive Labels

## Goal
Fix Activity diagram issues where Decision/Merge diamonds and Initial/Final circles do not resize with node bounds, edge anchoring ignores the true visible shape, and Decision/ActivityFlow labels are not independently draggable with persisted positions.

## User Stories
- As a diagram author, I want Decision and Merge diamond shapes to resize when I drag their resize handles so that the visible shape matches the selection box
- As a diagram author, I want ActivityFlow edges to anchor at the visible shape boundary (diamond edge, circle perimeter) rather than the invisible bounding box so that edges look professional

## Specific Requirements

**A) Unify Visual Shapes with Node Bounds**
- Render all Activity node shapes directly from node.width and node.height rather than hardcoded pixel sizes
- Decision diamond polygon fills node bounds: points = [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
- Merge diamond uses same rendering logic as Decision but with smaller default creation size (20x20 vs 60x60)
- Initial/Final circles use radius = min(width,height)/2, centered within bounds
- Remove any hardcoded fixed-size diamond or circle rendering logic from activityNodeRendering.ts
- Resize handles already modify node.width/height; visible shape must now follow these values

**B) ActivityFlow Boundary Anchoring Against True Shape**
- Compute flow source/target anchor points using shape-aware boundary intersection (RECT/DIAMOND/CIRCLE)
- Use existing getBoundaryAnchorPoint() from geometryUtils.ts with correct ShapeKind mapping
- For Action nodes: use ShapeKind.RoundedRect boundary calculation
- For Decision/Merge: use ShapeKind.Diamond boundary calculation
- For Initial/Final: use ShapeKind.Circle boundary calculation
- Edges must touch visible boundaries; no line should pass through node interior

**C) Decision Labels as DiagramDecoration**
- Suppress inline text rendering for Decision nodes (diamond should have no internal label)
- Decision labels default below diamond: y = node.pos_y + node.height + 8px offset
- Auto-create a LabelDecoration when a Decision node is created with targetKind='NODE' and targetId=node.id
- Store parent reference in LabelDecoration.targetId for tracking
- On diagram load, backfill missing label decorations for existing Decision nodes that lack them

**D) ActivityFlow Edge Labels - Clickable and Draggable**
- Persist label position via edge.label_pos_x and edge.label_pos_y fields
- Default label position: midpoint of edge with y offset -8px (above line)
- Use existing Canvas edge label drag infrastructure (findLabelAtPoint, previewLabelPos, UPDATE_DIAGRAM_EDGE)
- Extend getEdgeDisplayLabel() to return ActivityFlow condition_expression or trigger_label_text
- If label_pos_x/y is already set, always use persisted position over computed default

## Visual Design
No visual mockups provided. Implementation follows UML Activity diagram conventions:
- Diamond shapes inscribed within rectangular bounds
- Circle shapes inscribed within square bounds
- Labels positioned below Decision diamonds and above ActivityFlow edges
- Drag handles and selection styling consistent with existing Canvas patterns

## Existing Code to Leverage

**ActivityDiagramRenderer.tsx**
- Already filters nodes by entity_type='ACTIVITY' and edges by relationship_type='ACTIVITY_FLOW'
- Has ActivityNodeElement and ActivityFlowElement sub-components for rendering
- Supports LabelDecoration rendering with selectedLabelDecorationIds prop
- Uses renderActivityFlowWithBoundary() which already accepts sourceActivityKind and targetActivityKind

**activityNodeRendering.ts**
- Contains renderActivityNode() dispatcher that routes to shape-specific functions
- renderDecisionNode() and renderMergeNode() need modification to use node dimensions
- getDefaultLabelPosition() and getDefaultEdgeLabelPosition() already calculate label positions
- calculateFlowBoundaryPoints() computes shape-aware anchors using getShapeKindFromActivityKind()

**geometryUtils.ts**
- getBoundaryAnchorPoint() dispatches to shape-specific boundary calculation
- getDiamondBoundaryPoint() computes diamond edge intersection with ray
- getCircleBoundaryPoint() computes circle perimeter intersection
- getShapeKindFromActivityKind() maps ActivityKind to ShapeKind enum

**Canvas.tsx label dragging**
- findLabelAtPoint() detects clicks on edge labels using label bounding box hit test
- previewLabelPos state tracks live label position during drag
- UPDATE_DIAGRAM_EDGE action persists label_pos_x/y to diagram
- DecorationDragState supports 'labelDrag' dragType for LINE decoration labels

**LabelDecoration interface (model.ts)**
- Defines targetKind ('NODE' | 'EDGE'), targetId, x, y, width, height, text, font properties
- LABEL_DECORATION_DEFAULTS provides standard values for fontSize, textAnchor, decisionLabelOffset
- createDefaultLabelDecoration() factory generates new LabelDecoration with defaults
- Diagram.label_decorations array stores all label decorations for a diagram

## Out of Scope
- No edge routing or path avoidance algorithm for overlapping edges
- No snap-to-grid behavior for labels or nodes
- No changes to State diagram or Sequence diagram rendering
- No backend or database schema changes (frontend-only)
- No changes to ActivityPartition swimlane rendering
- No changes to Action node label rendering (already uses text alignment properties)
- No automatic label repositioning when nodes are moved (labels stay at absolute positions)
- No multi-line label wrapping for Decision labels
- No inline text editing for labels (use inspector panel)
- No undo/redo for label drag operations
