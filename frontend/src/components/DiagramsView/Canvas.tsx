import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import {
  getNodesInRenderOrder,
  getEdgesForDiagram,
  getEntityLabel,
  getEntityColor,
  calculateArrowhead,
  wrapText,
  calculateTextPosition,
  calculateBusinessUserTextPosition,
  calculateStickManDimensions,
  getTextRenderingConstants,
  getEdgeDisplayLabel,
  isPointNearPolyline,
  isPointOnHandle,
  isPointOnLabel,
  measureTextWidth,
  getEdgeStrokeStyle,
  getDiagramById,
  normalizeRect,
  isNodeInsideRect,
  isEdgeInsideRect,
  getDescendantNodes,
  isPointAttachedToNode,
  renderBoxDecoration,
  renderLineDecoration,
  getNodeFillColor,
  getDecorationsForDiagram,
  parseLineWeight,
} from '../../utils/rendering';
import {
  shouldRenderAsERD,
  getAttributesByIds,
  formatAttribute,
  ERD_HEADER_HEIGHT,
  ERD_ATTRIBUTE_ROW_HEIGHT,
} from '../../utils/erdUtils';
import {
  isInterfaceWithCustomRendering,
  getEndpointLinesForNode,
  getChildEntityNodesForInterface,
  calculateEndpointSectionHeight,
  ENDPOINT_LINE_HEIGHT,
  ENDPOINT_SECTION_PADDING,
  ENDPOINT_FONT_SIZE,
  ENDPOINT_TEXT_PADDING,
  INTERFACE_ENTITIES_SECTION_GAP,
  INTERFACE_PADDING_Y,
} from '../../utils/interfaceCustomRenderer';
import { getDefaultViewQuarter } from '../../utils/quarterUtils';
import {
  appConfig,
  diagramEditing,
  edgeInteraction,
  HandlePosition,
  DragState,
  EdgeDragState,
  handleCursors,
  BoxSelectState,
  initialBoxSelectState,
  boxSelectConfig,
  GroupDragState,
  initialGroupDragState,

  DECORATION_DEFAULTS,
} from '../../config/defaults';
import {
  DiagramNode,
  DiagramEdge,
  Decoration,
  BoxDecoration,
  LineDecoration,
  ShapeDecoration,
  ShapeDecorationType,
  LineDecorationType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
  ElementContextMenuType,
  RELATIONSHIP_EDGE_TYPES,
} from '../../types/model';
import {


  findDecorationAtPoint,
  isDecorationInsideRect,


  isPointInsideShapeDecoration,
  getShapeHandlePositions,


  createShapeDecoration,
  createLineTypeDecoration,
  isShapeDecoration,
  isLineBasedDecoration,
  findDecorationLabelAtPoint,
  calculateLineLabelPosition,
  calculateMidSegmentPositions,
  getMidSegmentHandleAtPoint,
} from '../../utils/decorationUtils';
import {
  getSortedRenderOrder,
  RenderableElement,
} from '../../utils/zIndexUtils';
import { renderShape, renderShapeDecoration } from '../../utils/shapeRendering';
// Task 5.3: Import interaction rendering utilities
import {
  calculateInteractionPaths,
  generateLinePath,
  getStrokeDasharray,
} from '../../utils/interactionRendering';
import { DecorationAddMode } from './InspectorPanel';
import styles from './DiagramsView.module.css';

// Task Group 5: Import Activity Diagram rendering component
import { ActivityDiagramRenderer } from './ActivityDiagramRenderer';

// Task Group 4: Import State Diagram rendering component
import { StateDiagramRenderer } from './StateDiagramRenderer';
// Task Group 2: Import Sequence Diagram rendering component
import { SequenceDiagramRenderer } from './SequenceDiagramRenderer';
// Task Group 7: Import UI Workflow Diagram rendering component
import { UIWorkflowDiagramRenderer } from './UIWorkflowDiagramRenderer';
// Spec 2026-04-03: Import User Journey Diagram rendering component and types
import UserJourneyDiagramRenderer from './UserJourneyDiagramRenderer';
import type { JourneyNavLink } from './UserJourneyDiagramRenderer';
import type { UserJourneyDiagramDto } from '../../types/userJourneyDiagram';
import { enrichJourneySteps } from './journeyEnrichment';
// Spec 2026-04-07: Import User Journey Overview Diagram rendering component and types
import UserJourneyOverviewDiagramRenderer from './UserJourneyOverviewDiagramRenderer';
import type { UserJourneyOverviewDiagramDto } from '../../types/userJourneyOverviewDiagram';
// Spec 2026-04-10: Overview enrichment utility (summary counts + related colleagues)
import { enrichOverviewFull } from './overviewEnrichment';
import type { OverviewEnrichmentMetaData } from './overviewEnrichment';

// Task Group 2: Import getDiagramType for case-insensitive diagram type comparison
import { getDiagramType } from '../../types/diagramType';

// Task Group 2: Import types for sequence diagram conversion
import { SequenceDiagram, SequenceParticipant, SequenceMessage, SequenceFragment, SequenceOperand, SequenceNode } from '../../types/sequenceDiagram';
import { SequenceContent } from '../../types/typedContent';
import type { Diagram } from '../../types/model';
// Spec 2026-04-13: Shared diagram extraction utilities (extracted from this file)
import { extractUserJourneyDiagram, extractUserJourneyOverviewDiagram } from './diagramExtractionUtils';

// Task Group 5-6: Import ER Edge Symbol utilities for UML relationship symbols and cardinality labels
import {
  getEREdgeSymbols,
  getSymbolRenderData,
  calculateEdgeAngle,
  getEREdgeStrokeDasharray,
  ER_SYMBOL_HEIGHT,
} from '../../utils/erEdgeSymbols';


// Spec 2026-01-01: Import square resize helpers for Activity symbol nodes
import {
  getActivityKindForNode,
  isSymbolActivityKind,
  calculateSquareResize,
} from '../../utils/activityNodeRendering';

// Spec 2026-01-01 Task Group 3: Import square resize helpers for State symbol nodes
import {
  getStateKindForNode,
  isSymbolStateKind,
  calculateSquareResizeForState,
} from '../../utils/stateNodeRendering';

// Geometry utilities for State edge boundary-adjusted hit-testing
import {
  getEdgeBoundaryPoints,
  getBoundaryAnchorPoint,
  getShapeKindFromStateKind,
  ShapeKind,
} from '../../utils/geometryUtils';

// Delete confirmation modal for State diagram elements
import { DeleteDiagramElementModal } from './modals/DeleteDiagramElementModal';

// Re-export DecorationAddMode for backward compatibility
export type { DecorationAddMode };

// Task Group 4: Decoration drag state types
type DecorationDragType = 'move' | 'resize' | 'linePointDrag' | 'labelDrag' | null;

interface DecorationDragState {
  isDragging: boolean;
  dragType: DecorationDragType;
  decorationId: string;
  resizeHandle: HandlePosition | null;
  linePointIndex: number | null; // For LINE point dragging
  startX: number;
  startY: number;
  originalDecoration: Decoration | null;
  // Task Group 1: For label dragging
  originalLabelPos: { x: number; y: number } | null;
}

const initialDecorationDragState: DecorationDragState = {
  isDragging: false,
  dragType: null,
  decorationId: '',
  resizeHandle: null,
  linePointIndex: null,
  startX: 0,
  startY: 0,
  originalDecoration: null,
  originalLabelPos: null,
};

// Task Group 1: Extended BOX decoration add gesture state (now supports all shape types)
interface BoxAddGestureState {
  isActive: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  shapeType: ShapeDecorationType | null;  // Track which shape type is being drawn
}

const initialBoxAddGestureState: BoxAddGestureState = {
  isActive: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  shapeType: null,
};

// Task Group 1: Extended LINE decoration add gesture state (now supports arrow types)
interface LineAddGestureState {
  isActive: boolean;
  startX: number;
  startY: number;
  hasFirstPoint: boolean;
  arrowType: LineDecorationType | null;  // Track which line type is being drawn
}

const initialLineAddGestureState: LineAddGestureState = {
  isActive: false,
  startX: 0,
  startY: 0,
  hasFirstPoint: false,
  arrowType: null,
};

// Task Group 3 (Line Enhancements): Bend point insertion state
interface BendPointInsertState {
  isInserting: boolean;
  decorationType: 'LINE' | 'EDGE';
  targetId: string;  // decoration ID or edge ID
  segmentIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

const initialBendPointInsertState: BendPointInsertState = {
  isInserting: false,
  decorationType: 'LINE',
  targetId: '',
  segmentIndex: 0,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

interface CanvasProps {
  diagramId: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  // Selection state props (lifted from Canvas to DiagramsView)
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  // Task 1.6: Add decoration selection props (optional for backward compatibility)
  selectedDecorationIds?: Set<string>;
  onNodeSelect: (nodeId: string, isMultiSelect: boolean) => void;
  onEdgeSelect: (edgeId: string, isMultiSelect: boolean) => void;
  // Task 1.6: Add decoration selection callback (optional for backward compatibility)
  onDecorationSelect?: (decorationId: string, isMultiSelect: boolean) => void;
  onClearSelection: () => void;
  // Task 1.6: Updated signature to include decorations
  onBulkSelect: (nodeIds: Set<string>, edgeIds: Set<string>, decorationIds: Set<string>, addToExisting: boolean) => void;
  // Task Group 3: Decoration add mode props (for future gesture handling)
  decorationAddMode?: DecorationAddMode;
  onDecorationAddModeChange?: (mode: DecorationAddMode) => void;
  // Sticky shape styles: last-used colors/opacity to apply to new shapes
  stickyShapeStyles?: {
    background_color?: string;
    line_color?: string;
    background_opacity?: number;
    border_opacity?: number;
  };
  // Viewport center fix: Ref to expose scroll container for on-demand viewport queries
  scrollContainerRef?: React.MutableRefObject<HTMLDivElement | null>;
  // Task Group 4: Context menu callback for right-click on elements
  onElementContextMenu?: (
    event: React.MouseEvent,
    elementType: ElementContextMenuType,
    elementId: string,
    currentAutoSize?: boolean
  ) => void;
  // Canvas-level right-click callback (empty space)
  onCanvasContextMenu?: (event: React.MouseEvent) => void;
  // Callback when a new element is added (for clipboard clearing)
  onNewElementAdded?: () => void;
  // Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
  // Task Group 5, Task 5.3: Callback for unlinked overview node click (bridges toast from DiagramsView into Canvas)
  onUnlinkedNodeClick?: () => void;
  // Spec 2026-04-10: Related colleagues click callback for saved overview diagrams
  onColleagueClick?: (businessUserId: string) => void;
  /** Navigation link to the parent overview diagram for child journey diagrams */
  journeyParentOverview?: JourneyNavLink | null;
  /** Navigation links to sibling/linked journey diagrams */
  journeyLinkedJourneys?: JourneyNavLink[];
  /** Callback when parent overview link is clicked in a child journey diagram */
  onParentOverviewClick?: (diagramId: string) => void;
  /** Callback when a linked journey link is clicked in a child journey diagram */
  onLinkedJourneyClick?: (diagramId: string) => void;
  /** Map from user journey entity ID to saved diagram ID (for co-worker link navigation) */
  journeyDiagramMap?: Map<string, string>;
  /** Callback when a co-worker abbreviation link is clicked */
  onCoWorkerClick?: (diagramId: string) => void;
}

// Initial drag state
const initialDragState: DragState = {
  isDragging: false,
  dragType: null,
  resizeHandle: null,
  startX: 0,
  startY: 0,
  originalNode: null,
};

// Initial edge drag state
const initialEdgeDragState: EdgeDragState = {
  isDragging: false,
  dragType: null,
  edgeId: '',
  pointIndex: undefined,
  startX: 0,
  startY: 0,
  originalValue: { pos_x: 0, pos_y: 0 },
};

// Calculate 8 handle positions from node bounds
function getHandlePositions(node: DiagramNode): { position: HandlePosition; x: number; y: number }[] {
  return [
    { position: 'TL', x: node.pos_x, y: node.pos_y },
    { position: 'TC', x: node.pos_x + node.width / 2, y: node.pos_y },
    { position: 'TR', x: node.pos_x + node.width, y: node.pos_y },
    { position: 'ML', x: node.pos_x, y: node.pos_y + node.height / 2 },
    { position: 'MR', x: node.pos_x + node.width, y: node.pos_y + node.height / 2 },
    { position: 'BL', x: node.pos_x, y: node.pos_y + node.height },
    { position: 'BC', x: node.pos_x + node.width / 2, y: node.pos_y + node.height },
    { position: 'BR', x: node.pos_x + node.width, y: node.pos_y + node.height },
  ];
}

// Check if point is over a resize handle
function getHandleAtPoint(
  x: number,
  y: number,
  node: DiagramNode,
  handleSize: number
): HandlePosition | null {
  const handles = getHandlePositions(node);
  const radius = handleSize / 2;

  for (const handle of handles) {
    const dx = x - handle.x;
    const dy = y - handle.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return handle.position;
    }
  }

  return null;
}

// Task Group 4: Check if point is over a shape decoration resize handle
function getShapeDecorationHandleAtPoint(
  x: number,
  y: number,
  shape: ShapeDecoration,
  handleSize: number
): HandlePosition | null {
  const handles = getShapeHandlePositions(shape);
  const radius = handleSize / 2;

  for (const handle of handles) {
    const dx = x - handle.x;
    const dy = y - handle.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return handle.position;
    }
  }

  return null;
}

// Check if point is over a LINE decoration control point
function getLineDecorationPointAtPoint(
  x: number,
  y: number,
  line: LineDecoration,
  handleSize: number
): number | null {
  const radius = handleSize / 2;

  for (let i = 0; i < line.line_points.length; i++) {
    const point = line.line_points[i];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return i;
    }
  }

  return null;
}

// Calculate resize based on handle position
function calculateResize(
  handle: HandlePosition,
  originalNode: DiagramNode,
  dx: number,
  dy: number
): { pos_x: number; pos_y: number; width: number; height: number } {
  let pos_x = originalNode.pos_x;
  let pos_y = originalNode.pos_y;
  let width = originalNode.width;
  let height = originalNode.height;

  const minWidth = appConfig.node.minWidth;
  const minHeight = appConfig.node.minHeight;

  switch (handle) {
    case 'TL':
      pos_x = Math.min(originalNode.pos_x + dx, originalNode.pos_x + originalNode.width - minWidth);
      pos_y = Math.min(originalNode.pos_y + dy, originalNode.pos_y + originalNode.height - minHeight);
      width = Math.max(originalNode.width - dx, minWidth);
      height = Math.max(originalNode.height - dy, minHeight);
      break;
    case 'TC':
      pos_y = Math.min(originalNode.pos_y + dy, originalNode.pos_y + originalNode.height - minHeight);
      height = Math.max(originalNode.height - dy, minHeight);
      break;
    case 'TR':
      pos_y = Math.min(originalNode.pos_y + dy, originalNode.pos_y + originalNode.height - minHeight);
      width = Math.max(originalNode.width + dx, minWidth);
      height = Math.max(originalNode.height - dy, minHeight);
      break;
    case 'ML':
      pos_x = Math.min(originalNode.pos_x + dx, originalNode.pos_x + originalNode.width - minWidth);
      width = Math.max(originalNode.width - dx, minWidth);
      break;
    case 'MR':
      width = Math.max(originalNode.width + dx, minWidth);
      break;
    case 'BL':
      pos_x = Math.min(originalNode.pos_x + dx, originalNode.pos_x + originalNode.width - minWidth);
      width = Math.max(originalNode.width - dx, minWidth);
      height = Math.max(originalNode.height + dy, minHeight);
      break;
    case 'BC':
      height = Math.max(originalNode.height + dy, minHeight);
      break;
    case 'BR':
      width = Math.max(originalNode.width + dx, minWidth);
      height = Math.max(originalNode.height + dy, minHeight);
      break;
  }

  return { pos_x, pos_y, width, height };
}

// Task Group 4: Calculate shape decoration resize based on handle position
function calculateShapeDecorationResize(
  handle: HandlePosition,
  originalShape: ShapeDecoration,
  dx: number,
  dy: number
): { pos_x: number; pos_y: number; width: number; height: number } {
  let pos_x = originalShape.pos_x;
  let pos_y = originalShape.pos_y;
  let width = originalShape.width;
  let height = originalShape.height;

  const minWidth = 10;
  const minHeight = 10;

  switch (handle) {
    case 'TL':
      pos_x = Math.min(originalShape.pos_x + dx, originalShape.pos_x + originalShape.width - minWidth);
      pos_y = Math.min(originalShape.pos_y + dy, originalShape.pos_y + originalShape.height - minHeight);
      width = Math.max(originalShape.width - dx, minWidth);
      height = Math.max(originalShape.height - dy, minHeight);
      break;
    case 'TC':
      pos_y = Math.min(originalShape.pos_y + dy, originalShape.pos_y + originalShape.height - minHeight);
      height = Math.max(originalShape.height - dy, minHeight);
      break;
    case 'TR':
      pos_y = Math.min(originalShape.pos_y + dy, originalShape.pos_y + originalShape.height - minHeight);
      width = Math.max(originalShape.width + dx, minWidth);
      height = Math.max(originalShape.height - dy, minHeight);
      break;
    case 'ML':
      pos_x = Math.min(originalShape.pos_x + dx, originalShape.pos_x + originalShape.width - minWidth);
      width = Math.max(originalShape.width - dx, minWidth);
      break;
    case 'MR':
      width = Math.max(originalShape.width + dx, minWidth);
      break;
    case 'BL':
      pos_x = Math.min(originalShape.pos_x + dx, originalShape.pos_x + originalShape.width - minWidth);
      width = Math.max(originalShape.width - dx, minWidth);
      height = Math.max(originalShape.height + dy, minHeight);
      break;
    case 'BC':
      height = Math.max(originalShape.height + dy, minHeight);
      break;
    case 'BR':
      width = Math.max(originalShape.width + dx, minWidth);
      height = Math.max(originalShape.height + dy, minHeight);
      break;
  }

  return { pos_x, pos_y, width, height };
}

// Find node at point
function findNodeAtPoint(x: number, y: number, nodes: DiagramNode[]): DiagramNode | null {
  // Search in reverse order (top-most first)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (
      x >= node.pos_x &&
      x <= node.pos_x + node.width &&
      y >= node.pos_y &&
      y <= node.pos_y + node.height
    ) {
      return node;
    }
  }
  return null;
}


// Task Group 2: Extract SequenceDiagram from Diagram.typedContent
// Converts the typedContent envelope to the SequenceDiagram format expected by SequenceDiagramRenderer
function extractSequenceDiagram(diagram: Diagram | null | undefined): SequenceDiagram {
  // Default empty sequence diagram structure
  const emptyDiagram: SequenceDiagram = {
    id: diagram?.id || '',
    model_file_id: '',
    name: diagram?.name || '',
    type: 'Sequence',
    participants: [],
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };

  if (!diagram?.typedContent) {
    return emptyDiagram;
  }

  const content = diagram.typedContent.content as SequenceContent | undefined;
  if (!content) {
    return emptyDiagram;
  }

  // Map participants from SequenceParticipantRef to SequenceParticipant
  const participants: SequenceParticipant[] = (content.participants || []).map(p => ({
    id: p.id,
    ref_kind: p.ref_kind as SequenceParticipant['ref_kind'],
    ref_id: p.ref_id,
    order_index: p.order_index,
  }));

  // Map messages from SequenceMessageRef to SequenceMessage
  const messages: SequenceMessage[] = (content.messages || []).map(m => ({
    id: m.id,
    exchange_id: m.exchange_id,
    exchange_role: m.exchange_role as SequenceMessage['exchange_role'],
    from_participant_id: m.from_participant_id,
    to_participant_id: m.to_participant_id,
    ref_kind: m.ref_kind as SequenceMessage['ref_kind'],
    ref_id: m.ref_id,
    label_text: m.label_text,
    is_collection: m.is_collection,
    show_endpoint_name: m.show_endpoint_name,
    show_endpoint_verb_path: m.show_endpoint_verb_path,
    show_endpoint_req_res_data: m.show_endpoint_req_res_data,
    response_mode: m.response_mode,
  }));

  // Map fragments from SequenceFragmentRef to SequenceFragment
  const fragments: SequenceFragment[] = (content.fragments || []).map(f => ({
    id: f.id,
    fragment_kind: f.fragment_kind as SequenceFragment['fragment_kind'],
    label_text: f.label_text,
  }));

  // Map operands from SequenceOperandRef to SequenceOperand
  const operands: SequenceOperand[] = (content.operands || []).map(o => ({
    id: o.id,
    fragment_id: o.fragment_id,
    guard_expression: o.guard_expression,
    operand_index: o.operand_index,
  }));

  // Map sequence nodes from SequenceNodeRef to SequenceNode
  const sequence_nodes: SequenceNode[] = (content.sequenceNodes || []).map(n => ({
    id: n.id,
    node_kind: n.node_kind as SequenceNode['node_kind'],
    message_id: n.message_id,
    fragment_id: n.fragment_id,
    order_index: n.order_index,
    parent_node_id: n.parent_node_id,
    parent_operand_id: n.parent_operand_id,
  }));

  return {
    id: diagram.id,
    model_file_id: '',
    name: diagram.name,
    type: 'Sequence',
    participants,
    messages,
    fragments,
    operands,
    sequence_nodes,
  };
}


export function Canvas({
  diagramId,
  zoom,
  onZoomChange,
  selectedNodeIds,
  selectedEdgeIds,
  selectedDecorationIds = new Set(), // Task 1.6: Default to empty Set
  onNodeSelect,
  onEdgeSelect,
  onDecorationSelect, // Task 4.2: Decoration selection callback
  onClearSelection,
  onBulkSelect,
  decorationAddMode, // Task Group 4: Decoration add mode
  onDecorationAddModeChange, // Task Group 4: Callback when add mode changes
  stickyShapeStyles, // Sticky styles for new shape decorations
  scrollContainerRef, // Viewport center fix: External ref for on-demand viewport queries
  onElementContextMenu, // Task Group 4: Context menu callback
  onCanvasContextMenu, // Canvas-level right-click (empty space)
  onNewElementAdded, // Callback when new element added (clipboard clearing)
  onUnlinkedNodeClick, // Task 5.3: Unlinked overview node click callback
  onColleagueClick, // Spec 2026-04-10: Related colleagues click callback
  journeyParentOverview,
  journeyLinkedJourneys,
  onParentOverviewClick,
  onLinkedJourneyClick,
  journeyDiagramMap,
  onCoWorkerClick,
}: CanvasProps) {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();
  const internalContainerRef = useRef<HTMLDivElement>(null);
  // Use external ref if provided, otherwise use internal ref
  const containerRef = scrollContainerRef || internalContainerRef;
  const svgRef = useRef<SVGSVGElement>(null);

  // Label selection state (kept local as it's specific to label dragging)
  const [selectedLabelEdgeId, setSelectedLabelEdgeId] = useState<string | null>(null);

  // Task Group 1: Decoration label selection state (similar to selectedLabelEdgeId)
  const [selectedDecorationLabelId, setSelectedDecorationLabelId] = useState<string | null>(null);

  // Drag state
  const [dragState, setDragState] = useState<DragState>(initialDragState);
  const [edgeDragState, setEdgeDragState] = useState<EdgeDragState>(initialEdgeDragState);

  // Box-select state (Task Group 3)
  const [boxSelectState, setBoxSelectState] = useState<BoxSelectState>(initialBoxSelectState);

  // Group drag state (Task Group 4)
  const [groupDragState, setGroupDragState] = useState<GroupDragState>(initialGroupDragState);

  // Task Group 4: Decoration drag state
  const [decorationDragState, setDecorationDragState] = useState<DecorationDragState>(initialDecorationDragState);

  // Task Group 4: Shape add gesture state (extended to support all shape types)
  const [boxAddGestureState, setBoxAddGestureState] = useState<BoxAddGestureState>(initialBoxAddGestureState);

  // Task Group 4: LINE add gesture state (extended to support arrow types)
  const [lineAddGestureState, setLineAddGestureState] = useState<LineAddGestureState>(initialLineAddGestureState);

  // Task Group 4: LINE add preview point (for showing line preview during second click)
  const [linePreviewPoint, setLinePreviewPoint] = useState<{ x: number; y: number } | null>(null);

  // Task Group 3 (Line Enhancements): Bend point insertion state
  const [bendPointInsertState, setBendPointInsertState] = useState<BendPointInsertState>(initialBendPointInsertState);

  // Delete confirmation modal state for State diagram elements
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    nodeIds: string[];
    edgeIds: string[];
    decorationIds: string[];
  }>({ isOpen: false, nodeIds: [], edgeIds: [], decorationIds: [] });

  // Preview state for real-time visual feedback during drag
  const [previewNode, setPreviewNode] = useState<DiagramNode | null>(null);
  const [previewEdgePoint, setPreviewEdgePoint] = useState<{ edgeId: string; pointIndex: number; pos_x: number; pos_y: number } | null>(null);
  const [previewLabelPos, setPreviewLabelPos] = useState<{ edgeId: string; pos_x: number; pos_y: number } | null>(null);

  // Task Group 4: Decoration preview state
  const [previewDecoration, setPreviewDecoration] = useState<Decoration | null>(null);

  // Task Group 1: Preview decoration label position during drag
  const [previewDecorationLabelPos, setPreviewDecorationLabelPos] = useState<{ decorationId: string; pos_x: number; pos_y: number } | null>(null);

  // Group movement preview state
  const [previewNodes, setPreviewNodes] = useState<Map<string, DiagramNode>>(new Map());
  const [previewEdges, setPreviewEdges] = useState<Map<string, DiagramEdge>>(new Map());
  const [previewDecorations, setPreviewDecorations] = useState<Map<string, Decoration>>(new Map());

  // Get current diagram to access view_quarter and decorations
  const diagram = getDiagramById(diagramId, state.model);
  const viewQuarter = diagram?.view_quarter || getDefaultViewQuarter();

  // Task Group 6: Get decorations with temporal filtering (diagram-level temporality)
  const decorations: Decoration[] = getDecorationsForDiagram(diagramId, state.model, viewQuarter);

  // Task 5.3: Get user_interactions from diagram (default to empty array)
  const userInteractions = diagram?.user_interactions || [];

  // Task Group 5: Check if this is an Activity diagram
  const isActivityDiagram = diagram?.diagram_type === 'Activity';

  // Task Group 4: Check if this is a State diagram
  const isStateDiagram = diagram?.diagram_type === 'State';

  // Task Group 2: Check if this is a Sequence diagram (using case-insensitive comparison)
  const isSequenceDiagram = getDiagramType(diagram) === 'Sequence';

  // Task Group 7: Check if this is a UI Workflow diagram
  const isUIWorkflowDiagram = getDiagramType(diagram) === 'UI_Workflow';

  // Spec 2026-04-03: Check if this is a User Journey diagram
  const isUserJourneyDiagram = getDiagramType(diagram) === 'USER_JOURNEY';
  // Spec 2026-04-07: Check if this is a User Journey Overview diagram
  const isUserJourneyOverviewDiagram = getDiagramType(diagram) === 'USER_JOURNEY_OVERVIEW';

  // Z-Index Unified Rendering: low/highZIndexDecorations removed
  // Rendering now uses sortedElements computed below after nodes/edges are defined

  // Apply time-based filtering to nodes and edges
  const nodes = getNodesInRenderOrder(diagramId, state.model, viewQuarter);

  // Create a set of visible node IDs for edge endpoint checking
  const visibleNodeIds = new Set(nodes.map(n => n.id));

  // Get edges with time-based filtering (checks relationship validity AND both endpoints visible)
  const edges = getEdgesForDiagram(diagramId, state.model, viewQuarter, visibleNodeIds);

  // Z-Index Unified Rendering: Compute sorted render order for all elements
  // This replaces the old category-based rendering with a single z_index-sorted list
  const sortedElements = useMemo(
    () => getSortedRenderOrder(nodes, edges, decorations),
    [nodes, edges, decorations]
  );

  // Spec 2026-04-03: Auto-sized SVG for User Journey diagrams
  const [journeyBounds, setJourneyBounds] = useState<{ width: number; height: number } | null>(null);

  // Spec 2026-04-07: Auto-sized SVG for User Journey Overview diagrams
  const [overviewBounds, setOverviewBounds] = useState<{ width: number; height: number } | null>(null);

  // Reset journey bounds when diagram changes or is cleared
  useEffect(() => {
    if (!isUserJourneyDiagram) {
      setJourneyBounds(null);
    }
  }, [isUserJourneyDiagram, diagramId]);

  // Spec 2026-04-07: Reset overview bounds when diagram changes or is cleared
  useEffect(() => {
    if (!isUserJourneyOverviewDiagram) {
      setOverviewBounds(null);
    }
  }, [isUserJourneyOverviewDiagram, diagramId]);

  const canvasWidth = (isUserJourneyDiagram && journeyBounds) ? journeyBounds.width
    : (isUserJourneyOverviewDiagram && overviewBounds) ? overviewBounds.width
    : appConfig.canvas.defaultWidth;
  const canvasHeight = (isUserJourneyDiagram && journeyBounds) ? journeyBounds.height
    : (isUserJourneyOverviewDiagram && overviewBounds) ? overviewBounds.height
    : appConfig.canvas.defaultHeight;

  const { padding, lineSpacing } = getTextRenderingConstants();
  const defaultFontSize = appConfig.node.fontSize;

  // Get the primary selected node (first in Set - for resize handles)
  const primarySelectedNodeId = Array.from(selectedNodeIds)[0] || null;
  const primarySelectedNode = primarySelectedNodeId ? nodes.find(n => n.id === primarySelectedNodeId) : null;

  // Get the primary selected edge (first in Set - for edge point handles)
  const primarySelectedEdgeId = Array.from(selectedEdgeIds)[0] || null;
  const primarySelectedEdge = primarySelectedEdgeId ? edges.find(e => e.id === primarySelectedEdgeId) : null;

  // Task Group 4: Get the primary selected decoration (first in Set - for handles)
  const primarySelectedDecorationId = Array.from(selectedDecorationIds)[0] || null;
  const primarySelectedDecoration = primarySelectedDecorationId
    ? decorations.find(d => d.id === primarySelectedDecorationId)
    : null;

  // Use preview node during drag, otherwise use actual node
  const getDisplayNode = (node: DiagramNode): DiagramNode => {
    // Check group preview first
    if (previewNodes.has(node.id)) {
      return previewNodes.get(node.id)!;
    }
    if (previewNode && node.id === previewNode.id) {
      return previewNode;
    }
    return node;
  };

  // Get display edge with preview support
  const getDisplayEdge = (edge: DiagramEdge): DiagramEdge => {
    if (previewEdges.has(edge.id)) {
      return previewEdges.get(edge.id)!;
    }
    return edge;
  };

  // Get display edge point (with preview if dragging)
  const getDisplayEdgePoint = (edge: DiagramEdge, pointIndex: number): { pos_x: number; pos_y: number } => {
    // Check group preview first
    const displayEdge = getDisplayEdge(edge);

    if (previewEdgePoint && previewEdgePoint.edgeId === edge.id && previewEdgePoint.pointIndex === pointIndex) {
      return { pos_x: previewEdgePoint.pos_x, pos_y: previewEdgePoint.pos_y };
    }
    const edgePoints = displayEdge.edge_points || [];
    if (pointIndex >= 0 && pointIndex < edgePoints.length) {
      return { pos_x: edgePoints[pointIndex].pos_x, pos_y: edgePoints[pointIndex].pos_y };
    }
    return { pos_x: 0, pos_y: 0 };
  };

  // Get display label position (with preview if dragging)
  const getDisplayLabelPos = (edge: DiagramEdge): { pos_x: number; pos_y: number } | null => {
    if (previewLabelPos && previewLabelPos.edgeId === edge.id) {
      return { pos_x: previewLabelPos.pos_x, pos_y: previewLabelPos.pos_y };
    }
    const displayEdge = getDisplayEdge(edge);
    if (displayEdge.label_pos_x !== undefined && displayEdge.label_pos_y !== undefined) {
      return { pos_x: displayEdge.label_pos_x, pos_y: displayEdge.label_pos_y };
    }
    return null;
  };

  // Task Group 4: Get display decoration (with preview if dragging)
  const getDisplayDecoration = (decoration: Decoration): Decoration => {
    if (previewDecoration && previewDecoration.id === decoration.id) {
      return previewDecoration;
    }
    if (previewDecorations.has(decoration.id)) {
      return previewDecorations.get(decoration.id)!;
    }
    return decoration;
  };

  // Task Group 1: Get display decoration label position (with preview if dragging)
  const getDisplayDecorationLabelPos = (line: LineDecoration): { x: number; y: number } => {
    if (previewDecorationLabelPos && previewDecorationLabelPos.decorationId === line.id) {
      return { x: previewDecorationLabelPos.pos_x, y: previewDecorationLabelPos.pos_y };
    }
    return calculateLineLabelPosition(line);
  };


  // Spec 2026-01-01 Task Group 1,3: Helper to calculate resize dimensions with square constraint for Activity/State symbols
  const getNodeResizeDimensions = (
    handle: HandlePosition,
    originalNode: DiagramNode,
    dx: number,
    dy: number
  ): { pos_x: number; pos_y: number; width: number; height: number } => {
    if (state.model.metaModel) {
      // Task Group 1: Check if this is an Activity symbol node that needs square resize
      const activityKind = getActivityKindForNode(originalNode, state.model.metaModel);
      if (isSymbolActivityKind(activityKind)) {
        // Use square-constrained resize for Activity symbol nodes (Initial/Decision/Merge/Final)
        return calculateSquareResize(handle, originalNode, dx, dy);
      }

      // Task Group 3: Check if this is a State symbol node that needs square resize
      const stateKind = getStateKindForNode(originalNode, state.model.metaModel);
      if (isSymbolStateKind(stateKind)) {
        // Use square-constrained resize for State symbol nodes (Initial/Final)
        return calculateSquareResizeForState(handle, originalNode, dx, dy);
      }
    }
    // Default to standard rectangular resize
    return calculateResize(handle, originalNode, dx, dy);
  };
  // Handle wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -appConfig.zoom.step : appConfig.zoom.step;
      onZoomChange(zoom + delta);
    }
  };

  // Re-render when view_quarter changes + wheel event handling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelPrevent = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    container.addEventListener('wheel', handleWheelPrevent, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelPrevent);
    };
  }, [viewQuarter]);

  // Delete key handler (Task Group 5) - extended for decorations and State diagram confirmation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Only handle Delete/Backspace
    if (e.key !== 'Delete' && e.key !== 'Backspace') {
      return;
    }

    // Check if we have anything selected
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0 && selectedDecorationIds.size === 0) {
      return;
    }

    // Check if focus is on an input element (prevent deletion when editing inspector)
    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      (activeElement as HTMLElement).contentEditable === 'true'
    )) {
      return;
    }

    // Prevent default browser behavior (e.g., Backspace navigation)
    e.preventDefault();

    // Check if this is a State diagram with state/transition elements selected
    if (isStateDiagram) {
      const hasStateNodes = nodes.some(
        n => selectedNodeIds.has(n.id) && n.entity_type === 'STATE'
      );
      const hasTransitionEdges = edges.some(
        e => selectedEdgeIds.has(e.id) && e.relationship_type === 'STATE_TRANSITION'
      );

      if (hasStateNodes || hasTransitionEdges) {
        // Show confirmation modal instead of immediately deleting
        setDeleteModalState({
          isOpen: true,
          nodeIds: Array.from(selectedNodeIds),
          edgeIds: Array.from(selectedEdgeIds),
          decorationIds: Array.from(selectedDecorationIds),
        });
        return;
      }
    }

    // Non-state elements or non-state diagrams: immediate deletion
    dispatch({
      type: 'DELETE_DIAGRAM_ELEMENTS',
      diagramId,
      nodeIds: Array.from(selectedNodeIds),
      edgeIds: Array.from(selectedEdgeIds),
      decorationIds: Array.from(selectedDecorationIds),
    });

    // Clear selection after deletion
    onClearSelection();
  }, [selectedNodeIds, selectedEdgeIds, selectedDecorationIds, diagramId, dispatch, onClearSelection, isStateDiagram, nodes, edges]);

  // Add keydown event listener for delete handling
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Convert client coordinates to canvas coordinates
  const getCanvasCoordinates = (e: React.MouseEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 };

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    return { x, y };
  };

  // Find edge point handle at point
  const findEdgePointHandleAtPoint = (
    x: number,
    y: number,
    edge: DiagramEdge
  ): number | null => {
    const edgePoints = edge.edge_points || [];
    for (let i = 0; i < edgePoints.length; i++) {
      const point = edgePoints[i];
      if (isPointOnHandle(x, y, point.pos_x, point.pos_y, edgeInteraction.handleHitRadius)) {
        return i;
      }
    }
    return null;
  };

  // Compute boundary-adjusted display points for a State diagram edge.
  // The renderer computes boundary intersections on-the-fly, so hit-testing
  // must use the same positions rather than the stored edge_points.
  const getStateEdgeDisplayPoints = (edge: DiagramEdge): Array<{ pos_x: number; pos_y: number }> => {
    const edgePoints = edge.edge_points || [];
    if (edgePoints.length < 2) return edgePoints;

    const sourceNode = nodes.find(n => n.id === edge.source_node_id);
    const targetNode = nodes.find(n => n.id === edge.target_node_id);
    if (!sourceNode || !targetNode) return edgePoints;

    const metaModel = state.model.metaModel;
    const sourceState = metaModel?.entities?.states?.find(
      (s: { id: string; state_kind: string }) => s.id === sourceNode.entity_id
    );
    const targetState = metaModel?.entities?.states?.find(
      (s: { id: string; state_kind: string }) => s.id === targetNode.entity_id
    );

    const sourceShapeKind = sourceState
      ? getShapeKindFromStateKind(sourceState.state_kind)
      : ShapeKind.RoundedRect;
    const targetShapeKind = targetState
      ? getShapeKindFromStateKind(targetState.state_kind)
      : ShapeKind.RoundedRect;

    const sourceRect = { x: sourceNode.pos_x, y: sourceNode.pos_y, width: sourceNode.width, height: sourceNode.height };
    const targetRect = { x: targetNode.pos_x, y: targetNode.pos_y, width: targetNode.width, height: targetNode.height };

    if (edgePoints.length === 2) {
      const bp = getEdgeBoundaryPoints(sourceRect, targetRect, sourceShapeKind, targetShapeKind);
      return [
        { pos_x: bp.source.x, pos_y: bp.source.y },
        { pos_x: bp.target.x, pos_y: bp.target.y },
      ];
    }

    // 3+ points: boundary-adjust first and last
    const sorted = [...edgePoints].sort((a, b) => a.sequence_order - b.sequence_order);
    const secondPt = { x: sorted[1].pos_x, y: sorted[1].pos_y, width: 0, height: 0 };
    const penultimatePt = { x: sorted[sorted.length - 2].pos_x, y: sorted[sorted.length - 2].pos_y, width: 0, height: 0 };
    const bSrc = getBoundaryAnchorPoint(sourceRect, secondPt, sourceShapeKind);
    const bTgt = getBoundaryAnchorPoint(targetRect, penultimatePt, targetShapeKind);
    return [
      { pos_x: bSrc.x, pos_y: bSrc.y },
      ...sorted.slice(1, -1),
      { pos_x: bTgt.x, pos_y: bTgt.y },
    ];
  };

  // Find edge at point (check if click is near any edge polyline)
  const findEdgeAtPoint = (x: number, y: number): DiagramEdge | null => {
    for (const edge of edges) {
      const edgePoints = edge.edge_points || [];
      if (edgePoints.length >= 2) {
        // For State diagram edges, use boundary-adjusted display points
        const testPoints = (isStateDiagram && edge.relationship_type === 'STATE_TRANSITION')
          ? getStateEdgeDisplayPoints(edge)
          : edgePoints;
        if (isPointNearPolyline(x, y, testPoints, edgeInteraction.edgeHitTolerance)) {
          return edge;
        }
      }
    }
    return null;
  };

  // Find label at point
  const findLabelAtPoint = (x: number, y: number): DiagramEdge | null => {
    for (const edge of edges) {
      const displayLabel = getEdgeDisplayLabel(edge, state.model);
      if (displayLabel && edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
        // Get font size for label
        const labelFontSizeStr = edge.label_font_size || '12px';
        const labelFontSize = parseFloat(labelFontSizeStr) || 12;
        const labelFontWeight = edge.label_font_weight || 'normal';
        const labelFontStyle = edge.label_font_style || 'normal';

        // Measure text width
        const textWidth = measureTextWidth(displayLabel, labelFontSize, labelFontWeight, labelFontStyle);

        if (isPointOnLabel(x, y, edge.label_pos_x, edge.label_pos_y, textWidth, labelFontSize)) {
          return edge;
        }
      }
    }
    return null;
  };

  // Task Group 2: Helper to check if a decoration type is a shape type
  const isShapeType = (type: string | null | undefined): type is ShapeDecorationType => {
    if (!type) return false;
    return (SHAPE_DECORATION_TYPES as readonly string[]).includes(type);
  };

  // Task Group 2: Helper to check if a decoration type is a line type
  const isLineType = (type: string | null | undefined): type is LineDecorationType => {
    if (!type) return false;
    return (LINE_DECORATION_TYPES as readonly string[]).includes(type);
  };

  // Mouse down handler
  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoordinates(e);
    const isMultiSelect = e.ctrlKey || e.metaKey;

    // Task Group 2: Handle shape add mode gesture (BOX, OVAL, DIAMOND, etc.)
    if (decorationAddMode && isShapeType(decorationAddMode)) {
      setBoxAddGestureState({
        isActive: true,
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
        shapeType: decorationAddMode,
      });
      e.preventDefault();
      return;
    }

    // Task Group 2: Handle line add mode gesture (LINE, ARROW_SINGLE, ARROW_DOUBLE)
    if (decorationAddMode && isLineType(decorationAddMode)) {
      if (!lineAddGestureState.hasFirstPoint) {
        // First click - record start point
        setLineAddGestureState({
          isActive: true,
          startX: x,
          startY: y,
          hasFirstPoint: true,
          arrowType: decorationAddMode,
        });
        setLinePreviewPoint({ x, y });
        e.preventDefault();
        return;
      } else {
        // Second click - create the line
        const newLine = createLineTypeDecoration(lineAddGestureState.arrowType || 'LINE', [
          { x: lineAddGestureState.startX, y: lineAddGestureState.startY },
          { x, y },
        ]);

        // Dispatch ADD_DECORATION
        dispatch({
          type: 'ADD_DECORATION',
          diagramId,
          decoration: newLine,
        });
        if (onNewElementAdded) onNewElementAdded();

        // Auto-select the new decoration
        if (onDecorationSelect) {
          onDecorationSelect(newLine.id, false);
        }

        // Reset LINE add state
        setLineAddGestureState(initialLineAddGestureState);
        setLinePreviewPoint(null);

        // Revert to neutral mode
        if (onDecorationAddModeChange) {
          onDecorationAddModeChange(null);
        }

        e.preventDefault();
        return;
      }
    }

    // Priority order for hit testing:
    // 0. Decoration resize handles on primary selected shape decoration
    // 0.1 LINE control points on primary selected LINE decoration
    // 0.2 Task Group 3 (Line Enhancements): Mid-segment handles on primary selected LINE decoration
    // 1. Resize handles on primary selected node
    // 2. Edge point handles on primary selected edge
    // 2.1 Task Group 3 (Line Enhancements): Mid-segment handles on primary selected edge
    // 2.5 Task Group 1: Decorative line labels (higher priority than edge labels)
    // 3. Labels of any edge
    // 4. Decorations (checked before nodes due to z-ordering)
    // 5. Node body (check if clicking on selected node for group drag)
    // 6. Edge line
    // 7. Empty canvas (start box-select)

    // 0. Check if clicked on shape decoration resize handle
    if (primarySelectedDecoration && isShapeDecoration(primarySelectedDecoration)) {
      const shapeDec = primarySelectedDecoration as ShapeDecoration;
      const handle = getShapeDecorationHandleAtPoint(x, y, shapeDec, diagramEditing.handleSize);
      if (handle) {
        setDecorationDragState({
          isDragging: true,
          dragType: 'resize',
          decorationId: shapeDec.id,
          resizeHandle: handle,
          linePointIndex: null,
          startX: x,
          startY: y,
          originalDecoration: { ...shapeDec },
          originalLabelPos: null,
        });
        setPreviewDecoration({ ...shapeDec });
        e.preventDefault();
        return;
      }
    }

    // 0.1 Check if clicked on LINE decoration control point (circles)
    if (primarySelectedDecoration && isLineBasedDecoration(primarySelectedDecoration)) {
      const lineDec = primarySelectedDecoration as LineDecoration;
      const pointIndex = getLineDecorationPointAtPoint(x, y, lineDec, diagramEditing.handleSize);
      if (pointIndex !== null) {
        setDecorationDragState({
          isDragging: true,
          dragType: 'linePointDrag',
          decorationId: lineDec.id,
          resizeHandle: null,
          linePointIndex: pointIndex,
          startX: x,
          startY: y,
          originalDecoration: {
            ...lineDec,
            line_points: lineDec.line_points.map(p => ({ ...p })),
          },
          originalLabelPos: null,
        });
        setPreviewDecoration({
          ...lineDec,
          line_points: lineDec.line_points.map(p => ({ ...p })),
        });
        e.preventDefault();
        return;
      }

      // 0.2 Task Group 3 (Line Enhancements): Check if clicked on LINE decoration mid-segment handle (squares)
      const midPositions = calculateMidSegmentPositions(lineDec.line_points);
      const segmentIndex = getMidSegmentHandleAtPoint(x, y, midPositions, edgeInteraction.midSegmentHandleSize);
      if (segmentIndex !== null) {
        // Start bend point insertion for LINE decoration
        setBendPointInsertState({
          isInserting: true,
          decorationType: 'LINE',
          targetId: lineDec.id,
          segmentIndex,
          startX: x,
          startY: y,
          currentX: x,
          currentY: y,
        });
        // Set preview decoration with new point inserted
        const newPoints = [
          ...lineDec.line_points.slice(0, segmentIndex + 1),
          { x, y },
          ...lineDec.line_points.slice(segmentIndex + 1),
        ];
        setPreviewDecoration({
          ...lineDec,
          line_points: newPoints,
        });
        e.preventDefault();
        return;
      }
    }

    // 1. Check if clicked on resize handle of primary selected node
    if (primarySelectedNode) {
      const handle = getHandleAtPoint(x, y, primarySelectedNode, diagramEditing.handleSize);
      if (handle) {
        // Start resize drag
        setDragState({
          isDragging: true,
          dragType: 'resize',
          resizeHandle: handle,
          startX: x,
          startY: y,
          originalNode: { ...primarySelectedNode },
        });
        setPreviewNode({ ...primarySelectedNode });
        e.preventDefault();
        return;
      }
    }

    // 2. Check if clicked on edge point handle of primary selected edge
    if (primarySelectedEdge) {
      const pointIndex = findEdgePointHandleAtPoint(x, y, primarySelectedEdge);
      if (pointIndex !== null) {
        const edgePoints = primarySelectedEdge.edge_points || [];
        const originalPoint = edgePoints[pointIndex];

        // Start edge point drag
        setEdgeDragState({
          isDragging: true,
          dragType: 'edgePoint',
          edgeId: primarySelectedEdge.id,
          pointIndex,
          startX: x,
          startY: y,
          originalValue: { pos_x: originalPoint.pos_x, pos_y: originalPoint.pos_y },
        });
        setPreviewEdgePoint({
          edgeId: primarySelectedEdge.id,
          pointIndex,
          pos_x: originalPoint.pos_x,
          pos_y: originalPoint.pos_y,
        });
        e.preventDefault();
        return;
      }

      // 2.1 Task Group 3 (Line Enhancements): Check if clicked on edge mid-segment handle (squares)
      const edgePoints = primarySelectedEdge.edge_points || [];
      const edgeDisplayPoints = edgePoints.map(p => ({ x: p.pos_x, y: p.pos_y }));
      const edgeMidPositions = calculateMidSegmentPositions(edgeDisplayPoints);
      const edgeSegmentIndex = getMidSegmentHandleAtPoint(x, y, edgeMidPositions, edgeInteraction.midSegmentHandleSize);
      if (edgeSegmentIndex !== null) {
        // Start bend point insertion for relationship edge
        setBendPointInsertState({
          isInserting: true,
          decorationType: 'EDGE',
          targetId: primarySelectedEdge.id,
          segmentIndex: edgeSegmentIndex,
          startX: x,
          startY: y,
          currentX: x,
          currentY: y,
        });
        e.preventDefault();
        return;
      }
    }

    // 2.5 Task Group 1: Check if clicked on a decorative line label
    const clickedDecorationLabel = findDecorationLabelAtPoint(x, y, decorations);
    if (clickedDecorationLabel) {
      // Select this decoration label
      setSelectedDecorationLabelId(clickedDecorationLabel.id);

      // Get current label position (either explicit or auto-centered)
      const currentLabelPos = calculateLineLabelPosition(clickedDecorationLabel);

      // Start label drag
      setDecorationDragState({
        isDragging: true,
        dragType: 'labelDrag',
        decorationId: clickedDecorationLabel.id,
        resizeHandle: null,
        linePointIndex: null,
        startX: x,
        startY: y,
        originalDecoration: {
          ...clickedDecorationLabel,
          line_points: clickedDecorationLabel.line_points.map(p => ({ ...p })),
        },
        originalLabelPos: currentLabelPos,
      });
      setPreviewDecorationLabelPos({
        decorationId: clickedDecorationLabel.id,
        pos_x: currentLabelPos.x,
        pos_y: currentLabelPos.y,
      });
      e.preventDefault();
      return;
    }

    // 3. Check if clicked on a label
    const labelEdge = findLabelAtPoint(x, y);
    if (labelEdge) {
      setSelectedLabelEdgeId(labelEdge.id);

      // Start label drag
      setEdgeDragState({
        isDragging: true,
        dragType: 'label',
        edgeId: labelEdge.id,
        startX: x,
        startY: y,
        originalValue: { pos_x: labelEdge.label_pos_x || 0, pos_y: labelEdge.label_pos_y || 0 },
      });
      setPreviewLabelPos({
        edgeId: labelEdge.id,
        pos_x: labelEdge.label_pos_x || 0,
        pos_y: labelEdge.label_pos_y || 0,
      });
      e.preventDefault();
      return;
    }

    // 4. Task Group 4: Check if clicked on a decoration
    const clickedDecoration = findDecorationAtPoint(x, y, decorations, edgeInteraction.edgeHitTolerance);
    if (clickedDecoration) {
      // Check if clicked decoration is part of an existing multi-selection (group drag)
      const totalSelection = selectedNodeIds.size + selectedDecorationIds.size;
      if (selectedDecorationIds.has(clickedDecoration.id) && totalSelection > 1) {
        // Start group drag — move all selected nodes + decorations together
        const originalPositions = new Map<string, { pos_x: number; pos_y: number }>();
        for (const nodeId of selectedNodeIds) {
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            originalPositions.set(nodeId, { pos_x: node.pos_x, pos_y: node.pos_y });
            const descendants = getDescendantNodes(nodeId, nodes);
            for (const descendant of descendants) {
              originalPositions.set(descendant.id, { pos_x: descendant.pos_x, pos_y: descendant.pos_y });
            }
          }
        }
        const originalDecorations = new Map<string, Decoration>();
        for (const decId of selectedDecorationIds) {
          const dec = decorations.find(d => d.id === decId);
          if (dec) {
            if (isLineBasedDecoration(dec)) {
              const lineDec = dec as LineDecoration;
              originalDecorations.set(decId, { ...lineDec, line_points: lineDec.line_points.map(p => ({ ...p })) });
            } else {
              originalDecorations.set(decId, { ...dec });
            }
          }
        }
        setGroupDragState({ isDragging: true, startX: x, startY: y, originalPositions, originalDecorations });
        e.preventDefault();
        return;
      }

      // Select the decoration
      if (onDecorationSelect) {
        onDecorationSelect(clickedDecoration.id, isMultiSelect);
      }

      // Start decoration move drag for single select
      if (!isMultiSelect) {
        if (isShapeDecoration(clickedDecoration)) {
          const shapeDec = clickedDecoration as ShapeDecoration;
          // Check if clicking inside the shape (not on border/handles)
          if (isPointInsideShapeDecoration(x, y, shapeDec)) {
            setDecorationDragState({
              isDragging: true,
              dragType: 'move',
              decorationId: shapeDec.id,
              resizeHandle: null,
              linePointIndex: null,
              startX: x,
              startY: y,
              originalDecoration: { ...shapeDec },
              originalLabelPos: null,
            });
            setPreviewDecoration({ ...shapeDec });
          }
        } else if (isLineBasedDecoration(clickedDecoration)) {
          const lineDec = clickedDecoration as LineDecoration;
          setDecorationDragState({
            isDragging: true,
            dragType: 'move',
            decorationId: lineDec.id,
            resizeHandle: null,
            linePointIndex: null,
            startX: x,
            startY: y,
            originalDecoration: {
              ...lineDec,
              line_points: lineDec.line_points.map(p => ({ ...p })),
            },
            originalLabelPos: null,
          });
          setPreviewDecoration({
            ...lineDec,
            line_points: lineDec.line_points.map(p => ({ ...p })),
          });
        }
      }
      e.preventDefault();
      return;
    }

    // 5. Check if clicked on a node
    const clickedNode = findNodeAtPoint(x, y, nodes);
    if (clickedNode) {
      // Check if clicked node is already in selection (group drag scenario)
      const totalSelection = selectedNodeIds.size + selectedDecorationIds.size;
      if (selectedNodeIds.has(clickedNode.id) && totalSelection > 1) {
        // Start group drag - move all selected nodes + decorations together
        const originalPositions = new Map<string, { pos_x: number; pos_y: number }>();

        // Store original positions of all selected nodes and their descendants
        for (const nodeId of selectedNodeIds) {
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            originalPositions.set(nodeId, { pos_x: node.pos_x, pos_y: node.pos_y });

            // Also store descendants
            const descendants = getDescendantNodes(nodeId, nodes);
            for (const descendant of descendants) {
              originalPositions.set(descendant.id, { pos_x: descendant.pos_x, pos_y: descendant.pos_y });
            }
          }
        }

        // Also capture selected decorations
        const originalDecorations = new Map<string, Decoration>();
        for (const decId of selectedDecorationIds) {
          const dec = decorations.find(d => d.id === decId);
          if (dec) {
            if (isLineBasedDecoration(dec)) {
              const lineDec = dec as LineDecoration;
              originalDecorations.set(decId, { ...lineDec, line_points: lineDec.line_points.map(p => ({ ...p })) });
            } else {
              originalDecorations.set(decId, { ...dec });
            }
          }
        }

        setGroupDragState({
          isDragging: true,
          startX: x,
          startY: y,
          originalPositions,
          originalDecorations,
        });
        e.preventDefault();
        return;
      }

      // Select the node using callback (handles single vs multi-select)
      onNodeSelect(clickedNode.id, isMultiSelect);

      // Start move drag only for single select (not multi-select toggle)
      if (!isMultiSelect) {
        setDragState({
          isDragging: true,
          dragType: 'move',
          resizeHandle: null,
          startX: x,
          startY: y,
          originalNode: { ...clickedNode },
        });
        setPreviewNode({ ...clickedNode });
      }
      e.preventDefault();
      return;
    }

    // 6. Check if clicked on an edge line
    const clickedEdge = findEdgeAtPoint(x, y);
    if (clickedEdge) {
      onEdgeSelect(clickedEdge.id, isMultiSelect);
      setSelectedLabelEdgeId(null);
      setSelectedDecorationLabelId(null);
      return;
    }

    // 7. Clicked on empty canvas - start box-select
    setBoxSelectState({
      isSelecting: true,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      isCtrlHeld: isMultiSelect,
    });

    // Clear selection unless Ctrl is held
    if (!isMultiSelect) {
      onClearSelection();
    }
    setSelectedLabelEdgeId(null);
    setSelectedDecorationLabelId(null);
    setPreviewNode(null);
    setPreviewEdgePoint(null);
    setPreviewLabelPos(null);
    setPreviewDecoration(null);
    setPreviewDecorationLabelPos(null);
  };

  // Mouse move handler
  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoordinates(e);

    // Task Group 2: Handle shape add gesture preview
    if (boxAddGestureState.isActive) {
      setBoxAddGestureState(prev => ({
        ...prev,
        currentX: x,
        currentY: y,
      }));
      return;
    }

    // Task Group 4: Handle LINE add preview (show line from first point to cursor)
    if (lineAddGestureState.hasFirstPoint) {
      setLinePreviewPoint({ x, y });
      return;
    }

    // Task Group 3 (Line Enhancements): Handle bend point insertion drag
    if (bendPointInsertState.isInserting) {
      setBendPointInsertState(prev => ({
        ...prev,
        currentX: x,
        currentY: y,
      }));

      if (bendPointInsertState.decorationType === 'LINE') {
        // Update preview decoration with dragging point
        const lineDec = decorations.find(d => d.id === bendPointInsertState.targetId) as LineDecoration | undefined;
        if (lineDec) {
          const newPoints = [
            ...lineDec.line_points.slice(0, bendPointInsertState.segmentIndex + 1),
            { x, y },
            ...lineDec.line_points.slice(bendPointInsertState.segmentIndex + 1),
          ];
          setPreviewDecoration({
            ...lineDec,
            line_points: newPoints,
          });
        }
      }
      // For EDGE type, we don't need real-time preview - just track position
      return;
    }

    // Handle box-select
    if (boxSelectState.isSelecting) {
      setBoxSelectState(prev => ({
        ...prev,
        currentX: x,
        currentY: y,
      }));
      return;
    }

    // Task Group 4: Handle decoration drag (including label drag)
    if (decorationDragState.isDragging && decorationDragState.originalDecoration) {
      const dx = x - decorationDragState.startX;
      const dy = y - decorationDragState.startY;
      const original = decorationDragState.originalDecoration;

      if (decorationDragState.dragType === 'move') {
        if (isShapeDecoration(original)) {
          const shapeOrig = original as ShapeDecoration;
          setPreviewDecoration({
            ...shapeOrig,
            pos_x: shapeOrig.pos_x + dx,
            pos_y: shapeOrig.pos_y + dy,
          });
        } else if (isLineBasedDecoration(original)) {
          const lineOrig = original as LineDecoration;
          setPreviewDecoration({
            ...lineOrig,
            line_points: lineOrig.line_points.map(p => ({
              x: p.x + dx,
              y: p.y + dy,
            })),
            // Also move label if it exists
            label_pos_x: lineOrig.label_pos_x !== undefined ? lineOrig.label_pos_x + dx : undefined,
            label_pos_y: lineOrig.label_pos_y !== undefined ? lineOrig.label_pos_y + dy : undefined,
          });
        }
      } else if (decorationDragState.dragType === 'resize' && decorationDragState.resizeHandle && isShapeDecoration(original)) {
        const shapeOrig = original as ShapeDecoration;
        const newDims = calculateShapeDecorationResize(decorationDragState.resizeHandle, shapeOrig, dx, dy);
        setPreviewDecoration({
          ...shapeOrig,
          pos_x: newDims.pos_x,
          pos_y: newDims.pos_y,
          width: newDims.width,
          height: newDims.height,
        });
      } else if (decorationDragState.dragType === 'linePointDrag' && decorationDragState.linePointIndex !== null && isLineBasedDecoration(original)) {
        const lineOrig = original as LineDecoration;
        const newPoints = lineOrig.line_points.map((p, i) => {
          if (i === decorationDragState.linePointIndex) {
            return { x: p.x + dx, y: p.y + dy };
          }
          return { ...p };
        });
        setPreviewDecoration({
          ...lineOrig,
          line_points: newPoints,
        });
      } else if (decorationDragState.dragType === 'labelDrag' && decorationDragState.originalLabelPos) {
        // Task Group 1: Handle decoration label drag preview
        setPreviewDecorationLabelPos({
          decorationId: decorationDragState.decorationId,
          pos_x: decorationDragState.originalLabelPos.x + dx,
          pos_y: decorationDragState.originalLabelPos.y + dy,
        });
      }
      return;
    }

    // Handle group drag
    if (groupDragState.isDragging) {
      const dx = x - groupDragState.startX;
      const dy = y - groupDragState.startY;

      // Update preview for all nodes in the group
      const newPreviewNodes = new Map<string, DiagramNode>();
      const newPreviewEdges = new Map<string, DiagramEdge>();

      // Collect all nodes to move
      const allNodesToMove = new Set<string>();
      for (const nodeId of selectedNodeIds) {
        allNodesToMove.add(nodeId);
        const descendants = getDescendantNodes(nodeId, nodes);
        for (const descendant of descendants) {
          allNodesToMove.add(descendant.id);
        }
      }

      // Update node previews
      for (const nodeId of allNodesToMove) {
        const originalPos = groupDragState.originalPositions.get(nodeId);
        const node = nodes.find(n => n.id === nodeId);
        if (originalPos && node) {
          newPreviewNodes.set(nodeId, {
            ...node,
            pos_x: originalPos.pos_x + dx,
            pos_y: originalPos.pos_y + dy,
          });
        }
      }

      // Update edge previews for attached points
      for (const edge of edges) {
        const edgePoints = edge.edge_points || [];
        let hasMovingPoints = false;
        const updatedEdgePoints = edgePoints.map(point => {
          // Check if this point is attached to any node being moved
          for (const nodeId of allNodesToMove) {
            const node = nodes.find(n => n.id === nodeId);
            if (node && isPointAttachedToNode(point, node)) {
              hasMovingPoints = true;
              return {
                ...point,
                pos_x: point.pos_x + dx,
                pos_y: point.pos_y + dy,
              };
            }
          }
          return point;
        });

        if (hasMovingPoints) {
          // Calculate label adjustment for 2-point edges
          let updatedLabelPosX = edge.label_pos_x;
          let updatedLabelPosY = edge.label_pos_y;

          if (edgePoints.length === 2 && edge.label_pos_x !== undefined && edge.label_pos_y !== undefined) {
            // Count how many points moved
            let movedCount = 0;
            for (let i = 0; i < edgePoints.length; i++) {
              const point = edgePoints[i];
              for (const nodeId of allNodesToMove) {
                const node = nodes.find(n => n.id === nodeId);
                if (node && isPointAttachedToNode(point, node)) {
                  movedCount++;
                  break;
                }
              }
            }

            if (movedCount === 1) {
              updatedLabelPosX = edge.label_pos_x + dx / 2;
              updatedLabelPosY = edge.label_pos_y + dy / 2;
            } else if (movedCount === 2) {
              updatedLabelPosX = edge.label_pos_x + dx;
              updatedLabelPosY = edge.label_pos_y + dy;
            }
          }

          newPreviewEdges.set(edge.id, {
            ...edge,
            edge_points: updatedEdgePoints,
            label_pos_x: updatedLabelPosX,
            label_pos_y: updatedLabelPosY,
          });
        }
      }

      // Update decoration previews for selected decorations
      const newPreviewDecorations = new Map<string, Decoration>();
      for (const [decId, original] of groupDragState.originalDecorations) {
        if (isShapeDecoration(original)) {
          const shapeOrig = original as ShapeDecoration;
          newPreviewDecorations.set(decId, {
            ...shapeOrig,
            pos_x: shapeOrig.pos_x + dx,
            pos_y: shapeOrig.pos_y + dy,
          });
        } else if (isLineBasedDecoration(original)) {
          const lineOrig = original as LineDecoration;
          newPreviewDecorations.set(decId, {
            ...lineOrig,
            line_points: lineOrig.line_points.map(p => ({ x: p.x + dx, y: p.y + dy })),
            label_pos_x: lineOrig.label_pos_x !== undefined ? lineOrig.label_pos_x + dx : undefined,
            label_pos_y: lineOrig.label_pos_y !== undefined ? lineOrig.label_pos_y + dy : undefined,
          } as Decoration);
        }
      }

      setPreviewNodes(newPreviewNodes);
      setPreviewEdges(newPreviewEdges);
      setPreviewDecorations(newPreviewDecorations);
      return;
    }

    // Handle node drag/resize
    if (dragState.isDragging && dragState.originalNode) {
      const dx = x - dragState.startX;
      const dy = y - dragState.startY;

      if (dragState.dragType === 'move') {
        // Update preview node position
        setPreviewNode({
          ...dragState.originalNode,
          pos_x: dragState.originalNode.pos_x + dx,
          pos_y: dragState.originalNode.pos_y + dy,
        });
      } else if (dragState.dragType === 'resize' && dragState.resizeHandle) {
        // Calculate new dimensions
        const newDimensions = getNodeResizeDimensions(
          dragState.resizeHandle,
          dragState.originalNode,
          dx,
          dy
        );

        setPreviewNode({
          ...dragState.originalNode,
          ...newDimensions,
        });
      }
      return;
    }

    // Handle edge point drag
    if (edgeDragState.isDragging && edgeDragState.dragType === 'edgePoint') {
      const dx = x - edgeDragState.startX;
      const dy = y - edgeDragState.startY;

      setPreviewEdgePoint({
        edgeId: edgeDragState.edgeId,
        pointIndex: edgeDragState.pointIndex!,
        pos_x: edgeDragState.originalValue.pos_x + dx,
        pos_y: edgeDragState.originalValue.pos_y + dy,
      });
      return;
    }

    // Handle label drag
    if (edgeDragState.isDragging && edgeDragState.dragType === 'label') {
      const dx = x - edgeDragState.startX;
      const dy = y - edgeDragState.startY;

      setPreviewLabelPos({
        edgeId: edgeDragState.edgeId,
        pos_x: edgeDragState.originalValue.pos_x + dx,
        pos_y: edgeDragState.originalValue.pos_y + dy,
      });
      return;
    }
  };

  // Mouse up handler
  const handleMouseUp = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoordinates(e);

    // Task Group 2: Handle shape add gesture completion
    if (boxAddGestureState.isActive && boxAddGestureState.shapeType) {
      const minX = Math.min(boxAddGestureState.startX, x);
      const minY = Math.min(boxAddGestureState.startY, y);
      let width = Math.abs(x - boxAddGestureState.startX);
      let height = Math.abs(y - boxAddGestureState.startY);

      // Special case for CIRCLE: use min dimension for both width and height
      if (boxAddGestureState.shapeType === 'CIRCLE') {
        const minDim = Math.min(width, height);
        width = minDim;
        height = minDim;
      }

      // Only create if drag was substantial (minimum 5 pixels in both dimensions)
      if (width >= 5 && height >= 5) {
        const newShape = createShapeDecoration(boxAddGestureState.shapeType, minX, minY, width, height);

        // Apply sticky styles to new shapes (except TEXT and NOTE, which always use their own defaults)
        if (stickyShapeStyles && boxAddGestureState.shapeType !== 'TEXT' && boxAddGestureState.shapeType !== 'NOTE') {
          if (stickyShapeStyles.background_color !== undefined) newShape.background_color = stickyShapeStyles.background_color;
          if (stickyShapeStyles.line_color !== undefined) newShape.line_color = stickyShapeStyles.line_color;
          if (stickyShapeStyles.background_opacity !== undefined) newShape.background_opacity = stickyShapeStyles.background_opacity;
          if (stickyShapeStyles.border_opacity !== undefined) newShape.border_opacity = stickyShapeStyles.border_opacity;
        }

        // Dispatch ADD_DECORATION
        dispatch({
          type: 'ADD_DECORATION',
          diagramId,
          decoration: newShape,
        });
        if (onNewElementAdded) onNewElementAdded();

        // Auto-select the new decoration
        if (onDecorationSelect) {
          onDecorationSelect(newShape.id, false);
        }
      }

      // Reset shape add state
      setBoxAddGestureState(initialBoxAddGestureState);

      // Revert to neutral mode
      if (onDecorationAddModeChange) {
        onDecorationAddModeChange(null);
      }

      return;
    }

    // Task Group 3 (Line Enhancements): Handle bend point insertion commit
    if (bendPointInsertState.isInserting) {
      if (bendPointInsertState.decorationType === 'LINE') {
        // Commit bend point insertion for LINE decoration
        const lineDec = decorations.find(d => d.id === bendPointInsertState.targetId) as LineDecoration | undefined;
        if (lineDec) {
          const newPoints = [
            ...lineDec.line_points.slice(0, bendPointInsertState.segmentIndex + 1),
            { x: bendPointInsertState.currentX, y: bendPointInsertState.currentY },
            ...lineDec.line_points.slice(bendPointInsertState.segmentIndex + 1),
          ];
          dispatch({
            type: 'UPDATE_DECORATION',
            diagramId,
            decorationId: lineDec.id,
            updates: {
              line_points: newPoints,
            },
          });
        }
      } else if (bendPointInsertState.decorationType === 'EDGE') {
        // Commit bend point insertion for relationship edge using INSERT_EDGE_POINT action
        dispatch({
          type: 'INSERT_EDGE_POINT',
          diagramId,
          edgeId: bendPointInsertState.targetId,
          segmentIndex: bendPointInsertState.segmentIndex,
          pos_x: bendPointInsertState.currentX,
          pos_y: bendPointInsertState.currentY,
        });
      }

      // Reset bend point insertion state
      setBendPointInsertState(initialBendPointInsertState);
      setPreviewDecoration(null);
      return;
    }

    // Task Group 4: Handle decoration drag commit (including label drag)
    if (decorationDragState.isDragging && decorationDragState.originalDecoration) {
      const dx = x - decorationDragState.startX;
      const dy = y - decorationDragState.startY;
      const original = decorationDragState.originalDecoration;

      if (decorationDragState.dragType === 'move') {
        if (isShapeDecoration(original)) {
          const shapeOrig = original as ShapeDecoration;
          dispatch({
            type: 'UPDATE_DECORATION',
            diagramId,
            decorationId: original.id,
            updates: {
              pos_x: shapeOrig.pos_x + dx,
              pos_y: shapeOrig.pos_y + dy,
            },
          });
        } else if (isLineBasedDecoration(original)) {
          const lineOrig = original as LineDecoration;
          const updatedLinePoints = lineOrig.line_points.map(p => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
          const updates: Partial<LineDecoration> = {
            line_points: updatedLinePoints,
          };
          if (lineOrig.label_pos_x !== undefined) {
            updates.label_pos_x = lineOrig.label_pos_x + dx;
          }
          if (lineOrig.label_pos_y !== undefined) {
            updates.label_pos_y = lineOrig.label_pos_y + dy;
          }
          dispatch({
            type: 'UPDATE_DECORATION',
            diagramId,
            decorationId: original.id,
            updates,
          });
        }
      } else if (decorationDragState.dragType === 'resize' && decorationDragState.resizeHandle && isShapeDecoration(original)) {
        const shapeOrig = original as ShapeDecoration;
        const newDims = calculateShapeDecorationResize(decorationDragState.resizeHandle, shapeOrig, dx, dy);
        dispatch({
          type: 'UPDATE_DECORATION',
          diagramId,
          decorationId: original.id,
          updates: {
            pos_x: newDims.pos_x,
            pos_y: newDims.pos_y,
            width: newDims.width,
            height: newDims.height,
          },
        });
      } else if (decorationDragState.dragType === 'linePointDrag' && decorationDragState.linePointIndex !== null && isLineBasedDecoration(original)) {
        const lineOrig = original as LineDecoration;
        const newPoints = lineOrig.line_points.map((p, i) => {
          if (i === decorationDragState.linePointIndex) {
            return { x: p.x + dx, y: p.y + dy };
          }
          return { ...p };
        });
        dispatch({
          type: 'UPDATE_DECORATION',
          diagramId,
          decorationId: original.id,
          updates: {
            line_points: newPoints,
          },
        });
      } else if (decorationDragState.dragType === 'labelDrag' && decorationDragState.originalLabelPos) {
        // Task Group 1: Commit decoration label position update
        const newLabelPosX = decorationDragState.originalLabelPos.x + dx;
        const newLabelPosY = decorationDragState.originalLabelPos.y + dy;

        dispatch({
          type: 'UPDATE_DECORATION',
          diagramId,
          decorationId: original.id,
          updates: {
            label_pos_x: newLabelPosX,
            label_pos_y: newLabelPosY,
          },
        });
      }

      setDecorationDragState(initialDecorationDragState);
      setPreviewDecoration(null);
      setPreviewDecorationLabelPos(null);
      return;
    }

    // Handle box-select completion
    if (boxSelectState.isSelecting) {
      // Compute normalized rectangle bounds
      const rect = {
        x1: boxSelectState.startX,
        y1: boxSelectState.startY,
        x2: x,
        y2: y,
      };

      // Find all nodes fully inside the rectangle
      const selectedNodes = new Set<string>();
      for (const node of nodes) {
        if (isNodeInsideRect(node, rect)) {
          selectedNodes.add(node.id);
        }
      }

      // Find all edges fully inside the rectangle
      const selectedEdgesSet = new Set<string>();
      for (const edge of edges) {
        if (isEdgeInsideRect(edge, rect)) {
          selectedEdgesSet.add(edge.id);
        }
      }

      // Task Group 4: Find all decorations fully inside the rectangle
      const selectedDecorationsSet = new Set<string>();
      for (const decoration of decorations) {
        if (isDecorationInsideRect(decoration, rect)) {
          selectedDecorationsSet.add(decoration.id);
        }
      }

      // Call bulk select callback with decorations
      onBulkSelect(selectedNodes, selectedEdgesSet, selectedDecorationsSet, boxSelectState.isCtrlHeld);

      // Reset box-select state
      setBoxSelectState(initialBoxSelectState);
      return;
    }

    // Handle group drag commit
    if (groupDragState.isDragging) {
      const dx = x - groupDragState.startX;
      const dy = y - groupDragState.startY;

      // Dispatch MOVE_NODES_WITH_CASCADE action for selected nodes
      if (selectedNodeIds.size > 0) {
        dispatch({
          type: 'MOVE_NODES_WITH_CASCADE',
          diagramId,
          nodeIds: Array.from(selectedNodeIds),
          dx,
          dy,
        });
      }

      // Dispatch decoration updates for selected decorations
      for (const [decId, original] of groupDragState.originalDecorations) {
        if (isShapeDecoration(original)) {
          const shapeOrig = original as ShapeDecoration;
          dispatch({
            type: 'UPDATE_DECORATION',
            diagramId,
            decorationId: decId,
            updates: { pos_x: shapeOrig.pos_x + dx, pos_y: shapeOrig.pos_y + dy },
          });
        } else if (isLineBasedDecoration(original)) {
          const lineOrig = original as LineDecoration;
          const updates: Partial<LineDecoration> = {
            line_points: lineOrig.line_points.map(p => ({ x: p.x + dx, y: p.y + dy })),
          };
          if (lineOrig.label_pos_x !== undefined) updates.label_pos_x = lineOrig.label_pos_x + dx;
          if (lineOrig.label_pos_y !== undefined) updates.label_pos_y = lineOrig.label_pos_y + dy;
          dispatch({ type: 'UPDATE_DECORATION', diagramId, decorationId: decId, updates });
        }
      }

      // Reset group drag state and previews
      setGroupDragState(initialGroupDragState);
      setPreviewNodes(new Map());
      setPreviewEdges(new Map());
      setPreviewDecorations(new Map());
      return;
    }

    // Handle node drag/resize commit
    if (dragState.isDragging && dragState.originalNode) {
      const dx = x - dragState.startX;
      const dy = y - dragState.startY;

      if (dragState.dragType === 'move') {
        // Commit move with cascade
        dispatch({
          type: 'MOVE_NODE_WITH_CASCADE',
          diagramId,
          nodeId: dragState.originalNode.id,
          dx,
          dy,
        });
      } else if (dragState.dragType === 'resize' && dragState.resizeHandle) {
        // Calculate final dimensions
        const finalDimensions = getNodeResizeDimensions(
          dragState.resizeHandle,
          dragState.originalNode,
          dx,
          dy
        );

        // Commit resize
        dispatch({
          type: 'UPDATE_DIAGRAM_NODE',
          diagramId,
          nodeId: dragState.originalNode.id,
          updates: finalDimensions,
        });
      }

      // Reset drag state
      setDragState(initialDragState);
      setPreviewNode(null);
      return;
    }

    // Handle edge point drag commit
    if (edgeDragState.isDragging && edgeDragState.dragType === 'edgePoint') {
      const dx = x - edgeDragState.startX;
      const dy = y - edgeDragState.startY;

      const finalPosX = edgeDragState.originalValue.pos_x + dx;
      const finalPosY = edgeDragState.originalValue.pos_y + dy;

      // Find the edge to check if it's a 2-point edge
      const edge = edges.find(e => e.id === edgeDragState.edgeId);
      const is2PointEdge = edge && (edge.edge_points || []).length === 2;

      // Commit edge point update
      dispatch({
        type: 'UPDATE_EDGE_POINT',
        diagramId,
        edgeId: edgeDragState.edgeId,
        pointIndex: edgeDragState.pointIndex!,
        pos_x: finalPosX,
        pos_y: finalPosY,
        adjustLabel: is2PointEdge,
      });

      // Reset edge drag state
      setEdgeDragState(initialEdgeDragState);
      setPreviewEdgePoint(null);
      return;
    }

    // Handle label drag commit
    if (edgeDragState.isDragging && edgeDragState.dragType === 'label') {
      const dx = x - edgeDragState.startX;
      const dy = y - edgeDragState.startY;

      const finalPosX = edgeDragState.originalValue.pos_x + dx;
      const finalPosY = edgeDragState.originalValue.pos_y + dy;

      // Commit label position update
      dispatch({
        type: 'UPDATE_EDGE_LABEL_POSITION',
        diagramId,
        edgeId: edgeDragState.edgeId,
        label_pos_x: finalPosX,
        label_pos_y: finalPosY,
      });

      // Reset edge drag state
      setEdgeDragState(initialEdgeDragState);
      setPreviewLabelPos(null);
      return;
    }

    // Reset all drag states if nothing was being dragged
    setDragState(initialDragState);
    setEdgeDragState(initialEdgeDragState);
    setDecorationDragState(initialDecorationDragState);
    setBendPointInsertState(initialBendPointInsertState);
    setPreviewNode(null);
    setPreviewEdgePoint(null);
    setPreviewLabelPos(null);
    setPreviewDecoration(null);
    setPreviewDecorationLabelPos(null);
    setPreviewDecorations(new Map());
  };

  // Mouse leave handler (in case mouse leaves canvas during drag)
  const handleMouseLeave = () => {
    // Cancel shape add gesture if in progress
    if (boxAddGestureState.isActive) {
      setBoxAddGestureState(initialBoxAddGestureState);
      if (onDecorationAddModeChange) {
        onDecorationAddModeChange(null);
      }
    }

    // Cancel LINE add gesture if in progress
    if (lineAddGestureState.isActive) {
      setLineAddGestureState(initialLineAddGestureState);
      setLinePreviewPoint(null);
      if (onDecorationAddModeChange) {
        onDecorationAddModeChange(null);
      }
    }

    // Cancel bend point insertion if in progress
    if (bendPointInsertState.isInserting) {
      setBendPointInsertState(initialBendPointInsertState);
      setPreviewDecoration(null);
    }

    // Cancel box-select if in progress
    if (boxSelectState.isSelecting) {
      setBoxSelectState(initialBoxSelectState);
    }

    // Cancel group drag if in progress
    if (groupDragState.isDragging) {
      setGroupDragState(initialGroupDragState);
      setPreviewNodes(new Map());
      setPreviewEdges(new Map());
      setPreviewDecorations(new Map());
    }

    // Cancel decoration drag if in progress
    if (decorationDragState.isDragging) {
      setDecorationDragState(initialDecorationDragState);
      setPreviewDecoration(null);
      setPreviewDecorationLabelPos(null);
    }

    if (dragState.isDragging || edgeDragState.isDragging) {
      // Cancel drag operation
      setDragState(initialDragState);
      setEdgeDragState(initialEdgeDragState);
      setPreviewNode(null);
      setPreviewEdgePoint(null);
      setPreviewLabelPos(null);
    }
  };


  // Task Group 4: Context menu handler for right-click
  const handleContextMenu = (e: React.MouseEvent) => {
    // Always prevent browser context menu
    e.preventDefault();
    e.stopPropagation();

    // If no callback provided, just suppress browser menu
    if (!onElementContextMenu) return;

    const { x, y } = getCanvasCoordinates(e);

    // Hit test in priority order (highest z-order first):
    // 1. Decorations (check shapes and lines)
    // 2. Nodes
    // 3. Edges

    // Check decorations first (they can be above or below other elements)
    const clickedDecoration = findDecorationAtPoint(x, y, decorations, edgeInteraction.edgeHitTolerance);
    if (clickedDecoration) {
      if (isShapeDecoration(clickedDecoration)) {
        const shapeDec = clickedDecoration as ShapeDecoration;
        onElementContextMenu(e, 'shape-decoration', clickedDecoration.id, shapeDec.auto_size);
        return;
      }
      if (isLineBasedDecoration(clickedDecoration)) {
        onElementContextMenu(e, 'line-decoration', clickedDecoration.id, undefined);
        return;
      }
    }

    // Check nodes
    const clickedNode = findNodeAtPoint(x, y, nodes);
    if (clickedNode) {
      onElementContextMenu(e, 'node', clickedNode.id, clickedNode.auto_size);
      return;
    }

    // Check edges
    const clickedEdge = findEdgeAtPoint(x, y);
    if (clickedEdge) {
      onElementContextMenu(e, 'edge', clickedEdge.id, undefined);
      return;
    }

    // Clicked on empty canvas - show canvas-level context menu (for Paste)
    if (onCanvasContextMenu) {
      onCanvasContextMenu(e);
    }
  };

  // Handle left-click on linked text to navigate to the linked diagram
  // Uses dispatch directly (same as DiagramSelector search) to avoid extra wrapper logic
  const handleLinkedTextClick = (e: React.MouseEvent, linkedDiagramId: string) => {
    if (e.button !== 0) return; // Left-click only
    e.stopPropagation();
    e.preventDefault();
    dispatch({ type: 'SELECT_DIAGRAM', payload: linkedDiagramId });
    // Scroll to top so the user sees the new diagram from the beginning
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      containerRef.current.scrollLeft = 0;
    }
  };

  // Helper function to parse font size from string (e.g., "14px" -> 14)
  const parseFontSize = (fontSizeStr?: string): number => {
    if (!fontSizeStr) return defaultFontSize;
    const parsed = parseFloat(fontSizeStr);
    return isNaN(parsed) ? defaultFontSize : parsed;
  };

  // Determine cursor based on current state
  const getCursor = (): string => {
    // All shape types use crosshair cursor
    if (decorationAddMode && isShapeType(decorationAddMode)) return 'crosshair';
    // All line types use crosshair cursor
    if (decorationAddMode && isLineType(decorationAddMode)) return 'crosshair';
    if (boxSelectState.isSelecting) return 'crosshair';
    if (boxAddGestureState.isActive) return 'crosshair';
    if (bendPointInsertState.isInserting) return 'move';
    if (groupDragState.isDragging) return 'move';
    if (decorationDragState.isDragging) {
      if (decorationDragState.dragType === 'move') return 'move';
      if (decorationDragState.dragType === 'resize' && decorationDragState.resizeHandle) {
        return handleCursors[decorationDragState.resizeHandle];
      }
      if (decorationDragState.dragType === 'linePointDrag') return 'move';
      if (decorationDragState.dragType === 'labelDrag') return 'move';
    }
    if (dragState.isDragging) {
      if (dragState.dragType === 'move') return 'move';
      if (dragState.dragType === 'resize' && dragState.resizeHandle) {
        return handleCursors[dragState.resizeHandle];
      }
    }
    if (edgeDragState.isDragging) {
      return 'move';
    }
    return 'default';
  };

  // Calculate box-select rectangle for rendering
  const getBoxSelectRect = () => {
    if (!boxSelectState.isSelecting) return null;

    const { minX, minY, maxX, maxY } = normalizeRect(
      boxSelectState.startX,
      boxSelectState.startY,
      boxSelectState.currentX,
      boxSelectState.currentY
    );

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  const boxSelectRect = getBoxSelectRect();

  // Task Group 3: Calculate shape add preview rectangle/shape
  const getShapeAddPreview = () => {
    if (!boxAddGestureState.isActive || !boxAddGestureState.shapeType) return null;

    const { minX, minY, maxX, maxY } = normalizeRect(
      boxAddGestureState.startX,
      boxAddGestureState.startY,
      boxAddGestureState.currentX,
      boxAddGestureState.currentY
    );

    let width = maxX - minX;
    let height = maxY - minY;

    // Special case for CIRCLE: use min dimension
    if (boxAddGestureState.shapeType === 'CIRCLE') {
      const minDim = Math.min(width, height);
      width = minDim;
      height = minDim;
    }

    return {
      x: minX,
      y: minY,
      width,
      height,
      shapeType: boxAddGestureState.shapeType,
    };
  };

  const shapeAddPreview = getShapeAddPreview();

  // Z-Index Unified Rendering: Helper function to render a node
  const renderNode = (nodeData: DiagramNode): React.ReactNode => {
    const node = getDisplayNode(nodeData);

    // Task Group 2: Skip rendering nodes that are children of custom Interface nodes
    // These are rendered inside the parent Interface, not separately
    if (node.parent_node_id) {
      const parentNode = nodes.find(n => n.id === node.parent_node_id);
      if (parentNode && isInterfaceWithCustomRendering(parentNode)) {
        return null; // Skip - will be rendered inside the parent Interface
      }
    }

    const label = getEntityLabel(node.entity_type, node.entity_id, state.model);
    const colors = getEntityColor(node.entity_type);

    // Get font styling with defaults
    const nodeFontSize = parseFontSize(node.text_font_size);
    const nodeFontWeight = node.text_font_weight || 'normal';
    const nodeFontStyle = node.text_font_style || 'normal';
    const nodeTextDecoration = node.linkedDiagramId ? 'underline' : (node.text_text_decoration || 'none');

    // Task Group 4: Get colour overrides with fallbacks
    const nodeBackgroundColor = getNodeFillColor(node, state.model);
    const nodeLineColor = node.line_color || colors.border;
    const nodeTextColor = node.linkedDiagramId ? '#1976D2' : (node.text_color || '#333');

    // Check if this is a BUSINESS_USER node
    const isBusinessUser = node.entity_type === 'BUSINESS_USER';

    if (isBusinessUser) {
      // Render stick man for BUSINESS_USER
      const dims = calculateStickManDimensions(node);
      const textAreaWidth = node.text_area_width || (node.width - 10);
      const lines = wrapText(label, textAreaWidth, nodeFontSize, nodeFontWeight, nodeFontStyle);
      const textPos = calculateBusinessUserTextPosition(node, lines, nodeFontSize);

      return (
        <g key={node.id} style={{ cursor: 'pointer' }}>
          {/* Stick man head (circle) */}
          <circle
            cx={dims.centerX}
            cy={dims.headCenterY}
            r={dims.headRadius}
            fill="none"
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
          />
          {/* Stick man body (vertical line) */}
          <line
            x1={dims.centerX}
            y1={dims.bodyStartY}
            x2={dims.centerX}
            y2={dims.bodyEndY}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
          />
          {/* Stick man arms (horizontal line) */}
          <line
            x1={dims.centerX - dims.armSpan}
            y1={dims.armY}
            x2={dims.centerX + dims.armSpan}
            y2={dims.armY}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
          />
          {/* Stick man left leg */}
          <line
            x1={dims.centerX}
            y1={dims.bodyEndY}
            x2={dims.centerX - dims.legSpan}
            y2={dims.legEndY}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
          />
          {/* Stick man right leg */}
          <line
            x1={dims.centerX}
            y1={dims.bodyEndY}
            x2={dims.centerX + dims.legSpan}
            y2={dims.legEndY}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
          />
          {/* Render text below stick man feet */}
          {lines.map((line, index) => {
            const yPos = textPos.startY + (index * (nodeFontSize + lineSpacing));
            const xCoord = textPos.getLineX(index, line);

            return (
              <text
                key={index}
                x={xCoord}
                y={yPos}
                textAnchor={textPos.anchor as 'start' | 'middle' | 'end'}
                fontSize={nodeFontSize}
                fontWeight={nodeFontWeight}
                fontStyle={nodeFontStyle}
                textDecoration={nodeTextDecoration}
                fill={nodeTextColor}
                style={node.linkedDiagramId ? { cursor: 'pointer' } : undefined}
                onMouseDown={node.linkedDiagramId ? (e) => handleLinkedTextClick(e, node.linkedDiagramId!) : undefined}
              >
                {line}
              </text>
            );
          })}
        </g>
      );
    }

    // Check if this node should render as ERD-style (class-box with attributes)
    if (shouldRenderAsERD(node)) {
      const embeddedAttributes = node.embedded_attribute_ids
        ? getAttributesByIds(state.model.metaModel, node.embedded_attribute_ids, node.entity_type)
        : [];
      const erdPaddingX = 8;
      const erdFontSize = 11;
      const headerFontSize = 12;

      return (
        <g key={node.id} style={{ cursor: 'pointer' }}>
          {/* Outer rectangle */}
          <rect
            x={node.pos_x}
            y={node.pos_y}
            width={node.width}
            height={node.height}
            fill={nodeBackgroundColor}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
            rx={0}
          />
          {/* Header: Entity name (bold, centered) */}
          <text
            x={node.pos_x + node.width / 2}
            y={node.pos_y + ERD_HEADER_HEIGHT / 2 + headerFontSize / 3}
            textAnchor="middle"
            fontSize={headerFontSize}
            fontWeight="bold"
            fill={nodeTextColor}
            textDecoration={nodeTextDecoration}
            style={node.linkedDiagramId ? { cursor: 'pointer' } : undefined}
            onMouseDown={node.linkedDiagramId ? (e) => handleLinkedTextClick(e, node.linkedDiagramId!) : undefined}
          >
            {label}
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
          {embeddedAttributes.map((attr, index) => {
            const formattedAttr = formatAttribute(attr);
            const attrY = node.pos_y + ERD_HEADER_HEIGHT + (index + 0.5) * ERD_ATTRIBUTE_ROW_HEIGHT + erdFontSize / 3;
            return (
              <text
                key={attr.id}
                x={node.pos_x + erdPaddingX}
                y={attrY}
                textAnchor="start"
                fontSize={erdFontSize}
                fontWeight="normal"
                fill={nodeTextColor}
              >
                {formattedAttr}
              </text>
            );
          })}
        </g>
      );
    }

    // Check if this node should render as Interface with embedded endpoints
    if (isInterfaceWithCustomRendering(node)) {
      const endpointLines = state.model.metaModel
        ? getEndpointLinesForNode(node, state.model.metaModel)
        : [];
      const headerHeight = ERD_HEADER_HEIGHT; // Same header height as ERD
      const headerFontSize = 12;
      const erdFontSize = 11;
      const erdPaddingX = 8;

      // Task Group 2: Get child entity nodes for rendering inside this Interface
      const childEntityNodes = state.model.metaModel
        ? getChildEntityNodesForInterface(node, nodes, state.model.metaModel)
        : [];

      // Calculate endpoint section height
      const endpointSectionHeight = calculateEndpointSectionHeight(endpointLines);

      // Calculate starting Y position for entity boxes
      let currentEntityY = node.pos_y + INTERFACE_PADDING_Y + headerHeight + endpointSectionHeight;
      if (childEntityNodes.length > 0) {
        currentEntityY += INTERFACE_ENTITIES_SECTION_GAP;
      }

      return (
        <g key={node.id} style={{ cursor: 'pointer' }}>
          {/* Outer rectangle */}
          <rect
            x={node.pos_x}
            y={node.pos_y}
            width={node.width}
            height={node.height}
            fill={nodeBackgroundColor}
            stroke={nodeLineColor}
            strokeWidth={parseLineWeight(node.line_weight)}
            rx={0}
          />
          {/* Header: Interface name (bold, centered) */}
          <text
            x={node.pos_x + node.width / 2}
            y={node.pos_y + headerHeight / 2 + headerFontSize / 3}
            textAnchor="middle"
            fontSize={headerFontSize}
            fontWeight="bold"
            fill={nodeTextColor}
            textDecoration={nodeTextDecoration}
            style={node.linkedDiagramId ? { cursor: 'pointer' } : undefined}
            onMouseDown={node.linkedDiagramId ? (e) => handleLinkedTextClick(e, node.linkedDiagramId!) : undefined}
          >
            {label}
          </text>
          {/* Divider line after header */}
          <line
            x1={node.pos_x}
            y1={node.pos_y + headerHeight}
            x2={node.pos_x + node.width}
            y2={node.pos_y + headerHeight}
            stroke={nodeLineColor}
            strokeWidth={1}
          />
          {/* Endpoint rows (left-aligned) */}
          {endpointLines.map((line, index) => {
            const lineY = node.pos_y + headerHeight + ENDPOINT_SECTION_PADDING + (index + 0.5) * ENDPOINT_LINE_HEIGHT + ENDPOINT_FONT_SIZE / 3;
            return (
              <text
                key={`endpoint-${index}`}
                x={node.pos_x + ENDPOINT_TEXT_PADDING}
                y={lineY}
                textAnchor="start"
                fontSize={ENDPOINT_FONT_SIZE}
                fontWeight="normal"
                fill={nodeTextColor}
              >
                {line}
              </text>
            );
          })}
          {/* Task Group 2: Render embedded entity boxes inside Interface */}
          {childEntityNodes.map((childNode) => {
            const childLabel = getEntityLabel(childNode.entity_type, childNode.entity_id, state.model);
            const childColors = getEntityColor(childNode.entity_type);
            const childBgColor = getNodeFillColor(childNode, state.model);
            const childLineColor = childNode.line_color || childColors.border;
            const childTextColor = childNode.text_color || '#333';

            // Get attributes for the entity
            const embeddedAttributes = childNode.embedded_attribute_ids
              ? getAttributesByIds(state.model.metaModel, childNode.embedded_attribute_ids, childNode.entity_type)
              : [];

            // Calculate entity box position - use the pre-stored position from handleAddWithAllChildren
            const entityX = childNode.pos_x;
            const entityY = childNode.pos_y;
            const entityWidth = childNode.width;
            const entityHeight = childNode.height;

            return (
              <g key={childNode.id}>
                {/* Entity box outer rectangle */}
                <rect
                  x={entityX}
                  y={entityY}
                  width={entityWidth}
                  height={entityHeight}
                  fill={childBgColor}
                  stroke={childLineColor}
                  strokeWidth={parseLineWeight(node.line_weight)}
                  rx={0}
                />
                {/* Entity header (name) */}
                <text
                  x={entityX + entityWidth / 2}
                  y={entityY + ERD_HEADER_HEIGHT / 2 + headerFontSize / 3}
                  textAnchor="middle"
                  fontSize={headerFontSize}
                  fontWeight="bold"
                  fill={childTextColor}
                >
                  {childLabel}
                </text>
                {/* Divider line */}
                <line
                  x1={entityX}
                  y1={entityY + ERD_HEADER_HEIGHT}
                  x2={entityX + entityWidth}
                  y2={entityY + ERD_HEADER_HEIGHT}
                  stroke={childLineColor}
                  strokeWidth={1}
                />
                {/* Attribute rows */}
                {embeddedAttributes.map((attr, attrIndex) => {
                  const formattedAttr = formatAttribute(attr);
                  const attrY = entityY + ERD_HEADER_HEIGHT + (attrIndex + 0.5) * ERD_ATTRIBUTE_ROW_HEIGHT + erdFontSize / 3;
                  return (
                    <text
                      key={attr.id}
                      x={entityX + erdPaddingX}
                      y={attrY}
                      textAnchor="start"
                      fontSize={erdFontSize}
                      fontWeight="normal"
                      fill={childTextColor}
                    >
                      {formattedAttr}
                    </text>
                  );
                })}
              </g>
            );
          })}
        </g>
      );
    }

    // Render rectangle for all other entity types
    const textAreaWidth = node.width - (padding * 2);
    const lines = wrapText(label, textAreaWidth, nodeFontSize, nodeFontWeight, nodeFontStyle);
    const textPos = calculateTextPosition(node, lines, nodeFontSize);

    return (
      <g key={node.id} style={{ cursor: 'pointer' }}>
        <rect
          x={node.pos_x}
          y={node.pos_y}
          width={node.width}
          height={node.height}
          fill={nodeBackgroundColor}
          stroke={nodeLineColor}
          strokeWidth={parseLineWeight(node.line_weight)}
          rx={appConfig.node.borderRadius}
        />
        {/* Render each line of text */}
        {lines.map((line, index) => {
          const yPos = textPos.startY + (index * (nodeFontSize + lineSpacing));
          const xCoord = textPos.getLineX(index, line);

          return (
            <text
              key={index}
              x={xCoord}
              y={yPos}
              textAnchor={textPos.anchor as 'start' | 'middle' | 'end'}
              fontSize={nodeFontSize}
              fontWeight={nodeFontWeight}
              fontStyle={nodeFontStyle}
              textDecoration={nodeTextDecoration}
              fill={nodeTextColor}
              style={node.linkedDiagramId ? { cursor: 'pointer' } : undefined}
              onMouseDown={node.linkedDiagramId ? (e) => handleLinkedTextClick(e, node.linkedDiagramId!) : undefined}
            >
              {line}
            </text>
          );
        })}
      </g>
    );
  };

  // Z-Index Unified Rendering: Helper function to render an edge
  const renderEdge = (edgeData: DiagramEdge): React.ReactNode => {
    const edge = getDisplayEdge(edgeData);
    const edgePoints = edge.edge_points || [];
    const displayPoints = edgePoints.map((_, index) => {
      const displayPoint = getDisplayEdgePoint(edgeData, index);
      return { x: displayPoint.pos_x, y: displayPoint.pos_y };
    });

    // Need at least 2 points to draw an edge
    if (displayPoints.length < 2) return null;

    const isSelected = selectedEdgeIds.has(edge.id);
    const { strokeWidth: baseStrokeWidth, strokeDasharray: baseStrokeDasharray } = getEdgeStrokeStyle(edge);
    const edgeStrokeColor = edge.line_color || '#616161';
    const edgeLabelColor = edge.linkedDiagramId ? '#1976D2' : (edge.text_color || '#333');
    const strokeColor = isSelected ? edgeInteraction.selectedEdgeColor : edgeStrokeColor;
    const strokeWidth = isSelected ? edgeInteraction.selectedEdgeWidth : baseStrokeWidth;

    // Task Group 5-6: Check if this is a LogicalER relationship edge
    const isLogicalEREdge = edge.relationship_type === RELATIONSHIP_EDGE_TYPES.LOGICAL_DATA_ENTITY_RELATIONSHIP;

    // Get LogicalER relationship from metaModel for UML symbols (if applicable)
    let erSymbols = null;
    let strokeDasharray = baseStrokeDasharray;

    if (isLogicalEREdge && state.model.metaModel) {
      const logicalER = state.model.metaModel.relationships.logical_data_entity_relationships.find(
        r => r.id === edge.relationship_id
      );
      if (logicalER) {
        erSymbols = getEREdgeSymbols(logicalER.relationship);
        // Override line style for REALIZATION and DEPENDENCY (dashed lines)
        const erDasharray = getEREdgeStrokeDasharray(erSymbols.lineStyle);
        if (erDasharray) {
          strokeDasharray = erDasharray;
        }
      }
    }

    const pathData = displayPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    let arrowPath = '';
    if (edge.arrow_end && edge.arrow_end !== 'NONE') {
      const lastPoint = displayPoints[displayPoints.length - 1];
      const secondLastPoint = displayPoints[displayPoints.length - 2];
      arrowPath = calculateArrowhead(
        secondLastPoint.x,
        secondLastPoint.y,
        lastPoint.x,
        lastPoint.y,
        appConfig.edge.arrowSize
      );
    }

    const displayLabel = getEdgeDisplayLabel(edgeData, state.model);
    const labelPos = getDisplayLabelPos(edgeData);
    const labelFontSize = edge.label_font_size || '12px';
    const labelFontWeight = edge.label_font_weight || 'normal';
    const labelFontStyle = edge.label_font_style || 'normal';
    const labelTextDecoration = edge.linkedDiagramId ? 'underline' : (edge.label_text_decoration || 'none');
    const isLabelSelected = edge.id === selectedLabelEdgeId;

    // Task Group 5: Calculate cardinality label positions for LogicalER edges
    let sourceLabelPos = null;
    let targetLabelPos = null;
    if (isLogicalEREdge && displayPoints.length >= 2) {
      const sourcePoint = displayPoints[0];
      const nextPoint = displayPoints[1];
      const targetPoint = displayPoints[displayPoints.length - 1];
      const prevPoint = displayPoints[displayPoints.length - 2];

      // Calculate offset positions for cardinality labels (15px from endpoint)
      const labelOffset = 15;

      // Source label position
      const sourceDx = nextPoint.x - sourcePoint.x;
      const sourceDy = nextPoint.y - sourcePoint.y;
      const sourceLen = Math.sqrt(sourceDx * sourceDx + sourceDy * sourceDy);
      if (sourceLen > 0) {
        sourceLabelPos = {
          x: sourcePoint.x + (sourceDx / sourceLen) * labelOffset,
          y: sourcePoint.y + (sourceDy / sourceLen) * labelOffset - 8, // Offset above line
        };
      }

      // Target label position
      const targetDx = prevPoint.x - targetPoint.x;
      const targetDy = prevPoint.y - targetPoint.y;
      const targetLen = Math.sqrt(targetDx * targetDx + targetDy * targetDy);
      if (targetLen > 0) {
        targetLabelPos = {
          x: targetPoint.x + (targetDx / targetLen) * labelOffset,
          y: targetPoint.y + (targetDy / targetLen) * labelOffset - 8, // Offset above line
        };
      }
    }

    // Task Group 6: Calculate UML symbol render data for LogicalER edges
    let sourceSymbolData = null;
    let targetSymbolData = null;
    if (erSymbols && displayPoints.length >= 2) {
      const sourcePoint = displayPoints[0];
      const nextPoint = displayPoints[1];
      const targetPoint = displayPoints[displayPoints.length - 1];
      const prevPoint = displayPoints[displayPoints.length - 2];

      // Source symbol (for COMPOSITION, AGGREGATION - diamond at source)
      if (erSymbols.sourceSymbol !== 'NONE') {
        const sourceAngle = calculateEdgeAngle(sourcePoint.x, sourcePoint.y, nextPoint.x, nextPoint.y);
        sourceSymbolData = getSymbolRenderData(erSymbols.sourceSymbol, sourcePoint.x, sourcePoint.y, sourceAngle, edgeStrokeColor);
      }

      // Target symbol (for GENERALIZATION, REALIZATION, DEPENDENCY - triangle/arrow at target)
      if (erSymbols.targetSymbol !== 'NONE') {
        const targetAngle = calculateEdgeAngle(prevPoint.x, prevPoint.y, targetPoint.x, targetPoint.y);
        targetSymbolData = getSymbolRenderData(erSymbols.targetSymbol, targetPoint.x, targetPoint.y, targetAngle, edgeStrokeColor);
      }
    }

    // Task Group 6: Adjust edge path to not overlap with symbols
    let adjustedPathData = pathData;
    if (erSymbols && displayPoints.length >= 2) {
      const adjustedPoints = [...displayPoints];

      // Shorten source end if there's a symbol there
      if (erSymbols.sourceSymbol !== 'NONE' && adjustedPoints.length >= 2) {
        const sourcePoint = adjustedPoints[0];
        const nextPoint = adjustedPoints[1];
        const dx = nextPoint.x - sourcePoint.x;
        const dy = nextPoint.y - sourcePoint.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > ER_SYMBOL_HEIGHT) {
          adjustedPoints[0] = {
            x: sourcePoint.x + (dx / len) * ER_SYMBOL_HEIGHT,
            y: sourcePoint.y + (dy / len) * ER_SYMBOL_HEIGHT,
          };
        }
      }

      // Shorten target end if there's a symbol there
      if (erSymbols.targetSymbol !== 'NONE' && adjustedPoints.length >= 2) {
        const targetPoint = adjustedPoints[adjustedPoints.length - 1];
        const prevPoint = adjustedPoints[adjustedPoints.length - 2];
        const dx = prevPoint.x - targetPoint.x;
        const dy = prevPoint.y - targetPoint.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > ER_SYMBOL_HEIGHT) {
          adjustedPoints[adjustedPoints.length - 1] = {
            x: targetPoint.x + (dx / len) * ER_SYMBOL_HEIGHT,
            y: targetPoint.y + (dy / len) * ER_SYMBOL_HEIGHT,
          };
        }
      }

      adjustedPathData = adjustedPoints
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ');
    }

    return (
      <g key={edge.id}>
        <path
          d={adjustedPathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray || undefined}
        />
        {arrowPath && <path d={arrowPath} fill={strokeColor} />}

        {/* Task Group 6: Render UML source symbol (diamond for COMPOSITION/AGGREGATION) */}
        {sourceSymbolData && (
          <path
            d={sourceSymbolData.pathData}
            fill={sourceSymbolData.fill}
            stroke={isSelected ? edgeInteraction.selectedEdgeColor : sourceSymbolData.stroke}
            strokeWidth={sourceSymbolData.strokeWidth}
          />
        )}

        {/* Task Group 6: Render UML target symbol (triangle for GENERALIZATION/REALIZATION, arrow for DEPENDENCY) */}
        {targetSymbolData && (
          <path
            d={targetSymbolData.pathData}
            fill={targetSymbolData.fill}
            stroke={isSelected ? edgeInteraction.selectedEdgeColor : targetSymbolData.stroke}
            strokeWidth={targetSymbolData.strokeWidth}
          />
        )}

        {/* Task Group 5: Render cardinality labels for LogicalER edges */}
        {isLogicalEREdge && edge.source_label_text && sourceLabelPos && (
          <text
            x={sourceLabelPos.x}
            y={sourceLabelPos.y}
            textAnchor="middle"
            fontSize="10px"
            fontWeight="normal"
            fill={edgeLabelColor}
          >
            {edge.source_label_text}
          </text>
        )}
        {isLogicalEREdge && edge.target_label_text && targetLabelPos && (
          <text
            x={targetLabelPos.x}
            y={targetLabelPos.y}
            textAnchor="middle"
            fontSize="10px"
            fontWeight="normal"
            fill={edgeLabelColor}
          >
            {edge.target_label_text}
          </text>
        )}

        {/* Center label (relationship description) */}
        {displayLabel && labelPos && (
          <text
            x={labelPos.pos_x}
            y={labelPos.pos_y}
            textAnchor="middle"
            fontSize={labelFontSize}
            fontWeight={isLabelSelected ? 'bold' : labelFontWeight}
            fontStyle={labelFontStyle}
            textDecoration={labelTextDecoration}
            fill={isLabelSelected ? edgeInteraction.selectedLabelColor : edgeLabelColor}
            style={{ cursor: edge.linkedDiagramId ? 'pointer' : 'move' }}
            onMouseDown={edge.linkedDiagramId ? (e) => handleLinkedTextClick(e, edge.linkedDiagramId!) : undefined}
          >
            {displayLabel}
          </text>
        )}
      </g>
    );
  };

  // Z-Index Unified Rendering: Dispatcher function to render any element type
  const renderElement = (item: RenderableElement): React.ReactNode => {
    switch (item.type) {
      case 'node':
        return renderNode(item.element as DiagramNode);
      case 'edge':
        return renderEdge(item.element as DiagramEdge);
      case 'shape-decoration':
      case 'line-decoration':
        return renderDecoration(item.element as Decoration);
      default:
        return null;
    }
  };

    // Task Group 3: Render a single decoration (all shape types and line types)
  const renderDecoration = (decoration: Decoration) => {
    const displayDecoration = getDisplayDecoration(decoration);
    const isSelected = selectedDecorationIds.has(decoration.id);
    const isPrimary = decoration.id === primarySelectedDecorationId;

    // Handle all shape decoration types
    if (isShapeDecoration(displayDecoration)) {
      const shapeDecoration = displayDecoration as ShapeDecoration;

      // Use renderBoxDecoration for BOX and TEXT types (TEXT is BOX with transparent defaults)
      if (shapeDecoration.type === 'BOX' || shapeDecoration.type === 'TEXT') {
        // Use existing renderBoxDecoration for backward compatibility
        const renderData = renderBoxDecoration(shapeDecoration as BoxDecoration, isSelected);

        return (
          <g key={decoration.id}>
            {/* Render the box rectangle */}
            <rect
              x={renderData.rect.x}
              y={renderData.rect.y}
              width={renderData.rect.width}
              height={renderData.rect.height}
              fill={renderData.rect.fill}
              stroke={renderData.rect.stroke}
              strokeWidth={renderData.rect.strokeWidth}
              strokeDasharray={renderData.rect.strokeDasharray || undefined}
            />
            {/* Render text if present */}
            {renderData.textElement && (
              <text
                x={renderData.textElement.x}
                y={renderData.textElement.y}
                textAnchor={renderData.textElement.textAnchor}
                fontSize={renderData.textElement.fontSize}
                fontWeight={renderData.textElement.fontWeight}
                fontStyle={renderData.textElement.fontStyle}
                fill={decoration.linkedDiagramId ? '#1976D2' : renderData.textElement.fill}
                textDecoration={decoration.linkedDiagramId ? 'underline' : (renderData.textElement.textDecoration !== 'none' ? renderData.textElement.textDecoration : undefined)}
                style={decoration.linkedDiagramId ? { cursor: 'pointer' } : undefined}
                onMouseDown={decoration.linkedDiagramId ? (e) => handleLinkedTextClick(e, decoration.linkedDiagramId!) : undefined}
              >
                {renderData.textElement.lines.map((line, i) => (
                  <tspan key={i} x={renderData.textElement!.x} dy={i === 0 ? 0 : renderData.textElement!.lineHeight}>
                    {line || '\u00A0'}
                  </tspan>
                ))}
              </text>
            )}
            {/* Selection indicator for BOX */}
            {isSelected && (
              <rect
                x={renderData.rect.x - 2}
                y={renderData.rect.y - 2}
                width={renderData.rect.width + 4}
                height={renderData.rect.height + 4}
                fill="none"
                stroke={diagramEditing.selectionColor}
                strokeWidth={diagramEditing.selectionStrokeWidth}
                strokeDasharray="4,4"
                pointerEvents="none"
              />
            )}
            {/* Task Group 4: Resize handles for primary selected BOX */}
            {isPrimary && getShapeHandlePositions(shapeDecoration).map(({ position, x, y }) => (
              <circle
                key={position}
                cx={x}
                cy={y}
                r={diagramEditing.handleSize / 2}
                fill={diagramEditing.handleFill}
                stroke={diagramEditing.handleStroke}
                strokeWidth={diagramEditing.handleStrokeWidth}
                style={{ cursor: handleCursors[position] }}
              />
            ))}
          </g>
        );
      }

      // Render non-BOX shape decorations using shapeRendering.ts
      const renderResult = renderShapeDecoration(shapeDecoration, isSelected);
      const shapeData = renderResult.shape;

      return (
        <g key={decoration.id}>
          {/* Render the shape path */}
          <path
            d={shapeData.pathData}
            fill={shapeData.fill}
            stroke={isSelected ? diagramEditing.selectionColor : shapeData.stroke}
            strokeWidth={isSelected ? shapeData.strokeWidth + 1 : shapeData.strokeWidth}
            strokeDasharray={shapeData.strokeDasharray || undefined}
          />
          {/* Render fold triangle for NOTE shapes */}
          {shapeData.foldPath && (
            <path
              d={shapeData.foldPath}
              fill={shapeData.foldFill || shapeData.fill}
              stroke={isSelected ? diagramEditing.selectionColor : shapeData.stroke}
              strokeWidth={isSelected ? shapeData.strokeWidth + 1 : shapeData.strokeWidth}
              strokeLinejoin="round"
            />
          )}
          {/* Render text if present */}
          {renderResult.textElement && (
            <text
              x={renderResult.textElement.x}
              y={renderResult.textElement.y}
              textAnchor={renderResult.textElement.textAnchor}
              fontSize={renderResult.textElement.fontSize}
              fontWeight={renderResult.textElement.fontWeight}
              fontStyle={renderResult.textElement.fontStyle}
              fill={decoration.linkedDiagramId ? '#1976D2' : renderResult.textElement.fill}
              textDecoration={decoration.linkedDiagramId ? 'underline' : (renderResult.textElement.textDecoration !== 'none' ? renderResult.textElement.textDecoration : undefined)}
              style={decoration.linkedDiagramId ? { cursor: 'pointer' } : undefined}
              onMouseDown={decoration.linkedDiagramId ? (e) => handleLinkedTextClick(e, decoration.linkedDiagramId!) : undefined}
            >
              {renderResult.textElement.lines.map((line, i) => (
                <tspan key={i} x={renderResult.textElement!.x} dy={i === 0 ? 0 : renderResult.textElement!.lineHeight}>
                  {line || '\u00A0'}
                </tspan>
              ))}
            </text>
          )}
          {/* Selection indicator for shape */}
          {isSelected && (
            <rect
              x={shapeDecoration.pos_x - 2}
              y={shapeDecoration.pos_y - 2}
              width={shapeDecoration.width + 4}
              height={shapeDecoration.height + 4}
              fill="none"
              stroke={diagramEditing.selectionColor}
              strokeWidth={diagramEditing.selectionStrokeWidth}
              strokeDasharray="4,4"
              pointerEvents="none"
            />
          )}
          {/* Task Group 4: Resize handles for primary selected shape */}
          {isPrimary && getShapeHandlePositions(shapeDecoration).map(({ position, x, y }) => (
            <circle
              key={position}
              cx={x}
              cy={y}
              r={diagramEditing.handleSize / 2}
              fill={diagramEditing.handleFill}
              stroke={diagramEditing.handleStroke}
              strokeWidth={diagramEditing.handleStrokeWidth}
              style={{ cursor: handleCursors[position] }}
            />
          ))}
        </g>
      );
    }

    // Handle all line decoration types (LINE, ARROW_SINGLE, ARROW_DOUBLE)
    if (isLineBasedDecoration(displayDecoration)) {
      const lineDecoration = displayDecoration as LineDecoration;
      const renderData = renderLineDecoration(lineDecoration, isSelected);

      // Task Group 1: Check if this line's label is selected
      const isLabelSelected = lineDecoration.id === selectedDecorationLabelId;

      // Get label position with preview support
      const labelPos = getDisplayDecorationLabelPos(lineDecoration);

      // Task Group 2: Calculate mid-segment positions for rendering handles
      const midSegmentPositions = calculateMidSegmentPositions(lineDecoration.line_points);

      return (
        <g key={decoration.id}>
          {/* Render the line path */}
          <path
            d={renderData.pathData}
            fill="none"
            stroke={isSelected ? diagramEditing.selectionColor : renderData.stroke}
            strokeWidth={isSelected ? renderData.strokeWidth + 1 : renderData.strokeWidth}
            strokeDasharray={renderData.strokeDasharray || undefined}
          />
          {/* Render arrow at start if present */}
          {renderData.arrowStartPath && (
            <path
              d={renderData.arrowStartPath}
              fill={isSelected ? diagramEditing.selectionColor : renderData.stroke}
            />
          )}
          {/* Render arrow at end if present */}
          {renderData.arrowEndPath && (
            <path
              d={renderData.arrowEndPath}
              fill={isSelected ? diagramEditing.selectionColor : renderData.stroke}
            />
          )}
          {/* Task Group 1: Render label with selection highlight support */}
          {renderData.labelElement && (
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor={renderData.labelElement.textAnchor}
              fontSize={renderData.labelElement.fontSize}
              fontWeight={isLabelSelected ? 'bold' : renderData.labelElement.fontWeight}
              fontStyle={renderData.labelElement.fontStyle}
              fill={decoration.linkedDiagramId ? '#1976D2' : (isLabelSelected ? edgeInteraction.selectedLabelColor : renderData.labelElement.fill)}
              textDecoration={decoration.linkedDiagramId ? 'underline' : undefined}
              style={decoration.linkedDiagramId ? { cursor: 'pointer' } : { cursor: 'move' }}
              onMouseDown={decoration.linkedDiagramId ? (e) => handleLinkedTextClick(e, decoration.linkedDiagramId!) : undefined}
            >
              {renderData.labelElement.lines.map((line, i) => (
                <tspan key={i} x={labelPos.x} dy={i === 0 ? 0 : renderData.labelElement!.lineHeight}>
                  {line || '\u00A0'}
                </tspan>
              ))}
            </text>
          )}
          {/* Task Group 4: Control point handles for primary selected LINE (circles) */}
          {isPrimary && lineDecoration.line_points.map((point, index) => (
            <circle
              key={`line-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={diagramEditing.handleSize / 2}
              fill={diagramEditing.handleFill}
              stroke={diagramEditing.handleStroke}
              strokeWidth={diagramEditing.handleStrokeWidth}
              style={{ cursor: 'move' }}
            />
          ))}
          {/* Task Group 2: Mid-segment handles for primary selected LINE (squares) */}
          {isPrimary && midSegmentPositions.map((midPos) => {
            const halfSize = edgeInteraction.midSegmentHandleSize / 2;
            return (
              <rect
                key={`mid-segment-${midPos.segmentIndex}`}
                x={midPos.x - halfSize}
                y={midPos.y - halfSize}
                width={edgeInteraction.midSegmentHandleSize}
                height={edgeInteraction.midSegmentHandleSize}
                fill={edgeInteraction.midSegmentHandleFill}
                stroke={edgeInteraction.midSegmentHandleStroke}
                strokeWidth={edgeInteraction.midSegmentHandleStrokeWidth}
                style={{ cursor: edgeInteraction.midSegmentHandleCursor }}
              />
            );
          })}
        </g>
      );
    }

    return null;
  };

  // Task Group 3: Render shape preview during drawing
  const renderShapePreview = () => {
    if (!shapeAddPreview) return null;

    const { x, y, width, height, shapeType } = shapeAddPreview;

    // Create a temporary shape decoration for preview
    const previewShape: ShapeDecoration = {
      id: 'preview',
      type: shapeType,
      pos_x: x,
      pos_y: y,
      width,
      height,
    };

    // Get the shape path for preview
    const shapeResult = renderShape(previewShape);

    return (
      <path
        d={shapeResult.pathData}
        fill="none"
        stroke={DECORATION_DEFAULTS.BOX.line_color}
        strokeWidth={2}
        strokeDasharray="4,4"
        pointerEvents="none"
      />
    );
  };

  // Task 5.3 & 5.4: Render user interaction lines
  const renderUserInteractionLines = (): React.ReactNode => {
    // Return null if no interactions to render
    if (userInteractions.length === 0) {
      return null;
    }

    // Define line style properties for interaction lines
    const interactionLineColor = '#8E44AD'; // Purple color for interactions
    const interactionLineWidth = 1.5;

    return (
      <g className="user-interaction-lines">
        {userInteractions.map((interaction) => {
          const paths = calculateInteractionPaths(interaction, nodes);

          return (
            <g key={interaction.id}>
              {/* Render primary-to-secondary line (if both points exist) */}
              {paths.primaryToSecondaryLine && (
                <path
                  d={generateLinePath(paths.primaryToSecondaryLine.start, paths.primaryToSecondaryLine.end)}
                  fill="none"
                  stroke={interactionLineColor}
                  strokeWidth={interactionLineWidth}
                  strokeDasharray={getStrokeDasharray(interaction.line_style)}
                  pointerEvents="none"
                />
              )}
              {/* Render user-to-target line (user to midpoint or user to primary) */}
              {paths.userToTargetLine && (
                <path
                  d={generateLinePath(paths.userToTargetLine.start, paths.userToTargetLine.end)}
                  fill="none"
                  stroke={interactionLineColor}
                  strokeWidth={interactionLineWidth}
                  strokeDasharray={getStrokeDasharray(interaction.line_style)}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </g>
    );
  };

  // Delete modal callbacks
  const handleDeleteDiagramOnly = useCallback(() => {
    dispatch({
      type: 'DELETE_DIAGRAM_ELEMENTS',
      diagramId,
      nodeIds: deleteModalState.nodeIds,
      edgeIds: deleteModalState.edgeIds,
      decorationIds: deleteModalState.decorationIds,
    });
    onClearSelection();
    setDeleteModalState({ isOpen: false, nodeIds: [], edgeIds: [], decorationIds: [] });
  }, [deleteModalState, diagramId, dispatch, onClearSelection]);

  const handleDeleteBoth = useCallback(() => {
    // Delete from meta-model: states
    for (const nodeId of deleteModalState.nodeIds) {
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.entity_type === 'STATE' && node.entity_id) {
        dispatch({
          type: 'DELETE_ENTITY',
          entityType: 'states',
          id: node.entity_id,
        });
      }
    }
    // Delete from meta-model: state transitions (stored as entities, not relationships)
    for (const edgeId of deleteModalState.edgeIds) {
      const edge = edges.find(e => e.id === edgeId);
      if (edge && edge.relationship_type === 'STATE_TRANSITION' && edge.relationship_id) {
        dispatch({
          type: 'DELETE_ENTITY',
          entityType: 'state_transitions',
          id: edge.relationship_id,
        });
      }
    }
    // Delete from diagram
    dispatch({
      type: 'DELETE_DIAGRAM_ELEMENTS',
      diagramId,
      nodeIds: deleteModalState.nodeIds,
      edgeIds: deleteModalState.edgeIds,
      decorationIds: deleteModalState.decorationIds,
    });
    onClearSelection();
    setDeleteModalState({ isOpen: false, nodeIds: [], edgeIds: [], decorationIds: [] });
  }, [deleteModalState, diagramId, dispatch, onClearSelection, nodes, edges]);

  const handleDeleteModalClose = useCallback(() => {
    setDeleteModalState({ isOpen: false, nodeIds: [], edgeIds: [], decorationIds: [] });
  }, []);

  return (
    <>
    <div
      ref={containerRef}
      className={styles.canvas}
      onWheel={handleWheel}
      style={{ cursor: getCursor() }}
      tabIndex={0} // Make canvas focusable for keyboard events
    >
      <svg
        ref={svgRef}
        width={canvasWidth * zoom}
        height={canvasHeight * zoom}
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className={styles.svg}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      >
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#f0f0f0"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width={canvasWidth} height={canvasHeight} fill="url(#grid)" />

        {/* Task Group 2/5: Conditional rendering for Sequence/Activity/State vs General diagrams */}
        {isSequenceDiagram ? (
          // Sequence Diagram Mode: Render via SequenceDiagramRenderer (Task Group 2)
          <>
            <SequenceDiagramRenderer
              sequenceDiagram={extractSequenceDiagram(diagram)}
              participantSpacing={220}
              metaModel={state.model.metaModel!}
            />
            {/* Task Group 3: Decoration overlay for Sequence diagrams */}
            {sortedElements
              .filter((item) => item.type === 'shape-decoration' || item.type === 'line-decoration')
              .map((item) => renderElement(item))}
          </>
        ) : isActivityDiagram ? (
          // Activity Diagram Mode: Render via ActivityDiagramRenderer
          <ActivityDiagramRenderer
            diagram={diagram!}
            metaModel={state.model.metaModel!}
            zoom={zoom}
          />
        ) : isStateDiagram ? (
          // State Diagram Mode: Render via StateDiagramRenderer (Task Group 4)
          <StateDiagramRenderer
            diagram={diagram!}
            metaModel={state.model.metaModel!}
            zoom={zoom}
          />
        ) : isUIWorkflowDiagram ? (
          // UI Workflow Diagram Mode: Render via UIWorkflowDiagramRenderer (Task Group 7)
          <UIWorkflowDiagramRenderer
            diagram={diagram!}
            metaModel={state.model.metaModel!}
            zoom={zoom}
          />
        ) : isUserJourneyDiagram ? (
          // User Journey Diagram Mode: Render via UserJourneyDiagramRenderer (Spec 2026-04-03)
          (() => {
            const rawJourneyData = extractUserJourneyDiagram(diagram);
            if (!rawJourneyData) {
              return (
                <text x={60} y={80} fontSize={14} fill="#666666">
                  User Journey diagram data is not available.
                </text>
              );
            }
            // Enrich steps with ProcessActivity and co-worker data from meta model
            const journeyData = enrichJourneySteps(
              rawJourneyData,
              state.model?.metaModel?.entities?.process_activities ?? [],
              state.model?.metaModel?.entities?.activity_steps ?? [],
              state.model?.metaModel?.entities?.business_users ?? [],
            );
            return (
              <UserJourneyDiagramRenderer
                diagram={journeyData}
                zoom={zoom}
                onContentBounds={setJourneyBounds}
                parentOverview={journeyParentOverview}
                linkedJourneys={journeyLinkedJourneys}
                onParentOverviewClick={onParentOverviewClick}
                onLinkedJourneyClick={onLinkedJourneyClick}
                journeyDiagramMap={journeyDiagramMap}
                onCoWorkerClick={onCoWorkerClick}
              />
            );
          })()
        ) : isUserJourneyOverviewDiagram ? (
          // User Journey Overview Diagram Mode: Render via UserJourneyOverviewDiagramRenderer (Spec 2026-04-07)
          (() => {
            const rawOverviewData = extractUserJourneyOverviewDiagram(diagram);
            if (!rawOverviewData) {
              return (
                <text x={60} y={80} fontSize={14} fill="#666666">
                  User Journey Overview diagram data is not available.
                </text>
              );
            }
            // Enrich overview with app abbreviations, summary counts, and related colleagues
            // Spec 2026-04-10: Task Group 3, Task 3.5
            const enrichMeta: OverviewEnrichmentMetaData = {
              activitySteps: state.model?.metaModel?.entities?.activity_steps ?? [],
              applications: state.model?.metaModel?.entities?.applications ?? [],
              businessUserBusinessPoints: state.model?.metaModel?.relationships?.business_user_business_points ?? [],
              businessUsers: state.model?.metaModel?.entities?.business_users ?? [],
              userJourneys: state.model?.metaModel?.entities?.user_journeys ?? [],
            };
            const overviewData = enrichOverviewFull(rawOverviewData, enrichMeta);
            return (
              <UserJourneyOverviewDiagramRenderer
                overviewData={overviewData}
                onContentBounds={setOverviewBounds}
                onNodeClick={(node) => {
                  const status = node.link?.link_status;
                  if (status === 'LINKED' || status === 'AMBIGUOUS_RESOLVED') {
                    dispatch({ type: 'SELECT_DIAGRAM', payload: node.link!.linked_diagram_id! });
                    if (containerRef.current) {
                      containerRef.current.scrollTop = 0;
                      containerRef.current.scrollLeft = 0;
                    }
                  } else {
                    onUnlinkedNodeClick?.();
                  }
                }}
                onColleagueClick={onColleagueClick}
              />
            );
          })()
        ) : (
          // General Diagram Mode: Existing node/edge rendering
          <>
            {/* Z-Index Unified Rendering: Single sorted loop for all elements */}
            {sortedElements.map((item) => renderElement(item))}

            {/* Task 5.4: Render user interaction lines after edges but before selection indicators */}
            {renderUserInteractionLines()}
          </>
        )}

        {/* Render selection indicators for ALL selected nodes */}
        {nodes.filter(n => selectedNodeIds.has(n.id)).map((nodeData) => {
          const displayNode = getDisplayNode(nodeData);
          const isPrimary = nodeData.id === primarySelectedNodeId;

          return (
            <g key={`selection-${nodeData.id}`}>
              {/* Selection indicator (blue outline) */}
              <rect
                x={displayNode.pos_x - 2}
                y={displayNode.pos_y - 2}
                width={displayNode.width + 4}
                height={displayNode.height + 4}
                fill="none"
                stroke={diagramEditing.selectionColor}
                strokeWidth={diagramEditing.selectionStrokeWidth}
                rx={appConfig.node.borderRadius + 2}
                pointerEvents="none"
              />

              {/* Resize handles - only shown on primary selected node */}
              {isPrimary && getHandlePositions(displayNode).map(({ position, x, y }) => (
                <circle
                  key={position}
                  cx={x}
                  cy={y}
                  r={diagramEditing.handleSize / 2}
                  fill={diagramEditing.handleFill}
                  stroke={diagramEditing.handleStroke}
                  strokeWidth={diagramEditing.handleStrokeWidth}
                  style={{ cursor: handleCursors[position] }}
                />
              ))}
            </g>
          );
        })}

        {/* Render point handles for primary selected edge only */}
        {primarySelectedEdge && (() => {
          const edgePoints = primarySelectedEdge.edge_points || [];

          // Task Group 2: Calculate mid-segment positions for edge
          const displayPoints = edgePoints.map((_, index) => {
            const displayPoint = getDisplayEdgePoint(primarySelectedEdge, index);
            return { x: displayPoint.pos_x, y: displayPoint.pos_y };
          });
          const midSegmentPositions = calculateMidSegmentPositions(displayPoints);

          return (
            <g>
              {/* Endpoint handles (circles) */}
              {edgePoints.map((_point, index) => {
                const displayPoint = getDisplayEdgePoint(primarySelectedEdge, index);

                return (
                  <circle
                    key={`edge-handle-${index}`}
                    cx={displayPoint.pos_x}
                    cy={displayPoint.pos_y}
                    r={edgeInteraction.pointHandleSize / 2}
                    fill={edgeInteraction.pointHandleFill}
                    stroke={edgeInteraction.pointHandleStroke}
                    strokeWidth={edgeInteraction.pointHandleStrokeWidth}
                    style={{ cursor: 'move' }}
                    className={styles.edgePointHandle}
                  />
                );
              })}
              {/* Task Group 2: Mid-segment handles for relationship edges (squares) */}
              {midSegmentPositions.map((midPos) => {
                const halfSize = edgeInteraction.midSegmentHandleSize / 2;
                return (
                  <rect
                    key={`edge-mid-segment-${midPos.segmentIndex}`}
                    x={midPos.x - halfSize}
                    y={midPos.y - halfSize}
                    width={edgeInteraction.midSegmentHandleSize}
                    height={edgeInteraction.midSegmentHandleSize}
                    fill={edgeInteraction.midSegmentHandleFill}
                    stroke={edgeInteraction.midSegmentHandleStroke}
                    strokeWidth={edgeInteraction.midSegmentHandleStrokeWidth}
                    style={{ cursor: edgeInteraction.midSegmentHandleCursor }}
                  />
                );
              })}
            </g>
          );
        })()}

        {/* Box-select rectangle (render at end, above all other content) */}
        {boxSelectRect && (
          <rect
            x={boxSelectRect.x}
            y={boxSelectRect.y}
            width={boxSelectRect.width}
            height={boxSelectRect.height}
            stroke={diagramEditing.selectionColor}
            strokeDasharray={boxSelectConfig.strokeDasharray}
            strokeWidth={boxSelectConfig.strokeWidth}
            fill={diagramEditing.selectionColor}
            fillOpacity={boxSelectConfig.fillAlpha}
            pointerEvents="none"
          />
        )}

        {/* Task Group 3: Shape add preview (shows actual shape outline during drawing) */}
        {renderShapePreview()}

        {/* Task Group 4: LINE add preview line */}
        {lineAddGestureState.hasFirstPoint && linePreviewPoint && (
          <line
            x1={lineAddGestureState.startX}
            y1={lineAddGestureState.startY}
            x2={linePreviewPoint.x}
            y2={linePreviewPoint.y}
            stroke={DECORATION_DEFAULTS.LINE.line_color}
            strokeWidth={2}
            strokeDasharray="4,4"
            pointerEvents="none"
          />
        )}
      </svg>
    </div>
    <DeleteDiagramElementModal
      isOpen={deleteModalState.isOpen}
      onClose={handleDeleteModalClose}
      onDiagramOnly={handleDeleteDiagramOnly}
      onBoth={handleDeleteBoth}
      selectedNodeCount={deleteModalState.nodeIds.length}
      selectedEdgeCount={deleteModalState.edgeIds.length}
    />
    </>
  );
}
