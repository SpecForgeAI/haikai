/**
 * TemporaryDiagramRenderer.tsx
 * Spec: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 2: ER Node Rendering
 * Task Group 3: ER Edge Rendering
 *
 * Dedicated SVG renderer for TemporaryArchitectureDiagram payloads.
 * Follows the pattern of SequenceDiagramRenderer.tsx / ActivityDiagramRenderer.tsx:
 * receives typed diagram data and produces SVG elements directly, without
 * fabricating synthetic native DiagramNode[]/DiagramEdge[] objects.
 *
 * Currently supports only diagram_kind === 'ER'. Other diagram kinds render
 * a warning message.
 *
 * The component does NOT perform meta-model lookups; all data is self-contained
 * in the TemporaryArchitectureDiagram contract.
 */

import React from 'react';
import type {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
  TemporaryArchitectureDiagramEdge,
  TemporaryArchitectureDiagramCompartmentItem,
} from '../../types/temporaryArchitectureDiagram';
import type { LogicalERRelationship } from '../../types/model';
import { ERD_HEADER_HEIGHT, ERD_ATTRIBUTE_ROW_HEIGHT } from '../../utils/erdUtils';
import { getEntityColor } from '../../utils/rendering';
import { appConfig } from '../../config/defaults';
import {
  getEREdgeSymbols,
  getSymbolRenderData,
  calculateEdgeAngle,
  getEREdgeStrokeDasharray,
  ER_SYMBOL_HEIGHT,
  ER_SYMBOL_STROKE_COLOR,
} from '../../utils/erEdgeSymbols';

// ============================================================================
// Props Interface
// ============================================================================

export interface TemporaryDiagramRendererProps {
  /** The temporary architecture diagram data to render */
  diagram: TemporaryArchitectureDiagram;
  /** Current zoom level */
  zoom: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Font size for attribute rows */
const ERD_FONT_SIZE = 11;

/** Font size for entity header text */
const HEADER_FONT_SIZE = 12;

/** Horizontal padding for attribute text within ERD node */
const ERD_PADDING_X = 8;

/** Default stroke color for edges */
const EDGE_STROKE_COLOR = '#616161';

/** Default stroke width for edges */
const EDGE_STROKE_WIDTH = 1.5;

/** Font size for edge labels */
const EDGE_LABEL_FONT_SIZE = 10;

// ============================================================================
// Attribute Formatting
// ============================================================================

/**
 * Format a compartment item for display in ERD-style rendering.
 *
 * Produces output matching the existing formatAttribute() pattern:
 * - "display_name : data_type" when metadata.data_type is present
 * - Prefixed with "PK " for metadata.is_primary_key
 * - Prefixed with "FK " for metadata.is_foreign_key
 * - Both prefixes if both flags are true: "PK FK display_name : data_type"
 *
 * Handles missing compartments, empty items, and missing metadata gracefully.
 */
export function formatCompartmentItem(
  item: TemporaryArchitectureDiagramCompartmentItem
): string {
  let prefix = '';

  if (item.metadata?.is_primary_key) {
    prefix += 'PK ';
  }
  if (item.metadata?.is_foreign_key) {
    prefix += 'FK ';
  }

  const name = item.display_name;

  if (item.metadata?.data_type && item.metadata.data_type.trim() !== '') {
    return `${prefix}${name} : ${item.metadata.data_type}`;
  }

  return `${prefix}${name}`;
}

// ============================================================================
// Node Rendering
// ============================================================================

/**
 * Render a single ERD-style class-box node.
 * Follows the SVG structure from Canvas.tsx lines 2399-2462.
 */
function renderERDNode(node: TemporaryArchitectureDiagramNode): React.ReactElement {
  const colors = getEntityColor(node.semantic_type);
  const nodeBackgroundColor = colors.background;
  const nodeLineColor = colors.border;

  // Find the ATTRIBUTES compartment
  const attributesCompartment = node.compartments?.find(
    (c) => c.compartment_kind === 'ATTRIBUTES'
  );
  const attributes = attributesCompartment?.items ?? [];

  return (
    <g key={node.id} data-testid={`temp-erd-node-${node.id}`}>
      {/* Outer rectangle */}
      <rect
        x={node.pos_x}
        y={node.pos_y}
        width={node.width}
        height={node.height}
        fill={nodeBackgroundColor}
        stroke={nodeLineColor}
        strokeWidth={appConfig.node.borderWidth}
        rx={0}
      />
      {/* Header: Entity name (bold, centered) */}
      <text
        x={node.pos_x + node.width / 2}
        y={node.pos_y + ERD_HEADER_HEIGHT / 2 + HEADER_FONT_SIZE / 3}
        textAnchor="middle"
        fontSize={HEADER_FONT_SIZE}
        fontWeight="bold"
        fill="#000000"
      >
        {node.display_name}
      </text>
      {/* Divider line */}
      <line
        x1={node.pos_x}
        y1={node.pos_y + ERD_HEADER_HEIGHT}
        x2={node.pos_x + node.width}
        y2={node.pos_y + ERD_HEADER_HEIGHT}
        stroke={nodeLineColor}
        strokeWidth={1}
      />
      {/* Attribute rows (left-aligned) */}
      {attributes.map((item, index) => {
        const formattedAttr = formatCompartmentItem(item);
        const attrY =
          node.pos_y +
          ERD_HEADER_HEIGHT +
          (index + 0.5) * ERD_ATTRIBUTE_ROW_HEIGHT +
          ERD_FONT_SIZE / 3;
        return (
          <text
            key={item.id}
            x={node.pos_x + ERD_PADDING_X}
            y={attrY}
            textAnchor="start"
            fontSize={ERD_FONT_SIZE}
            fontWeight="normal"
            fill="#000000"
          >
            {formattedAttr}
          </text>
        );
      })}
    </g>
  );
}

// ============================================================================
// Edge Point Helpers
// ============================================================================

/** Check if a value is a finite number (not NaN, null, undefined, or Infinity) */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compute border-to-border connection points between two nodes.
 * Returns [sourcePoint, targetPoint] at the closest facing sides.
 */
function computeNodeBorderPoints(
  source: TemporaryArchitectureDiagramNode,
  target: TemporaryArchitectureDiagramNode
): [{ pos_x: number; pos_y: number }, { pos_x: number; pos_y: number }] {
  const sCx = source.pos_x + source.width / 2;
  const sCy = source.pos_y + source.height / 2;
  const tCx = target.pos_x + target.width / 2;
  const tCy = target.pos_y + target.height / 2;

  const dx = tCx - sCx;
  const dy = tCy - sCy;

  let sp: { pos_x: number; pos_y: number };
  let tp: { pos_x: number; pos_y: number };

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal connection
    if (dx >= 0) {
      sp = { pos_x: source.pos_x + source.width, pos_y: sCy };
      tp = { pos_x: target.pos_x, pos_y: tCy };
    } else {
      sp = { pos_x: source.pos_x, pos_y: sCy };
      tp = { pos_x: target.pos_x + target.width, pos_y: tCy };
    }
  } else {
    // Vertical connection
    if (dy >= 0) {
      sp = { pos_x: sCx, pos_y: source.pos_y + source.height };
      tp = { pos_x: tCx, pos_y: target.pos_y };
    } else {
      sp = { pos_x: sCx, pos_y: source.pos_y };
      tp = { pos_x: tCx, pos_y: target.pos_y + target.height };
    }
  }

  return [sp, tp];
}

// ============================================================================
// Edge Rendering (Task Group 3)
// ============================================================================

/**
 * Render a single ER edge as an SVG polyline with optional UML endpoint symbols
 * and source/target labels.
 *
 * - Validates edge_points have numeric pos_x/pos_y; falls back to auto-computed
 *   border-to-border points when edge_points are missing, empty, or contain
 *   non-numeric coordinates.
 * - Sorts edge_points by sequence_order ascending
 * - Calls getEREdgeSymbols() at the renderer boundary to determine UML symbols
 * - Renders endpoint symbols using getSymbolRenderData() and calculateEdgeAngle()
 * - Renders source_label and target_label as <text> elements at their pos_x/pos_y
 */
function renderERDEdge(
  edge: TemporaryArchitectureDiagramEdge,
  nodeMap: Map<string, TemporaryArchitectureDiagramNode>
): React.ReactElement | null {
  // Determine valid edge_points: filter to only those with numeric pos_x/pos_y
  const validPoints = (edge.edge_points ?? []).filter(
    (p) => isFiniteNumber(p.pos_x) && isFiniteNumber(p.pos_y)
  );

  // If no valid LLM-provided points, compute fallback from node positions
  let sortedPoints: { pos_x: number; pos_y: number; sequence_order: number }[];

  if (validPoints.length >= 2) {
    sortedPoints = [...validPoints].sort((a, b) => a.sequence_order - b.sequence_order);
  } else {
    // Fallback: auto-compute edge from source/target node borders
    const sourceNode = nodeMap.get(edge.source_node_id);
    const targetNode = nodeMap.get(edge.target_node_id);
    if (!sourceNode || !targetNode) {
      return null; // Can't compute without both nodes
    }
    const [sp, tp] = computeNodeBorderPoints(sourceNode, targetNode);
    sortedPoints = [
      { pos_x: sp.pos_x, pos_y: sp.pos_y, sequence_order: 0 },
      { pos_x: tp.pos_x, pos_y: tp.pos_y, sequence_order: 1 },
    ];
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[TemporaryDiagramRenderer] Edge "${edge.id}": using auto-computed border points (LLM provided ${edge.edge_points?.length ?? 0} points, ${validPoints.length} valid)`
      );
    }
  }

  // Check for degenerate zero-length edges (all points at same coordinate)
  const allSameX = sortedPoints.every((p) => p.pos_x === sortedPoints[0].pos_x);
  const allSameY = sortedPoints.every((p) => p.pos_y === sortedPoints[0].pos_y);
  if (allSameX && allSameY) {
    // Zero-length edge: try fallback from node borders
    const sourceNode = nodeMap.get(edge.source_node_id);
    const targetNode = nodeMap.get(edge.target_node_id);
    if (sourceNode && targetNode) {
      const [sp, tp] = computeNodeBorderPoints(sourceNode, targetNode);
      sortedPoints = [
        { pos_x: sp.pos_x, pos_y: sp.pos_y, sequence_order: 0 },
        { pos_x: tp.pos_x, pos_y: tp.pos_y, sequence_order: 1 },
      ];
    } else {
      return null; // Truly degenerate, nothing to render
    }
  }

  // Get UML symbols and line style from relationship_type
  // Handle undefined relationship_type gracefully (defaults to ASSOCIATION)
  const erSymbols = getEREdgeSymbols(
    edge.relationship_type as LogicalERRelationship | undefined
  );

  // Derive stroke-dasharray from line style
  const strokeDasharray = getEREdgeStrokeDasharray(erSymbols.lineStyle);

  // Build the polyline points string
  const polylinePoints = sortedPoints
    .map((p) => `${p.pos_x},${p.pos_y}`)
    .join(' ');

  // Calculate UML symbol render data for source and target endpoints
  let sourceSymbolData = null;
  let targetSymbolData = null;

  if (sortedPoints.length >= 2) {
    const sourcePoint = sortedPoints[0];
    const nextPoint = sortedPoints[1];
    const targetPoint = sortedPoints[sortedPoints.length - 1];
    const prevPoint = sortedPoints[sortedPoints.length - 2];

    // Source symbol (for COMPOSITION, AGGREGATION - diamond at source)
    if (erSymbols.sourceSymbol !== 'NONE') {
      const sourceAngle = calculateEdgeAngle(
        sourcePoint.pos_x, sourcePoint.pos_y,
        nextPoint.pos_x, nextPoint.pos_y
      );
      sourceSymbolData = getSymbolRenderData(
        erSymbols.sourceSymbol,
        sourcePoint.pos_x, sourcePoint.pos_y,
        sourceAngle,
        EDGE_STROKE_COLOR
      );
    }

    // Target symbol (for GENERALIZATION, REALIZATION, DEPENDENCY - triangle/arrow at target)
    if (erSymbols.targetSymbol !== 'NONE') {
      const targetAngle = calculateEdgeAngle(
        prevPoint.pos_x, prevPoint.pos_y,
        targetPoint.pos_x, targetPoint.pos_y
      );
      targetSymbolData = getSymbolRenderData(
        erSymbols.targetSymbol,
        targetPoint.pos_x, targetPoint.pos_y,
        targetAngle,
        EDGE_STROKE_COLOR
      );
    }
  }

  return (
    <g key={edge.id} data-testid={`temp-erd-edge-${edge.id}`}>
      {/* Edge polyline */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={EDGE_STROKE_COLOR}
        strokeWidth={EDGE_STROKE_WIDTH}
        strokeDasharray={strokeDasharray || undefined}
      />

      {/* UML source symbol (diamond for COMPOSITION/AGGREGATION) */}
      {sourceSymbolData && (
        <path
          data-testid={`temp-erd-edge-source-symbol-${edge.id}`}
          d={sourceSymbolData.pathData}
          fill={sourceSymbolData.fill}
          stroke={sourceSymbolData.stroke}
          strokeWidth={sourceSymbolData.strokeWidth}
        />
      )}

      {/* UML target symbol (triangle for GENERALIZATION/REALIZATION, arrow for DEPENDENCY) */}
      {targetSymbolData && (
        <path
          data-testid={`temp-erd-edge-target-symbol-${edge.id}`}
          d={targetSymbolData.pathData}
          fill={targetSymbolData.fill}
          stroke={targetSymbolData.stroke}
          strokeWidth={targetSymbolData.strokeWidth}
        />
      )}

      {/* Source label */}
      {edge.source_label && (
        <text
          data-testid={`temp-erd-edge-source-label-${edge.id}`}
          x={edge.source_label.pos_x}
          y={edge.source_label.pos_y}
          textAnchor="middle"
          fontSize={EDGE_LABEL_FONT_SIZE}
          fontWeight="normal"
          fill={EDGE_STROKE_COLOR}
        >
          {edge.source_label.text}
        </text>
      )}

      {/* Target label */}
      {edge.target_label && (
        <text
          data-testid={`temp-erd-edge-target-label-${edge.id}`}
          x={edge.target_label.pos_x}
          y={edge.target_label.pos_y}
          textAnchor="middle"
          fontSize={EDGE_LABEL_FONT_SIZE}
          fontWeight="normal"
          fill={EDGE_STROKE_COLOR}
        >
          {edge.target_label.text}
        </text>
      )}
    </g>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * TemporaryDiagramRenderer
 *
 * Renders a TemporaryArchitectureDiagram as SVG elements.
 * Currently supports only ER diagram kind.
 */
const TemporaryDiagramRenderer: React.FC<TemporaryDiagramRendererProps> = ({
  diagram,
  zoom,
}) => {
  // Check for unsupported diagram kinds
  if (diagram.diagram_kind !== 'ER') {
    return (
      <g>
        <text x={50} y={50} fontSize={14} fill="#666666">
          Unsupported diagram kind: {diagram.diagram_kind}. Only ER diagrams are
          supported in this version.
        </text>
      </g>
    );
  }

  // Build node lookup map for edge fallback computation
  const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

  // Sort nodes by z_index ascending (nulls/undefined treated as 0)
  const sortedNodes = [...diagram.nodes].sort((a, b) => {
    const aZ = a.z_index ?? 0;
    const bZ = b.z_index ?? 0;
    return aZ - bZ;
  });

  return (
    <g data-testid="temporary-diagram-renderer">
      {/* Render edges first (below nodes) */}
      {diagram.edges.map((edge) => renderERDEdge(edge, nodeMap))}
      {/* Render nodes */}
      {sortedNodes.map((node) => renderERDNode(node))}
    </g>
  );
};

export default TemporaryDiagramRenderer;
