/**
 * TypedContent Type Definitions
 *
 * Defines the envelope structure and content types for typed diagrams.
 * The typedContent field on Diagram stores type-specific content for
 * Sequence, ER, Activity, State, UI_SCREEN, USER_JOURNEY, and USER_JOURNEY_OVERVIEW diagrams.
 *
 * Backend stores this in diagrams.typed_content_json (JSONB column).
 */

import type {
  UserJourneyDiagramJourneyDto,
  UserJourneyDiagramLaneDto,
  UserJourneyDiagramStepDto,
  UserJourneyDiagramEdgeDto,
  UserJourneyDiagramRenderHintsDto,
} from './userJourneyDiagram';

import type {
  UserJourneyOverviewHeaderDto,
  UserJourneyOverviewLaneDto,
  UserJourneyOverviewNodeDto,
  UserJourneyOverviewEdgeDto,
  UserJourneyOverviewRenderHintsDto,
} from './userJourneyOverviewDiagram';

// ============================================================================
// Diagram Type Constants
// ============================================================================

/**
 * DiagramTypedContentType - the diagram types that have typed content.
 * General diagrams do NOT have typed content (typedContent is undefined).
 */
export type DiagramTypedContentType = 'Sequence' | 'ER' | 'Activity' | 'State' | 'UI_SCREEN' | 'USER_JOURNEY' | 'USER_JOURNEY_OVERVIEW';

/**
 * Array of all typed diagram types for validation
 */
export const TYPED_DIAGRAM_TYPES: DiagramTypedContentType[] = [
  'Sequence',
  'ER',
  'Activity',
  'State',
  'UI_SCREEN',
  'USER_JOURNEY',
  'USER_JOURNEY_OVERVIEW',
];

/**
 * Type guard for DiagramTypedContentType
 */
export function isDiagramTypedContentType(value: string): value is DiagramTypedContentType {
  return TYPED_DIAGRAM_TYPES.includes(value as DiagramTypedContentType);
}

// ============================================================================
// TypedContent Envelope
// ============================================================================

/**
 * TypedContentEnvelope - the envelope structure for typed diagram content.
 *
 * This structure wraps the type-specific content with metadata:
 * - type: Must match the diagram's diagram_type field
 * - version: Schema version for future evolution (1 for most types, 2 for USER_JOURNEY with sync)
 * - content: Type-specific payload
 *
 * Example:
 * ```json
 * {
 *   "type": "Sequence",
 *   "version": 1,
 *   "content": {
 *     "participants": [...],
 *     "messages": [...],
 *     ...
 *   }
 * }
 * ```
 */
export interface TypedContentEnvelope {
  /** Type of diagram - must match diagram.diagram_type */
  type: DiagramTypedContentType;
  /** Schema version for future evolution (1 for most types, 2 for USER_JOURNEY with sync) */
  version: number;
  /** Type-specific content payload */
  content: SequenceContent | ERContent | ActivityContent | StateContent | UIScreenContent | UserJourneyContent | UserJourneyOverviewContent;
}

// ============================================================================
// Sequence Diagram Content
// ============================================================================

/**
 * SequenceContent - type-specific content for Sequence diagrams.
 *
 * Matches the backend SequenceDiagram DTO structure with snake_case JSON fields.
 * Contains participants (lifelines), messages, fragments, operands, and sequence nodes.
 */
export interface SequenceContent {
  /** List of participants (lifelines), ordered by order_index */
  participants: SequenceParticipantRef[];
  /** List of messages between participants */
  messages: SequenceMessageRef[];
  /** List of control flow fragments (Loop, Optional, Alternative) */
  fragments: SequenceFragmentRef[];
  /** List of operands for fragments (especially for Alternative) */
  operands: SequenceOperandRef[];
  /** List of ordering nodes defining the diagram structure */
  sequenceNodes: SequenceNodeRef[];
}

/**
 * SequenceParticipantRef - reference to a participant in a sequence diagram.
 */
export interface SequenceParticipantRef {
  id: string;
  ref_kind: string;
  ref_id: string;
  order_index: number;
}

/**
 * SequenceMessageRef - reference to a message in a sequence diagram.
 */
export interface SequenceMessageRef {
  id: string;
  exchange_id: string;
  exchange_role: string;
  from_participant_id: string;
  to_participant_id: string;
  ref_kind?: string;
  ref_id?: string;
  label_text?: string;
  /** Indicates whether the referenced entity represents a collection (optional, defaults to false if missing) */
  is_collection?: boolean;
  /** Whether to show the endpoint name in the message label (InterfaceEndpoint only) */
  show_endpoint_name?: boolean;
  /** Whether to show the endpoint verb and path in the message label (InterfaceEndpoint only) */
  show_endpoint_verb_path?: boolean;
  /** Whether to show the endpoint request/response data entity in the message label (InterfaceEndpoint only) */
  show_endpoint_req_res_data?: boolean;
  /** Response mode: 'normal' or 'endpoint_response' (InterfaceEndpoint only) */
  response_mode?: string;
}

/**
 * SequenceFragmentRef - reference to a fragment in a sequence diagram.
 */
export interface SequenceFragmentRef {
  id: string;
  fragment_kind: string;
  label_text?: string;
}

/**
 * SequenceOperandRef - reference to an operand in a sequence diagram.
 */
export interface SequenceOperandRef {
  id: string;
  fragment_id: string;
  guard_expression: string;
  operand_index: number;
}

/**
 * SequenceNodeRef - reference to an ordering node in a sequence diagram.
 */
export interface SequenceNodeRef {
  id: string;
  node_kind: string;
  message_id?: string;
  fragment_id?: string;
  order_index: number;
  parent_node_id?: string;
  parent_operand_id?: string;
}

// ============================================================================
// ER Diagram Content
// ============================================================================

/**
 * ERContent - type-specific content for ER diagrams.
 *
 * Contains references to entities and relationships for ER diagram rendering.
 * This is a placeholder structure that will be expanded in future increments.
 */
export interface ERContent {
  /** References to entities displayed in the diagram */
  entityRefs: EREntityRef[];
  /** References to relationships between entities */
  relationshipRefs: ERRelationshipRef[];
}

/**
 * EREntityRef - reference to an entity in an ER diagram.
 * Placeholder structure for future implementation.
 */
export interface EREntityRef {
  id: string;
  entity_id: string;
}

/**
 * ERRelationshipRef - reference to a relationship in an ER diagram.
 * Placeholder structure for future implementation.
 */
export interface ERRelationshipRef {
  id: string;
  relationship_id: string;
}

// ============================================================================
// Activity Diagram Content
// ============================================================================

/**
 * ActivityContent - type-specific content for Activity diagrams.
 *
 * Contains partitions (swimlanes) and flows for activity diagram rendering.
 * This is a placeholder structure that will be expanded in future increments.
 */
export interface ActivityContent {
  /** List of partitions (swimlanes) in the activity diagram */
  partitions: ActivityPartitionRef[];
  /** List of flows between activities */
  flows: ActivityFlowRef[];
}

/**
 * ActivityPartitionRef - reference to a partition in an activity diagram.
 * Placeholder structure for future implementation.
 */
export interface ActivityPartitionRef {
  id: string;
  name?: string;
  ref_kind?: string;
  ref_id?: string;
  order_index?: number;
}

/**
 * ActivityFlowRef - reference to a flow in an activity diagram.
 * Placeholder structure for future implementation.
 */
export interface ActivityFlowRef {
  id: string;
  from_activity_id: string;
  to_activity_id: string;
}

// ============================================================================
// State Diagram Content
// ============================================================================

/**
 * StateContent - type-specific content for State diagrams.
 *
 * Contains states and transitions for state diagram rendering.
 * This is a placeholder structure that will be expanded in future increments.
 */
export interface StateContent {
  /** List of states in the state diagram */
  states: StateRef[];
  /** List of transitions between states */
  transitions: StateTransitionRef[];
}

/**
 * StateRef - reference to a state in a state diagram.
 * Placeholder structure for future implementation.
 */
export interface StateRef {
  id: string;
  name: string;
  state_kind?: string;
}

/**
 * StateTransitionRef - reference to a transition in a state diagram.
 * Placeholder structure for future implementation.
 */
export interface StateTransitionRef {
  id: string;
  from_state_id: string;
  to_state_id: string;
}

// ============================================================================
// UI Screen Diagram Content
// ============================================================================

/**
 * UIScreenContent - type-specific content for UI_SCREEN diagrams.
 *
 * Contains a reference to the associated UIScreen entity and lists of
 * component references and action references that define the screen specification.
 */
export interface UIScreenContent {
  /** Reference to the associated UIScreen entity ID */
  screen_id: string | null;
  /** List of component references for the screen */
  components: UIScreenComponentRef[];
  /** List of action references for the screen */
  actions: UIScreenActionRef[];
}

/**
 * UIScreenComponentRef - reference to a component used in a UI screen.
 */
export interface UIScreenComponentRef {
  /** Unique identifier for this component reference */
  id: string;
  /** Reference to the UIComponent entity ID */
  component_id: string;
  /** Optional parent component reference ID (for nested components) */
  parent_ref_id?: string;
  /** Order index for display ordering */
  order_index?: number;
  /** Component-specific configuration/props as JSON */
  props_override?: Record<string, unknown>;
}

/**
 * UIScreenActionRef - reference to an action used in a UI screen.
 */
export interface UIScreenActionRef {
  /** Unique identifier for this action reference */
  id: string;
  /** Reference to the UIAction entity ID */
  action_id: string;
  /** Order index for display ordering */
  order_index?: number;
}

// ============================================================================
// User Journey Sync Metadata
// ============================================================================

/**
 * UserJourneySyncMetadata - sync metadata for v2 USER_JOURNEY diagrams.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 3: TypedContent v2, API Client, and Save Flow
 *
 * Contains source-link metadata enabling drift detection against
 * the authoritative meta-model data.
 */
export interface UserJourneySyncMetadata {
  /** ID of the source USER_JOURNEY entity in the meta-model */
  source_user_journey_id: string;
  /** Project UUID where the source journey resides */
  source_project_id: string;
  /** Model file ID (nullable, enriched by backend) */
  source_model_file_id: string | null;
  /** Projection version used to generate the diagram */
  source_projection_version: string;
  /** ISO-8601 timestamp of last successful sync */
  last_synced_at: string;
  /** SHA-256 hash of the canonical projected diagram */
  last_synced_hash: string;
  /** Current sync status */
  sync_status: 'IN_SYNC' | 'STALE' | 'BROKEN_SOURCE';
  /** Reason for staleness (nullable) */
  stale_reason: string | null;
}

// ============================================================================
// User Journey Diagram Content
// ============================================================================

/**
 * UserJourneyContent - type-specific content for USER_JOURNEY diagrams.
 *
 * Matches the UserJourneyDiagramDto structure from the backend.
 * Contains journey metadata, lanes, steps, edges, and render hints.
 * The UserJourneyDiagramRenderer computes layout deterministically from this data.
 *
 * v2 diagrams include an optional `sync` field with source-link metadata
 * for drift detection and refresh-from-model capability.
 */
export interface UserJourneyContent {
  /** Journey metadata (name, description, user role, parent business process) */
  journey: UserJourneyDiagramJourneyDto;
  /** List of lanes (one per application) */
  lanes: UserJourneyDiagramLaneDto[];
  /** List of steps (one per ActivityStep) */
  steps: UserJourneyDiagramStepDto[];
  /** List of edges connecting sequential steps */
  edges: UserJourneyDiagramEdgeDto[];
  /** Static layout hints for rendering */
  render_hints: UserJourneyDiagramRenderHintsDto;
  /** Diagram type identifier */
  diagram_type: string;
  /** Schema version */
  version: string;
  /** Sync metadata for v2 diagrams (absent in v1) */
  sync?: UserJourneySyncMetadata;
}

// ============================================================================
// User Journey Overview Diagram Content
// ============================================================================

/**
 * UserJourneyOverviewContent - type-specific content for USER_JOURNEY_OVERVIEW diagrams.
 *
 * Matches the UserJourneyOverviewDiagramDto structure from the backend.
 * Contains overview header, lanes (one per Business Process), nodes (one per USER_JOURNEY),
 * edges (one per USER_JOURNEY_LINK), and render hints.
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 4, Task 4.4
 */
export interface UserJourneyOverviewContent {
  /** Overview header with business user context and title */
  overview: UserJourneyOverviewHeaderDto;
  /** List of lanes (one per Business Process) */
  lanes: UserJourneyOverviewLaneDto[];
  /** List of nodes (one per USER_JOURNEY) */
  nodes: UserJourneyOverviewNodeDto[];
  /** List of edges (one per USER_JOURNEY_LINK) */
  edges: UserJourneyOverviewEdgeDto[];
  /** Static layout hints for rendering */
  render_hints: UserJourneyOverviewRenderHintsDto;
  /** Diagram type identifier */
  diagram_type: string;
  /** Schema version */
  version: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a default empty Sequence content structure.
 */
export function createDefaultSequenceContent(): SequenceContent {
  return {
    participants: [],
    messages: [],
    fragments: [],
    operands: [],
    sequenceNodes: [],
  };
}

/**
 * Creates a default empty ER content structure.
 */
export function createDefaultERContent(): ERContent {
  return {
    entityRefs: [],
    relationshipRefs: [],
  };
}

/**
 * Creates a default empty Activity content structure.
 */
export function createDefaultActivityContent(): ActivityContent {
  return {
    partitions: [],
    flows: [],
  };
}

/**
 * Creates a default empty State content structure.
 */
export function createDefaultStateContent(): StateContent {
  return {
    states: [],
    transitions: [],
  };
}

/**
 * Creates a default empty UI Screen content structure.
 */
export function createDefaultUIScreenContent(): UIScreenContent {
  return {
    screen_id: null,
    components: [],
    actions: [],
  };
}

/**
 * Creates a default empty User Journey content structure.
 * Returns a minimal placeholder with empty arrays and default metadata.
 */
export function createDefaultUserJourneyContent(): UserJourneyContent {
  return {
    journey: {
      id: '',
      name: '',
      description: '',
      user_role_id: '',
      user_role_name: '',
      parent_business_process_id: '',
      parent_business_process_name: '',
    },
    lanes: [],
    steps: [],
    edges: [],
    render_hints: {
      lane_axis: 'HORIZONTAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
    },
    diagram_type: 'USER_JOURNEY',
    version: '1',
  };
}

/**
 * Creates a default empty User Journey Overview content structure.
 * Returns a minimal placeholder with empty arrays and default render hints.
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 4, Task 4.4
 */
export function createDefaultUserJourneyOverviewContent(): UserJourneyOverviewContent {
  return {
    overview: {
      business_user_id: '',
      business_user_name: '',
      title: '',
    },
    lanes: [],
    nodes: [],
    edges: [],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
  };
}

/**
 * Creates a default TypedContentEnvelope for a given diagram type.
 * Returns undefined for General diagrams (no typed content).
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 3: USER_JOURNEY now produces version 2 envelopes.
 *
 * @param diagramType - The diagram type
 * @returns TypedContentEnvelope or undefined for General diagrams
 */
export function createDefaultTypedContent(
  diagramType: string | undefined
): TypedContentEnvelope | undefined {
  if (!diagramType || diagramType === 'General') {
    return undefined;
  }

  switch (diagramType) {
    case 'Sequence':
      return {
        type: 'Sequence',
        version: 1,
        content: createDefaultSequenceContent(),
      };
    case 'ER':
      return {
        type: 'ER',
        version: 1,
        content: createDefaultERContent(),
      };
    case 'Activity':
      return {
        type: 'Activity',
        version: 1,
        content: createDefaultActivityContent(),
      };
    case 'State':
      return {
        type: 'State',
        version: 1,
        content: createDefaultStateContent(),
      };
    case 'UI_SCREEN':
      return {
        type: 'UI_SCREEN',
        version: 1,
        content: createDefaultUIScreenContent(),
      };
    case 'USER_JOURNEY':
      return {
        type: 'USER_JOURNEY',
        version: 2,
        content: createDefaultUserJourneyContent(),
      };
    case 'USER_JOURNEY_OVERVIEW':
      return {
        type: 'USER_JOURNEY_OVERVIEW',
        version: 1,
        content: createDefaultUserJourneyOverviewContent(),
      };
    default:
      return undefined;
  }
}
