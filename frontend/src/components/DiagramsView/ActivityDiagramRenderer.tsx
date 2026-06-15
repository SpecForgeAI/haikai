/**
 * ActivityDiagramRenderer.tsx
 * Task Group 5: ActivityDiagramRenderer Integration
 * Spec 2025-12-31 (A5): Label Decoration Rendering
 * Spec 2026-01-01: Activity Diagram Corrective Fixes
 *   - (A1) Boundary-anchored edge rendering
 *   - (A) Shape rendering from node bounds
 *   - (B1) Action label alignment using standard text layout
 *   - (B2) Decision labels as independent decorations
 *   - (B3) ActivityFlow edge labels - draggable and persistent
 *
 * This component renders Activity diagram elements on an SVG canvas:
 * - Activity Partitions (swimlanes) at z-index 50 (behind activities)
 * - Activity nodes at z-index 100 (standard node level)
 * - Activity flows at z-index 110 (above activities for visibility)
 * - Label decorations at z-index 115 (above flows)
 *
 * The component follows the SequenceDiagramRenderer.tsx architecture pattern:
 * - Accept diagram, metaModel, zoom props
 * - Define local constants for styling
 * - Filter and render elements by entity_type/relationship_type
 * - Apply correct z-index layering
 *
 * Spec 2025-12-31 (A5): Added label decoration rendering:
 * - Renders persisted LabelDecoration elements
 * - Renders virtual labels for nodes/edges without explicit decorations
 * - Supports selection handles for drag/resize operations
 *
 * Spec 2026-01-01 (A): Shape rendering from node bounds:
 * - All activity node shapes (Decision, Merge, Initial, Final) now use node.width/height
 * - Diamond shapes use polygon formula: points = [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
 * - Circle shapes use radius = min(width, height) / 2
 */

import React, { useMemo } from 'react';
import {
  Diagram,
  DiagramNode,
  DiagramEdge,
  MetaModel,
  Activity,
  ActivityPartition,
  ActivityFlow,
  ActivityDiagramOrientation,
  ActivityFlowKind,
  ActivityKind,
  LabelDecoration,
  LABEL_DECORATION_DEFAULTS,
  TextHorizontalAlign,
  TextVerticalAlign,
} from '../../types/model';
import {
  renderActivityNode,
  renderActivityFlowWithBoundary,
  ActivityNodeRenderResult,
  getDefaultLabelPosition,
  getDefaultEdgeLabelPosition,
} from '../../utils/activityNodeRendering';
import {
  renderPartition,
  PartitionRenderResult,
} from '../../utils/activityPartitionRendering';
import { ACTIVITY_PARTITION_DEFAULTS } from '../../config/defaults';
import { wrapText } from '../../utils/rendering';

// ============================================================================
// Props Interface
// ============================================================================

export interface ActivityDiagramRendererProps {
  /** The diagram data to render */
  diagram: Diagram;
  /** MetaModel for resolving entity names and data */
  metaModel: MetaModel;
  /** Current zoom level */
  zoom: number;
  /** Optional: Selected label decoration IDs for showing selection handles */
  selectedLabelDecorationIds?: Set<string>;
  /** Optional: Callback when a label decoration is clicked */
  onLabelDecorationClick?: (labelDecId: string, event: React.MouseEvent) => void;
}

// ============================================================================
// Constants - Z-Index Layering
// ============================================================================

/** Z-index for activity partitions (below standard nodes) */
const PARTITION_Z_INDEX = 50;

/** Z-index for activity nodes (standard node level) */
const ACTIVITY_Z_INDEX = 100;

/** Z-index for activity flows (above activities for visibility) */
const FLOW_Z_INDEX = 110;

/** Z-index for label decorations (above flows) */
const LABEL_Z_INDEX = 115;

// ============================================================================
// Constants - Styling
// ============================================================================

/** Font size for activity labels */
const ACTIVITY_LABEL_FONT_SIZE = 12;

/** Font weight for activity labels */
const ACTIVITY_LABEL_FONT_WEIGHT = 'normal';

/** Font style for activity labels */
const ACTIVITY_LABEL_FONT_STYLE = 'normal';

/** Text color for activity labels */
const ACTIVITY_LABEL_COLOR = '#333333';

/** Line spacing for wrapped text */
const LINE_SPACING = 4;

/** Selection handle size for label decorations */
const SELECTION_HANDLE_SIZE = 6;

/** Selection handle color */
const SELECTION_HANDLE_COLOR = '#0066cc';

/** Text padding for aligned text */
const TEXT_PADDING = 5;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get Activity entity from metaModel by ID
 */
function getActivityById(activityId: string, metaModel: MetaModel): Activity | undefined {
  return metaModel.entities.activities?.find((a) => a.id === activityId);
}

/**
 * Get ActivityKind from activity entity ID
 * Spec 2026-01-01 (A1): Helper for boundary calculation
 */
function getActivityKindByEntityId(activityId: string, metaModel: MetaModel): ActivityKind {
  const activity = getActivityById(activityId, metaModel);
  return activity?.activity_kind || 'Action';
}

/**
 * Get ActivityPartition entity from metaModel by ID
 */
function getPartitionById(partitionId: string, metaModel: MetaModel): ActivityPartition | undefined {
  return metaModel.entities.activity_partitions?.find((p) => p.id === partitionId);
}

/**
 * Get ActivityFlow entity from metaModel by ID
 */
function getActivityFlowById(flowId: string, metaModel: MetaModel): ActivityFlow | undefined {
  return metaModel.entities.activity_flows?.find((f) => f.id === flowId);
}

/**
 * Get display label for an Activity node
 */
function getActivityLabel(activityId: string, metaModel: MetaModel): string {
  const activity = getActivityById(activityId, metaModel);
  return activity?.name || activityId;
}

/**
 * Get display label for an ActivityFlow edge
 * Uses condition_expression or trigger_label_text if available
 */
function getFlowLabel(flowId: string, metaModel: MetaModel): string | undefined {
  const flow = getActivityFlowById(flowId, metaModel);
  if (!flow) return undefined;

  // Priority: condition_expression > trigger_label_text
  if (flow.condition_expression) return flow.condition_expression;
  if (flow.trigger_label_text) return flow.trigger_label_text;

  return undefined;
}

/**
 * Get flow kind for an ActivityFlow edge
 * Task Group 6: Read flowKind from entity for proper styling
 * Defaults to 'Control' if not specified
 */
function getFlowKind(flowId: string, metaModel: MetaModel): ActivityFlowKind {
  const flow = getActivityFlowById(flowId, metaModel);
  return flow?.flow_kind || 'Control';
}



/**
 * Get orientation for a partition node
 * Defaults to VERTICAL if not specified
 */
function getPartitionOrientation(
  _partitionId: string,
  _metaModel: MetaModel
): ActivityDiagramOrientation {
  // Currently partitions don't have orientation stored on the entity
  // Use default VERTICAL orientation
  return ACTIVITY_PARTITION_DEFAULTS.orientation;
}

/**
 * Spec 2025-12-31 (A5): Check if an Activity node should show a label
 * Initial, Merge, and Final nodes do not show labels by default
 */
function shouldShowActivityLabel(activity: Activity | undefined): boolean {
  if (!activity) return true;
  const kind = activity.activity_kind || 'Action';
  return kind === 'Action' || kind === 'Decision';
}

/**
 * Spec 2026-01-01 (B1): Calculate text position based on alignment properties
 * Used for Action node labels with proper alignment support
 */
function calculateAlignedTextPosition(
  node: DiagramNode,
  lines: string[],
  fontSize: number = ACTIVITY_LABEL_FONT_SIZE
): {
  startY: number;
  getX: () => number;
  anchor: 'start' | 'middle' | 'end';
} {
  const padding = TEXT_PADDING;
  const lineSpacing = LINE_SPACING;

  // Calculate text area
  const textAreaX = node.pos_x + padding;
  const textAreaY = node.pos_y + padding;
  const textAreaWidth = node.width - (padding * 2);
  const textAreaHeight = node.height - (padding * 2);

  // Calculate total text block height
  const blockHeight = lines.length * fontSize + (lines.length - 1) * lineSpacing;

  // Determine vertical start position (baseline of first line)
  let startY: number;
  const vAlign: TextVerticalAlign = node.text_v_align || 'MIDDLE';

  switch (vAlign) {
    case 'TOP':
      startY = textAreaY + fontSize;
      break;
    case 'BOTTOM':
      startY = textAreaY + textAreaHeight - blockHeight + fontSize;
      break;
    case 'MIDDLE':
    default:
      startY = textAreaY + (textAreaHeight - blockHeight) / 2 + fontSize;
      break;
  }

  // Determine horizontal position and anchor
  const hAlign: TextHorizontalAlign = node.text_h_align || 'CENTER';
  let anchor: 'start' | 'middle' | 'end';

  const getX = (): number => {
    switch (hAlign) {
      case 'LEFT':
        return textAreaX;
      case 'RIGHT':
        return textAreaX + textAreaWidth;
      case 'CENTER':
      default:
        return textAreaX + textAreaWidth / 2;
    }
  };

  switch (hAlign) {
    case 'LEFT':
      anchor = 'start';
      break;
    case 'RIGHT':
      anchor = 'end';
      break;
    case 'CENTER':
    default:
      anchor = 'middle';
      break;
  }

  return { startY, getX, anchor };
}

// ============================================================================
// Sub-Components
// ============================================================================

interface PartitionElementProps {
  node: DiagramNode;
  renderResult: PartitionRenderResult;
}

/**
 * Renders a single partition swimlane
 */
const PartitionElement: React.FC<PartitionElementProps> = ({ node, renderResult }) => {
  const { headerRect, bodyRect, dividerLine, fullBorderRect, textElement } = renderResult;

  return (
    <g
      className="activity-partition"
      data-partition-id={node.entity_id}
      data-node-id={node.id}
      style={{ zIndex: PARTITION_Z_INDEX }}
    >
      {/* Body rectangle first (background) */}
      <rect
        x={bodyRect.x}
        y={bodyRect.y}
        width={bodyRect.width}
        height={bodyRect.height}
        fill={bodyRect.fill}
        stroke="none"
      />
      {/* Header rectangle */}
      <rect
        x={headerRect.x}
        y={headerRect.y}
        width={headerRect.width}
        height={headerRect.height}
        fill={headerRect.fill}
        stroke="none"
      />
      {/* Full border around partition */}
      <rect
        x={fullBorderRect.x}
        y={fullBorderRect.y}
        width={fullBorderRect.width}
        height={fullBorderRect.height}
        fill={fullBorderRect.fill}
        stroke={fullBorderRect.stroke}
        strokeWidth={fullBorderRect.strokeWidth}
      />
      {/* Divider line between header and body */}
      <line
        x1={dividerLine.x1}
        y1={dividerLine.y1}
        x2={dividerLine.x2}
        y2={dividerLine.y2}
        stroke={dividerLine.stroke}
        strokeWidth={dividerLine.strokeWidth}
        strokeDasharray={dividerLine.strokeDasharray || undefined}
      />
      {/* Partition name text */}
      <text
        x={textElement.x}
        y={textElement.y}
        textAnchor={textElement.textAnchor}
        dominantBaseline={textElement.dominantBaseline || "auto"}
        fontSize={textElement.fontSize}
        fontWeight={textElement.fontWeight}
        fill={textElement.fill}
      >
        {textElement.content}
      </text>
    </g>
  );
};

interface ActivityNodeElementProps {
  node: DiagramNode;
  renderResult: ActivityNodeRenderResult;
  /** Whether to render the label inline (if no explicit label decoration exists) */
  showInlineLabel: boolean;
  label: string;
  /** The activity kind for proper label rendering */
  activityKind: ActivityKind;
}

/**
 * Renders a single activity node (shape only, label may be separate)
 * Spec 2026-01-01 (B1): Updated to use text alignment properties for Action labels
 * Spec 2026-01-01 (B2): Decision labels suppressed when LabelDecoration exists
 */
const ActivityNodeElement: React.FC<ActivityNodeElementProps> = ({
  node,
  renderResult,
  showInlineLabel,
  label,
  activityKind,
}) => {
  const { pathData, fill, stroke, strokeWidth, showLabel, outerPathData, innerPathData } =
    renderResult;

  // Check if this is a Final node (bullseye) that needs special rendering
  const isFinalNode = outerPathData && innerPathData;

  // Calculate text wrapping if label should be shown inline
  // Only show inline if showInlineLabel is true AND the shape supports labels
  // Spec 2026-01-01 (B2): For Decision nodes, only show inline label if no explicit decoration
  const shouldRenderInlineLabel = showInlineLabel && showLabel;
  const textLines = shouldRenderInlineLabel
    ? wrapText(
        label,
        (renderResult.width || 140) - 20, // padding
        ACTIVITY_LABEL_FONT_SIZE,
        ACTIVITY_LABEL_FONT_WEIGHT,
        ACTIVITY_LABEL_FONT_STYLE
      )
    : [];

  // Spec 2026-01-01 (B1): Calculate text position with alignment support for Action nodes
  // Decision nodes render labels below the shape (handled by LabelDecoration)
  const isActionNode = activityKind === 'Action';

  let textX: number;
  let textStartY: number;
  let textAnchor: 'start' | 'middle' | 'end' = 'middle';

  if (isActionNode && shouldRenderInlineLabel && textLines.length > 0) {
    // Use alignment-aware position calculation for Action nodes
    const { startY, getX, anchor } = calculateAlignedTextPosition(node, textLines, ACTIVITY_LABEL_FONT_SIZE);
    textX = getX();
    textStartY = startY;
    textAnchor = anchor;
  } else {
    // Default centered position for other node types
    const centerX = node.pos_x + node.width / 2;
    const centerY = node.pos_y + node.height / 2;
    const totalTextHeight =
      textLines.length * ACTIVITY_LABEL_FONT_SIZE +
      (textLines.length - 1) * LINE_SPACING;
    textX = centerX;
    textStartY = centerY - totalTextHeight / 2 + ACTIVITY_LABEL_FONT_SIZE * 0.35;
  }

  return (
    <g
      className="activity-node"
      data-activity-id={node.entity_id}
      data-node-id={node.id}
      style={{ cursor: 'pointer', zIndex: ACTIVITY_Z_INDEX }}
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
        // Render standard shape (circle, rectangle, diamond)
        <path
          d={pathData}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {/* Render inline label if no explicit decoration exists */}
      {shouldRenderInlineLabel &&
        textLines.map((line, index) => (
          <text
            key={index}
            x={textX}
            y={textStartY + index * (ACTIVITY_LABEL_FONT_SIZE + LINE_SPACING)}
            textAnchor={textAnchor}
            fontSize={ACTIVITY_LABEL_FONT_SIZE}
            fontWeight={ACTIVITY_LABEL_FONT_WEIGHT}
            fontStyle={ACTIVITY_LABEL_FONT_STYLE}
            fill={ACTIVITY_LABEL_COLOR}
          >
            {line}
          </text>
        ))}
    </g>
  );
};

interface ActivityFlowElementProps {
  edge: DiagramEdge;
  sourceNode: DiagramNode;
  targetNode: DiagramNode;
  /** Whether to render the label inline (if no explicit label decoration exists) */
  showInlineLabel: boolean;
  label?: string;
  flowKind: ActivityFlowKind;
  /** Spec 2026-01-01 (A1): Source activity kind for boundary calculation */
  sourceActivityKind: ActivityKind;
  /** Spec 2026-01-01 (A1): Target activity kind for boundary calculation */
  targetActivityKind: ActivityKind;
}

/**
 * Renders a single activity flow edge (line and arrow only, label may be separate)
 * Spec 2026-01-01 (A1): Updated to use boundary-anchored rendering
 * Spec 2026-01-01 (B3): Uses persisted label position when available
 */
const ActivityFlowElement: React.FC<ActivityFlowElementProps> = ({
  edge,
  sourceNode,
  targetNode,
  showInlineLabel,
  label,
  flowKind,
  sourceActivityKind,
  targetActivityKind,
}) => {
  // Spec 2026-01-01 (A1): Use boundary-anchored rendering instead of centre-to-centre
  // This ensures flow arrows connect at shape boundaries for professional appearance
  const flowResult = renderActivityFlowWithBoundary(
    sourceNode,
    targetNode,
    flowKind,
    sourceActivityKind,
    targetActivityKind,
    label
  );

  // Spec 2026-01-01 (B3): Use persisted label position if available
  const labelX = edge.label_pos_x ?? flowResult.labelPosition?.x;
  const labelY = edge.label_pos_y ?? flowResult.labelPosition?.y;

  return (
    <g
      className="activity-flow"
      data-flow-id={edge.relationship_id}
      data-edge-id={edge.id}
      style={{ zIndex: FLOW_Z_INDEX }}
    >
      {/* Flow line */}
      <path
        d={flowResult.linePath}
        fill="none"
        stroke={flowResult.strokeColor}
        strokeWidth={flowResult.strokeWidth}
        strokeDasharray={flowResult.strokeDasharray || undefined}
      />
      {/* Arrowhead */}
      <path
        d={flowResult.arrowheadPath}
        fill={flowResult.arrowheadFill}
        stroke={flowResult.strokeColor}
        strokeWidth={1}
      />
      {/* Label at midpoint if present AND no explicit decoration */}
      {showInlineLabel && labelX !== undefined && labelY !== undefined && flowResult.labelText && (
        <text
          x={labelX}
          y={labelY - flowResult.labelOffset}
          textAnchor="middle"
          fontSize={flowResult.labelFontSize}
          fill={ACTIVITY_LABEL_COLOR}
        >
          {flowResult.labelText}
        </text>
      )}
    </g>
  );
};

interface LabelDecorationElementProps {
  labelDec: LabelDecoration;
  text: string;
  isSelected: boolean;
  onClick?: (event: React.MouseEvent) => void;
}

/**
 * Spec 2025-12-31 (A5): Renders a single label decoration element
 * Displays text with optional selection handles for drag/resize
 */
const LabelDecorationElement: React.FC<LabelDecorationElementProps> = ({
  labelDec,
  text,
  isSelected,
  onClick,
}) => {
  const {
    id,
    x,
    y,
    width,
    height,
    textAnchor = LABEL_DECORATION_DEFAULTS.textAnchor,
    dominantBaseline = LABEL_DECORATION_DEFAULTS.dominantBaseline,
    fontSize = LABEL_DECORATION_DEFAULTS.fontSize,
    fontWeight = LABEL_DECORATION_DEFAULTS.fontWeight,
    textColor = LABEL_DECORATION_DEFAULTS.textColor,
  } = labelDec;

  // Calculate text position based on anchor settings
  let textX = x;
  let textY = y;

  if (textAnchor === 'middle') {
    textX = x + width / 2;
  } else if (textAnchor === 'end') {
    textX = x + width;
  }

  if (dominantBaseline === 'middle' || dominantBaseline === 'central') {
    textY = y + height / 2;
  } else if (dominantBaseline === 'text-after-edge' || dominantBaseline === 'ideographic') {
    textY = y + height;
  } else {
    // 'text-before-edge', 'hanging' - text baseline at top
    textY = y + fontSize; // Approximate adjustment for top alignment
  }

  // Wrap text within bounds
  const textLines = wrapText(
    text,
    width - 4, // Small padding
    fontSize,
    fontWeight,
    'normal'
  );

  // Calculate vertical start position for wrapped text
  const lineHeight = fontSize * 1.2;
  const totalTextHeight = textLines.length * lineHeight;
  let textStartY = textY;

  if (dominantBaseline === 'middle' || dominantBaseline === 'central') {
    textStartY = y + height / 2 - totalTextHeight / 2 + fontSize * 0.35;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
  };

  return (
    <g
      className="label-decoration"
      data-label-decoration-id={id}
      style={{ cursor: 'pointer', zIndex: LABEL_Z_INDEX }}
      onClick={handleClick}
    >
      {/* Invisible hit area for easier selection */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        stroke={isSelected ? SELECTION_HANDLE_COLOR : 'none'}
        strokeWidth={isSelected ? 1 : 0}
        strokeDasharray={isSelected ? '3,3' : undefined}
      />

      {/* Render text lines */}
      {textLines.map((line, index) => (
        <text
          key={index}
          x={textX}
          y={textStartY + index * lineHeight}
          textAnchor={textAnchor}
          dominantBaseline="hanging"
          fontSize={fontSize}
          fontWeight={fontWeight}
          fill={textColor}
          style={{ pointerEvents: 'none' }}
        >
          {line}
        </text>
      ))}

      {/* Selection handles (corner squares) when selected */}
      {isSelected && (
        <>
          {/* Top-left corner */}
          <rect
            x={x - SELECTION_HANDLE_SIZE / 2}
            y={y - SELECTION_HANDLE_SIZE / 2}
            width={SELECTION_HANDLE_SIZE}
            height={SELECTION_HANDLE_SIZE}
            fill={SELECTION_HANDLE_COLOR}
            className="resize-handle resize-nw"
          />
          {/* Top-right corner */}
          <rect
            x={x + width - SELECTION_HANDLE_SIZE / 2}
            y={y - SELECTION_HANDLE_SIZE / 2}
            width={SELECTION_HANDLE_SIZE}
            height={SELECTION_HANDLE_SIZE}
            fill={SELECTION_HANDLE_COLOR}
            className="resize-handle resize-ne"
          />
          {/* Bottom-left corner */}
          <rect
            x={x - SELECTION_HANDLE_SIZE / 2}
            y={y + height - SELECTION_HANDLE_SIZE / 2}
            width={SELECTION_HANDLE_SIZE}
            height={SELECTION_HANDLE_SIZE}
            fill={SELECTION_HANDLE_COLOR}
            className="resize-handle resize-sw"
          />
          {/* Bottom-right corner */}
          <rect
            x={x + width - SELECTION_HANDLE_SIZE / 2}
            y={y + height - SELECTION_HANDLE_SIZE / 2}
            width={SELECTION_HANDLE_SIZE}
            height={SELECTION_HANDLE_SIZE}
            fill={SELECTION_HANDLE_COLOR}
            className="resize-handle resize-se"
          />
        </>
      )}
    </g>
  );
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * ActivityDiagramRenderer - Renders a complete activity diagram on SVG canvas.
 *
 * This component:
 * - Filters diagram_nodes for ACTIVITY_PARTITION and ACTIVITY entity_types
 * - Filters diagram_edges for ACTIVITY_FLOW relationship_type
 * - Renders partitions first (lowest z-index: 50)
 * - Renders activities second (z-index: 100)
 * - Renders flows third (z-index: 110)
 * - Renders label decorations last (z-index: 115)
 * - Applies correct shape rendering based on activityKind
 *
 * Spec 2025-12-31 (A5): Label Decoration Support
 * - If a node/edge has an explicit LabelDecoration, render it separately
 * - If not, render the label inline with the shape (virtual mode)
 * - Virtual labels are rendered using default positioning based on activity kind
 *
 * Spec 2026-01-01: Activity Diagram Corrective Fixes
 * - (A) Shape rendering from node bounds - shapes use node.width/height
 * - (A1) Flow edges anchor at node boundaries, not centres
 * - (B1) Action labels use text_h_align and text_v_align properties
 * - (B2) Decision labels rendered as separate decorations
 * - (B3) ActivityFlow edge labels use persisted positions
 */
export const ActivityDiagramRenderer: React.FC<ActivityDiagramRendererProps> = ({
  diagram,
  metaModel,
  zoom: _zoom,
  selectedLabelDecorationIds = new Set(),
  onLabelDecorationClick,
}) => {
  // ========================================================================
  // Collect and filter elements
  // ========================================================================

  // Get partition nodes (entity_type === 'ACTIVITY_PARTITION')
  const partitionNodes = useMemo(() => {
    return diagram.diagram_nodes.filter(
      (n) => n.entity_type === 'ACTIVITY_PARTITION'
    );
  }, [diagram.diagram_nodes]);

  // Get activity nodes (entity_type === 'ACTIVITY')
  const activityNodes = useMemo(() => {
    return diagram.diagram_nodes.filter((n) => n.entity_type === 'ACTIVITY');
  }, [diagram.diagram_nodes]);

  // Get flow edges (relationship_type === 'ACTIVITY_FLOW')
  const flowEdges = useMemo(() => {
    return diagram.diagram_edges.filter(
      (e) => e.relationship_type === 'ACTIVITY_FLOW'
    );
  }, [diagram.diagram_edges]);

  // Get label decorations
  const labelDecorations = useMemo(() => {
    return diagram.label_decorations || [];
  }, [diagram.label_decorations]);

  // Create lookup maps for label decorations by target
  const nodeLabelDecMap = useMemo(() => {
    const map = new Map<string, LabelDecoration>();
    for (const labelDec of labelDecorations) {
      if (labelDec.targetKind === 'NODE') {
        map.set(labelDec.targetId, labelDec);
      }
    }
    return map;
  }, [labelDecorations]);

  const edgeLabelDecMap = useMemo(() => {
    const map = new Map<string, LabelDecoration>();
    for (const labelDec of labelDecorations) {
      if (labelDec.targetKind === 'EDGE') {
        map.set(labelDec.targetId, labelDec);
      }
    }
    return map;
  }, [labelDecorations]);

  // Create node lookup map for edge rendering
  const nodeMap = useMemo(() => {
    const map = new Map<string, DiagramNode>();
    for (const node of diagram.diagram_nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [diagram.diagram_nodes]);

  // ========================================================================
  // Compute partition render results
  // ========================================================================

  const partitionRenderResults = useMemo(() => {
    const results: Array<{
      node: DiagramNode;
      renderResult: PartitionRenderResult;
    }> = [];

    for (const node of partitionNodes) {
      const partition = getPartitionById(node.entity_id, metaModel);
      if (!partition) continue;

      const orientation = getPartitionOrientation(node.entity_id, metaModel);

      const renderResult = renderPartition({
        partition,
        position: { x: node.pos_x, y: node.pos_y },
        dimensions: { width: node.width, height: node.height },
        orientation,
        metaModel, // Spec 2025-12-31 (A1): Pass metaModel for partition name resolution
      });

      results.push({ node, renderResult });
    }

    return results;
  }, [partitionNodes, metaModel]);

  // ========================================================================
  // Compute activity render results
  // Spec 2026-01-01 (A): Pass node dimensions to renderActivityNode
  // ========================================================================

  const activityRenderResults = useMemo(() => {
    const results: Array<{
      node: DiagramNode;
      renderResult: ActivityNodeRenderResult;
      label: string;
      hasExplicitLabel: boolean;
      activityKind: ActivityKind;
    }> = [];

    for (const node of activityNodes) {
      const activity = getActivityById(node.entity_id, metaModel);
      if (!activity) continue;

      // Calculate center position for rendering
      const centerPosition = {
        x: node.pos_x + node.width / 2,
        y: node.pos_y + node.height / 2,
      };

      // Spec 2026-01-01 (A): Pass node dimensions for shape rendering
      // Shapes will use node.width/height to derive visible bounds
      const renderResult = renderActivityNode(
        activity,
        centerPosition,
        node.width,
        node.height
      );
      const label = getActivityLabel(node.entity_id, metaModel);
      const activityKind = activity.activity_kind || 'Action';

      // Check if this node has an explicit label decoration
      const hasExplicitLabel = nodeLabelDecMap.has(node.id);

      results.push({ node, renderResult, label, hasExplicitLabel, activityKind });
    }

    return results;
  }, [activityNodes, metaModel, nodeLabelDecMap]);

  // ========================================================================
  // Compute flow edge data
  // Spec 2026-01-01 (A1): Include ActivityKind for boundary calculation
  // ========================================================================

  const flowEdgeData = useMemo(() => {
    const results: Array<{
      edge: DiagramEdge;
      sourceNode: DiagramNode;
      targetNode: DiagramNode;
      label?: string;
      flowKind: ActivityFlowKind;
      hasExplicitLabel: boolean;
      sourceActivityKind: ActivityKind;
      targetActivityKind: ActivityKind;
    }> = [];

    for (const edge of flowEdges) {
      const sourceNode = nodeMap.get(edge.source_node_id || '');
      const targetNode = nodeMap.get(edge.target_node_id || '');

      if (!sourceNode || !targetNode) continue;

      const label = getFlowLabel(edge.relationship_id, metaModel);
      const flowKind = getFlowKind(edge.relationship_id, metaModel);

      // Check if this edge has an explicit label decoration
      const hasExplicitLabel = edgeLabelDecMap.has(edge.id);

      // Spec 2026-01-01 (A1): Get ActivityKind for boundary calculation
      const sourceActivityKind = getActivityKindByEntityId(sourceNode.entity_id, metaModel);
      const targetActivityKind = getActivityKindByEntityId(targetNode.entity_id, metaModel);

      results.push({
        edge,
        sourceNode,
        targetNode,
        label,
        flowKind,
        hasExplicitLabel,
        sourceActivityKind,
        targetActivityKind,
      });
    }

    return results;
  }, [flowEdges, nodeMap, metaModel, edgeLabelDecMap]);

  // ========================================================================
  // Compute label decoration data for rendering
  // ========================================================================

  const labelDecorationData = useMemo(() => {
    const results: Array<{
      labelDec: LabelDecoration;
      text: string;
    }> = [];

    for (const labelDec of labelDecorations) {
      let text = labelDec.text || '';

      // If no explicit text, derive from target
      if (!text) {
        if (labelDec.targetKind === 'NODE') {
          // Find the node and get activity name
          const node = nodeMap.get(labelDec.targetId);
          if (node) {
            text = getActivityLabel(node.entity_id, metaModel);
          }
        } else if (labelDec.targetKind === 'EDGE') {
          // Find the edge and get flow label
          const edge = flowEdges.find(e => e.id === labelDec.targetId);
          if (edge) {
            text = getFlowLabel(edge.relationship_id, metaModel) || '';
          }
        }
      }

      results.push({ labelDec, text });
    }

    return results;
  }, [labelDecorations, nodeMap, flowEdges, metaModel]);

  // ========================================================================
  // Compute virtual labels for nodes without explicit decorations
  // Spec 2025-12-31 (A5, Task 5.11): Handle existing diagrams without label decorations
  // ========================================================================

  const virtualNodeLabels = useMemo(() => {
    const results: Array<{
      nodeId: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      activityKind: string;
    }> = [];

    for (const { node, label, activityKind } of activityRenderResults) {
      // Skip if already has explicit label decoration
      if (nodeLabelDecMap.has(node.id)) continue;

      const activity = getActivityById(node.entity_id, metaModel);
      if (!activity) continue;

      // Only create virtual labels for Action and Decision nodes
      if (!shouldShowActivityLabel(activity)) continue;

      // Calculate default label position
      const nodeBounds = {
        x: node.pos_x,
        y: node.pos_y,
        width: node.width,
        height: node.height,
      };
      const labelPos = getDefaultLabelPosition(nodeBounds, activityKind);

      results.push({
        nodeId: node.id,
        text: label,
        x: labelPos.x,
        y: labelPos.y,
        width: labelPos.width,
        height: labelPos.height,
        activityKind,
      });
    }

    return results;
  }, [activityRenderResults, nodeLabelDecMap, metaModel]);

  // ========================================================================
  // Compute virtual labels for edges without explicit decorations
  // ========================================================================

  const virtualEdgeLabels = useMemo(() => {
    const results: Array<{
      edgeId: string;
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    for (const { edge, sourceNode, targetNode, label } of flowEdgeData) {
      // Skip if no label text or already has explicit label decoration
      if (!label) continue;
      if (edgeLabelDecMap.has(edge.id)) continue;

      // Calculate default edge label position
      const labelPos = getDefaultEdgeLabelPosition(sourceNode, targetNode);

      results.push({
        edgeId: edge.id,
        text: label,
        x: labelPos.x,
        y: labelPos.y,
        width: labelPos.width,
        height: labelPos.height,
      });
    }

    return results;
  }, [flowEdgeData, edgeLabelDecMap]);

  // ========================================================================
  // Render
  // ========================================================================

  // Early return for empty diagram
  if (partitionNodes.length === 0 && activityNodes.length === 0) {
    return (
      <g className="activity-diagram-renderer">
        <text
          x={200}
          y={100}
          textAnchor="middle"
          fontSize={14}
          fill="#666"
        >
          Add activities or partitions to begin
        </text>
      </g>
    );
  }

  return (
    <g className="activity-diagram-renderer">
      {/* Layer 1: Partitions (z-index 50 - lowest, behind everything) */}
      {partitionRenderResults.map(({ node, renderResult }) => (
        <PartitionElement
          key={node.id}
          node={node}
          renderResult={renderResult}
        />
      ))}

      {/* Layer 2: Activity nodes (z-index 100 - standard node level) */}
      {/* Spec 2025-12-31 (A5): Don't show inline label if explicit decoration exists */}
      {/* Spec 2026-01-01 (B1): Pass activityKind for proper label alignment */}
      {activityRenderResults.map(({ node, renderResult, label, hasExplicitLabel, activityKind }) => (
        <ActivityNodeElement
          key={node.id}
          node={node}
          renderResult={renderResult}
          showInlineLabel={!hasExplicitLabel}
          label={label}
          activityKind={activityKind}
        />
      ))}

      {/* Layer 3: Activity flows (z-index 110 - above activities for visibility) */}
      {/* Spec 2026-01-01 (A1): Pass ActivityKind for boundary-anchored rendering */}
      {flowEdgeData.map(({
        edge,
        sourceNode,
        targetNode,
        label,
        flowKind,
        hasExplicitLabel,
        sourceActivityKind,
        targetActivityKind,
      }) => (
        <ActivityFlowElement
          key={edge.id}
          edge={edge}
          sourceNode={sourceNode}
          targetNode={targetNode}
          showInlineLabel={!hasExplicitLabel}
          label={label}
          flowKind={flowKind}
          sourceActivityKind={sourceActivityKind}
          targetActivityKind={targetActivityKind}
        />
      ))}

      {/* Layer 4: Explicit Label Decorations (z-index 115) */}
      {labelDecorationData.map(({ labelDec, text }) => (
        <LabelDecorationElement
          key={labelDec.id}
          labelDec={labelDec}
          text={text}
          isSelected={selectedLabelDecorationIds.has(labelDec.id)}
          onClick={(e) => onLabelDecorationClick?.(labelDec.id, e)}
        />
      ))}

      {/* Layer 5: Virtual Node Labels (for backward compatibility with existing diagrams) */}
      {/* These are rendered as non-interactive text; interaction creates explicit decoration */}
      {/* Note: Currently rendered inline with nodes above when hasExplicitLabel is false */}

      {/* Layer 6: Virtual Edge Labels (for backward compatibility with existing diagrams) */}
      {/* These are rendered as non-interactive text; interaction creates explicit decoration */}
      {/* Note: Currently rendered inline with edges above when hasExplicitLabel is false */}
    </g>
  );
};

export default ActivityDiagramRenderer;
