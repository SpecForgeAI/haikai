/**
 * Sequence Diagram TypeScript Types
 *
 * Type definitions for UML-style Sequence Diagrams in the Behavioural Architecture domain.
 * These types match the backend DTO structures with snake_case JSON field names.
 */

// ============================================================================
// Enum Union Types
// ============================================================================

/**
 * ParticipantRefKind - indicates the meta-model entity type for a participant/lifeline.
 * Participants can reference various entity types from different domains.
 */
export type ParticipantRefKind =
  | 'BusinessUser'
  | 'Application'
  | 'ApplicationComponent'
  | 'Service'
  | 'Interface'
  | 'InterfaceEndpoint'
  | 'Class';

/**
 * MessageRefKind - indicates the meta-model entity type for a message reference.
 * Messages can reference methods, entities, classes, events, interfaces, or endpoints
 * when not using free-text labels.
 */
export type MessageRefKind =
  | 'Method'
  | 'LogicalEntity'
  | 'PhysicalEntity'
  | 'Class'
  | 'Event'
  | 'Interface'
  | 'InterfaceEndpoint';

/**
 * ExchangeRole - indicates whether a message is a request or response in an exchange pair.
 * Exchange pairs group related request/response messages using exchange_id.
 */
export type ExchangeRole = 'Request' | 'Response';

/**
 * FragmentKind - indicates the type of control flow fragment (combined fragment in UML).
 * Loop: Iteration construct
 * Optional: Conditional execution (opt in UML)
 * Alternative: Branching construct with multiple operands (alt in UML)
 */
export type FragmentKind = 'Loop' | 'Optional' | 'Alternative';

/**
 * NodeKind - indicates whether a sequence node represents a message or a fragment.
 * Used for ordering and nesting within the diagram.
 */
export type NodeKind = 'Message' | 'Fragment';

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Array of all valid ParticipantRefKind values for validation
 */
export const PARTICIPANT_REF_KINDS: ParticipantRefKind[] = [
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'InterfaceEndpoint',
  'Class',
];

/**
 * Array of all valid MessageRefKind values for validation
 */
export const MESSAGE_REF_KINDS: MessageRefKind[] = [
  'Method',
  'LogicalEntity',
  'PhysicalEntity',
  'Class',
  'Event',
  'Interface',
  'InterfaceEndpoint',
];

/**
 * Array of all valid ExchangeRole values for validation
 */
export const EXCHANGE_ROLES: ExchangeRole[] = ['Request', 'Response'];

/**
 * Array of all valid FragmentKind values for validation
 */
export const FRAGMENT_KINDS: FragmentKind[] = ['Loop', 'Optional', 'Alternative'];

/**
 * Array of all valid NodeKind values for validation
 */
export const NODE_KINDS: NodeKind[] = ['Message', 'Fragment'];

/**
 * Type guard for ParticipantRefKind
 */
export function isParticipantRefKind(value: string): value is ParticipantRefKind {
  return PARTICIPANT_REF_KINDS.includes(value as ParticipantRefKind);
}

/**
 * Type guard for MessageRefKind
 */
export function isMessageRefKind(value: string): value is MessageRefKind {
  return MESSAGE_REF_KINDS.includes(value as MessageRefKind);
}

/**
 * Type guard for ExchangeRole
 */
export function isExchangeRole(value: string): value is ExchangeRole {
  return EXCHANGE_ROLES.includes(value as ExchangeRole);
}

/**
 * Type guard for FragmentKind
 */
export function isFragmentKind(value: string): value is FragmentKind {
  return FRAGMENT_KINDS.includes(value as FragmentKind);
}

/**
 * Type guard for NodeKind
 */
export function isNodeKind(value: string): value is NodeKind {
  return NODE_KINDS.includes(value as NodeKind);
}

// ============================================================================
// Entity Interfaces
// ============================================================================

/**
 * SequenceParticipant - represents a participant (lifeline) in the sequence diagram.
 * Participants reference meta-model entities and are ordered horizontally.
 */
export interface SequenceParticipant {
  /** Unique identifier for the participant */
  id: string;
  /** Type of meta-model entity being referenced */
  ref_kind: ParticipantRefKind;
  /** ID of the referenced meta-model entity */
  ref_id: string;
  /** Order index for horizontal positioning (left to right) */
  order_index: number;
}

/**
 * SequenceMessage - represents a message exchanged between participants.
 * Messages have an exchange pair (request/response) and either reference an entity or use free-text.
 */
export interface SequenceMessage {
  /** Unique identifier for the message */
  id: string;
  /** Groups related request/response messages */
  exchange_id: string;
  /** Role in the exchange (Request or Response) */
  exchange_role: ExchangeRole;
  /** ID of the source participant */
  from_participant_id: string;
  /** ID of the target participant */
  to_participant_id: string;
  /** Type of meta-model entity being referenced (optional) */
  ref_kind?: MessageRefKind;
  /** ID of the referenced meta-model entity (optional) */
  ref_id?: string;
  /** Free-text label for the message (optional, mutually exclusive with ref_kind/ref_id) */
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
 * SequenceFragment - represents a control flow fragment (combined fragment in UML).
 * Fragments can be loops, optional blocks, or alternatives with multiple branches.
 */
export interface SequenceFragment {
  /** Unique identifier for the fragment */
  id: string;
  /** Type of fragment (Loop, Optional, Alternative) */
  fragment_kind: FragmentKind;
  /** Optional label for the fragment (e.g., "for each item") */
  label_text?: string;
}

/**
 * SequenceOperand - represents an operand (branch) within a fragment.
 * Used for Alternative fragments to define multiple conditional branches.
 */
export interface SequenceOperand {
  /** Unique identifier for the operand */
  id: string;
  /** ID of the parent fragment */
  fragment_id: string;
  /** Guard expression/condition for this branch */
  guard_expression: string;
  /** Order index within the fragment (for multiple operands) */
  operand_index: number;
}

/**
 * SequenceNode - represents an ordering node in the sequence diagram.
 * Nodes define the vertical order of messages and fragments, including nesting.
 */
export interface SequenceNode {
  /** Unique identifier for the node */
  id: string;
  /** Type of node (Message or Fragment) */
  node_kind: NodeKind;
  /** ID of the message (required when node_kind is 'Message') */
  message_id?: string;
  /** ID of the fragment (required when node_kind is 'Fragment') */
  fragment_id?: string;
  /** Order index for vertical positioning within parent scope */
  order_index: number;
  /** ID of parent node if nested inside a fragment (optional) */
  parent_node_id?: string;
  /** ID of parent operand if nested inside a specific branch (optional) */
  parent_operand_id?: string;
}

/**
 * SequenceDiagram - root aggregate containing all sequence diagram elements.
 * This is the main interface returned by the API with all nested children.
 */
export interface SequenceDiagram {
  /** Unique identifier for the sequence diagram */
  id: string;
  /** ID of the model file containing this diagram */
  model_file_id: string;
  /** Name of the sequence diagram */
  name: string;
  /** Type of diagram (defaults to 'Sequence') */
  type: string;
  /** List of participants (lifelines), ordered by order_index */
  participants: SequenceParticipant[];
  /** List of messages between participants */
  messages: SequenceMessage[];
  /** List of control flow fragments */
  fragments: SequenceFragment[];
  /** List of operands for fragments (especially for Alternative) */
  operands: SequenceOperand[];
  /** List of ordering nodes defining the diagram structure */
  sequence_nodes: SequenceNode[];
}
