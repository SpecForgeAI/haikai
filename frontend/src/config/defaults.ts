import { AppConfig, EntityColors } from '../types/config';
import { ArchitectureModel, DiagramNode, LineStyle, ArrowType, ProcessActivity, UserInteractionLevel, ActorHint, InterfaceType, ProcessActivityFrequency, DecorationType, EndpointType, EndpointDirection, EndpointLifecycleStatus, StateKind, TriggerRefKind, GuardRefKind, EffectRefKind, ActivityKind, ActivityFlowKind, ActivityPartitionRefKind, ActivityDiagramOrientation, LogicalERCardinality, LogicalERRelationship, LogicalEREndpointKind, ApplicationPointTargetType, UICharacteristicType, UserJourneyLinkRelationshipType } from '../types/model';

export const appConfig: AppConfig = {
  canvas: {
    defaultWidth: 2500,
    defaultHeight: 4000,
  },
  zoom: {
    min: 0.25,
    max: 2.0,
    default: 1.0,
    step: 0.25,
  },
  grid: {
    rowHeight: 36,
    headerHeight: 40,
  },
  node: {
    minWidth: 60,
    minHeight: 40,
    padding: 10,
    labelPadding: 8,
    borderRadius: 4,
    borderWidth: 2,
    fontSize: 12,
  },
  edge: {
    lineWidth: 2,
    arrowSize: 8,
    labelFontSize: 10,
  },
};

// Diagram editing configuration
export const diagramEditing = {
  // Selection
  selectionColor: '#1976D2',
  selectionStrokeWidth: 2,

  // Resize handles
  handleSize: 8,
  handleFill: '#1976D2',
  handleStroke: '#FFFFFF',
  handleStrokeWidth: 1,

  // Constraints
  minNodeWidth: 20,
  minNodeHeight: 20,

  // Edge attachment
  attachmentTolerance: 5,
};

// Edge interaction configuration
export const edgeInteraction = {
  // Edge point handles
  pointHandleSize: 6,        // 6px diameter circles
  pointHandleFill: '#1976D2',
  pointHandleStroke: '#FFFFFF',
  pointHandleStrokeWidth: 1,

  // Hit testing
  edgeHitTolerance: 5,       // pixels from line
  handleHitRadius: 6,        // pixels from handle center

  // Selected edge styling
  selectedEdgeColor: '#1976D2',
  selectedEdgeWidth: 3,

  // Selected label styling
  selectedLabelColor: '#1976D2',

  // Mid-segment handles (for bend point insertion)
  midSegmentHandleSize: 6,           // 6px side for square
  midSegmentHandleFill: '#FFFFFF',   // white fill
  midSegmentHandleStroke: '#4a90d9', // blue stroke
  midSegmentHandleStrokeWidth: 1,
  midSegmentHandleCursor: 'pointer', // cursor style (pointer or crosshair)
};

// Edge rendering configuration
export const edgeRendering = {
  // Default stroke width
  defaultLineWeight: 2,

  // Default dash patterns
  defaultDashedPattern: [6, 4],
  defaultDottedPattern: [2, 4],

  // Line types
  lineTypes: {
    SOLID: 'SOLID',
    DASHED: 'DASHED',
    DOTTED: 'DOTTED',
  },
};

// ============================================================================
// Decoration Defaults
// Default styling and z-index values for all decoration types
// ============================================================================

// Z-index ordering for diagram elements
// BOX decorations render below nodes (grouping boxes)
// LINE decorations render above edges (annotation lines)
export const Z_INDEX_DEFAULTS = {
  BOX_DECORATION: 50,      // Below nodes at 100
  DIAGRAM_NODE: 100,       // Standard node layer
  DIAGRAM_EDGE: 110,       // Above nodes
  LINE_DECORATION: 120,    // Above edges
} as const;

// Default styling for BOX decorations (also used for other shape types)
export interface BoxDecorationDefaults {
  z_index: number;
  background_color: string;
  line_color: string;
  line_style: LineStyle;
  line_weight: string;
  text_font_size: number;
  text_font_weight: string;
  text_font_style: string;
  text_color: string;
  text_h_align: 'LEFT' | 'CENTER' | 'RIGHT';
  text_v_align: 'TOP' | 'MIDDLE' | 'BOTTOM';
  min_width: number;
  min_height: number;
  // Opacity defaults (0-100)
  background_opacity: number;
  border_opacity: number;
}

// Default styling for LINE decorations
export interface LineDecorationDefaults {
  z_index: number;
  line_color: string;
  line_style: LineStyle;
  line_weight: string;
  text_font_size: number;
  text_font_weight: string;
  text_font_style: string;
  text_color: string;
  arrow_start: ArrowType;
  arrow_end: ArrowType;
}

// Extended decoration defaults type including all shape types
export interface DecorationDefaultsType {
  TEXT: BoxDecorationDefaults;
  BOX: BoxDecorationDefaults;
  LINE: LineDecorationDefaults;
  // New shape types
  OVAL: BoxDecorationDefaults;
  DIAMOND: BoxDecorationDefaults;
  PARALLELOGRAM: BoxDecorationDefaults;
  CIRCLE: BoxDecorationDefaults;
  CYLINDER: BoxDecorationDefaults;
  TRAPEZOID: BoxDecorationDefaults;
  HEXAGON: BoxDecorationDefaults;
  NOTE: BoxDecorationDefaults;
  // New line types
  ARROW_SINGLE: LineDecorationDefaults;
  ARROW_DOUBLE: LineDecorationDefaults;
}

// Base shape defaults (shared by all shape types)
const baseShapeDefaults: BoxDecorationDefaults = {
  z_index: Z_INDEX_DEFAULTS.BOX_DECORATION,
  background_color: 'rgba(230, 230, 255, 0.2)',
  line_color: '#9999FF',
  line_style: 'SOLID',
  line_weight: '2px',
  text_font_size: 14,
  text_font_weight: 'normal',
  text_font_style: 'normal',
  text_color: '#000000',
  text_h_align: 'CENTER',
  text_v_align: 'MIDDLE',
  min_width: 40,
  min_height: 30,
  background_opacity: 100,
  border_opacity: 100,
};

// Base line defaults (shared by all line types)
const baseLineDefaults: LineDecorationDefaults = {
  z_index: Z_INDEX_DEFAULTS.LINE_DECORATION,
  line_color: '#666666',
  line_style: 'SOLID',
  line_weight: '2px',
  text_font_size: 12,
  text_font_weight: 'normal',
  text_font_style: 'normal',
  text_color: '#333333',
  arrow_start: 'NONE',
  arrow_end: 'NONE',
};

export const DECORATION_DEFAULTS: DecorationDefaultsType = {
  // TEXT - transparent box for free-form text annotations
  TEXT: {
    ...baseShapeDefaults,
    background_opacity: 0,
    border_opacity: 0,
    text_v_align: 'MIDDLE',
  },

  // Original BOX decoration
  BOX: {
    ...baseShapeDefaults,
    text_v_align: 'TOP', // BOX uses top alignment for grouping labels
  },

  // Original LINE decoration
  LINE: {
    ...baseLineDefaults,
  },

  // ============================================================================
  // New Shape Types
  // ============================================================================

  // OVAL - Ellipse (terminator shape in flowcharts)
  OVAL: {
    ...baseShapeDefaults,
    background_color: 'rgba(200, 230, 200, 0.3)',
    line_color: '#66AA66',
  },

  // DIAMOND - Rhombus (decision shape in flowcharts)
  DIAMOND: {
    ...baseShapeDefaults,
    background_color: 'rgba(255, 230, 200, 0.3)',
    line_color: '#CC9966',
    min_width: 60,
    min_height: 60,
  },

  // PARALLELOGRAM - Slanted rectangle (input/output in flowcharts)
  PARALLELOGRAM: {
    ...baseShapeDefaults,
    background_color: 'rgba(230, 220, 255, 0.3)',
    line_color: '#9966CC',
    min_width: 80,
  },

  // CIRCLE - Perfect circle (connector in flowcharts)
  CIRCLE: {
    ...baseShapeDefaults,
    background_color: 'rgba(255, 240, 200, 0.3)',
    line_color: '#CCAA44',
    min_width: 40,
    min_height: 40,
  },

  // CYLINDER - Database/data store shape
  CYLINDER: {
    ...baseShapeDefaults,
    background_color: 'rgba(200, 220, 255, 0.3)',
    line_color: '#6699CC',
    min_height: 60,
  },

  // TRAPEZOID - Manual operation shape
  TRAPEZOID: {
    ...baseShapeDefaults,
    background_color: 'rgba(220, 220, 220, 0.3)',
    line_color: '#888888',
    min_width: 60,
  },

  // HEXAGON - Preparation/initialization shape
  HEXAGON: {
    ...baseShapeDefaults,
    background_color: 'rgba(255, 220, 220, 0.3)',
    line_color: '#CC6666',
    min_width: 60,
  },

  // NOTE - Post-it note shape (folded top-left corner)
  NOTE: {
    ...baseShapeDefaults,
    background_color: '#FFEB3B',
    line_color: '#000000',
    line_weight: '3px',
    text_h_align: 'CENTER',
    text_v_align: 'MIDDLE',
    min_width: 140,
    min_height: 100,
  },
  // ============================================================================
  // New Line Types
  // ============================================================================

  // ARROW_SINGLE - Line with arrow at end only
  ARROW_SINGLE: {
    ...baseLineDefaults,
    arrow_start: 'NONE',
    arrow_end: 'ARROW',
  },

  // ARROW_DOUBLE - Line with arrows at both ends
  ARROW_DOUBLE: {
    ...baseLineDefaults,
    arrow_start: 'ARROW',
    arrow_end: 'ARROW',
  },
};

// Counter for generating unique decoration IDs
let decorationIdCounter = 0;

/**
 * Generate a unique ID for a decoration
 * @param type - The decoration type
 * @returns A unique ID string with appropriate prefix
 */
export function generateDecorationId(type: DecorationType): string {
  decorationIdCounter++;
  const timestamp = Date.now();
  const prefix = `dec_${type.toLowerCase()}_`;
  return `${prefix}${timestamp}_${decorationIdCounter}`;
}

// ============================================================================
// Box-select configuration
// ============================================================================

export const boxSelectConfig = {
  strokeDasharray: '4,4',
  fillAlpha: 0.1,
  strokeWidth: 1,
  // Color references diagramEditing.selectionColor (#1976D2)
};

// Box-select state interface for tracking selection rectangle
export interface BoxSelectState {
  isSelecting: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isCtrlHeld: boolean;
}

// Initial box-select state
export const initialBoxSelectState: BoxSelectState = {
  isSelecting: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  isCtrlHeld: false,
};

// Group drag state interface for tracking multi-node movement
export interface GroupDragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  originalPositions: Map<string, { pos_x: number; pos_y: number }>;
  originalDecorations: Map<string, any>;
}

// Initial group drag state
export const initialGroupDragState: GroupDragState = {
  isDragging: false,
  startX: 0,
  startY: 0,
  originalPositions: new Map(),
  originalDecorations: new Map(),
};

// Handle position type for resize handles
export type HandlePosition = 'TL' | 'TC' | 'TR' | 'ML' | 'MR' | 'BL' | 'BC' | 'BR';

// Drag type for drag operations
export type DragType = 'move' | 'resize' | null;

// Edge drag type for edge-specific operations
export type EdgeDragType = 'edgePoint' | 'label' | null;

// Drag state interface for tracking drag operations
export interface DragState {
  isDragging: boolean;
  dragType: DragType;
  resizeHandle: HandlePosition | null;
  startX: number;
  startY: number;
  originalNode: DiagramNode | null;
}

// Edge drag state interface for tracking edge drag operations
export interface EdgeDragState {
  isDragging: boolean;
  dragType: EdgeDragType;
  edgeId: string;
  pointIndex?: number;  // For edge point drag
  startX: number;
  startY: number;
  originalValue: { pos_x: number; pos_y: number };
}

// Cursor mapping for resize handles
export const handleCursors: Record<HandlePosition, string> = {
  TL: 'nwse-resize',
  TC: 'ns-resize',
  TR: 'nesw-resize',
  ML: 'ew-resize',
  MR: 'ew-resize',
  BL: 'nesw-resize',
  BC: 'ns-resize',
  BR: 'nwse-resize',
};

export const entityColors: Record<string, EntityColors> = {
  APPLICATION: { background: '#E3F2FD', border: '#1976D2' },
  APP_COMPONENT: { background: '#E8F5E9', border: '#388E3C' },
  SERVICE: { background: '#F3E5F5', border: '#7B1FA2' },
  INTERFACE: { background: '#E8EAF6', border: '#5C6BC0' },
  ENDPOINT: { background: '#E0E7FF', border: '#4338CA' },  // Indigo for endpoints (child of Interface)
  CLASS: { background: '#FFF8E1', border: '#FF8F00' },  // Amber for classes
  METHOD: { background: '#FFF3E0', border: '#EF6C00' },  // Orange for methods (child of Class)
  LOGICAL_DATA_ENTITY: { background: '#FFF3E0', border: '#F57C00' },
  PHYSICAL_DATA_ENTITY: { background: '#FFF3E0', border: '#F57C00' },
  BUSINESS_USER: { background: '#F5F5F5', border: '#616161' },
  BUSINESS_PROCESS: { background: '#d6f5d6', border: '#616161' }, // Green background for business process visualization
  PROCESS_ACTIVITY: { background: '#a5d6a7', border: '#616161' }, // Default to AUTOMATED (medium green), border consistent with business domain
  APPLICATION_POINT: { background: '#E3F2FD', border: '#1976D2' },
  BUSINESS_POINT: { background: '#E8D5B7', border: '#8B7355' }, // Warm tan/beige - unified business process abstraction
  INTERACTION: { background: '#FFF8E1', border: '#FFA000' },  // Amber - user interaction entity
  APP_BUSINESS_POINT: { background: '#F0E6D3', border: '#9D8B6E' }, // Light tan - App_Business_Point lookup entity
  EVENT: { background: '#E1F5FE', border: '#0288D1' }, // Light cyan - behavioural domain event entity
  STATE: { background: '#E8F5E9', border: '#4CAF50' }, // Light green - behavioural domain state entity
  STATE_TRANSITION: { background: '#FFF3E0', border: '#FF9800' }, // Light orange - behavioural domain state transition entity
  ACTIVITY: { background: '#E8F5E9', border: '#66BB6A' }, // Light green - behavioural domain activity entity
  ACTIVITY_FLOW: { background: '#E3F2FD', border: '#42A5F5' }, // Light blue - behavioural domain activity flow entity
  ACTIVITY_PARTITION: { background: '#F3E5F5', border: '#AB47BC' }, // Light purple - behavioural domain activity partition entity
  BUSINESS_LOGIC: { background: '#FCE4EC', border: '#C2185B' }, // Light pink - behavioural domain business logic entity
  // Spec 2026-01-02: UI Architecture entities
  UI_SCREEN: { background: '#E8EAF6', border: '#5C6BC0' }, // Indigo - UI screen entity
  UI_WORKFLOW_TRANSITION: { background: '#E3F2FD', border: '#1976D2' }, // Blue - UI workflow transition entity
  // Spec 2026-01-03: Meta-Model UI Domain Tab - UI Components and Actions
  UI_COMPONENT: { background: '#E8EAF6', border: '#3F51B5' }, // Indigo - UI component entity
  UI_ACTION: { background: '#E3F2FD', border: '#2196F3' }, // Blue - UI action entity
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 entity colours
  // Keys match the InfrastructurePointKind discriminator values (SCREAMING_SNAKE_CASE).
  // The 6 container-like types (Environment, CloudAccount, Location, Network, Subnet, ComputeCluster)
  // also receive 320x200 default dimensions via nodeCreation.ts (see CONTAINER_TYPES set there).
  ENVIRONMENT: { background: '#ECEFF1', border: '#546E7A' }, // Slate - outermost container (cloud environment)
  CLOUD_ACCOUNT: { background: '#CFD8DC', border: '#455A64' }, // Cool grey - cloud account (subscription/project)
  LOCATION: { background: '#FFF8E1', border: '#A1887F' }, // Sand - region/zone neutral container
  NETWORK: { background: '#E3F2FD', border: '#1565C0' }, // Cool blue - network (VPC/VNet)
  SUBNET: { background: '#E1F5FE', border: '#0277BD' }, // Paler blue - subnet (sits inside network)
  COMPUTE_CLUSTER: { background: '#FFF9C4', border: '#F9A825' }, // Warm yellow - compute cluster container
  COMPUTE_RESOURCE: { background: '#FFECB3', border: '#FF8F00' }, // Saturated amber - compute resource node
  DEPLOYMENT_UNIT: { background: '#EDE7F6', border: '#5E35B1' }, // Purple - deployment unit (package shade)
  LOAD_BALANCER: { background: '#E8F5E9', border: '#2E7D32' }, // Green - load balancer node
  LISTENER: { background: '#F1F8E9', border: '#689F38' }, // Paler green / chartreuse - listener (child of load balancer)
  DATA_STORE_INSTANCE: { background: '#E0F2F1', border: '#00796B' }, // Teal - data store / database shade
  INFRASTRUCTURE_RESOURCE: { background: '#ECEFF1', border: '#607D8B' }, // Neutral grey-blue - generic infrastructure resource (catch-all)
};

// ============================================================================
// Business Point Colors
// Colors for the Business Point super-entity that abstracts Business Processes
// and Process Activities for relationship targeting
// ============================================================================

export const businessPointColors = {
  fill: '#E8D5B7',    // Warm tan/beige background
  stroke: '#8B7355',  // Darker brown border
  text: '#4A3728',    // Dark brown text for readability
};

// ============================================================================
// Process Activity Background Colours by user_interaction_level
// These colours indicate the level of user interaction required for an activity
// ============================================================================

export const processActivityColors: Record<UserInteractionLevel, string> = {
  AUTOMATED: '#a5d6a7',    // Medium green - fully automated activities (no user interaction)
  MINIMAL: '#c8e6c9',      // Light green - low user interaction
  MODERATE: '#fff9c4',     // Light yellow - medium user interaction
  SIGNIFICANT: '#ffcdd2',  // Light red - high user interaction
};

/**
 * Get the default background fill colour for a ProcessActivity node
 * based on its user_interaction_level value.
 *
 * @param activity - The ProcessActivity entity
 * @returns Hex colour string for the background fill
 */
export function getProcessActivityDefaultFill(activity: ProcessActivity): string {
  const userInteractionLevel = activity.user_interaction_level || 'AUTOMATED';
  return processActivityColors[userInteractionLevel] || processActivityColors.AUTOMATED;
}

// ============================================================================
// ActorHint and UserInteractionLevel options for dropdowns
// ============================================================================

export const actorHintOptions: ActorHint[] = [
  'END_USER',
  'EXTERNAL_USER',
  'INTERNAL_SYSTEM',
  'EXTERNAL_SYSTEM',
  'HYBRID_USER_SYSTEM',
  'BATCH_JOB',
  'BOT_OR_RPA',
  'OTHER',
];

export const userInteractionLevelOptions: UserInteractionLevel[] = [
  'AUTOMATED',
  'MINIMAL',
  'MODERATE',
  'SIGNIFICANT',
];

// ============================================================================
// ProcessActivityFrequency options for dropdown
// Indicates how frequently an activity is performed
// ============================================================================

export const processActivityFrequencyOptions: ProcessActivityFrequency[] = [
  'CONTINUOUSLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMI-ANNUALLY',
  'ANNUALLY',
  'ADHOC',
  'OTHER',
];

// ============================================================================
// InterfaceType options for dropdown
// ============================================================================

export const interfaceTypeOptions: InterfaceType[] = [
  'REST_API',
  'GRAPHQL_API',
  'MESSAGE_TOPIC',
  'STREAM',
  'FILE_TRANSFER',
  'SOAP_API',
  'RPC',
  // Internal Processing (Spec 2026-07-24): scheduled jobs / listeners / batch.
  'INTERNAL_PROCESSING',
  'OTHER',
];

// ============================================================================
// Endpoint Options for dropdowns
// ============================================================================

/**
 * EndpointType options for dropdown selection
 * Maps enum values to human-readable labels
 */
export const endpointTypeOptions: Array<{ value: EndpointType; label: string }> = [
  { value: EndpointType.HTTP_REST, label: 'HTTP REST' },
  { value: EndpointType.MESSAGE_QUEUE, label: 'Message Queue' },
  { value: EndpointType.MESSAGE_TOPIC, label: 'Message Topic' },
  { value: EndpointType.FILE_TRANSFER, label: 'File Transfer' },
  { value: EndpointType.INTERNAL_PROCESS, label: 'Internal Process' },
  { value: EndpointType.OTHER, label: 'Other' },
];

/**
 * EndpointDirection options for dropdown selection
 * Maps enum values to human-readable labels
 */
export const endpointDirectionOptions: Array<{ value: EndpointDirection; label: string }> = [
  { value: EndpointDirection.INBOUND, label: 'Inbound' },
  { value: EndpointDirection.OUTBOUND, label: 'Outbound' },
  { value: EndpointDirection.BIDIRECTIONAL, label: 'Bidirectional' },
];

/**
 * EndpointLifecycleStatus options for dropdown selection
 * Maps enum values to human-readable labels
 */
export const endpointLifecycleStatusOptions: Array<{ value: EndpointLifecycleStatus; label: string }> = [
  { value: EndpointLifecycleStatus.ACTIVE, label: 'Active' },
  { value: EndpointLifecycleStatus.DEPRECATED, label: 'Deprecated' },
  { value: EndpointLifecycleStatus.PLANNED, label: 'Planned' },
  { value: EndpointLifecycleStatus.RETIRED, label: 'Retired' },
];

// ============================================================================
// Event Entity Options for dropdowns (Behavioural Architecture Domain)
// ============================================================================

/**
 * Source reference kind options for Event entity.
 * Indicates what type of entity can be the source of an event.
 */
export const sourceRefKindOptions: string[] = [
  '',
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'InterfaceEndpoint',
  'Class',
];

/**
 * Payload reference kind options for Event entity.
 * Indicates what type of entity can be the payload of an event.
 * Currently only LogicalEntity is supported.
 */
export const payloadRefKindOptions: string[] = [
  '',
  'LogicalEntity',
];

/**
 * Payload primitive type options for Event entity.
 * Alternative to a LogicalEntity payload - use a primitive type instead.
 */
export const payloadPrimitiveTypeOptions: string[] = [
  '',
  'string',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'uuid',
];

// ============================================================================
// State and StateTransition Options for dropdowns (Behavioural Architecture Domain)
// ============================================================================

/**
 * StateKind options for State entity dropdown.
 * Indicates the type of state in a state machine.
 */
export const stateKindOptions: StateKind[] = [
  'Initial',
  'Normal',
  'Final',
];

/**
 * TriggerRefKind options for StateTransition entity dropdown.
 * Indicates what triggers a state transition.
 */
export const triggerRefKindOptions: Array<{ value: TriggerRefKind | ''; label: string }> = [
  { value: '', label: '' },
  { value: 'Event', label: 'Event' },
  { value: 'Method', label: 'Method' },
];

/**
 * GuardRefKind options for StateTransition entity dropdown.
 * Indicates what guards a state transition.
 */
export const guardRefKindOptions: Array<{ value: GuardRefKind | ''; label: string }> = [
  { value: '', label: '' },
  { value: 'Method', label: 'Method' },
];

/**
 * EffectRefKind options for StateTransition entity dropdown.
 * Indicates what effect is executed during a transition.
 */
export const effectRefKindOptions: Array<{ value: EffectRefKind | ''; label: string }> = [
  { value: '', label: '' },
  { value: 'Method', label: 'Method' },
];

// ============================================================================
// Activity Diagram Options for dropdowns (Behavioural Architecture Domain)
// ============================================================================

/**
 * ActivityKind options for Activity entity dropdown.
 * Indicates the type of activity node in an activity diagram.
 */
export const activityKindOptions: ActivityKind[] = [
  'Initial',
  'Action',
  'Decision',
  'Merge',
  'Final',
];

/**
 * ActivityFlowKind options for ActivityFlow entity dropdown.
 * Indicates the type of flow between activities.
 */
export const activityFlowKindOptions: ActivityFlowKind[] = [
  'Control',
  'Data',
];

/**
 * ActivityPartitionRefKind options for ActivityPartition entity dropdown.
 * Indicates what type of entity a partition references.
 */
export const activityPartitionRefKindOptions: ActivityPartitionRefKind[] = [
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'Class',
];


// ============================================================================
// Activity Diagram Defaults
// Default styling for Activity Diagram nodes, partitions, and flows
// Task Group 1: Activity Diagram Visualisation v1
// ============================================================================

/**
 * ActivityNodeShape type - indicates the shape of an activity node
 * Used by ACTIVITY_NODE_DEFAULTS to define visual representation
 */
export type ActivityNodeShape = 'circle' | 'roundedRectangle' | 'diamond' | 'bullseye';

/**
 * Activity Node Default configuration interface
 * Defines the visual styling for each ActivityKind
 */
export interface ActivityNodeDefaultConfig {
  shape: ActivityNodeShape;
  fill: string;
  stroke: string;
  stroke_width: number;
  showLabel: boolean;
  // Dimension fields - diameter for circles/bullseye, width/height for rectangles/diamonds
  diameter?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  innerDiameter?: number; // For bullseye shape
}

/**
 * ACTIVITY_NODE_DEFAULTS - default styling for all 5 ActivityKind types
 *
 * Visual specifications from spec:
 * - Initial: Solid filled black circle, diameter ~18px, no label
 * - Action: Rounded rectangle (~140x50px), moderate corner radius (pill-like), label centered, green theme
 * - Decision: Diamond shape (~60x60px), optional label centered or above
 * - Merge: Diamond shape (~20x20px), significantly smaller than Decision, no label by default
 * - Final: Bullseye shape (outer circle stroke + inner filled circle), diameter ~22px, no label
 */
export const ACTIVITY_NODE_DEFAULTS: Record<ActivityKind, ActivityNodeDefaultConfig> = {
  // Initial: Solid filled black circle, diameter 18px, no label
  Initial: {
    shape: 'circle',
    fill: '#000000',
    stroke: '#000000',
    stroke_width: 2,
    showLabel: false,
    diameter: 18,
  },

  // Action: Rounded rectangle 140x50px, green theme from entityColors.ACTIVITY
  Action: {
    shape: 'roundedRectangle',
    fill: entityColors.ACTIVITY.background, // '#E8F5E9' - Light green
    stroke: entityColors.ACTIVITY.border,   // '#66BB6A' - Medium green
    stroke_width: 2,
    showLabel: true,
    width: 140,
    height: 50,
    cornerRadius: 25, // Pill-like appearance
  },

  // Decision: Diamond 60x60px, optional label, neutral black/white
  Decision: {
    shape: 'diamond',
    fill: '#FFFFFF',
    stroke: '#000000',
    stroke_width: 2,
    showLabel: true,
    width: 60,
    height: 60,
  },

  // Merge: Diamond 20x20px, no label, neutral black/white
  Merge: {
    shape: 'diamond',
    fill: '#FFFFFF',
    stroke: '#000000',
    stroke_width: 2,
    showLabel: false,
    width: 20,
    height: 20,
  },

  // Final: Bullseye 22px diameter, neutral black/white
  Final: {
    shape: 'bullseye',
    fill: '#000000',      // Inner circle fill
    stroke: '#000000',    // Outer circle stroke
    stroke_width: 2,
    showLabel: false,
    diameter: 22,
    innerDiameter: 14,    // Inner filled circle diameter
  },
};

/**
 * Activity Partition Default configuration interface
 * Defines the visual styling for swimlane partitions
 */
export interface ActivityPartitionDefaultConfig {
  header_height: number;
  header_background: string;
  body_background: string;
  border_color: string;
  border_width: number;
  divider_style: 'solid' | 'dashed' | 'dotted';
  default_width: number;
  min_width: number;
  orientation: ActivityDiagramOrientation;
}

/**
 * ACTIVITY_PARTITION_DEFAULTS - default styling for activity partitions (swimlanes)
 *
 * Visual specifications from spec:
 * - header_height: 30px
 * - header_background: slightly darker than body
 * - body_background: light fill matching entityColors.ACTIVITY_PARTITION
 * - orientation: VERTICAL as default
 */
export const ACTIVITY_PARTITION_DEFAULTS: ActivityPartitionDefaultConfig = {
  header_height: 30,
  header_background: '#E1BEE7', // Slightly darker purple for header
  body_background: entityColors.ACTIVITY_PARTITION.background, // '#F3E5F5' - Light purple
  border_color: entityColors.ACTIVITY_PARTITION.border, // '#AB47BC' - Medium purple
  border_width: 2,
  divider_style: 'solid',
  default_width: 200,
  min_width: 150,
  orientation: 'VERTICAL',
};

/**
 * Activity Flow Default configuration interface
 * Defines the visual styling for activity flow edges
 */
export interface ActivityFlowDefaultConfig {
  line_color: string;
  line_width: number;
  arrow_size: number;
  label_font_size: number;
  label_offset: number;
  flowKind: ActivityFlowKind;
}

/**
 * ACTIVITY_FLOW_DEFAULTS - default styling for activity flow edges
 *
 * Visual specifications:
 * - Control flow: solid lines with arrow
 * - Data flow: dashed lines (handled by flowKind)
 * - Default flowKind: 'Control'
 */
export const ACTIVITY_FLOW_DEFAULTS: ActivityFlowDefaultConfig = {
  line_color: entityColors.ACTIVITY_FLOW.border, // '#42A5F5' - Blue
  line_width: 2,
  arrow_size: 8,
  label_font_size: 11,
  label_offset: 5,
  flowKind: 'Control',
};

// ============================================================================
// State Diagram Defaults
// Default styling for State Diagram nodes
// Task Group 1: State Diagram Visualisation v1
// ============================================================================

/**
 * StateNodeShape type - indicates the shape of a state node
 * Used by STATE_NODE_DEFAULTS to define visual representation
 * Following ActivityNodeShape pattern
 */
export type StateNodeShape = 'circle' | 'roundedRectangle' | 'bullseye';

/**
 * State Node Default configuration interface
 * Defines the visual styling for each StateKind
 * Following ActivityNodeDefaultConfig interface structure
 */
export interface StateNodeDefaultConfig {
  shape: StateNodeShape;
  fill: string;
  stroke: string;
  stroke_width: number;
  showLabel: boolean;
  // Dimension fields - diameter for circles/bullseye, width/height for rectangles
  diameter?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  innerDiameter?: number; // For bullseye shape
}

/**
 * STATE_NODE_DEFAULTS - default styling for all 3 StateKind types
 *
 * Visual specifications from spec:
 * - Initial: Solid filled black circle, diameter ~18px, no label (matches Activity Initial)
 * - Normal: Rounded rectangle (~140x50px), moderate corner radius, label centered (matches Activity Action)
 * - Final: Bullseye shape (outer stroke circle + inner filled circle), diameter ~22px, no label (matches Activity Final)
 *
 * Colour scheme:
 * - Normal state nodes use entityColors.STATE (light green background, green border)
 * - Initial and Final states use neutral black fill/stroke matching Activity control nodes
 */
export const STATE_NODE_DEFAULTS: Record<StateKind, StateNodeDefaultConfig> = {
  // Initial: Solid filled black circle, diameter 18px, no label
  Initial: {
    shape: 'circle',
    fill: '#000000',
    stroke: '#000000',
    stroke_width: 2,
    showLabel: false,
    diameter: 18,
  },

  // Normal: Rounded rectangle 140x50px, green theme from entityColors.STATE
  Normal: {
    shape: 'roundedRectangle',
    fill: entityColors.STATE.background, // '#E8F5E9' - Light green
    stroke: entityColors.STATE.border,   // '#4CAF50' - Green
    stroke_width: 2,
    showLabel: true,
    width: 140,
    height: 50,
    cornerRadius: 8, // Moderate corner radius (different from Activity Action pill-like)
  },

  // Final: Bullseye 22px diameter, neutral black
  Final: {
    shape: 'bullseye',
    fill: '#000000',      // Inner circle fill
    stroke: '#000000',    // Outer circle stroke
    stroke_width: 2,
    showLabel: false,
    diameter: 22,
    innerDiameter: 14,    // Inner filled circle diameter
  },
};

export const relationshipColors: Record<string, string> = {
  // Business Point relationship types
  business_user_business_points: '#616161',      // Gray - business domain relationships
  application_point_business_points: '#616161',  // Gray - business domain relationships
  application_point_business_logics: '#C2185B',  // Pink - business logic relationships
  // Other relationship types
  logical_data_entity_relationships: '#F57C00',
  logical_data_entity_physical_data_entities: '#F57C00',
  logical_data_attribute_physical_data_attributes: '#F57C00',
  data_movements: '#1976D2',
  interface_logical_entities: '#5C6BC0',
  // Spec 2026-01-02: UI Architecture relationships
  ui_workflow_transitions: '#5C6BC0', // Indigo - UI workflow transitions
  // Spec 2026-05-05: Infrastructure Domain Diagram Support
  // - resource_subnet_hostings is containment-only (no edge drawn) - placeholder for symmetry only
  // - deployment_unit_compute_resources uses a neutral grey-purple consistent with DEPLOYMENT_UNIT entity colour
  // - load_balancer_resource_routes uses a green consistent with LOAD_BALANCER entity colour
  resource_subnet_hostings: '#0277BD', // Subnet blue - never looked up at edge-draw time
  deployment_unit_compute_resources: '#5E35B1', // Purple - matches DEPLOYMENT_UNIT family
  load_balancer_resource_routes: '#2E7D32', // Green - matches LOAD_BALANCER family
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 distinct stroke colours
  // per Q9. Chosen to be visually distinct from each other and from spec 5 Infra-internal edges.
  application_compute_deployments: '#00838F',         // Teal - bridges Application and COMPUTE_RESOURCE
  data_entity_data_store_hostings: '#AD1457',         // Magenta - bridges Data and DATA_STORE_INSTANCE
  application_infrastructure_resource_uses: '#EF6C00', // Orange - bridges Application and INFRA_RESOURCE
  application_load_balancer_exposures: '#558B2F',     // Olive - bridges Application and LOAD_BALANCER (distinct from spec 5 LB green)
};

export const appTypeOptions = ['Web', 'Batch', 'API', 'Desktop', 'Mobile'];
export const statusOptions = ['Active', 'Deprecated', 'Planned', 'Retired'];
export const serviceTypeOptions = ['REST', 'SOAP', 'gRPC', 'GraphQL', 'Message'];
export const pointTypeOptions = ['UI', 'File Drop', 'Queue', 'Email', 'API'];
export const physicalTypeOptions = ['Table', 'View', 'Collection', 'File', 'Queue'];

// ============================================================================
// Tech Type Options for Application Component dropdown
// Spec: Sequence Diagram Participant Colour and Icons
// ============================================================================

/**
 * Tech Type options for Application Component dropdown.
 * Used to classify components by their technology tier for sequence diagram styling.
 */
export const techTypeOptions = ['UI Tier', 'Service Tier', 'Persistence Tier', 'Other'];

// ============================================================================
// ApplicationPoint Target Type Options
// Spec: Expand Application Points to Reference Service/Class/Method
// ============================================================================

/**
 * ApplicationPointTargetType options for dropdown selection.
 * Indicates what type of entity an Application Point targets.
 * Values: SERVICE, CLASS, METHOD
 */
export const applicationPointTargetTypeOptions: ApplicationPointTargetType[] = [
  ApplicationPointTargetType.SERVICE,
  ApplicationPointTargetType.CLASS,
  ApplicationPointTargetType.METHOD,
];

// ============================================================================
// BusinessLogic type options for dropdown
// Type of business logic (e.g., "Validation", "Calculation", "Transformation", "Rule")
// ============================================================================

export const businessLogicTypeOptions: string[] = [
  'Validation',
  'Calculation',
  'Transformation',
  'Rule',
  'Constraint',
  'Policy',
  'Workflow',
  'Other',
];

// ============================================================================
// UI Architecture Domain Options for dropdowns
// Spec 2026-01-03: Meta-Model UI Domain Tab - UI Components and Actions
// ============================================================================

/**
 * UIComponent type options for dropdown selection.
 * Indicates the type of UI component.
 */
export const uiComponentTypeOptions: string[] = [
  'Button',
  'Form',
  'Modal',
  'Table',
  'Card',
  'Navigation',
  'Input',
  'Other',
];

/**
 * UIAction trigger type options for dropdown selection.
 * Indicates what event triggers the action.
 */
export const uiActionTriggerTypeOptions: string[] = [
  'Click',
  'Submit',
  'Change',
  'Focus',
  'Blur',
  'Load',
  'Unload',
  'Other',
];

/**
 * UIAction owner type options for dropdown selection.
 * Indicates what type of entity owns the action.
 */
export const uiActionOwnerTypeOptions: string[] = [
  'Screen',
  'Component',
  'Other',
];

/**
 * UIAction effect type options for dropdown selection.
 * Indicates what effect the action has.
 */
export const uiActionEffectTypeOptions: string[] = [
  'Navigate',
  'Submit',
  'Validate',
  'Update',
  'Delete',
  'Open',
  'Close',
  'Other',
];

// ============================================================================
// UICharacteristic Type Options for dropdown
// Spec 2026-01-20: UI Characteristics Entity
// Type of UI characteristic (business_feature, ui_capability, interaction_complexity, technical_shape)
// ============================================================================

/**
 * UICharacteristicType options for dropdown selection.
 * Indicates the type of UI characteristic.
 *
 * Spec 2026-01-20: UI Characteristics Entity
 */
export const uiCharacteristicTypeOptions: Array<{ value: UICharacteristicType; label: string }> = [
  { value: 'business_feature', label: 'Business Feature' },
  { value: 'ui_capability', label: 'UI Capability' },
  { value: 'interaction_complexity', label: 'Interaction Complexity' },
  { value: 'technical_shape', label: 'Technical Shape' },
];

// ============================================================================
// Data Type Options for Logical and Physical Attributes
// ============================================================================

/**
 * OAS (OpenAPI) primitive types for Logical Attributes.
 * Format: type or type_format (e.g., string_uuid = { type: "string", format: "uuid" })
 * These types align with API schema definitions for logical data modeling.
 */
export const OAS_DATA_TYPE_OPTIONS = Object.freeze([
  // String types
  'string',
  'string_uuid',
  'string_date',
  'string_date-time',
  'string_password',
  'string_byte',
  'string_binary',
  // Number types
  'number',
  'number_float',
  'number_double',
  // Integer types
  'integer',
  'integer_int32',
  'integer_int64',
  // Boolean
  'boolean',
  // Complex types
  'array',
  'object',
] as const);

/**
 * SQL primitive types for Physical Attributes.
 * These types align with database schema definitions for physical data modeling.
 * Retained for Physical Attributes while Logical Attributes use OAS types.
 */
export const SQL_DATA_TYPE_OPTIONS = Object.freeze([
  'VARCHAR',
  'CHAR',
  'TEXT',
  'INTEGER',
  'BIGINT',
  'DECIMAL',
  'NUMERIC',
  'FLOAT',
  'DOUBLE',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'BINARY',
  'BLOB',
  'JSON',
] as const);

/**
 * @deprecated Use OAS_DATA_TYPE_OPTIONS for Logical Attributes or SQL_DATA_TYPE_OPTIONS for Physical Attributes.
 * Kept for backward compatibility - now points to SQL_DATA_TYPE_OPTIONS.
 */
export const dataTypeOptions = SQL_DATA_TYPE_OPTIONS;

export const movementTypeOptions = ['Batch', 'Real-time', 'On-demand', 'Scheduled'];

/**
 * @deprecated Use cardinalityOptions instead.
 * Kept for backward compatibility - old lowercase format values.
 * The new cardinalityOptions uses SCREAMING_SNAKE_CASE enum values matching the backend.
 */
export const relationshipTypeOptions = ['one-to-one', 'one-to-many', 'many-to-many'];

// ============================================================================
// Logical ER Relationship Options for dropdowns
// Used by LogicalDataEntityRelationship for UML-style relationship semantics
// ============================================================================

/**
 * Cardinality options for LogicalDataEntityRelationship.
 * Replaces the old relationshipTypeOptions with SCREAMING_SNAKE_CASE enum values.
 * Values: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
 */
export const cardinalityOptions: LogicalERCardinality[] = [
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_ONE',
  'MANY_TO_MANY',
];

/**
 * Relationship type options for LogicalDataEntityRelationship.
 * UML-style relationship semantics.
 * Values: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
 */
export const logicalERRelationshipOptions: LogicalERRelationship[] = [
  'GENERALIZATION',
  'REALIZATION',
  'COMPOSITION',
  'AGGREGATION',
  'ASSOCIATION',
  'DEPENDENCY',
];

/**
 * Endpoint kind options for LogicalDataEntityRelationship polymorphic endpoints.
 * Indicates whether the endpoint references a LogicalDataEntity or PhysicalDataEntity.
 * Values: LOGICAL_ENTITY, PHYSICAL_ENTITY
 */
export const logicalEREndpointKindOptions: LogicalEREndpointKind[] = [
  'LOGICAL_ENTITY',
  'PHYSICAL_ENTITY',
];

// ============================================================================
// User Journey Link Relationship Type Options for dropdown
// Spec: User Journey Links Meta-Model Foundation
// ============================================================================

/**
 * UserJourneyLinkRelationshipType options for dropdown selection.
 * Indicates the type of directed relationship between two User Journeys.
 */
export const userJourneyLinkTypeOptions: UserJourneyLinkRelationshipType[] = [
  'RELATES_TO',
  'PRECEDES',
  'DEPENDS_ON',
  'OPTIONALLY_LEADS_TO',
  'TRIGGERS',
];

// ============================================================================
// Infrastructure Domain Picklist Options
// Spec 2026-05-04: Infrastructure Domain Tables UI
//
// 23 plain string[] option arrays covering every Infrastructure picklist enum.
// Values mirror spec 1's documented enum lists verbatim (uppercase snake_case
// constants); UI labels are derived at render time via
// formatOptionLabel: snakeCaseToTitleCase.
//
// Reused arrays:
// - lifecycleStateOptions: environments.lifecycle_state, compute_resources.lifecycle_state
// - criticalityOptions: environments.criticality, infrastructure_resources.criticality
// - exposureOptions: load_balancers.exposure, listeners.exposure
// - protocolOptions: listeners.protocol, load_balancer_resource_routes.protocol
// ============================================================================

export const environmentTypeOptions: string[] = ['DEV', 'TEST', 'STAGING', 'PROD', 'DR', 'CURRENT_STATE', 'TARGET_STATE', 'OTHER'];
export const lifecycleStateOptions: string[] = ['PLANNED', 'ACTIVE', 'DEPRECATED', 'RETIRED'];
export const criticalityOptions: string[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const providerOptions: string[] = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'OTHER'];
export const locationTypeOptions: string[] = ['CLOUD_REGION', 'CLOUD_ZONE', 'DATA_CENTRE', 'OFFICE', 'EDGE_SITE', 'OTHER'];
export const networkTypeOptions: string[] = ['VPC', 'VNET', 'ON_PREM_NETWORK', 'LAN', 'WAN', 'OTHER'];
export const routingModeOptions: string[] = ['REGIONAL', 'GLOBAL', 'STATIC', 'DYNAMIC', 'OTHER'];
export const subnetTypeOptions: string[] = ['PUBLIC', 'PRIVATE', 'APP', 'DATA', 'MANAGEMENT', 'DMZ', 'OTHER'];
export const subnetVisibilityOptions: string[] = ['PUBLIC', 'PRIVATE', 'ISOLATED', 'INTERNAL', 'OTHER'];
export const platformTypeOptions: string[] = ['GKE', 'KUBERNETES', 'CLOUD_RUN', 'VMWARE', 'OPENSHIFT', 'SERVER_FARM', 'OTHER'];
export const operatingModelOptions: string[] = ['MANAGED', 'SELF_MANAGED', 'HYBRID', 'OTHER'];
export const computeTypeOptions: string[] = ['VM', 'PHYSICAL_SERVER', 'CONTAINER_SERVICE', 'KUBERNETES_WORKLOAD', 'SERVERLESS_FUNCTION', 'CLOUD_RUN_SERVICE', 'BATCH_JOB', 'OTHER'];
export const deploymentUnitTypeOptions: string[] = ['CONTAINER_IMAGE', 'VM_IMAGE', 'FUNCTION_BUNDLE', 'JAR', 'WAR', 'STATIC_BUNDLE', 'PACKAGE', 'OTHER'];
export const loadBalancerTypeOptions: string[] = ['EXTERNAL_HTTP', 'EXTERNAL_HTTPS', 'INTERNAL_HTTP', 'INTERNAL_TCP', 'INGRESS_CONTROLLER', 'F5', 'NGINX', 'API_GATEWAY', 'OTHER'];
export const exposureOptions: string[] = ['PUBLIC', 'PRIVATE', 'INTERNAL', 'OTHER'];
export const protocolOptions: string[] = ['HTTP', 'HTTPS', 'TCP', 'UDP', 'TLS', 'GRPC', 'OTHER'];
export const dataStoreTypeOptions: string[] = ['RELATIONAL_DB', 'DOCUMENT_DB', 'KEY_VALUE', 'CACHE', 'DATA_WAREHOUSE', 'OBJECT_STORAGE_AS_DATASTORE', 'OTHER'];
export const engineOptions: string[] = ['POSTGRES', 'MYSQL', 'ORACLE', 'SQLSERVER', 'BIGQUERY', 'REDIS', 'MONGODB', 'OTHER'];
export const resourceTypeOptions: string[] = ['OBJECT_BUCKET', 'MESSAGE_TOPIC', 'MESSAGE_QUEUE', 'CACHE', 'SECRET_STORE', 'SCHEDULER', 'EVENT_BUS', 'CDN', 'REGISTRY', 'OTHER'];
export const infrastructurePointKindOptions: string[] = ['ENVIRONMENT', 'CLOUD_ACCOUNT', 'LOCATION', 'NETWORK', 'SUBNET', 'COMPUTE_CLUSTER', 'COMPUTE_RESOURCE', 'DEPLOYMENT_UNIT', 'LOAD_BALANCER', 'LISTENER', 'DATA_STORE_INSTANCE', 'INFRASTRUCTURE_RESOURCE'];
export const relationshipRoleOptions: string[] = ['PRIMARY_PLACEMENT', 'PRIVATE_CONNECTIVITY', 'BACKEND_PLACEMENT', 'OTHER'];
export const deploymentStatusOptions: string[] = ['PLANNED', 'DEPLOYED', 'DEPRECATED', 'FAILED', 'UNKNOWN'];
export const routingTypeOptions: string[] = ['DEFAULT', 'HOST_BASED', 'PATH_BASED', 'WEIGHTED', 'FAILOVER', 'OTHER'];

// ============================================================================
// Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new picklist arrays
// (exposureOptions and protocolOptions are reused from spec 4 - do NOT redeclare)
//
// - deploymentRoleOptions: application_compute_deployments.deployment_role
// - hostingRoleOptions: data_entity_data_store_hostings.hosting_role
// - dependencyTypeOptions: application_infrastructure_resource_uses.dependency_type
// - accessModeOptions: application_infrastructure_resource_uses.access_mode
// ============================================================================
export const deploymentRoleOptions: string[] = ['PRIMARY', 'SECONDARY', 'WORKER', 'BATCH', 'ADMIN', 'OTHER'];
export const hostingRoleOptions: string[] = ['PRIMARY', 'REPLICA', 'CACHE', 'ARCHIVE', 'ANALYTICS', 'OTHER'];
export const dependencyTypeOptions: string[] = ['READS_FROM', 'WRITES_TO', 'PUBLISHES_TO', 'SUBSCRIBES_TO', 'USES', 'STORES_IN', 'RETRIEVES_FROM', 'OTHER'];
export const accessModeOptions: string[] = ['READ', 'WRITE', 'READ_WRITE', 'EXECUTE', 'ADMIN', 'OTHER'];


// ============================================================================
// Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 new picklist arrays
//
// Provenance enums (used on 12 entities + 3 Infra-internal relationships;
// UI display deferred per Q4 - data round-trips through save/load only):
// - sourceOriginOptions
// - generationStatusOptions
//
// IaC Source enums:
// - iacSourceTypeOptions
// - repositoryProviderOptions
// - iacSourceProviderOptions (separate from existing providerOptions per Q6 - includes MULTI)
//
// IaC Resource Binding enum:
// - bindingStatusOptions
// ============================================================================
export const sourceOriginOptions: string[] = ['MANUAL', 'DISCOVERED', 'IMPORTED', 'GENERATED', 'SUGGESTED', 'OTHER'];
export const generationStatusOptions: string[] = ['NOT_READY', 'READY', 'GENERATED', 'BLOCKED', 'NOT_APPLICABLE', 'UNKNOWN'];
export const iacSourceTypeOptions: string[] = ['TERRAFORM', 'OPENTOFU', 'CLOUDFORMATION', 'BICEP', 'PULUMI', 'KUBERNETES', 'HELM', 'OTHER'];
export const repositoryProviderOptions: string[] = ['GITHUB', 'GITLAB', 'BITBUCKET', 'AZURE_DEVOPS', 'OTHER'];
export const iacSourceProviderOptions: string[] = ['GCP', 'AWS', 'AZURE', 'ON_PREM', 'MULTI', 'OTHER'];
export const bindingStatusOptions: string[] = ['PLANNED', 'SUGGESTED', 'CONFIRMED', 'STALE', 'REMOVED', 'UNKNOWN'];

// ============================================================================
// Spec 2026-05-06: Library Frontend Types & Tables - 2 new picklist arrays
//
// Reused arrays (do NOT redeclare):
// - sourceOriginOptions (line 1317): libraries.source_origin
// - generationStatusOptions (line 1318): libraries.generation_status
// ============================================================================
export const ecosystemOptions: string[] = ['MAVEN', 'NPM', 'PYPI', 'NUGET', 'GO', 'OTHER'];
export const dependencyScopeOptions: string[] = ['COMPILE', 'RUNTIME', 'TEST', 'PROVIDED', 'OPTIONAL', 'DEV', 'PEER'];

export const emptyModel: ArchitectureModel = {
  metaModel: {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],  // Business Point super-entity (derived from Business Processes and Process Activities)
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],  // Interaction entities for user interactions with App_Business_Points
      app_business_points: [],
      events: [],  // Behavioural domain: Events entities (auto-created from source entities)
      states: [],  // Behavioural domain: State entities
      state_transitions: [],  // Behavioural domain: StateTransition entities
      activities: [],  // Behavioural domain: Activity entities
      activity_flows: [],  // Behavioural domain: ActivityFlow entities
      activity_partitions: [],  // Behavioural domain: ActivityPartition entities
      business_logics: [],  // Behavioural domain: BusinessLogic entities
      ui_screens: [],  // Spec 2026-01-02: UI Architecture - UI Screen entities
      ui_components: [],  // Spec 2026-01-03: Meta-Model UI Domain Tab - UI Component entities
      ui_actions: [],  // Spec 2026-01-03: Meta-Model UI Domain Tab - UI Action entities
      ui_characteristics: [],  // Spec 2026-01-20: UI Architecture - UI Characteristic entities
      package_sets: [],  // Package Sets for service design
      packages: [],  // Packages within Package Sets
      user_journeys: [],  // Business domain: User Journeys
      activity_steps: [],  // Business domain: Activity Steps
      // Spec 2026-05-04: Infrastructure Domain Frontend Types - 13 entity collections
      environments: [],
      cloud_accounts: [],
      locations: [],
      networks: [],
      subnets: [],
      compute_clusters: [],
      compute_resources: [],
      deployment_units: [],
      load_balancers: [],
      listeners: [],
      data_store_instances: [],
      infrastructure_resources: [],
      infrastructure_points: [],  // Polymorphic anchor for infrastructure relationships
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 1 new entity collection
      iac_sources: [],
      // Spec 2026-05-06: Library Frontend Types & Tables - Application domain Library entity
      libraries: [],
    },
    relationships: {
      // Business Point relationship types
      business_user_business_points: [],      // User <-> Business Point relationships
      application_point_business_points: [],  // App Point <-> Business Point relationships
      application_point_business_logics: [],  // App Point <-> Business Logic relationships
      // Other relationship types
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],  // Spec 2026-01-02: UI Architecture - UI Workflow Transition relationships
      user_journey_links: [],  // Business domain: User Journey Link relationships
      // Spec 2026-05-04: Infrastructure Domain Frontend Types - 3 relationship collections
      resource_subnet_hostings: [],
      deployment_unit_compute_resources: [],
      load_balancer_resource_routes: [],
      // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship collections
      application_compute_deployments: [],
      data_entity_data_store_hostings: [],
      application_infrastructure_resource_uses: [],
      application_load_balancer_exposures: [],
      // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 1 new relationship collection
      iac_resource_bindings: [],
      // Spec 2026-05-06: Library Frontend Types & Tables - Library Dependency relationship
      code_unit_dependencies: [],
      // Spec 2026-05-29: Endpoint->Data-Effect Call Graph for Discovery
      endpoint_data_effects: [],
    },
  },
  diagrams: [],
};
