/**
 * UIWorkflowDiagramRenderer.tsx
 * Task Group 7: UI Workflow Diagram Rendering Component
 * Spec 2026-01-02: Phase 1 UI Architecture - Increment 1
 *
 * This component renders UI Workflow diagram elements on an SVG canvas:
 * - UIScreen nodes at z-index 100 (standard node level)
 * - UIWorkflowTransition edges at z-index 110 (above screens for visibility)
 *
 * The component follows the StateDiagramRenderer.tsx architecture pattern:
 * - Accept diagram, metaModel, zoom props
 * - Define local constants for styling
 * - Filter and render elements by entity_type/relationship_type
 * - Apply correct z-index layering
 * - Use border-to-border edge anchoring
 */

import React, { useMemo } from 'react';
import {
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  UIScreen,
  UIWorkflowTransition,
  ENTITY_TYPES,
  RELATIONSHIP_EDGE_TYPES,
} from '../../types/model';
import { wrapText, calculateArrowhead } from '../../utils/rendering';
import {
  getEdgeBoundaryPoints,
  ShapeKind,
  Rect,
} from '../../utils/geometryUtils';

// ============================================================================
// Props Interface
// ============================================================================

export interface UIWorkflowDiagramRendererProps {
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

/** Z-index for UI Screen nodes (standard node level) */
const UI_SCREEN_Z_INDEX = 100;

/** Z-index for UI Workflow Transition edges (above screens for visibility) */
const UI_WORKFLOW_TRANSITION_Z_INDEX = 110;

// ============================================================================
// Constants - Styling
// ============================================================================

/** Font size for UI Screen labels */
const UI_SCREEN_LABEL_FONT_SIZE = 12;

/** Font weight for UI Screen labels */
const UI_SCREEN_LABEL_FONT_WEIGHT = 'normal';

/** Font style for UI Screen labels */
const UI_SCREEN_LABEL_FONT_STYLE = 'normal';

/** Text color for UI Screen labels */
const UI_SCREEN_LABEL_COLOR = '#333333';

/** Line spacing for wrapped text */
const LINE_SPACING = 4;

/** Default background color for UI Screen nodes */
const UI_SCREEN_BACKGROUND = '#E8F4FD';

/** Default border color for UI Screen nodes */
const UI_SCREEN_BORDER = '#4A90D9';

/** Border width for UI Screen nodes */
const UI_SCREEN_BORDER_WIDTH = 1;

/** Corner radius for UI Screen nodes */
const UI_SCREEN_BORDER_RADIUS = 4;

/** Edge stroke color */
const EDGE_STROKE_COLOR = '#616161';

/** Edge stroke width */
const EDGE_STROKE_WIDTH = 1.5;

/** Edge label font size */
const EDGE_LABEL_FONT_SIZE = 11;

/** Arrow size for edges */
const ARROW_SIZE = 8;

// ============================================================================
// Helper Functions - Entity Lookups
// ============================================================================

/**
 * Get UIScreen entity from metaModel by ID
 */
function getUIScreenById(screenId: string, metaModel: MetaModel): UIScreen | undefined {
  return metaModel.entities.ui_screens?.find((s) => s.id === screenId);
}

/**
 * Get UIWorkflowTransition entity from metaModel by ID
 */
function getUIWorkflowTransitionById(
  transitionId: string,
  metaModel: MetaModel
): UIWorkflowTransition | undefined {
  return metaModel.relationships.ui_workflow_transitions?.find(
    (t) => t.id === transitionId
  );
}

/**
 * Get display label for a UIScreen node
 * Returns screen.name or fallback to screenId
 */
function getUIScreenLabel(screenId: string, metaModel: MetaModel): string {
  const screen = getUIScreenById(screenId, metaModel);
  return screen?.name || screenId;
}

/**
 * Get display label for a UIWorkflowTransition edge
 * Returns transition.trigger if present, otherwise transition.name
 */
function getTransitionLabel(
  transitionId: string,
  metaModel: MetaModel
): string | undefined {
  const transition = getUIWorkflowTransitionById(transitionId, metaModel);
  if (!transition) return undefined;
  // Prefer trigger text for edge label (e.g., "Click Submit")
  // Fall back to name if no trigger
  return transition.trigger || transition.name;
}

// ============================================================================
// Helper Functions - Boundary Anchoring
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

interface UIScreenNodeElementProps {
  node: DiagramNode;
  label: string;
}

/**
 * UIScreenNodeElement sub-component
 * Renders a single UI Screen node as a rounded rectangle with label
 */
const UIScreenNodeElement: React.FC<UIScreenNodeElementProps> = ({
  node,
  label,
}) => {
  // Get styling from node or use defaults
  const backgroundColor = node.fill_color || UI_SCREEN_BACKGROUND;
  const borderColor = node.line_color || UI_SCREEN_BORDER;
  const textColor = node.text_color || UI_SCREEN_LABEL_COLOR;

  // Calculate text wrapping
  const textAreaWidth = node.width - 20; // 10px padding on each side
  const textLines = wrapText(
    label,
    textAreaWidth,
    UI_SCREEN_LABEL_FONT_SIZE,
    UI_SCREEN_LABEL_FONT_WEIGHT,
    UI_SCREEN_LABEL_FONT_STYLE
  );

  // Calculate total text height for vertical centering
  const totalTextHeight =
    textLines.length * UI_SCREEN_LABEL_FONT_SIZE +
    (textLines.length - 1) * LINE_SPACING;

  // Center text vertically within node
  const centerY = node.pos_y + node.height / 2;
  const textStartY = centerY - totalTextHeight / 2 + UI_SCREEN_LABEL_FONT_SIZE * 0.8;

  return (
    <g
      className="ui-screen-node"
      data-screen-id={node.entity_id}
      data-node-id={node.id}
      style={{ cursor: 'pointer', zIndex: UI_SCREEN_Z_INDEX }}
    >
      {/* Rounded rectangle background */}
      <rect
        x={node.pos_x}
        y={node.pos_y}
        width={node.width}
        height={node.height}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={UI_SCREEN_BORDER_WIDTH}
        rx={UI_SCREEN_BORDER_RADIUS}
      />
      {/* Render label text (centered) */}
      {textLines.map((line, index) => (
        <text
          key={index}
          x={node.pos_x + node.width / 2}
          y={textStartY + index * (UI_SCREEN_LABEL_FONT_SIZE + LINE_SPACING)}
          textAnchor="middle"
          fontSize={UI_SCREEN_LABEL_FONT_SIZE}
          fontWeight={UI_SCREEN_LABEL_FONT_WEIGHT}
          fontStyle={UI_SCREEN_LABEL_FONT_STYLE}
          fill={textColor}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

interface UIWorkflowTransitionElementProps {
  edge: DiagramEdge;
  sourceNode: DiagramNode;
  targetNode: DiagramNode;
  label?: string;
}

/**
 * UIWorkflowTransitionElement sub-component
 * Renders a single UI Workflow Transition edge with:
 * - Border-to-border anchoring
 * - Arrow at target end
 * - Optional label at midpoint
 */
const UIWorkflowTransitionElement: React.FC<UIWorkflowTransitionElementProps> = ({
  edge,
  sourceNode,
  targetNode,
  label,
}) => {
  // UIScreen nodes are always rendered as rectangles
  const sourceShapeKind = ShapeKind.RoundedRect;
  const targetShapeKind = ShapeKind.RoundedRect;

  // Build rectangles from node positions
  const sourceRect = nodeToRect(sourceNode);
  const targetRect = nodeToRect(targetNode);

  // Calculate boundary points for border-to-border anchoring
  const boundaryPoints = getEdgeBoundaryPoints(
    sourceRect,
    targetRect,
    sourceShapeKind,
    targetShapeKind
  );

  // Get edge styling
  const strokeColor = edge.line_color || EDGE_STROKE_COLOR;
  const strokeWidth = edge.line_width ?? EDGE_STROKE_WIDTH;

  // Generate line path
  const linePath = `M ${boundaryPoints.source.x} ${boundaryPoints.source.y} L ${boundaryPoints.target.x} ${boundaryPoints.target.y}`;

  // Calculate arrowhead path
  const arrowheadPath = calculateArrowhead(
    boundaryPoints.source.x,
    boundaryPoints.source.y,
    boundaryPoints.target.x,
    boundaryPoints.target.y,
    ARROW_SIZE
  );

  // Calculate label position at midpoint
  const labelX = (boundaryPoints.source.x + boundaryPoints.target.x) / 2;
  const labelY = (boundaryPoints.source.y + boundaryPoints.target.y) / 2 - 8; // Offset above line

  return (
    <g
      className="ui-workflow-transition"
      data-transition-id={edge.relationship_id}
      data-edge-id={edge.id}
      style={{ zIndex: UI_WORKFLOW_TRANSITION_Z_INDEX }}
    >
      {/* Transition line */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      {/* Arrowhead */}
      <path
        d={arrowheadPath}
        fill={strokeColor}
        stroke={strokeColor}
        strokeWidth={1}
      />
      {/* Label at midpoint if present */}
      {label && (
        <text
          x={edge.label_pos_x ?? labelX}
          y={edge.label_pos_y ?? labelY}
          textAnchor="middle"
          fontSize={EDGE_LABEL_FONT_SIZE}
          fill={UI_SCREEN_LABEL_COLOR}
        >
          {label}
        </text>
      )}
    </g>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * UIWorkflowDiagramRenderer - Renders a complete UI Workflow diagram on SVG canvas.
 *
 * This component:
 * - Filters diagram_nodes for entity_type === 'UI_SCREEN'
 * - Filters diagram_edges for relationship_type === 'UI_WORKFLOW_TRANSITION'
 * - Builds nodeMap for efficient edge endpoint lookup
 * - Uses boundary points for edge rendering (edges start/end at node borders)
 * - Renders nodes first (z-index 100), then transitions (z-index 110)
 */
export const UIWorkflowDiagramRenderer: React.FC<UIWorkflowDiagramRendererProps> = ({
  diagram,
  metaModel,
  zoom: _zoom,
}) => {
  // ========================================================================
  // Collect and filter elements
  // ========================================================================

  // Get UI Screen nodes (entity_type === 'UI_SCREEN')
  const uiScreenNodes = useMemo(() => {
    return diagram.diagram_nodes.filter(
      (n) => n.entity_type === ENTITY_TYPES.UI_SCREEN
    );
  }, [diagram.diagram_nodes]);

  // Get UI Workflow Transition edges (relationship_type === 'UI_WORKFLOW_TRANSITION')
  const transitionEdges = useMemo(() => {
    return diagram.diagram_edges.filter(
      (e) => e.relationship_type === RELATIONSHIP_EDGE_TYPES.UI_WORKFLOW_TRANSITION
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
  // Compute UI Screen node render data
  // ========================================================================

  const uiScreenRenderData = useMemo(() => {
    const results: Array<{
      node: DiagramNode;
      label: string;
    }> = [];

    for (const node of uiScreenNodes) {
      const label = getUIScreenLabel(node.entity_id, metaModel);
      results.push({ node, label });
    }

    return results;
  }, [uiScreenNodes, metaModel]);

  // ========================================================================
  // Compute transition edge data
  // ========================================================================

  const transitionEdgeData = useMemo(() => {
    const results: Array<{
      edge: DiagramEdge;
      sourceNode: DiagramNode;
      targetNode: DiagramNode;
      label?: string;
    }> = [];

    for (const edge of transitionEdges) {
      const sourceNode = nodeMap.get(edge.source_node_id || '');
      const targetNode = nodeMap.get(edge.target_node_id || '');

      if (!sourceNode || !targetNode) continue;

      const label = getTransitionLabel(edge.relationship_id, metaModel);

      results.push({ edge, sourceNode, targetNode, label });
    }

    return results;
  }, [transitionEdges, nodeMap, metaModel]);

  // ========================================================================
  // Render
  // ========================================================================

  // Early return for empty diagram with placeholder text
  if (uiScreenNodes.length === 0) {
    return (
      <g className="ui-workflow-diagram-renderer">
        <text
          x={200}
          y={100}
          textAnchor="middle"
          fontSize={14}
          fill="#666"
        >
          Add UI Screens to begin
        </text>
      </g>
    );
  }

  return (
    <g className="ui-workflow-diagram-renderer">
      {/* Layer 1: UI Screen nodes (z-index 100 - standard node level) */}
      {uiScreenRenderData.map(({ node, label }) => (
        <UIScreenNodeElement
          key={node.id}
          node={node}
          label={label}
        />
      ))}

      {/* Layer 2: UI Workflow Transitions (z-index 110 - above screens for visibility) */}
      {transitionEdgeData.map(({ edge, sourceNode, targetNode, label }) => (
        <UIWorkflowTransitionElement
          key={edge.id}
          edge={edge}
          sourceNode={sourceNode}
          targetNode={targetNode}
          label={label}
        />
      ))}
    </g>
  );
};

export default UIWorkflowDiagramRenderer;
