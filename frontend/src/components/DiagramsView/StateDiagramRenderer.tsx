/**
 * StateDiagramRenderer.tsx
 * Task Group 4: StateDiagramRenderer Component and Canvas Integration
 * Spec 2026-01-01: State Diagram UX Fixes
 *   - Task Group 2: Pass node dimensions to rendering functions
 *   - Task Group 6: Apply label alignment settings for Normal states
 * Spec 2026-01-02: State Diagram UX Fixes
 *   - Task Group 1: Edge boundary anchoring - edges anchor at node borders
 *
 * This component renders State diagram elements on an SVG canvas:
 * - State nodes at z-index 100 (standard node level)
 * - State transitions at z-index 110 (above states for visibility)
 *
 * The component follows the ActivityDiagramRenderer.tsx architecture pattern:
 * - Accept diagram, metaModel, zoom props
 * - Define local constants for styling
 * - Filter and render elements by entity_type/relationship_type
 * - Apply correct z-index layering
 */

import React, { useMemo } from 'react';
import { Diagram, DiagramNode, DiagramEdge, MetaModel, State, StateTransition } from '../../types/model';
import {
  renderStateNode,
  StateNodeRenderResult,
} from '../../utils/stateNodeRendering';
import {
  renderStateTransitionPolyline,
  resolveTransitionLabel,
  EdgePosition,
} from '../../utils/stateTransitionRendering';
import { wrapText } from '../../utils/rendering';
import {
  getEdgeBoundaryPoints,
  getBoundaryAnchorPoint,
  getShapeKindFromStateKind,
  ShapeKind,
  Rect,
} from '../../utils/geometryUtils';

// ============================================================================
// Props Interface
// ============================================================================

export interface StateDiagramRendererProps {
  /** The diagram data to render */
  diagram: Diagram;
  /** MetaModel for resolving entity names and data */
  metaModel: MetaModel;
  /** Current zoom level */
  zoom: number;
}

// ============================================================================
// Constants - Z-Index Layering
// ============================================================================

/** Z-index for state nodes (standard node level) */
const STATE_Z_INDEX = 100;

/** Z-index for state transitions (above states for visibility) */
const TRANSITION_Z_INDEX = 110;

// ============================================================================
// Constants - Styling
// ============================================================================

/** Font size for state labels */
const STATE_LABEL_FONT_SIZE = 12;

/** Font weight for state labels */
const STATE_LABEL_FONT_WEIGHT = 'normal';

/** Font style for state labels */
const STATE_LABEL_FONT_STYLE = 'normal';

/** Text color for state labels */
const STATE_LABEL_COLOR = '#333333';

/** Line spacing for wrapped text */
const LINE_SPACING = 4;

// ============================================================================
// Helper Functions - Entity Lookups (Task 4.6)
// ============================================================================

/**
 * Get State entity from metaModel by ID
 * Task 4.6: getStateById helper function
 */
function getStateById(stateId: string, metaModel: MetaModel): State | undefined {
  return metaModel.entities.states?.find((s) => s.id === stateId);
}

/**
 * Get StateTransition entity from metaModel by ID
 * Task 4.6: getStateTransitionById helper function
 */
function getStateTransitionById(transitionId: string, metaModel: MetaModel): StateTransition | undefined {
  return metaModel.entities.state_transitions?.find((t) => t.id === transitionId);
}

/**
 * Get display label for a State node
 * Task 4.6: getStateLabel helper function
 * Returns state.name or fallback to stateId
 */
function getStateLabel(stateId: string, metaModel: MetaModel): string {
  const state = getStateById(stateId, metaModel);
  return state?.name || stateId;
}

/**
 * Get display label for a StateTransition edge
 * Task 4.6: getTransitionLabel helper function
 * Delegates to resolveTransitionLabel for proper label resolution
 */
function getTransitionLabel(transitionId: string, metaModel: MetaModel): string | undefined {
  const transition = getStateTransitionById(transitionId, metaModel);
  if (!transition) return undefined;
  return resolveTransitionLabel(transition, metaModel);
}

// ============================================================================
// Helper Functions - Label Alignment (Task Group 6)
// ============================================================================

/**
 * Get text anchor based on horizontal alignment setting.
 * Spec 2026-01-01 Task Group 6: Apply alignment settings for Normal states.
 *
 * @param textAlignH - Horizontal alignment ('LEFT', 'CENTER', 'RIGHT')
 * @returns SVG text-anchor value
 */
function getTextAnchor(textAlignH: string | undefined): 'start' | 'middle' | 'end' {
  switch (textAlignH) {
    case 'LEFT':
      return 'start';
    case 'RIGHT':
      return 'end';
    case 'CENTER':
    default:
      return 'middle';
  }
}

/**
 * Calculate X position based on horizontal alignment.
 *
 * @param node - The diagram node
 * @param textAlignH - Horizontal alignment ('LEFT', 'CENTER', 'RIGHT')
 * @returns X coordinate for text placement
 */
function getTextX(node: DiagramNode, textAlignH: string | undefined): number {
  const centerX = node.pos_x + node.width / 2;
  const padding = 10; // Text padding from edges

  switch (textAlignH) {
    case 'LEFT':
      return node.pos_x + padding;
    case 'RIGHT':
      return node.pos_x + node.width - padding;
    case 'CENTER':
    default:
      return centerX;
  }
}

/**
 * Calculate Y position based on vertical alignment.
 *
 * @param node - The diagram node
 * @param textAlignV - Vertical alignment ('TOP', 'MIDDLE', 'BOTTOM')
 * @param textHeight - Total height of all text lines
 * @param fontSize - Font size for text
 * @returns Y coordinate for first text line
 */
function getTextY(
  node: DiagramNode,
  textAlignV: string | undefined,
  textHeight: number,
  fontSize: number
): number {
  const centerY = node.pos_y + node.height / 2;
  const padding = 10; // Text padding from edges
  // Baseline adjustment for proper vertical centering
  const baselineAdjust = fontSize * 0.35;

  switch (textAlignV) {
    case 'TOP':
      return node.pos_y + padding + fontSize * 0.8;
    case 'BOTTOM':
      return node.pos_y + node.height - padding - textHeight + fontSize;
    case 'MIDDLE':
    default:
      return centerY - textHeight / 2 + baselineAdjust;
  }
}

// ============================================================================
// Helper Functions - Boundary Anchoring (Spec 2026-01-02 Task Group 1)
// ============================================================================

/**
 * Build a Rect from a DiagramNode for boundary calculations
 */
function nodeToRect(node: DiagramNode): Rect {
  return {
    x: node.pos_x,
    y: node.pos_y,
    width: node.width,
    height: node.height,
  };
}

// ============================================================================
// Sub-Components
// ============================================================================

interface StateNodeElementProps {
  node: DiagramNode;
  renderResult: StateNodeRenderResult;
  label: string;
}

/**
 * StateNodeElement sub-component
 * Task 4.3: Implement StateNodeElement sub-component
 * Spec 2026-01-01 Task Group 6: Apply label alignment settings
 *
 * Renders a single state node with proper handling for:
 * - Bullseye (Final) nodes with separate outer/inner paths
 * - Normal nodes with wrapped text labels and alignment
 * - Applies cursor: pointer style and z-index 100
 */
const StateNodeElement: React.FC<StateNodeElementProps> = ({
  node,
  renderResult,
  label,
}) => {
  const { pathData, fill, stroke, strokeWidth, showLabel, outerPathData, innerPathData } =
    renderResult;

  // Check if this is a Final node (bullseye) that needs special rendering
  const isFinalNode = outerPathData && innerPathData;

  // Get alignment settings from node (default to CENTER/MIDDLE)
  const textAlignH = node.text_h_align || 'CENTER';
  const textAlignV = node.text_v_align || 'MIDDLE';

  // Calculate text wrapping if label should be shown
  const textLines = showLabel
    ? wrapText(
        label,
        (renderResult.width || node.width || 140) - 20, // padding
        STATE_LABEL_FONT_SIZE,
        STATE_LABEL_FONT_WEIGHT,
        STATE_LABEL_FONT_STYLE
      )
    : [];

  // Calculate total text height for vertical alignment
  const totalTextHeight =
    textLines.length * STATE_LABEL_FONT_SIZE +
    (textLines.length - 1) * LINE_SPACING;

  // Get text anchor and positions based on alignment
  const textAnchor = getTextAnchor(textAlignH);
  const textX = getTextX(node, textAlignH);
  const textStartY = getTextY(node, textAlignV, totalTextHeight, STATE_LABEL_FONT_SIZE);

  return (
    <g
      className="state-node"
      data-state-id={node.entity_id}
      data-node-id={node.id}
      style={{ cursor: 'pointer', zIndex: STATE_Z_INDEX }}
    >
      {isFinalNode ? (
        // Render bullseye (Final node): outer stroke + inner fill
        <>
          {/* Outer circle (stroke only) */}
          <path
            d={outerPathData}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          {/* Inner circle (filled) */}
          <path
            d={innerPathData}
            fill={fill}
            stroke="none"
          />
        </>
      ) : (
        // Render standard shape (circle for Initial, rounded rectangle for Normal)
        <path
          d={pathData}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {/* Render label if showLabel is true (Normal nodes only) */}
      {showLabel &&
        textLines.map((line, index) => (
          <text
            key={index}
            x={textX}
            y={textStartY + index * (STATE_LABEL_FONT_SIZE + LINE_SPACING)}
            textAnchor={textAnchor}
            fontSize={STATE_LABEL_FONT_SIZE}
            fontWeight={STATE_LABEL_FONT_WEIGHT}
            fontStyle={STATE_LABEL_FONT_STYLE}
            fill={STATE_LABEL_COLOR}
          >
            {line}
          </text>
        ))}
    </g>
  );
};

interface StateTransitionElementProps {
  edge: DiagramEdge;
  sourceNode: DiagramNode;
  targetNode: DiagramNode;
  sourceState: State | undefined;
  targetState: State | undefined;
  label?: string;
}

/**
 * StateTransitionElement sub-component
 * Task 4.4: Implement StateTransitionElement sub-component
 * Spec 2026-01-02 Task Group 1: Edge boundary anchoring
 *
 * Renders a single state transition edge through edge_points as a polyline:
 * - 2-point case: computes boundary points from source/target nodes (preserves existing behavior)
 * - 3+ point case: uses all edge_points with boundary-adjusted first/last points
 * - Renders line path, arrowhead path, and optional label
 * - Applies z-index 110
 */
const StateTransitionElement: React.FC<StateTransitionElementProps> = ({
  edge,
  sourceNode,
  targetNode,
  sourceState,
  targetState,
  label,
}) => {
  // Get shape kinds for source and target states
  const sourceShapeKind = sourceState
    ? getShapeKindFromStateKind(sourceState.state_kind)
    : ShapeKind.RoundedRect;
  const targetShapeKind = targetState
    ? getShapeKindFromStateKind(targetState.state_kind)
    : ShapeKind.RoundedRect;

  // Build rectangles from node positions
  const sourceRect = nodeToRect(sourceNode);
  const targetRect = nodeToRect(targetNode);

  const edgePoints = edge.edge_points || [];

  // Build the polyline points array
  let polylinePoints: EdgePosition[];

  if (edgePoints.length <= 2) {
    // 2-point case: compute boundary points from source/target nodes
    const boundaryPoints = getEdgeBoundaryPoints(
      sourceRect,
      targetRect,
      sourceShapeKind,
      targetShapeKind
    );
    polylinePoints = [boundaryPoints.source, boundaryPoints.target];
  } else {
    // 3+ point case: use all edge_points with boundary-adjusted first/last
    const sortedPoints = [...edgePoints].sort((a, b) => a.sequence_order - b.sequence_order);

    // Compute boundary-adjusted first point: intersection from second point toward source boundary
    const secondPoint: Rect = { x: sortedPoints[1].pos_x, y: sortedPoints[1].pos_y, width: 0, height: 0 };
    const boundarySource = getBoundaryAnchorPoint(sourceRect, secondPoint, sourceShapeKind);

    // Compute boundary-adjusted last point: intersection from second-to-last point toward target boundary
    const secondToLast: Rect = {
      x: sortedPoints[sortedPoints.length - 2].pos_x,
      y: sortedPoints[sortedPoints.length - 2].pos_y,
      width: 0,
      height: 0,
    };
    const boundaryTarget = getBoundaryAnchorPoint(targetRect, secondToLast, targetShapeKind);

    // Build polyline: boundary source, interior points, boundary target
    polylinePoints = [
      boundarySource,
      ...sortedPoints.slice(1, -1).map(p => ({ x: p.pos_x, y: p.pos_y })),
      boundaryTarget,
    ];
  }

  // Render the transition as a polyline
  const transitionResult = renderStateTransitionPolyline(polylinePoints, label);

  return (
    <g
      className="state-transition"
      data-transition-id={edge.relationship_id}
      data-edge-id={edge.id}
      style={{ zIndex: TRANSITION_Z_INDEX }}
    >
      {/* Invisible wider hit target for pointer cursor on hover */}
      <path
        d={transitionResult.linePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ cursor: 'pointer' }}
        pointerEvents="stroke"
      />
      {/* Transition line */}
      <path
        d={transitionResult.linePath}
        fill="none"
        stroke={transitionResult.strokeColor}
        strokeWidth={transitionResult.strokeWidth}
        style={{ cursor: 'pointer' }}
        pointerEvents="stroke"
      />
      {/* Arrowhead */}
      <path
        d={transitionResult.arrowheadPath}
        fill={transitionResult.arrowheadFill}
        stroke={transitionResult.strokeColor}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
      />
      {/* Label at midpoint if present */}
      {transitionResult.labelPosition && transitionResult.labelText && (
        <text
          x={transitionResult.labelPosition.x}
          y={transitionResult.labelPosition.y - transitionResult.labelOffset}
          textAnchor="middle"
          fontSize={transitionResult.labelFontSize}
          fill={STATE_LABEL_COLOR}
        >
          {transitionResult.labelText}
        </text>
      )}
    </g>
  );
};

// ============================================================================
// Main Component (Task 4.5)
// ============================================================================

/**
 * StateDiagramRenderer - Renders a complete state diagram on SVG canvas.
 * Task 4.5: Implement main StateDiagramRenderer component logic
 * Spec 2026-01-01 Task Group 2: Pass node dimensions to rendering functions
 * Spec 2026-01-02 Task Group 1: Edge boundary anchoring for StateTransition edges
 *
 * This component:
 * - Filters diagram_nodes for entity_type === 'STATE'
 * - Filters diagram_edges for relationship_type === 'STATE_TRANSITION'
 * - Builds nodeMap for efficient edge endpoint lookup
 * - Computes render results for all nodes and edges
 * - Passes node.width and node.height to renderStateNode for dimension-aware rendering
 * - Uses boundary points for edge rendering (edges start/end at node borders)
 * - Renders nodes first (z-index 100), then transitions (z-index 110)
 */
export const StateDiagramRenderer: React.FC<StateDiagramRendererProps> = ({
  diagram,
  metaModel,
  zoom: _zoom,
}) => {
  // ========================================================================
  // Collect and filter elements
  // ========================================================================

  // Get state nodes (entity_type === 'STATE')
  const stateNodes = useMemo(() => {
    return diagram.diagram_nodes.filter((n) => n.entity_type === 'STATE');
  }, [diagram.diagram_nodes]);

  // Get transition edges (relationship_type === 'STATE_TRANSITION')
  const transitionEdges = useMemo(() => {
    return diagram.diagram_edges.filter(
      (e) => e.relationship_type === 'STATE_TRANSITION'
    );
  }, [diagram.diagram_edges]);

  // Create node lookup map for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    for (const node of diagram.diagram_nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [diagram.diagram_nodes]);

  // ========================================================================
  // Compute state node render results
  // Spec 2026-01-01 Task Group 2: Pass node.width and node.height to renderStateNode
  // ========================================================================

  const stateRenderResults = useMemo(() => {
    const results: Array<{
      node: DiagramNode;
      renderResult: StateNodeRenderResult;
      label: string;
    }> = [];

    for (const node of stateNodes) {
      const state = getStateById(node.entity_id, metaModel);
      if (!state) continue;

      // Calculate center position for rendering
      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      // Spec 2026-01-01 Task Group 2: Pass node dimensions to renderStateNode
      // This enables resize-driven shape rendering
      const renderResult = renderStateNode(state, centerPosition, node.width, node.height);
      const label = getStateLabel(node.entity_id, metaModel);

      results.push({ node, renderResult, label });
    }

    return results;
  }, [stateNodes, metaModel]);

  // ========================================================================
  // Compute transition edge data
  // Spec 2026-01-02 Task Group 1: Include source/target State entities for shape kind lookup
  // ========================================================================

  const transitionEdgeData = useMemo(() => {
    const results: Array<{
      edge: DiagramEdge;
      sourceNode: DiagramNode;
      targetNode: DiagramNode;
      sourceState: State | undefined;
      targetState: State | undefined;
      label?: string;
    }> = [];

    for (const edge of transitionEdges) {
      const sourceNode = nodeMap.get(edge.source_node_id || '');
      const targetNode = nodeMap.get(edge.target_node_id || '');

      if (!sourceNode || !targetNode) continue;

      // Spec 2026-01-02 Task Group 1: Get State entities for shape kind lookup
      const sourceState = getStateById(sourceNode.entity_id, metaModel);
      const targetState = getStateById(targetNode.entity_id, metaModel);

      const label = getTransitionLabel(edge.relationship_id, metaModel);

      results.push({ edge, sourceNode, targetNode, sourceState, targetState, label });
    }

    return results;
  }, [transitionEdges, nodeMap, metaModel]);

  // ========================================================================
  // Render
  // ========================================================================

  // Early return for empty diagram with placeholder text
  if (stateNodes.length === 0) {
    return (
      <g className="state-diagram-renderer">
        <text
          x={200}
          y={100}
          textAnchor="middle"
          fontSize={14}
          fill="#666"
        >
          Add states to begin
        </text>
      </g>
    );
  }

  return (
    <g className="state-diagram-renderer">
      {/* Layer 1: State nodes (z-index 100 - standard node level) */}
      {stateRenderResults.map(({ node, renderResult, label }) => (
        <StateNodeElement
          key={node.id}
          node={node}
          renderResult={renderResult}
          label={label}
        />
      ))}

      {/* Layer 2: State transitions (z-index 110 - above states for visibility) */}
      {transitionEdgeData.map(({ edge, sourceNode, targetNode, sourceState, targetState, label }) => (
        <StateTransitionElement
          key={edge.id}
          edge={edge}
          sourceNode={sourceNode}
          targetNode={targetNode}
          sourceState={sourceState}
          targetState={targetState}
          label={label}
        />
      ))}
    </g>
  );
};

export default StateDiagramRenderer;
