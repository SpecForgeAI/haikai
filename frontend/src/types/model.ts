// Business Domain Entities
export interface BusinessUser {
  id: string;
  name: string;
  description: string;
  tags: string;
  abbreviation: string;
}

export interface BusinessProcess {
  id: string;
  name: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

export interface UserJourney {
  id: string;
  name: string;
  description: string;
  tags: string;
  primary_business_user_id?: string;
  parent_business_process_id?: string;
}

export interface ActivityStep {
  id: string;
  user_journey_id: string;
  name: string;
  diagram_label: string;
  description: string;
  tags: string;
  sequence_order?: number;
  process_activity_id: string;
  business_user_id: string;
  application_id: string;
  activity_issues: string;
  ui_issues: string;
}

// ActorHint type for ProcessActivity - indicates primary actor performing the activity
export type ActorHint =
  | 'END_USER'
  | 'EXTERNAL_USER'
  | 'INTERNAL_SYSTEM'
  | 'EXTERNAL_SYSTEM'
  | 'HYBRID_USER_SYSTEM'
  | 'BATCH_JOB'
  | 'BOT_OR_RPA'
  | 'OTHER';

// UserInteractionLevel type for ProcessActivity - indicates level of user interaction required
// Replaces the old is_manual + user_input_amount two-field approach
export type UserInteractionLevel = 'AUTOMATED' | 'MINIMAL' | 'MODERATE' | 'SIGNIFICANT';

// ProcessActivityFrequency type for ProcessActivity - indicates how frequently an activity is performed
// Used to document operational cadence alongside process flows
export type ProcessActivityFrequency =
  | 'CONTINUOUSLY'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI-ANNUALLY'
  | 'ANNUALLY'
  | 'ADHOC'
  | 'OTHER';

// InterfaceType enum for Interface entity
// Indicates the type of API contract or integration point
export type InterfaceType =
  | 'REST_API'
  | 'GRAPHQL_API'
  | 'MESSAGE_TOPIC'
  | 'STREAM'
  | 'FILE_TRANSFER'
  | 'SOAP_API'
  | 'RPC'
  // Internal (non-HTTP) entry points — scheduled jobs / listeners / batch
  // (Spec 2026-07-24). Endpoints under this type are auto-classified out of
  // API-behaviour capture scope.
  | 'INTERNAL_PROCESSING'
  | 'OTHER';

// ============================================================================
// Endpoint Entity Type Definitions (Task Group 1)
// Endpoints represent specific operations/actions within an Interface
// ============================================================================

/**
 * EndpointType enum - indicates the type of endpoint/operation
 * HTTP_REST: RESTful HTTP endpoint
 * MESSAGE_QUEUE: Message queue consumer/producer
 * MESSAGE_TOPIC: Pub/sub topic subscriber/publisher
 * FILE_TRANSFER: File-based integration point
 * OTHER: Other endpoint types
 */
export enum EndpointType {
  HTTP_REST = 'HTTP_REST',
  MESSAGE_QUEUE = 'MESSAGE_QUEUE',
  MESSAGE_TOPIC = 'MESSAGE_TOPIC',
  FILE_TRANSFER = 'FILE_TRANSFER',
  /** Internal (non-HTTP) entry point — scheduled job / listener / batch main
   *  (Spec 2026-07-24). */
  INTERNAL_PROCESS = 'INTERNAL_PROCESS',
  OTHER = 'OTHER',
}

/**
 * EndpointDirection enum - indicates the data flow direction
 * INBOUND: Receives data/requests
 * OUTBOUND: Sends data/requests
 * BIDIRECTIONAL: Both sends and receives
 */
export enum EndpointDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  BIDIRECTIONAL = 'BIDIRECTIONAL',
}

/**
 * EndpointLifecycleStatus enum - indicates the lifecycle state of the endpoint
 * ACTIVE: Currently in use and supported
 * DEPRECATED: Still available but scheduled for removal
 * PLANNED: Not yet implemented
 * RETIRED: No longer available
 */
export enum EndpointLifecycleStatus {
  ACTIVE = 'ACTIVE',
  DEPRECATED = 'DEPRECATED',
  PLANNED = 'PLANNED',
  RETIRED = 'RETIRED',
}

/**
 * Endpoint interface - represents a specific operation within an Interface
 * Endpoints are text rows rendered inside Interface contract boxes, NOT standalone nodes
 */
export interface Endpoint {
  id: string;
  name: string;
  description: string;
  // FK to interfaces - the parent interface owning this endpoint
  interface_id: string;
  // Type of endpoint (HTTP_REST, MESSAGE_QUEUE, etc.)
  endpoint_type: EndpointType;
  // Path or address (e.g., "/api/v1/customers/{id}" or "orders.created.v1")
  path_or_address: string;
  // Protocol used (e.g., "HTTPS", "AMQP", "SFTP")
  protocol?: string;
  // HTTP verb or operation type (e.g., "GET", "POST", "SUBSCRIBE", "PUBLISH")
  operation_verb?: string;
  // Direction of data flow
  direction?: EndpointDirection;
  // Request data entity point FK
  request_data_entity_point_id?: string;
  // Response data entity point FK
  response_data_entity_point_id?: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// Data Type Definitions for Logical and Physical Attributes
// ============================================================================

/**
 * OAS (OpenAPI) data types for Logical Attributes.
 * Format: basetype or basetype_format (e.g., string_uuid = { type: "string", format: "uuid" })
 * These types align with OpenAPI 3.0 primitive types for API-first design.
 */
export type OASDataType =
  // String types
  | 'string'
  | 'string_uuid'
  | 'string_date'
  | 'string_date-time'
  | 'string_password'
  | 'string_byte'
  | 'string_binary'
  // Number types
  | 'number'
  | 'number_float'
  | 'number_double'
  // Integer types
  | 'integer'
  | 'integer_int32'
  | 'integer_int64'
  // Boolean
  | 'boolean'
  // Complex types
  | 'array'
  | 'object';

/**
 * SQL data types for Physical Attributes.
 * These types align with database schema definitions for physical data modeling.
 */
export type SQLDataType =
  | 'VARCHAR'
  | 'CHAR'
  | 'TEXT'
  | 'INTEGER'
  | 'BIGINT'
  | 'DECIMAL'
  | 'NUMERIC'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'BINARY'
  | 'BLOB'
  | 'JSON';

// ProcessActivity - represents individual activities within a Business Process
export interface ProcessActivity {
  id: string;
  business_process_id: string;
  name: string;
  description: string;
  sequence_order?: number;
  // Frequency of activity execution - optional field indicating operational cadence
  frequency?: ProcessActivityFrequency;
  actor_hint: ActorHint;
  user_interaction_level: UserInteractionLevel;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// BusinessPoint kind type for derived Business Points
// Indicates whether the source entity is a Business Process or Process Activity
export type BusinessPointKind = 'BUSINESS_PROCESS' | 'PROCESS_ACTIVITY';

// BusinessPoint - unified relationship target for Business Processes and Process Activities
// Similar to ApplicationPoint pattern - auto-created and synchronized from source entities
export interface BusinessPoint {
  id: string;
  name: string;
  description: string;
  // Kind field indicates the source entity type for derived Business Points
  kind: BusinessPointKind;
  // Foreign key to source Business Process (always set - for BUSINESS_PROCESS kind, this is the source;
  // for PROCESS_ACTIVITY kind, this is the parent process)
  business_process_id: string;
  // Foreign key to source Process Activity (only set for PROCESS_ACTIVITY kind)
  process_activity_id?: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// TechType - Technology Tier Type for Application Components
// Spec: Sequence Diagram Participant Colour and Icons for Services and Components
// Used for sequence diagram participant styling based on tech tier
// ============================================================================

/**
 * TechType - indicates the technology tier of an Application Component.
 * Used for sequence diagram participant styling.
 *
 * Values:
 * - 'UI Tier': Frontend/user interface components
 * - 'Service Tier': Backend service/business logic components
 * - 'Persistence Tier': Database/storage components
 * - 'Other': Default for components that don't fit other categories
 */
export type TechType = 'UI Tier' | 'Service Tier' | 'Persistence Tier' | 'Other';

/**
 * Array of all valid TechType values for dropdowns and validation
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 */
export const TECH_TYPE_OPTIONS: TechType[] = [
  'UI Tier',
  'Service Tier',
  'Persistence Tier',
  'Other',
];

// Application Domain Entities
export interface Application {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  app_type: string;
  status: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
  // Spec: Sequence Diagram Participant Colour and Icons
  // Indicates whether this application is internal (true) or external (false)
  // Defaults to true if not specified
  is_internal?: boolean;
}

export interface ApplicationComponent {
  id: string;
  name: string;
  description: string;
  application_id: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
  // Spec: Sequence Diagram Participant Colour and Icons
  // Indicates whether this component is internal (true) or external (false)
  // Defaults to true if not specified
  is_internal?: boolean;
  // Spec: Sequence Diagram Participant Colour and Icons
  // Technology tier classification for sequence diagram styling
  // Defaults to "Other" if not specified
  tech_type?: TechType;
}

// ============================================================================
// PackageSet and Package Entities (Application Domain)
// PackageSets represent groups of packages for service design
// Services can optionally reference a PackageSet
// ============================================================================

/**
 * PackageSet entity - represents a group of packages for service design.
 * Services can optionally reference a PackageSet to define their package structure.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 * Extended with standard_source and standard_key for imported standards.
 */
export interface PackageSet {
  id: string;
  name: string;
  /** Source of the import: "COMPANY" or "PROJECT" (null if manually created) */
  standard_source?: string;
  /** Unique key within the source for idempotent imports (null if manually created) */
  standard_key?: string;
}

/**
 * Package entity - represents a package within a PackageSet.
 * Packages belong to a PackageSet and have a name, optional purpose, and sort order.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 * Extended with standard_source and standard_key for imported standards.
 */
export interface Package {
  id: string;
  package_set_id: string;
  name: string;
  purpose?: string;
  sort_order?: number;
  /** Source of the import: "COMPANY" or "PROJECT" (null if manually created) */
  standard_source?: string;
  /** Unique key within the source for idempotent imports (null if manually created) */
  standard_key?: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  application_id: string;
  app_component_id?: string;
  service_type: string;
  // Core technology stack (e.g., "Java, Spring Boot, PostgreSQL")
  core_tech?: string;
  // Repository location (URL for git repos, or local folder path)
  repo_location?: string;
  // Subfolder within the repo (e.g., "services/order-service")
  repo_subfolder?: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
  // Optional reference to a PackageSet that defines the service's package structure
  package_set_id?: string;
  // Spec: Sequence Diagram Participant Colour and Icons
  // Indicates whether this service is internal (true) or external (false)
  // Defaults to true if not specified
  is_internal?: boolean;
  // Spec 2026-04-20: Tech Hints LLM Resolution
  // Structured resolution of core_tech into registered language/framework packs.
  // All five fields are NULL for unresolved rows; populated after save-time resolve.
  core_tech_resolved?: Record<string, unknown> | null;
  core_tech_language_pack?: string | null;
  core_tech_framework_packs?: string[] | null;
  core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null;
  core_tech_resolved_at?: string | null;
}

// ============================================================================
// Library entity (Application domain)
// Spec 2026-05-06: Library Frontend Types & Tables
// Mirrors Service field shape minus Service-specifics; adds ecosystem +
// 6 provenance fields. snake_case JSON, matches Spec 1 backend column names.
// ============================================================================
export interface Library {
  id: string;
  name?: string;
  description: string;
  tags: string;
  ecosystem?: string;
  repo_location?: string;
  repo_subfolder?: string;
  core_tech?: string;
  // 5 tech-hints columns mirror Service - LLM resolver flow.
  core_tech_resolved?: Record<string, unknown> | null;
  core_tech_language_pack?: string | null;
  core_tech_framework_packs?: string[] | null;
  core_tech_resolution_confidence?: 'high' | 'low' | 'none' | 'tech-only' | 'manual-override' | null;
  core_tech_resolved_at?: string | null;
  package_set_id?: string | null;
  // Temporal validity fields - format: 'YYYY-Qn' (e.g., '2026-Q2')
  valid_from?: string;
  valid_to?: string;
  // 6 provenance fields (mirrors spec 7 Infra entities)
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
}

// Interface entity - represents API contracts and integration points owned by Services
export interface Interface {
  id: string;
  name: string;
  description: string;
  // FK to services - the owning service for this interface
  service_id: string;
  // Type of interface (REST_API, GRAPHQL_API, etc.)
  interface_type: InterfaceType;
  // Optional link to specification (e.g., OpenAPI spec URL)
  spec_link?: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// Class and Method Entities (Application Architecture Domain)
// ============================================================================

/**
 * Class entity - represents software classes within the Application Architecture
 * Classes are owned by a Service via service_id FK
 * Spec: Extension Pack Framework - replaced application_point_id with service_id
 */
export interface Class {
  id: string;
  name: string;
  description?: string;
  namespace?: string;
  service_id?: string;
}

/**
 * Method entity - represents behavioral interfaces owned by Classes
 * Methods have optional parameters, returns, and throws fields stored as JSON strings
 */
export interface Method {
  id: string;
  class_id: string;
  name: string;
  description?: string;
  parameters_json?: string;
  returns_json?: string;
  throws_json?: string;
}

// ============================================================================
// ApplicationPoint Target Type (Spec: Expand Application Points to Reference Service/Class/Method)
// Enables precise targeting of Service, Class, or Method entities from ApplicationPoints
// ============================================================================

/**
 * ApplicationPointTargetType enum - indicates the type of target entity.
 *
 * Spec: Expand Application Points to Reference Service/Class/Method
 *
 * Used in conjunction with target_ref_id to specify which entity type
 * the ApplicationPoint is targeting for business logic attachment.
 */
export enum ApplicationPointTargetType {
  SERVICE = 'SERVICE',
  CLASS = 'CLASS',
  METHOD = 'METHOD',
  // Spec 2026-05-06: Library Frontend Types & Tables
  LIBRARY = 'LIBRARY',
}

// ApplicationPoint kind type for derived Application Points
// Spec: Global Application Point Picker with Derived ApplicationPoints
// Extended to include 'CLASS' and 'METHOD' for derived APs targeting those entity types
export type ApplicationPointKind = 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE' | 'CLASS' | 'METHOD' | 'LIBRARY';

/**
 * ApplicationPoint interface - represents a point where business logic can be attached.
 *
 * Spec: Expand Application Points to Reference Service/Class/Method
 *
 * Extended with target_type and target_ref_id fields to enable precise targeting
 * of Service, Class, or Method entities. This allows business logic to be attached
 * at different granularities of the application architecture.
 */
export interface ApplicationPoint {
  id: string;
  name: string;
  description: string;
  // Kind field indicates the source entity type for derived Application Points
  kind: ApplicationPointKind;
  // Foreign key to source Application (for APPLICATION kind)
  application_id: string;
  // Foreign key to source App Component (for APP_COMPONENT kind)
  application_component_id?: string;
  // Foreign key to source Service (for SERVICE kind)
  service_id?: string;
  // Foreign key to Interface (optional)
  interface_id?: string;

  // ============================================================================
  // Target Type and Reference (Spec: Expand Application Points to Reference Service/Class/Method)
  // These fields enable precise targeting of Service, Class, or Method entities
  // ============================================================================

  /**
   * Target type for precise targeting of Service, Class, or Method.
   * Valid values: SERVICE, CLASS, METHOD
   *
   * Must be used together with target_ref_id (pairwise constraint):
   * - If target_type is set, target_ref_id must also be set
   * - If target_type is null/empty, target_ref_id must also be null/empty
   */
  target_type?: ApplicationPointTargetType | string;

  /**
   * Target reference ID - UUID of the targeted Service, Class, or Method.
   * Must reference a valid entity based on target_type:
   * - SERVICE: Must reference a valid Service entity
   * - CLASS: Must reference a valid Class entity
   * - METHOD: Must reference a valid Method entity
   */
  target_ref_id?: string;

  // Deprecated: point_type is no longer used but kept for backward compatibility
  point_type: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// Data Domain Entities
export interface LogicalDataEntity {
  id: string;
  name: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

export interface LogicalDataAttribute {
  id: string;
  name: string;
  description: string;
  logical_entity_id: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
  tags: string;
}

// PhysicalDataEntity - represents physical storage structures
// NOTE: The logical_entity_id field has been REMOVED from this interface.
// The Logical-to-Physical Entity mapping is now exclusively modeled via the
// LogicalDataEntityPhysicalDataEntity relationship table, which supports
// 1:1, 1:M, M:1, and M:M cardinalities correctly.
export interface PhysicalDataEntity {
  id: string;
  name: string;
  description: string;
  physical_type: string;
  database: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
  // ==========================================================================
  // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A
  // Structured constraint/index metadata captured verbatim by the discovery DB
  // scan. METADATA ON the entity - NOT a separate entity type. snake_case wire
  // key matches the AMS PhysicalDataEntityDto exactly. Optional: existing models
  // (and non-DB-discovered entities) won't carry it.
  // ==========================================================================
  constraints_metadata?: PhysicalEntityConstraintsMetadata;
}

/**
 * Structured constraint/index metadata attached to a PhysicalDataEntity.
 *
 * Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A.
 * Sourced from the discovery DB scan's KeyOrIndexMetadata IR. This is metadata
 * ON the table entity - NOT a separate architecture entity type. Maps to the
 * AMS `constraints_metadata` JSONB passthrough object. All members optional; a
 * DB-only scan may populate any subset.
 */
export interface PhysicalEntityConstraintsMetadata {
  primary_key?: { name?: string; columns?: string[] };
  unique_constraints?: Array<{ name?: string; columns?: string[] }>;
  check_constraints?: Array<{ name?: string; expression?: string }>;
  indexes?: Array<{ name?: string; columns?: string[]; is_unique?: boolean }>;
}

export interface PhysicalDataAttribute {
  id: string;
  name: string;
  description: string;
  physical_entity_id: string;
  data_type: string;
  is_primary_key: boolean;
  is_nullable: boolean;
  tags: string;
  // ==========================================================================
  // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A
  // Structural-fidelity fields captured verbatim by the discovery DB scan with
  // NO type normalization. snake_case wire keys match the AMS
  // PhysicalDataAttributeDto exactly. All optional - existing models (and
  // non-DB-discovered attributes) won't carry them. `column_default` (NOT
  // `default`) mirrors the AMS column name (`default` is a SQL reserved word).
  // ==========================================================================
  /** Verbatim source column type (e.g. "VARCHAR(255)", "numeric(10,2)"). NO normalization. */
  source_type?: string;
  /** Numeric scale (digits after the decimal point) for numeric/decimal columns. */
  scale?: number;
  /** Numeric precision (total significant digits) for numeric/decimal columns. */
  precision?: number;
  /** Verbatim column default expression. Named `column_default` (`default` is reserved). */
  column_default?: string;
  /** 1-based ordinal position of the column within the table. */
  ordinal?: number;
  /** Column-level identity / auto-increment flag. */
  is_identity?: boolean;
}

// ============================================================================
// ============================================================================
// Behavioural Domain Entities
// ============================================================================

/**
 * Event interface - represents a business or system event in the Behavioural domain
 *
 * Events are the starter entity for the Behavioural Architecture domain.
 * They represent occurrences of interest that trigger actions or state changes.
 *
 * Source Reference fields (source_ref_kind, source_ref_id):
 * - Indicate the entity that triggers/produces this event
 * - source_ref_kind values: BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class
 *
 * Payload fields (payload_ref_kind, payload_ref_id, payload_primitive_type):
 * - Describe the data carried by the event
 * - payload_ref_kind/payload_ref_id: Reference to a LogicalEntity
 * - payload_primitive_type: For simple primitive payloads (string, number, etc.)
 * - These are mutually exclusive: use either ref fields OR primitive_type
 */
export interface Event {
  id: string;
  name: string;
  description: string;
  tags: string;
  // Source reference fields - indicates the entity that triggers/produces this event
  source_ref_kind?: string;  // BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class
  source_ref_id?: string;
  // Payload reference fields - for complex payload referencing a LogicalEntity
  payload_ref_kind?: string;  // LogicalEntity
  payload_ref_id?: string;
  // Payload primitive type - for simple primitive payloads (mutually exclusive with payload_ref fields)
  payload_primitive_type?: string;  // string, number, integer, boolean, date, datetime, uuid
}

// ============================================================================
// State and StateTransition Entities (Behavioural Domain)
// ============================================================================

/**
 * StateKind type - indicates the type of state in a state machine.
 * Initial: The starting state (entry point)
 * Normal: A regular state during execution
 * Final: A terminal state (no outgoing transitions)
 */
export type StateKind = 'Initial' | 'Normal' | 'Final';

/**
 * TriggerRefKind type - indicates what triggers a state transition.
 * Event: The trigger is an Event entity
 * Method: The trigger is a Method entity
 */
export type TriggerRefKind = 'Event' | 'Method';

/**
 * GuardRefKind type - indicates what guards a state transition.
 * Method: The guard is a Method that returns boolean
 */
export type GuardRefKind = 'Method';

/**
 * EffectRefKind type - indicates what effect is executed during a transition.
 * Method: The effect is a Method call
 */
export type EffectRefKind = 'Method';

/**
 * State entity - represents a state in a state machine (UML State Machine).
 * States can be Initial (entry point), Normal (regular states), or Final (terminal states).
 */
export interface State {
  id: string;
  name: string;
  description?: string;
  // The kind of state (Initial, Normal, Final)
  state_kind: StateKind;
  // Owner reference fields - optional polymorphic reference to the owning entity
  owner_ref_kind?: string;
  owner_ref_id?: string;
}

/**
 * StateTransition entity - represents a transition between states.
 * Models UML state machine transitions with trigger, guard, and effect.
 *
 * Trigger: What causes the transition (Event or Method)
 * Guard: Condition that must be true (Method returning boolean, or expression)
 * Effect: Action executed during transition (Method call, or label text)
 */
export interface StateTransition {
  id: string;
  // FK to states - the source state
  from_state_id: string;
  // FK to states - the target state
  to_state_id: string;
  // Order index for multiple transitions from the same state
  order_index?: number;
  // Description of the transition
  description?: string;
  // Trigger fields (required: one of ref pair OR label text)
  trigger_ref_kind?: TriggerRefKind;
  trigger_ref_id?: string;
  trigger_label_text?: string;
  // Guard fields (optional: one of ref pair OR expression)
  guard_ref_kind?: GuardRefKind;
  guard_ref_id?: string;
  guard_expression?: string;
  // Effect fields (optional: one of ref pair OR label text)
  effect_ref_kind?: EffectRefKind;
  effect_ref_id?: string;
  effect_label_text?: string;
}

// ============================================================================
// Activity Diagram Entities (Behavioural Domain)
// ============================================================================

/**
 * ActivityKind type - indicates the type of activity node in an activity diagram.
 * Initial: The starting node (entry point)
 * Action: A standard action/activity node
 * Decision: A decision/branch node (diamond)
 * Merge: A merge node where flows rejoin
 * Final: A terminal node (endpoint)
 */
export type ActivityKind = 'Initial' | 'Action' | 'Decision' | 'Merge' | 'Final';

/**
 * ActivityFlowKind type - indicates the type of flow between activities.
 * Control: Control flow (sequence of execution)
 * Data: Data flow (data passing between activities)
 */
export type ActivityFlowKind = 'Control' | 'Data';

/**
 * ActivityPartitionRefKind type - indicates what type of entity a partition references.
 * Used for swimlane partitions that represent organizational responsibilities.
 */
export type ActivityPartitionRefKind =
  | 'BusinessUser'
  | 'Application'
  | 'ApplicationComponent'
  | 'Service'
  | 'Interface'
  | 'Class';


/**
 * ActivityDiagramOrientation type - indicates the orientation of activity partitions.
 * VERTICAL: Header at top, lane extends top-to-bottom, partitions arranged left-to-right
 * HORIZONTAL: Header on left, lane extends left-to-right, partitions arranged top-to-bottom
 */
export type ActivityDiagramOrientation = 'VERTICAL' | 'HORIZONTAL';
/**
 * Activity entity - represents an activity node in a UML activity diagram.
 * Activities are actions, decisions, merges, or start/end points.
 */
export interface Activity {
  id: string;
  name: string;
  description?: string;
  // The kind of activity node (Initial, Action, Decision, Merge, Final)
  activity_kind: ActivityKind;
}

/**
 * ActivityFlow entity - represents a flow (edge) between activities.
 * Flows connect activities and can carry trigger and condition information.
 *
 * Trigger: What causes the flow to be taken (Event or Method, or label text)
 * Condition: Guard condition for the flow (Method returning boolean, or expression)
 */
export interface ActivityFlow {
  id: string;
  // FK to activities - the source activity
  from_activity_id: string;
  // FK to activities - the target activity
  to_activity_id: string;
  // Trigger fields (optional: one of ref pair OR label text)
  trigger_ref_kind?: TriggerRefKind;
  trigger_ref_id?: string;
  trigger_label_text?: string;
  // Condition fields (optional: one of ref pair OR expression)
  condition_ref_kind?: GuardRefKind;
  condition_ref_id?: string;
  condition_expression?: string;
  // Flow kind (Control or Data)
  flow_kind: ActivityFlowKind;
  // Order index for multiple flows from the same activity
  order_index?: number;
  // Description of the flow
  description?: string;
}

/**
 * ActivityPartition entity - represents a swimlane partition in an activity diagram.
 * Partitions organize activities by responsibility (e.g., which actor or system performs them).
 */
export interface ActivityPartition {
  id: string;
  // Name of the partition (optional if ref_kind/ref_id is set)
  name?: string;
  // Reference to an entity that represents this partition
  ref_kind?: ActivityPartitionRefKind;
  ref_id?: string;
  // Order index for partition ordering (left to right or top to bottom)
  order_index?: number;
  // Description of the partition
  description?: string;
}

// ============================================================================
// BusinessLogic Entity (Behavioural Domain)
// Represents business rules, validations, or logic components
// ============================================================================

/**
 * BusinessLogic entity - represents a business rule or logic component in the Behavioural domain.
 *
 * BusinessLogic entities capture business rules, validations, calculations, or other
 * logic components that can be linked to ApplicationPoints via the
 * ApplicationPointBusinessLogic join table.
 *
 * This enables traceability between technical implementation (ApplicationPoints) and
 * the business rules they implement.
 */
export interface BusinessLogic {
  id: string;
  name: string;
  // Type of business logic (e.g., "Validation", "Calculation", "Transformation", "Rule")
  type_text?: string;
  // Markdown description of the business logic
  description_md?: string;
  tags?: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// UI Architecture Entities (UI Domain)
// UIScreen, UIWorkflowTransition, UIComponent, UIAction, UICharacteristic
// ============================================================================

/**
 * UIScreen entity - represents a UI screen/page/route in the UI Architecture.
 * Used in UI_Workflow diagrams to model navigation flows.
 */
export interface UIScreen {
  id: string;
  name: string;
  // Route path for the screen (e.g., "/trades/:id", "/dashboard")
  route: string;
  description?: string;
  application_point_id?: string;
}

/**
 * UIWorkflowTransition entity - represents a navigation flow between UI screens.
 * Models user navigation paths in UI_Workflow diagrams.
 */
export interface UIWorkflowTransition {
  id: string;
  name: string;
  // FK to ui_screens - the source screen
  source_screen_id: string;
  // FK to ui_screens - the target screen
  target_screen_id: string;
  // Optional trigger that causes the transition (e.g., "Submit Login", "Click Trade")
  trigger?: string;
  // Optional guard condition (e.g., "isAuthenticated", "hasPermission")
  guard?: string;
}

// UserJourneyLinkRelationshipType - Enum for User Journey Link relationship types
export type UserJourneyLinkRelationshipType = 'RELATES_TO' | 'PRECEDES' | 'DEPENDS_ON' | 'OPTIONALLY_LEADS_TO' | 'TRIGGERS';

// UserJourneyLink - Directed relationship between two User Journeys
export interface UserJourneyLink {
  id: string;
  source_user_journey_id: string;
  target_user_journey_id: string;
  relationship_type: UserJourneyLinkRelationshipType;
  label?: string;
  description?: string;
  tags?: string;
}


/**
 * UIComponent entity - represents a reusable UI component in the UI Architecture.
 * Used to model UI building blocks like buttons, forms, modals, etc.
 *
 * Spec: Meta-Model View - UI Domain Tab (2026-01-03)
 */
export interface UIComponent {
  id: string;
  name: string;
  // Type of component (e.g., "Button", "Form", "Modal", "Table", etc.)
  component_type?: string;
  description?: string;
}

/**
 * UIAction entity - represents a UI action/event in the UI Architecture.
 * Models user-triggered actions like clicks, form submissions, etc.
 *
 * Spec: Meta-Model View - UI Domain Tab (2026-01-03)
 */
export interface UIAction {
  id: string;
  name: string;
  // Type of trigger (e.g., "Click", "Submit", "Change", etc.)
  trigger_type: string;
  // Type of owner (e.g., "Screen", "Component")
  owner_type: string;
  // ID of the owner entity (screen or component)
  owner_id: string;
  // Type of effect (e.g., "Navigate", "Submit", "Validate", etc.)
  effect_type: string;
}

// ============================================================================
// UICharacteristic Entity (UI Domain)
// Spec 2026-01-20: UI Characteristics Entity
// Captures business features and UI/UX/technical characteristics of UIs
// ============================================================================

/**
 * UICharacteristicType - enum for the type of UI characteristic.
 * Stored as snake_case in backend, displayed as Title Case with spaces in UI.
 *
 * - business_feature: Key business feature of the UI
 * - ui_capability: UI capability (e.g., search, filter, sort)
 * - interaction_complexity: Level of interaction complexity (e.g., simple, moderate, complex)
 * - technical_shape: Technical shape of the UI (e.g., form, list, detail, dashboard)
 */
export type UICharacteristicType =
  | 'business_feature'
  | 'ui_capability'
  | 'interaction_complexity'
  | 'technical_shape';

/**
 * UICharacteristic entity - represents a characteristic of a UI in the UI Architecture.
 *
 * Captures business features and UI/UX/technical characteristics associated with
 * frontend UIs, linked to Application Points.
 *
 * Spec 2026-01-20: UI Characteristics Entity
 */
export interface UICharacteristic {
  id: string;
  // FK to application_points - the UI this characteristic describes
  uiId: string;
  // Type of characteristic (business_feature, ui_capability, interaction_complexity, technical_shape)
  type: UICharacteristicType;
  // Optional key with type-dependent autocomplete
  key?: string;
  // Name of the characteristic
  name: string;
  // Optional description
  description?: string;
  // Optional evidence text
  evidence?: string;
}

// Interaction Entity (User Interaction with App/Business Points)
// Represents a user's interaction with one or two application/business points
// ============================================================================

/**
 * Interaction interface - represents a user interaction with application/business points
 *
 * An Interaction captures how a BusinessUser interacts with one or two App_Business_Point
 * entities. This is used to model user journeys, touchpoints, and interaction flows.
 */
export interface Interaction {
  id: string;
  name: string;
  description?: string;
  // FK to business_users - the user performing the interaction
  user_id: string;
  // FK to app_business_points - the primary interaction point
  primary_app_business_point_id: string;
  // FK to app_business_points - optional secondary interaction point
  secondary_app_business_point_id?: string;
}

// ============================================================================
// App_Business_Point Entity (Auto-Created Indirect Entity)
// Unifies Application-side and Business-side entities as interaction targets
// Auto-created and synced with source entities (Application, App Component,
// Service, Interface, Business Process, Process Activity)
// ============================================================================

/**
 * AppBusinessPointKind - the kind of entity that is the source for this ABP
 *
 * These are the 6 entity types that trigger ABP auto-creation/sync/delete:
 * - APPLICATION, APP_COMPONENT, SERVICE, INTERFACE (Application domain)
 * - BUSINESS_PROCESS, PROCESS_ACTIVITY (Business domain)
 *
 * Note: ENDPOINT is excluded from ABP kinds because Endpoints are child
 * entities of Interfaces and don't need separate ABP tracking.
 */
export type AppBusinessPointKind =
  | 'APPLICATION'
  | 'APP_COMPONENT'
  | 'SERVICE'
  | 'INTERFACE'
  | 'BUSINESS_PROCESS'
  | 'PROCESS_ACTIVITY';

/**
 * Array of all valid AppBusinessPoint kinds
 * Used for iteration and validation
 */
export const APP_BUSINESS_POINT_KINDS: AppBusinessPointKind[] = [
  'APPLICATION',
  'APP_COMPONENT',
  'SERVICE',
  'INTERFACE',
  'BUSINESS_PROCESS',
  'PROCESS_ACTIVITY',
];

/**
 * Helper function to check if a string is a valid AppBusinessPointKind
 * @param kind - The string to check
 * @returns true if the string is a valid AppBusinessPointKind
 */
export function isAppBusinessPointKind(kind: string): kind is AppBusinessPointKind {
  return APP_BUSINESS_POINT_KINDS.includes(kind as AppBusinessPointKind);
}

/**
 * AppBusinessPoint interface - indirect/lookup entity for Interaction FK targets
 *
 * This is a REAL entity that is AUTO-MANAGED:
 * - Auto-created when source entities (Application, App Component, Service,
 *   Interface, Business Process, Process Activity) are created
 * - Auto-synced when source entity names change
 * - Auto-deleted when source entities are deleted
 *
 * The Interaction entity's primary_app_business_point_id and
 * secondary_app_business_point_id fields reference this entity.
 */
export interface AppBusinessPoint {
  /** Auto-generated ID with 'abp_' prefix: `abp_{source_entity_id}` */
  id: string;
  /** Mirrors source entity name - always synced from source */
  name: string;
  /** The kind of source entity (APPLICATION, APP_COMPONENT, etc.) */
  kind: AppBusinessPointKind;
  /** FK to the source entity that this ABP represents */
  source_entity_id: string;
}

// ============================================================================
// App_Business_Point Polymorphic Super-type (Legacy - for backward compatibility)
// Used by resolveAppBusinessPoint() to search across collections
// ============================================================================

/**
 * AppBusinessPointEntityType - union of entity types that are App_Business_Points
 *
 * These entity types can be referenced as interaction points in the Interaction entity.
 * This is used for the legacy polymorphic lookup pattern.
 */
export type AppBusinessPointEntityType =
  | 'APPLICATION'
  | 'APP_COMPONENT'
  | 'SERVICE'
  | 'INTERFACE'
  | 'ENDPOINT'
  | 'BUSINESS_PROCESS'
  | 'PROCESS_ACTIVITY';

/**
 * Array of all valid App_Business_Point entity types
 * Used for iteration and validation
 */
export const APP_BUSINESS_POINT_TYPES: AppBusinessPointEntityType[] = [
  'APPLICATION',
  'APP_COMPONENT',
  'SERVICE',
  'INTERFACE',
  'ENDPOINT',
  'BUSINESS_PROCESS',
  'PROCESS_ACTIVITY',
];

/**
 * Helper function to check if an entity type is an App_Business_Point
 * @param entityType - The entity type string to check
 * @returns true if the entity type is a valid App_Business_Point type
 */
export function isAppBusinessPointType(entityType: string): boolean {
  return APP_BUSINESS_POINT_TYPES.includes(entityType as AppBusinessPointEntityType);
}

/**
 * Resolves an App_Business_Point ID to its concrete entity
 *
 * Searches each App_Business_Point collection for the matching ID and returns
 * the entity along with its type. Returns null if not found.
 *
 * @param id - The entity ID to resolve
 * @param metaModel - The MetaModel containing all entities
 * @returns Object with entityType and entity, or null if not found
 */
export function resolveAppBusinessPoint(
  id: string,
  metaModel: MetaModel
): { entityType: AppBusinessPointEntityType; entity: AnyEntity } | null {
  // First, check the app_business_points collection (new pattern)
  const abp = metaModel.entities.app_business_points?.find(e => e.id === id);
  if (abp) {
    // Return the ABP itself with its kind as the entity type
    return { entityType: abp.kind as AppBusinessPointEntityType, entity: abp as unknown as AnyEntity };
  }

  // Fallback: Search each collection for the matching ID (legacy pattern)
  const collections: [keyof MetaModelEntities, AppBusinessPointEntityType][] = [
    ['applications', 'APPLICATION'],
    ['app_components', 'APP_COMPONENT'],
    ['services', 'SERVICE'],
    ['interfaces', 'INTERFACE'],
    ['endpoints', 'ENDPOINT'],
    ['business_processes', 'BUSINESS_PROCESS'],
    ['process_activities', 'PROCESS_ACTIVITY'],
  ];

  for (const [key, type] of collections) {
    const entityArray = metaModel.entities[key];
    if (entityArray) {
      const entity = (entityArray as AnyEntity[]).find((e: AnyEntity) => e.id === id);
      if (entity) {
        return { entityType: type, entity };
      }
    }
  }
  return null;
}

// ============================================================================
// Logical ER Relationship Enum Types
// Used for LogicalDataEntityRelationship - UML-style relationship semantics
// ============================================================================

/**
 * LogicalERCardinality type - indicates the cardinality of a logical ER relationship.
 * ONE_TO_ONE: One instance of source maps to one instance of target
 * ONE_TO_MANY: One instance of source maps to many instances of target
 * MANY_TO_ONE: Many instances of source map to one instance of target
 * MANY_TO_MANY: Many instances of source map to many instances of target
 */
export type LogicalERCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_ONE' | 'MANY_TO_MANY';

/**
 * LogicalERRelationship type - indicates the UML relationship type.
 * GENERALIZATION: "is-a" relationship (inheritance)
 * REALIZATION: Implementation of an interface
 * COMPOSITION: Strong "has-a" relationship (lifecycle-dependent)
 * AGGREGATION: Weak "has-a" relationship (independent lifecycle)
 * ASSOCIATION: General relationship between entities
 * DEPENDENCY: One entity depends on another
 */
export type LogicalERRelationship = 'GENERALIZATION' | 'REALIZATION' | 'COMPOSITION' | 'AGGREGATION' | 'ASSOCIATION' | 'DEPENDENCY';

/**
 * LogicalEREndpointKind type - indicates the type of entity at a relationship endpoint.
 * LOGICAL_ENTITY: Endpoint references a LogicalDataEntity
 * PHYSICAL_ENTITY: Endpoint references a PhysicalDataEntity
 *
 * @deprecated This type is no longer used. Use Data Entity Point IDs instead.
 * Kept for backward compatibility during migration period.
 */
export type LogicalEREndpointKind = 'LOGICAL_ENTITY' | 'PHYSICAL_ENTITY';

// Relationships

// BusinessUserBusinessPoint - User to Business Point relationship
// Primary relationship type for linking Business Users to Business Processes and Process Activities
export interface BusinessUserBusinessPoint {
  id: string;
  business_user_id: string;
  business_point_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ApplicationPointBusinessPoint - Application Point to Business Point relationship
// Primary relationship type for linking Application Points to Business Processes and Process Activities
export interface ApplicationPointBusinessPoint {
  id: string;
  application_point_id: string;
  business_point_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// ApplicationPointBusinessLogic - ApplicationPoint to BusinessLogic join table
// Links ApplicationPoints to BusinessLogic entities (many-to-many relationship)
// ============================================================================

/**
 * ApplicationPointBusinessLogic - join table linking ApplicationPoints to BusinessLogic entities.
 *
 * This enables tracing which business rules/logic are implemented by which technical
 * components (Applications, AppComponents, Services via their ApplicationPoints).
 */
export interface ApplicationPointBusinessLogic {
  id: string;
  // FK to application_points - the technical implementation point
  application_point_id: string;
  // FK to business_logics - the business rule/logic being implemented
  business_logic_id: string;
  description?: string;
  tags?: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

/**
 * LogicalDataEntityRelationship - represents relationships between data entities.
 *
 * Supports polymorphic endpoints that can connect:
 * - LogicalEntity <-> LogicalEntity
 * - PhysicalEntity <-> PhysicalEntity
 * - LogicalEntity <-> PhysicalEntity
 *
 * Uses UML-style relationship semantics with cardinality and relationship type enums.
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 * Legacy fields (from_ref_kind, from_ref_id, to_ref_kind, to_ref_id) have been removed.
 * Only Data Entity Point ID fields are now used.
 */
export interface LogicalDataEntityRelationship {
  id: string;
  // Cardinality (renamed from relationship_type)
  cardinality?: LogicalERCardinality;
  // UML relationship type
  relationship?: LogicalERRelationship;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;

  // ============================================================================
  // Data Entity Point ID fields (Spec: Remove Legacy Data Entity Relationship Columns)
  // Unified picker fields - required for all relationships
  // Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities
  // ============================================================================

  /** Data Entity Point ID for "From" endpoint - required field */
  fromDataEntityPointId: string;
  /** Data Entity Point ID for "To" endpoint - required field */
  toDataEntityPointId: string;

  // ==========================================================================
  // Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A
  // FK column-level detail captured verbatim by the discovery DB scan. METADATA
  // on the relationship - NOT a new entity type; the point-id endpoints above
  // are unchanged. snake_case wire key `fk_columns` matches the AMS
  // LogicalDataEntityRelationshipDto exactly. Optional: only FK relationships
  // discovered from a DB scan carry it.
  // ==========================================================================
  fk_columns?: RelationshipFkColumns;
}

/**
 * FK column-level detail attached to a LogicalDataEntityRelationship.
 *
 * Spec: DB Structural Fidelity for Discovery (2026-05-29) - Group A.
 * `join_columns` are the referencing (FK) columns on the "from" side;
 * `referenced_columns` are the referenced columns on the "to" side. Sourced
 * from the discovery DB scan's KeyOrIndexMetadata / RelationshipInference IR.
 * METADATA on the relationship - NOT a separate entity type. Maps to the AMS
 * `fk_columns` JSONB passthrough object. Both members optional.
 */
export interface RelationshipFkColumns {
  join_columns?: string[];
  referenced_columns?: string[];
}

/**
 * Endpoint→data-effect edge (Spec: Endpoint→Data-Effect Call Graph, 2026-05-29).
 * One reviewable relationship per (endpoint, data-entity) pair — the endpoint
 * reads and/or writes a data entity. snake_case wire mirrors the AMS
 * `EndpointDataEffectDto`; `data_entity_point_id` uses the `dep_log_`/`dep_phy_`
 * point convention; `path_metadata_json` is a passthrough object holding the
 * ordered controller→service→repository hop list + operation hint + `transactional` flag.
 * (Restored 2026-05-29 — the Spec-3 frontend ripple inadvertently reverted this typing.)
 */
export interface EndpointDataEffect {
  id: string;
  endpoint_id: string;
  data_entity_point_id: string;
  access_mode?: string;
  path_metadata_json?: Record<string, unknown>;
  confidence?: number | null;
  description?: string | null;
  tags?: string | null;
  valid_from?: string;
  valid_to?: string;
}

// LogicalDataEntityPhysicalDataEntity - AUTHORITATIVE relationship table
// This is the ONLY structure defining Logical-to-Physical Entity mappings.
// Supports 1:1, 1:M, M:1, and M:M cardinalities through multiple relationship records.
export interface LogicalDataEntityPhysicalDataEntity {
  id: string;
  logical_entity_id: string;
  physical_entity_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

export interface LogicalDataAttributePhysicalDataAttribute {
  id: string;
  logical_attribute_id: string;
  physical_attribute_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// InterfaceLogicalEntity - Interface to Data Entity Relationship
// Spec 2026-01-11: Interface Entity Relationship Refactor
// - Renamed from "Interface <-> Logical Entity" to "Interface <-> Entity"
// - Updated to use dataEntityPointId for Logical OR Physical entity selection
// - Supports backward compatibility with legacy logical_entity_id field
// ============================================================================

/**
 * InterfaceLogicalEntity - many-to-many relationship between Interfaces and Data Entities
 * Links interfaces to the data entities (Logical OR Physical) they expose or consume
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Uses dataEntityPointId (data_entity_point_picker) for unified entity selection
 * - Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities
 * - Backward compatible: legacy logical_entity_id is still supported during migration
 */
export interface InterfaceLogicalEntity {
  id: string;
  // FK to interfaces - the interface exposing/consuming the data
  interface_id: string;

  // ============================================================================
  // Data Entity Point ID (Spec 2026-01-11: Interface Entity Relationship Refactor)
  // Unified picker field for Logical OR Physical data entity selection
  // Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities
  // ============================================================================

  /**
   * Data Entity Point ID - required field for data entity selection
   * Uses data_entity_point_picker cellType (same as Data Movements relationship)
   */
  dataEntityPointId: string;

  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

/**
 * DataMovement relationship - represents data flows between Application Points.
 *
 * This allows data flows between any combination of Applications, App Components, and Services
 * via their ApplicationPoints.
 *
 * Spec: Data Movement Interface Schema Extension
 * - dataEntityPointId is now OPTIONAL (XOR with interfaceWithSchemaId)
 * - Added interfaceWithSchemaId for Interface (with Schema) level specification
 * - Added biDirectional flag for bi-directional data flows
 *
 * XOR Constraint: Exactly ONE of dataEntityPointId OR interfaceWithSchemaId must be set.
 * - Both set: validation error
 * - Neither set: validation error
 */
export interface DataMovement {
  id: string;
  // FK to application_points.id - source endpoint of the data movement
  source_application_point_id: string;
  // FK to application_points.id - target endpoint of the data movement
  target_application_point_id: string;
  movement_type: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;

  // ============================================================================
  // Data Entity Point ID field (Spec: Data Movement Interface Schema Extension)
  // NOW OPTIONAL - XOR with interfaceWithSchemaId
  // Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities
  // ============================================================================

  /**
   * Data Entity Point ID - optional field for specific data entity selection.
   * XOR constraint: Exactly ONE of dataEntityPointId OR interfaceWithSchemaId must be set.
   */
  dataEntityPointId?: string;

  // ============================================================================
  // Interface (with Schema) ID field (Spec: Data Movement Interface Schema Extension)
  // NEW FIELD - XOR with dataEntityPointId
  // ============================================================================

  /**
   * Interface (with Schema) ID - optional FK to interfaces.
   * When set, implies movable entities are those linked via Interface <-> Entity relationship.
   * XOR constraint: Exactly ONE of dataEntityPointId OR interfaceWithSchemaId must be set.
   */
  interfaceWithSchemaId?: string;

  // ============================================================================
  // Bi-directional Flag (Spec: Data Movement Interface Schema Extension)
  // NEW FIELD - indicates movement applies in both directions
  // ============================================================================

  /**
   * Bi-directional flag - indicates if movement applies in both directions.
   * When true, movement applies Source <-> Target (both directions).
   * Default: false (uni-directional from Source to Target).
   */
  biDirectional?: boolean;
}

// ============================================================================
// CodeUnitDependency relationship (Application domain)
// Spec 2026-05-06: Library Frontend Types & Tables
// Polymorphic via application_points: source can be SERVICE or LIBRARY,
// target is always LIBRARY. No name/valid_from/valid_to (relationship convention).
// ============================================================================
export interface CodeUnitDependency {
  id: string;
  description?: string;
  tags?: string;
  // FK to application_points.id - source endpoint (Service or Library declarer)
  source_application_point_id: string;
  // FK to application_points.id - target endpoint (Library dependency)
  target_application_point_id: string;
  declared_name?: string;
  declared_version?: string;
  declared_version_range?: string;
  scope?: string;
  manifest_path?: string;
  manifest_line?: number;
  evidence_source?: string;
  confidence?: number;
}

// Entity type values (SCREAMING_SNAKE_CASE)
export const ENTITY_TYPES = {
  APPLICATION: 'APPLICATION',
  APP_COMPONENT: 'APP_COMPONENT',
  SERVICE: 'SERVICE',
  INTERFACE: 'INTERFACE',
  ENDPOINT: 'ENDPOINT',
  CLASS: 'CLASS',
  METHOD: 'METHOD',
  APPLICATION_POINT: 'APPLICATION_POINT',
  BUSINESS_USER: 'BUSINESS_USER',
  BUSINESS_PROCESS: 'BUSINESS_PROCESS',
  PROCESS_ACTIVITY: 'PROCESS_ACTIVITY',
  BUSINESS_POINT: 'BUSINESS_POINT',
  LOGICAL_DATA_ENTITY: 'LOGICAL_DATA_ENTITY',
  PHYSICAL_DATA_ENTITY: 'PHYSICAL_DATA_ENTITY',
  LOGICAL_DATA_ATTRIBUTE: 'LOGICAL_DATA_ATTRIBUTE',
  PHYSICAL_DATA_ATTRIBUTE: 'PHYSICAL_DATA_ATTRIBUTE',
  INTERACTION: 'INTERACTION',
  APP_BUSINESS_POINT: 'APP_BUSINESS_POINT',
  EVENT: 'EVENT',  // Behavioural domain entity type
  STATE: 'STATE',  // Behavioural domain entity type
  STATE_TRANSITION: 'STATE_TRANSITION',  // Behavioural domain entity type
  ACTIVITY: 'ACTIVITY',  // Behavioural domain: Activity entity type
  ACTIVITY_FLOW: 'ACTIVITY_FLOW',  // Behavioural domain: ActivityFlow entity type
  ACTIVITY_PARTITION: 'ACTIVITY_PARTITION',  // Behavioural domain: ActivityPartition entity type
  BUSINESS_LOGIC: 'BUSINESS_LOGIC',  // Behavioural domain: BusinessLogic entity type
  UI_SCREEN: 'UI_SCREEN',  // UI Architecture: UIScreen entity type
  UI_WORKFLOW_TRANSITION: 'UI_WORKFLOW_TRANSITION',  // UI Architecture: UIWorkflowTransition entity type
  UI_COMPONENT: 'UI_COMPONENT',  // UI Architecture: UIComponent entity type
  UI_ACTION: 'UI_ACTION',  // UI Architecture: UIAction entity type
  UI_CHARACTERISTIC: 'UI_CHARACTERISTIC',  // UI Architecture: UICharacteristic entity type (Spec 2026-01-20)
  PACKAGE_SET: 'PACKAGE_SET',  // Application domain: PackageSet entity type
  PACKAGE: 'PACKAGE',  // Application domain: Package entity type
} as const;

export type DiagramEntityType = typeof ENTITY_TYPES[keyof typeof ENTITY_TYPES];

// ============================================================================
// Relationship Edge Type Constants
// Used for diagram_edges to identify the relationship type being visualised
// ============================================================================

export const RELATIONSHIP_EDGE_TYPES = {
  // Business Point relationship types
  USER_BUSINESS_POINT: 'USER_BUSINESS_POINT',
  APP_POINT_BUSINESS_POINT: 'APP_POINT_BUSINESS_POINT',
  // Task Group 3.3: User Interaction relationship edge type
  // Used with DiagramEdge.subType field for 'MAIN' or 'USER_LINK' edges
  USER_INTERACTION: 'USER_INTERACTION',
  // Other relationship types
  LOGICAL_DATA_ENTITY_RELATIONSHIP: 'LOGICAL_DATA_ENTITY_RELATIONSHIP',
  LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY: 'LOGICAL_DATA_ENTITY_PHYSICAL_DATA_ENTITY',
  LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE: 'LOGICAL_DATA_ATTRIBUTE_PHYSICAL_DATA_ATTRIBUTE',
  DATA_MOVEMENT: 'DATA_MOVEMENT',
  INTERFACE_LOGICAL_ENTITY: 'INTERFACE_LOGICAL_ENTITY',
  // UI Architecture: UIWorkflowTransition edge type
  UI_WORKFLOW_TRANSITION: 'UI_WORKFLOW_TRANSITION',
  // Spec 2026-05-05: Infrastructure Domain Diagram Support
  // RESOURCE_SUBNET_HOSTING is containment-only (no edge drawn); constant exists for symmetry with RELATIONSHIP_DEFINITIONS.
  RESOURCE_SUBNET_HOSTING: 'RESOURCE_SUBNET_HOSTING',
  // DEPLOYMENT_UNIT_COMPUTE_RESOURCE: DASHED line, no arrow, label "runs on" or version field.
  DEPLOYMENT_UNIT_COMPUTE_RESOURCE: 'DEPLOYMENT_UNIT_COMPUTE_RESOURCE',
  // LOAD_BALANCER_RESOURCE_ROUTE: SOLID line, ARROW at target, label "<protocol> <target_port>".
  LOAD_BALANCER_RESOURCE_ROUTE: 'LOAD_BALANCER_RESOURCE_ROUTE',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new cross-domain edge types
  // APPLICATION_COMPUTE_DEPLOYMENT: SOLID + ARROW, label = deployment_role (fallback "deployed to").
  APPLICATION_COMPUTE_DEPLOYMENT: 'APPLICATION_COMPUTE_DEPLOYMENT',
  // DATA_ENTITY_DATA_STORE_HOSTING: SOLID + ARROW, label = hosting_role (fallback "hosted on").
  DATA_ENTITY_DATA_STORE_HOSTING: 'DATA_ENTITY_DATA_STORE_HOSTING',
  // APPLICATION_INFRASTRUCTURE_RESOURCE_USE: SOLID + ARROW, label = dependency_type (fallback access_mode, then "uses").
  APPLICATION_INFRASTRUCTURE_RESOURCE_USE: 'APPLICATION_INFRASTRUCTURE_RESOURCE_USE',
  // APPLICATION_LOAD_BALANCER_EXPOSURE: SOLID + ARROW, label = "<protocol> <target_port>" (fallback "exposed via").
  APPLICATION_LOAD_BALANCER_EXPOSURE: 'APPLICATION_LOAD_BALANCER_EXPOSURE',
} as const;

export type RelationshipEdgeType = typeof RELATIONSHIP_EDGE_TYPES[keyof typeof RELATIONSHIP_EDGE_TYPES];

// ============================================================================
// User Interaction Edge SubType
// Used for distinguishing MAIN and USER_LINK edges in USER_INTERACTION relationships
// ============================================================================

/**
 * UserInteractionEdgeSubType - discriminator for User Interaction edge variants
 *
 * Used with DiagramEdge when relationship_type is 'USER_INTERACTION':
 * - 'MAIN': Primary edge connecting App_Business_Point nodes (Case A: P to S, Case B: U to P)
 * - 'USER_LINK': Secondary edge connecting User node to MAIN edge midpoint (Case A only)
 *
 * Both edge types use dotted line styling via LINE_DASHES_DOTTED constant.
 */
export type UserInteractionEdgeSubType = 'MAIN' | 'USER_LINK';

// ============================================================================
// Edge Styling Constants
// Constants for consistent edge styling across the application
// ============================================================================

/**
 * LINE_DASHES_DOTTED - SVG stroke-dasharray value for dotted line styling
 *
 * Used for User Interaction edges (both MAIN and USER_LINK subtypes).
 * Value '4,4' creates evenly spaced dots with 4px dash and 4px gap.
 * Apply to DiagramEdge.line_dashes field for consistent dotted appearance.
 */
export const LINE_DASHES_DOTTED = '4,4';

// Text alignment types
export type TextHorizontalAlign = 'LEFT' | 'CENTER' | 'RIGHT';
export type TextVerticalAlign = 'TOP' | 'MIDDLE' | 'BOTTOM';

// ============================================================================
// Decoration Types
// Decorations are purely visual elements, separate from the meta-model.
// Extended to support multiple shape types and arrow variations.
// ============================================================================

// Decoration alignment types (for text inside decorations)
export type DecorationHAlign = 'LEFT' | 'CENTER' | 'RIGHT';
export type DecorationVAlign = 'TOP' | 'MIDDLE' | 'BOTTOM';

// Line style for decoration borders and lines
export type LineStyle = 'SOLID' | 'DASHED' | 'DOTTED';

// Arrow type for LINE decoration endpoints
export type ArrowType = 'NONE' | 'ARROW';

// ============================================================================
// Extended Decoration Type System (Task Group 1)
// ============================================================================

// All decoration types (13 total)
export type DecorationType =
  | 'TEXT'          // Transparent box (text-only, no visible background/border)
  | 'BOX'           // Rectangle
  | 'LINE'          // Polyline without arrows
  | 'OVAL'          // Ellipse/oval (terminator)
  | 'DIAMOND'       // Rhombus (decision)
  | 'PARALLELOGRAM' // Slanted rectangle (input/output)
  | 'ARROW_SINGLE'  // Line with single arrowhead at end
  | 'ARROW_DOUBLE'  // Line with arrowheads at both ends
  | 'CIRCLE'        // Perfect circle (connector)
  | 'CYLINDER'      // Database/data store shape
  | 'TRAPEZOID'     // Manual operation shape
  | 'HEXAGON'       // Preparation/initialization shape
  | 'NOTE';         // Post-it note shape (folded top-left corner)

// Shape decoration types (10 area-based shapes)
export type ShapeDecorationType =
  | 'TEXT'
  | 'BOX'
  | 'OVAL'
  | 'DIAMOND'
  | 'PARALLELOGRAM'
  | 'CIRCLE'
  | 'CYLINDER'
  | 'TRAPEZOID'
  | 'HEXAGON'
  | 'NOTE';

// Line decoration types (3 line-based shapes)
export type LineDecorationType =
  | 'LINE'
  | 'ARROW_SINGLE'
  | 'ARROW_DOUBLE';

// Arrays of decoration types for iteration and validation
export const DECORATION_TYPES: DecorationType[] = [
  'TEXT',
  'BOX',
  'LINE',
  'OVAL',
  'DIAMOND',
  'PARALLELOGRAM',
  'ARROW_SINGLE',
  'ARROW_DOUBLE',
  'CIRCLE',
  'CYLINDER',
  'TRAPEZOID',
  'HEXAGON',
  'NOTE',
];

export const SHAPE_DECORATION_TYPES: ShapeDecorationType[] = [
  'TEXT',
  'BOX',
  'OVAL',
  'DIAMOND',
  'PARALLELOGRAM',
  'CIRCLE',
  'CYLINDER',
  'TRAPEZOID',
  'HEXAGON',
  'NOTE',
];

export const LINE_DECORATION_TYPES: LineDecorationType[] = [
  'LINE',
  'ARROW_SINGLE',
  'ARROW_DOUBLE',
];

// ============================================================================
// Temporal Diagram Element Type
// Used for diagram-level temporality (nodes, edges, decorations)
// ============================================================================

/**
 * TemporalDiagramElement - helper type for elements with temporal validity
 * Used by isDiagramElementVisibleInPeriod() for type-safe temporal filtering
 * Format: "YYYY-Qn" (e.g., "2026-Q2")
 *
 * Null/undefined values mean "always valid" (timeless):
 * - valid_from undefined: visible from the beginning of time
 * - valid_to undefined: visible until the end of time
 */
export interface TemporalDiagramElement {
  valid_from?: string;
  valid_to?: string;
}

// Base interface with shared properties for all decoration types
// Now includes temporal validity fields for diagram-level temporality
export interface DecorationBase {
  id: string;
  text?: string;
  text_font_size?: number;
  text_font_weight?: string;
  text_font_style?: string;
  text_text_decoration?: string;
  text_color?: string;
  line_color?: string;
  line_style?: LineStyle;
  line_weight?: string;
  z_index?: number;
  // Opacity controls (0-100, where 0 = fully transparent, 100 = fully opaque)
  // Undefined/missing defaults to 100 (fully opaque) for backward compatibility
  background_opacity?: number;
  border_opacity?: number;
  // Temporal validity fields for diagram-level temporality - format: "YYYY-Qn" (e.g., "2026-Q2")
  // Null/undefined means "always valid" (timeless)
  valid_from?: string;
  valid_to?: string;
  linkedDiagramId?: string;
}

// ShapeDecoration - unified interface for all area-based shapes
// Includes BOX, OVAL, DIAMOND, PARALLELOGRAM, CIRCLE, CYLINDER, TRAPEZOID, HEXAGON, NOTE
export interface ShapeDecoration extends DecorationBase {
  type: ShapeDecorationType;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text_h_align?: DecorationHAlign;
  text_v_align?: DecorationVAlign;
  background_color?: string;
  /** Whether the shape should auto-resize to fit its text content */
  auto_size?: boolean;
}

// BOX decoration - kept as alias for backward compatibility
// Now a specific case of ShapeDecoration with type: 'BOX'
export interface BoxDecoration extends DecorationBase {
  type: 'BOX';
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  text_h_align?: DecorationHAlign;
  text_v_align?: DecorationVAlign;
  background_color?: string;
  /** Whether the shape should auto-resize to fit its text content */
  auto_size?: boolean;
}

// LINE decoration - polyline with optional label and arrows
// Extended to support LINE, ARROW_SINGLE, and ARROW_DOUBLE types
export interface LineDecoration extends DecorationBase {
  type: LineDecorationType;
  line_points: Array<{ x: number; y: number }>;
  label_pos_x?: number;
  label_pos_y?: number;
  arrow_start?: ArrowType;
  arrow_end?: ArrowType;
}

// Union type for all decoration types
// Includes both shape-based and line-based decorations
export type Decoration = ShapeDecoration | LineDecoration;

// ============================================================================
// Label Decoration Types (Task Group 5: Movable/Resizable Labels A5)
// Labels are independent visual elements associated with nodes or edges
// Used for Activity diagram node and flow labels
// ============================================================================

/**
 * LabelTargetKind - indicates what type of element a label decoration is attached to.
 * NODE: Label is attached to a DiagramNode (e.g., Activity node)
 * EDGE: Label is attached to a DiagramEdge (e.g., Activity Flow edge)
 */
export type LabelTargetKind = 'NODE' | 'EDGE';

/**
 * SVG text-anchor values for horizontal text alignment
 */
export type SVGTextAnchor = 'start' | 'middle' | 'end';

/**
 * SVG dominant-baseline values for vertical text alignment
 */
export type SVGDominantBaseline = 'auto' | 'middle' | 'hanging' | 'text-top' | 'text-bottom';

/**
 * LabelDecoration interface - represents a movable/resizable label attached to a node or edge.
 *
 * Task Group 5: Labels are independent visual elements that can be dragged and resized
 * without affecting the underlying node or edge. They enable custom positioning of
 * text labels in Activity diagrams.
 *
 * Properties:
 * - id: Unique identifier for the label decoration
 * - targetKind: Whether attached to a NODE or EDGE
 * - targetId: The ID of the node or edge this label belongs to
 * - x, y: Position of the label (top-left corner)
 * - width, height: Dimensions of the label bounding box
 * - text: Optional text override (if not provided, uses entity/edge name)
 * - textAnchor: SVG text-anchor for horizontal alignment
 * - dominantBaseline: SVG dominant-baseline for vertical alignment
 */
export interface LabelDecoration {
  /** Unique identifier for this label decoration */
  id: string;
  /** Whether attached to a NODE or EDGE */
  targetKind: LabelTargetKind;
  /** The ID of the node or edge this label belongs to */
  targetId: string;
  /** X position of the label (top-left corner of bounding box) */
  x: number;
  /** Y position of the label (top-left corner of bounding box) */
  y: number;
  /** Width of the label bounding box */
  width: number;
  /** Height of the label bounding box */
  height: number;
  /** Optional text override (if not provided, uses entity/edge name) */
  text?: string;
  /** SVG text-anchor for horizontal alignment (default: 'middle') */
  textAnchor?: SVGTextAnchor;
  /** SVG dominant-baseline for vertical alignment (default: 'middle') */
  dominantBaseline?: SVGDominantBaseline;
  /** Font size for the label text */
  fontSize?: number;
  /** Font weight for the label text */
  fontWeight?: string;
  /** Text color for the label */
  textColor?: string;
  /** Z-index for rendering order */
  z_index?: number;
}

/**
 * Default values for LabelDecoration properties
 */
export const LABEL_DECORATION_DEFAULTS = {
  textAnchor: 'middle' as SVGTextAnchor,
  dominantBaseline: 'middle' as SVGDominantBaseline,
  fontSize: 12,
  fontWeight: 'normal',
  textColor: '#333333',
  z_index: 115, // Above nodes (100) and edges (110), but below LINE decorations (120)
  // Default label dimensions
  width: 80,
  height: 20,
  // Offset for Decision labels (below diamond)
  decisionLabelOffset: 8,
  // Offset for edge labels (above line)
  edgeLabelOffset: 5,
} as const;

/**
 * Type guard to check if an object is a LabelDecoration
 * @param obj - Object to check
 * @returns true if the object is a valid LabelDecoration
 */
export function isLabelDecoration(obj: unknown): obj is LabelDecoration {
  if (!obj || typeof obj !== 'object') return false;
  const label = obj as Record<string, unknown>;
  return (
    typeof label.id === 'string' &&
    (label.targetKind === 'NODE' || label.targetKind === 'EDGE') &&
    typeof label.targetId === 'string' &&
    typeof label.x === 'number' &&
    typeof label.y === 'number' &&
    typeof label.width === 'number' &&
    typeof label.height === 'number'
  );
}

/**
 * Factory function to create a default LabelDecoration
 * @param targetKind - Whether attached to a NODE or EDGE
 * @param targetId - The ID of the node or edge this label belongs to
 * @param x - X position of the label
 * @param y - Y position of the label
 * @param width - Width of the label bounding box
 * @param height - Height of the label bounding box
 * @param text - Optional text override
 * @returns A new LabelDecoration with default styling
 */
export function createDefaultLabelDecoration(
  targetKind: LabelTargetKind,
  targetId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text?: string
): LabelDecoration {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);

  return {
    id: `label_${timestamp}_${randomSuffix}`,
    targetKind,
    targetId,
    x,
    y,
    width,
    height,
    text,
    textAnchor: LABEL_DECORATION_DEFAULTS.textAnchor,
    dominantBaseline: LABEL_DECORATION_DEFAULTS.dominantBaseline,
    fontSize: LABEL_DECORATION_DEFAULTS.fontSize,
    fontWeight: LABEL_DECORATION_DEFAULTS.fontWeight,
    textColor: LABEL_DECORATION_DEFAULTS.textColor,
    z_index: LABEL_DECORATION_DEFAULTS.z_index,
  };
}

// ============================================================================
// ERD/UML-Style Rendering Types
// Render style for nodes that support ERD-style class-box visualization
// ============================================================================

/**
 * Render style type for DiagramNode
 * - 'standard': Default rectangular box rendering
 * - 'erd': ERD/UML class-box style with header, divider, and attribute rows
 * - 'contract': Interface contract style with header, endpoints section, and entities section
 */
export type NodeRenderStyle = 'standard' | 'erd' | 'contract';

// ============================================================================
// Diagram Structures
// ============================================================================

export interface EdgePoint {
  id: string;
  sequence_order: number;
  pos_x: number;
  pos_y: number;
}

export interface DiagramEdge {
  id: string;
  relationship_type: string;
  relationship_id: string;
  source_node_id: string;
  target_node_id: string;
  label_text?: string;
  label_pos_x?: number;
  label_pos_y?: number;
  line_weight?: string;
  line_type?: string;
  line_dashes?: string;
  arrow_start?: string;
  arrow_end?: string;
  style_override?: Record<string, unknown>;
  edge_points: EdgePoint[];
  // Font styling for edge labels
  label_font_size?: string;
  label_font_weight?: string;
  label_font_style?: string;
  // Text decoration for edge labels (values: "underline" | "none")
  label_text_decoration?: string;
  // Label alignment (for future use)
  label_h_align?: TextHorizontalAlign;
  label_v_align?: TextVerticalAlign;
  // Colour customization for edges
  line_color?: string;   // hex colour for edge stroke
  text_color?: string;   // hex colour for edge label_text

  // ============================================================================
  // User Interaction Edge SubType
  // Only applicable when relationship_type is 'USER_INTERACTION'
  // ============================================================================
  /**
   * SubType for User Interaction edges.
   * - 'MAIN': Primary edge connecting App_Business_Point nodes
   * - 'USER_LINK': Secondary edge connecting User node to MAIN edge midpoint
   * Only set when relationship_type is 'USER_INTERACTION'.
   */
  subType?: UserInteractionEdgeSubType;

  // ============================================================================
  // Multiplicity Label Fields (for Logical ER relationships)
  // Source and target labels are rendered near the respective endpoints
  // ============================================================================
  source_label_text?: string;     // e.g., "1" or "m" near source node
  source_label_pos_x?: number;    // X position of source label
  source_label_pos_y?: number;    // Y position of source label
  target_label_text?: string;     // e.g., "1" or "m" near target node
  target_label_pos_x?: number;    // X position of target label
  target_label_pos_y?: number;    // Y position of target label

  // ============================================================================
  // Z-Index for Edge Rendering Order
  // Controls the draw order relative to other diagram elements
  // ============================================================================
  /** Z-index for controlling edge draw order (default: 110) */
  z_index?: number;

  // ============================================================================
  // Temporal Validity Fields for Diagram-Level Temporality
  // Controls when this diagram edge layout is visible
  // Format: "YYYY-Qn" (e.g., "2026-Q2")
  // Null/undefined means "always valid" (timeless)
  // ============================================================================
  valid_from?: string;
  valid_to?: string;
  linkedDiagramId?: string;
}

export interface DiagramNode {
  id: string;
  entity_type: string;
  entity_id: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  auto_size?: boolean;
  z_index?: number;
  parent_node_id: string | null;
  style_override?: Record<string, unknown>;
  text_h_align?: TextHorizontalAlign;
  text_v_align?: TextVerticalAlign;
  // Text area and font styling for node labels
  text_area_width?: number;
  text_font_size?: string;
  text_font_weight?: string;
  text_font_style?: string;
  // Text decoration for node labels (values: "underline" | "none")
  text_text_decoration?: string;
  // Colour customization for nodes
  background_color?: string;  // hex colour for node fill
  line_color?: string;        // hex colour for node border/stroke
  line_weight?: string;       // CSS pixel string for node border stroke width (e.g., "2px")
  text_color?: string;        // hex colour for node label text

  // ============================================================================
  // ERD/UML-Style Rendering Fields
  // For rendering Logical/Physical Data Entities in class-box style
  // ============================================================================

  /**
   * Rendering style for the node.
   * - 'standard': Default rectangular box (entity name only)
   * - 'erd': ERD/UML class-box style with header, divider, and attribute rows
   * - 'contract': Interface contract style with header, endpoints, and entities sections
   * Defaults to 'standard' if not specified.
   */
  render_style?: NodeRenderStyle;

  /**
   * For ERD-style rendering: IDs of attributes to render inside this node.
   * When render_style is 'erd', these attribute IDs are displayed as text rows
   * inside the node instead of being rendered as separate child nodes.
   * Only applicable to LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY types.
   */
  embedded_attribute_ids?: string[];

  /**
   * For Advanced Add dialog: IDs of selected attributes to render inside this node.
   * When present, these attributes are rendered as rows inside the entity box.
   * This field is populated when users select specific attributes via Advanced Add.
   * Only applicable to LOGICAL_DATA_ENTITY and PHYSICAL_DATA_ENTITY types.
   *
   * Backward compatibility: If this field is undefined, fall back to showing
   * all attributes (via embedded_attribute_ids or getAttributesForEntity).
   *
   * Task Group 2: Added for "Advanced Add - Do Not Create Attribute Nodes" feature.
   */
  selected_attribute_ids?: string[];

  /**
   * For contract-style rendering: IDs of endpoints to render inside this node.
   * When render_style is 'contract', these endpoint IDs are displayed as text rows
   * in the endpoints section of the Interface contract box.
   * Only applicable to INTERFACE entity type.
   */
  embedded_endpoint_ids?: string[];

  /**
   * For contract-style rendering: IDs of logical entities to render inside this node.
   * When render_style is 'contract', these entity IDs are displayed as mini boxes
   * in the entities section of the Interface contract box.
   * Only applicable to INTERFACE entity type.
   */
  embedded_entity_ids?: string[];

  // ============================================================================
  // Temporal Validity Fields for Diagram-Level Temporality
  // Controls when this diagram node layout is visible
  // Format: "YYYY-Qn" (e.g., "2026-Q2")
  // Null/undefined means "always valid" (timeless)
  // ============================================================================
  valid_from?: string;
  valid_to?: string;
  linkedDiagramId?: string;
}

// ============================================================================
// DiagramUserInteraction - Represents user interaction lines on diagram
// Used to render dotted lines between App_Business_Point nodes
// @deprecated Use DiagramInteractionEdge for new implementations
// ============================================================================

/**
 * DiagramUserInteraction interface - diagram-specific representation of an Interaction
 *
 * This links Interaction entities to their visual representation on diagrams,
 * including the nodes involved and line styling.
 *
 * @deprecated Use DiagramInteractionEdge for new implementations.
 * This interface is retained for backward compatibility with existing diagrams.
 */
export interface DiagramUserInteraction {
  /** Diagram-specific ID for this user interaction visualization */
  id: string;
  /** FK to Interaction entity in meta-model */
  interaction_id: string;
  /** FK to DiagramNode for the primary App_Business_Point */
  primary_node_id: string;
  /** FK to DiagramNode for the secondary App_Business_Point (optional) */
  secondary_node_id?: string;
  /** FK to DiagramNode for the user (optional - if user is on diagram) */
  user_node_id?: string;
  /** Visual style for the interaction line */
  line_style: 'dotted' | 'solid';
}

// ============================================================================
// Task Group 3: DiagramInteractionEdge - New edge-based representation
// Replaces entity nodes (yellow boxes) with relationship edges (dotted lines)
// ============================================================================

/**
 * DiagramInteractionEdge interface - edge-based representation of Interactions
 *
 * Task Group 3: This replaces the old node-based rendering of Interactions
 * with a new edge-based rendering. Interactions are now visualized as:
 * - Dotted lines between App_Business_Point nodes
 * - Movable labels on the edges
 * - Optional user link to midpoint
 *
 * Visualization:
 * - Two points: [App 1] <---- "Interaction" ----> [App 2] with user link to midpoint
 * - One point: [User] <---- "Interaction" ----> [App] direct connection
 */
export interface DiagramInteractionEdge {
  /** Unique ID for this edge instance on the diagram */
  id: string;
  /** FK to Interaction entity in meta-model */
  interaction_id: string;
  /** Relationship type identifier - always 'USER_INTERACTION' */
  relationship_type: 'USER_INTERACTION';
  /** FK to DiagramNode for the source (primary App_Business_Point or User) */
  source_node_id: string;
  /** FK to DiagramNode for the target (secondary App_Business_Point or primary if only one) */
  target_node_id: string;
  /** Edge points for the main interaction line (source to target) */
  edge_points: EdgePoint[];
  /** Label text displayed on the edge (typically Interaction name) */
  label_text?: string;
  /** X position of the label */
  label_pos_x?: number;
  /** Y position of the label */
  label_pos_y?: number;
  /** FK to DiagramNode for the user (optional - for user link rendering) */
  user_node_id?: string;
  /** Edge points for the user link line (user to midpoint) */
  user_link_edge_points?: EdgePoint[];
  /** Visual style for the interaction line - typically 'dotted' */
  line_style: 'dotted' | 'solid';
}

// ============================================================================
// TypedContent Type Import
// Import from typedContent.ts for type-safe typed diagram content handling
// ============================================================================

import type { TypedContentEnvelope } from './typedContent';

// ============================================================================
// Package Set Default Rule (Spec: Package Set Standards Import - Iteration 6)
// Import from packageSetStandards.ts for type-safe default rule handling
// ============================================================================

import type { PackageSetDefaultRule } from './packageSetStandards';

export interface Diagram {
  id: string;
  name: string;
  description: string;
  diagram_type?: string;
  settings?: Record<string, unknown>;
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  // Decorations - purely visual elements separate from meta-model
  // Stored in a separate array, not in diagram_nodes or diagram_edges
  // Optional for backward compatibility - defaults to empty array when missing
  decorations?: Decoration[];
  // Label decorations for Activity diagram nodes and edges
  // Task Group 5: Movable/resizable labels for Activity diagrams
  // Optional for backward compatibility - defaults to empty array when missing
  label_decorations?: LabelDecoration[];
  // User Interactions - dotted lines representing user interactions with App_Business_Points
  // Optional for backward compatibility - defaults to empty array when missing
  // @deprecated Use interaction_edges for new implementations
  user_interactions?: DiagramUserInteraction[];
  // Task Group 3.4: New edge-based interaction representation
  // Interaction edges render Interactions as dotted lines with movable labels
  // Optional for backward compatibility - defaults to empty array when missing
  interaction_edges?: DiagramInteractionEdge[];
  // Temporal view state - format: "YYYY-Qn" (e.g., "2026-Q4")
  // Stores the canonical time state for the diagram
  // Defaults to current quarter or "2026-Q4" if missing
  view_quarter?: string;

  // ============================================================================
  // TypedContent - Type-specific content for typed diagrams (Sequence, ER, Activity, State)
  // Stores type-specific content (participants, messages, etc.) directly on the diagram
  // Optional for backward compatibility - General diagrams have undefined typedContent
  // Backend stores this in diagrams.typed_content_json (JSONB column)
  // ============================================================================
  /**
   * Type-specific content for typed diagrams.
   *
   * Contains structured content specific to the diagram type:
   * - Sequence: participants, messages, fragments, operands, sequenceNodes
   * - ER: entityRefs, relationshipRefs
   * - Activity: partitions, flows
   * - State: states, transitions
   *
   * General diagrams have typedContent as undefined.
   * The envelope structure includes type, version, and content fields.
   */
  typedContent?: TypedContentEnvelope;
}

// ============================================================================
// Element Context Menu State
// Used for right-click context menu on canvas elements (nodes, edges, decorations)
// ============================================================================

/** Element type for context menu targeting */
export type ElementContextMenuType = 'node' | 'edge' | 'shape-decoration' | 'line-decoration';

/**
 * State interface for element context menu
 * Controls visibility and positioning of the right-click context menu on canvas elements
 */
export interface ElementContextMenuState {
  /** Whether the context menu is visible */
  visible: boolean;
  /** X coordinate (screen position) of the menu */
  x: number;
  /** Y coordinate (screen position) of the menu */
  y: number;
  /** Type of element being right-clicked */
  elementType: ElementContextMenuType;
  /** ID of the element being right-clicked */
  elementId: string;
  /** Current auto_size value (only for nodes and shape decorations) */
  currentAutoSize?: boolean;
}

// ============================================================================
// Infrastructure Domain Entities (Spec 2026-05-04: Infrastructure Domain Frontend Types)
// 12 entity interfaces, plus polymorphic InfrastructurePoint with point_kind discriminator,
// plus 3 relationship interfaces. Field names mirror backend JSON contract exactly (snake_case).
// model_file_id is server-side only and does NOT appear on any frontend interface.
// All enum-style TEXT fields are typed `?: string` (no string-literal unions);
// InfrastructurePoint.point_kind is the only string-literal union introduced.
// ============================================================================

/** Environment - top-level deployment environment (e.g., prod, staging, dev). */
export interface Environment {
  id: string;
  name: string;
  description: string;
  environment_type?: string;
  lifecycle_state?: string;
  is_current_state?: boolean;
  is_target_state?: boolean;
  owner?: string;
  criticality?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** CloudAccount - a cloud provider account/subscription scoped to an Environment. */
export interface CloudAccount {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  provider?: string;
  external_account_id?: string;
  parent_org_id?: string;
  billing_owner?: string;
  technical_owner?: string;
  landing_zone_name?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** Location - physical or logical location (region/zone/datacentre/office/etc.). */
export interface Location {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_type?: string;
  provider?: string;
  provider_region_code?: string;
  provider_zone_code?: string;
  country?: string;
  city?: string;
  address?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** Network - VPC / VNet / on-prem network. */
export interface Network {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  network_type?: string;
  provider?: string;
  cidr?: string;
  external_id?: string;
  is_shared?: boolean;
  routing_mode?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** Subnet - a subnetwork within a Network. */
export interface Subnet {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  network_id?: string;
  location_id?: string;
  cidr?: string;
  subnet_type?: string;
  visibility?: string;
  provider_region_code?: string;
  provider_zone_code?: string;
  external_id?: string;
  gateway_address?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** ComputeCluster - logical compute cluster (Kubernetes cluster, ECS cluster, etc.). */
export interface ComputeCluster {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  network_id?: string;
  platform_type?: string;
  provider?: string;
  version?: string;
  external_id?: string;
  owner?: string;
  operating_model?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** ComputeResource - individual compute unit (VM, container host, function runtime, etc.). */
export interface ComputeResource {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  cluster_id?: string;
  compute_type?: string;
  provider?: string;
  hostname?: string;
  fqdn?: string;
  private_ip?: string;
  public_ip?: string;
  os?: string;
  runtime?: string;
  instance_size?: string;
  scaling_min?: number;
  scaling_max?: number;
  external_id?: string;
  lifecycle_state?: string;
  owner?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** DeploymentUnit - a deployable unit of a Service (image/artifact/build target). */
export interface DeploymentUnit {
  id: string;
  name: string;
  description: string;
  // Direct typed FK to services.id (NOT application_entity_id - backend wins)
  service_id?: string;
  deployment_unit_type?: string;
  version?: string;
  artifact_uri?: string;
  image_name?: string;
  image_tag?: string;
  source_repository?: string;
  source_commit?: string;
  build_pipeline?: string;
  owner?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** LoadBalancer - L4/L7 load balancer in front of compute resources. */
export interface LoadBalancer {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  network_id?: string;
  load_balancer_type?: string;
  provider?: string;
  exposure?: string;
  scheme?: string;
  dns_name?: string;
  ip_address?: string;
  external_id?: string;
  owner?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** Listener - listener/frontend on a LoadBalancer (protocol+port+host+path). */
export interface Listener {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  load_balancer_id?: string;
  // Direct FK to compute_resources.id (per backend A1 lock - listener attaches directly to a compute resource)
  compute_resource_id?: string;
  protocol?: string;
  port?: number;
  host_name?: string;
  path_pattern?: string;
  exposure?: string;
  is_public?: boolean;
  certificate_reference?: string;
  external_id?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** DataStoreInstance - a database/queue/cache/storage instance. */
export interface DataStoreInstance {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  data_store_type?: string;
  engine?: string;
  engine_version?: string;
  provider?: string;
  host?: string;
  port?: number;
  external_id?: string;
  encrypted?: boolean;
  ha_enabled?: boolean;
  backup_enabled?: boolean;
  owner?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

/** InfrastructureResource - generic infrastructure resource (catch-all for resources not covered by other entities). */
export interface InfrastructureResource {
  id: string;
  name: string;
  description: string;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  resource_type?: string;
  provider?: string;
  provider_resource_type?: string;
  endpoint?: string;
  external_id?: string;
  criticality?: string;
  owner?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;

}

// ============================================================================
// InfrastructurePoint - polymorphic supertype for the 12 Infrastructure entities.
// BusinessPoint-style envelope: required name/description, point_kind discriminator,
// 12 optional typed FK fields. Auto-created and synchronized from source entities.
// ============================================================================

/** InfrastructurePointKind - discriminator for InfrastructurePoint, one per Infrastructure entity. */
export type InfrastructurePointKind =
  | 'ENVIRONMENT'
  | 'CLOUD_ACCOUNT'
  | 'LOCATION'
  | 'NETWORK'
  | 'SUBNET'
  | 'COMPUTE_CLUSTER'
  | 'COMPUTE_RESOURCE'
  | 'DEPLOYMENT_UNIT'
  | 'LOAD_BALANCER'
  | 'LISTENER'
  | 'DATA_STORE_INSTANCE'
  | 'INFRASTRUCTURE_RESOURCE';

/** InfrastructurePoint - polymorphic supertype mirroring backend infrastructure_points table. */
export interface InfrastructurePoint {
  id: string;
  name: string;
  description: string;
  point_kind: InfrastructurePointKind;
  environment_id?: string;
  cloud_account_id?: string;
  location_id?: string;
  network_id?: string;
  subnet_id?: string;
  compute_cluster_id?: string;
  compute_resource_id?: string;
  deployment_unit_id?: string;
  load_balancer_id?: string;
  listener_id?: string;
  data_store_instance_id?: string;
  infrastructure_resource_id?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}

// ============================================================================
// Infrastructure Relationship Interfaces (3)
// snake_case fields, required `description`, required FKs where backend column is NOT NULL,
// `tags: string`, optional fields with `?`. Polymorphic *_point_id references go via InfrastructurePoint.
// `environment_id: string` is required on all 3 (backend NOT NULL).
// ============================================================================

/**
 * ResourceSubnetHosting - polymorphic relationship pinning an InfrastructurePoint to a Subnet.
 * Source is polymorphic via infrastructure_point_id.
 */
export interface ResourceSubnetHosting {
  id: string;
  description: string;
  // Polymorphic source via InfrastructurePoint
  infrastructure_point_id: string;
  subnet_id: string;
  environment_id: string;
  relationship_role?: string;
  primary_ip?: string;
  private_ip?: string;
  public_ip?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  tags: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;

}

/**
 * DeploymentUnitComputeResource - relationship from DeploymentUnit to a polymorphic compute target
 * (typically a ComputeResource or ComputeCluster InfrastructurePoint).
 */
export interface DeploymentUnitComputeResource {
  id: string;
  description: string;
  deployment_unit_id: string;
  // Polymorphic compute target via InfrastructurePoint (allowed kinds: COMPUTE_RESOURCE, COMPUTE_CLUSTER - documentation-only)
  compute_infrastructure_point_id: string;
  environment_id: string;
  version?: string;
  // JSONB on backend - matches Service.core_tech_resolved precedent
  runtime_config?: Record<string, unknown> | null;
  desired_instances?: number;
  min_instances?: number;
  max_instances?: number;
  deployment_status?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  tags: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;

}

/**
 * LoadBalancerResourceRoute - routing rule from a LoadBalancer (optionally via a Listener)
 * to a polymorphic infrastructure target.
 */
export interface LoadBalancerResourceRoute {
  id: string;
  description: string;
  load_balancer_id: string;
  listener_id?: string;
  // Polymorphic target via InfrastructurePoint
  target_infrastructure_point_id: string;
  environment_id: string;
  protocol?: string;
  target_port?: number;
  host_name?: string;
  path_pattern?: string;
  routing_type?: string;
  weight?: number;
  health_check_path?: string;
  tags: string;
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;

}

// ============================================================================
// Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain
// relationship interfaces. Source-side FKs (Rels 1, 3, 4 use application_point_id;
// Rel 2 uses data_entity_point_id) are required. Primary Infra-side target FKs
// are required. environment_id is optional (NULL on backend - differs from spec 1).
// `description: string` and `tags: string` required. snake_case fields throughout.
// ============================================================================

/**
 * ApplicationComputeDeployment - application/service deployed to a Compute Resource
 * (optionally via a Deployment Unit).
 */
export interface ApplicationComputeDeployment {
  id: string;
  application_point_id: string;
  compute_resource_id: string;
  deployment_unit_id?: string;
  environment_id?: string;
  deployment_role?: string;
  runtime_name?: string;
  runtime_version?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  description: string;
  tags: string;
}

/**
 * DataEntityDataStoreHosting - data entity hosted on a Data Store Instance.
 */
export interface DataEntityDataStoreHosting {
  id: string;
  data_entity_point_id: string;
  data_store_instance_id: string;
  environment_id?: string;
  database_name?: string;
  schema_name?: string;
  table_or_collection_name?: string;
  hosting_role?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  description: string;
  tags: string;
}

/**
 * ApplicationInfrastructureResourceUse - application/service uses an Infrastructure Resource
 * (bucket, queue, topic, cache, secret store, scheduler, registry, CDN).
 */
export interface ApplicationInfrastructureResourceUse {
  id: string;
  application_point_id: string;
  infrastructure_resource_id: string;
  environment_id?: string;
  dependency_type?: string;
  protocol?: string;
  endpoint_or_topic?: string;
  access_mode?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  description: string;
  tags: string;
}

/**
 * ApplicationLoadBalancerExposure - application/service exposed through a Load Balancer
 * (and optionally a specific Listener).
 */
export interface ApplicationLoadBalancerExposure {
  id: string;
  application_point_id: string;
  load_balancer_id: string;
  listener_id?: string;
  environment_id?: string;
  host_name?: string;
  path_pattern?: string;
  protocol?: string;
  // INTEGER on backend - number on frontend
  target_port?: number;
  exposure?: string;
  evidence_source?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  description: string;
  tags: string;
}


// ============================================================================
// Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
// 2 new interfaces:
//   - IaCSource (entity-shaped, full envelope with name/description/tags)
//   - IaCResourceBinding (relationship-shaped, no `name`, polymorphic-target via
//     infrastructure_point_id; references an iac_sources row via iac_source_id)
// snake_case fields throughout, mirroring backend JSON contract.
// ============================================================================

/** IaCSource - IaC source-of-record (Terraform repo / OpenTofu / CloudFormation / Pulumi etc.). */
export interface IaCSource {
  id: string;
  name: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  environment_id?: string;
  source_type?: string;
  repository_url?: string;
  repository_provider?: string;
  branch?: string;
  commit_sha?: string;
  path?: string;
  workspace?: string;
  module_name?: string;
  module_path?: string;
  provider?: string;
  owner?: string;
  last_scanned_at?: string;
  last_imported_at?: string;
}

/** IaCResourceBinding - mapping between an Infrastructure entity (via InfrastructurePoint)
 *  and a current/future IaC resource address (Terraform module address, CloudFormation
 *  logical ID, Pulumi URN, etc.). */
export interface IaCResourceBinding {
  id: string;
  iac_source_id: string;
  infrastructure_point_id: string;
  environment_id?: string;
  iac_address?: string;
  iac_resource_type?: string;
  iac_resource_name?: string;
  provider?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  state_resource_id?: string;
  external_id?: string;
  binding_status?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  last_seen_at?: string;
  description: string;
  tags: string;
}

// MetaModel nested structure
export interface MetaModelEntities {
  business_users: BusinessUser[];
  business_processes: BusinessProcess[];
  process_activities: ProcessActivity[];
  business_points: BusinessPoint[];
  applications: Application[];
  app_components: ApplicationComponent[];
  services: Service[];
  interfaces: Interface[];
  endpoints: Endpoint[];
  classes: Class[];
  methods: Method[];
  application_points: ApplicationPoint[];
  logical_data_entities: LogicalDataEntity[];
  logical_data_attributes: LogicalDataAttribute[];
  physical_data_entities: PhysicalDataEntity[];
  physical_data_attributes: PhysicalDataAttribute[];
  interactions: Interaction[];
  app_business_points: AppBusinessPoint[];
  events: Event[];  // Behavioural domain: Events
  states: State[];  // Behavioural domain: States
  state_transitions: StateTransition[];  // Behavioural domain: StateTransitions
  activities: Activity[];  // Behavioural domain: Activities
  activity_flows: ActivityFlow[];  // Behavioural domain: ActivityFlows
  activity_partitions: ActivityPartition[];  // Behavioural domain: ActivityPartitions
  business_logics: BusinessLogic[];  // Behavioural domain: BusinessLogics
  ui_screens: UIScreen[];  // UI Architecture: UIScreens
  ui_components: UIComponent[];  // UI Architecture: UIComponents
  ui_actions: UIAction[];  // UI Architecture: UIActions
  ui_characteristics: UICharacteristic[];  // UI Architecture: UICharacteristics (Spec 2026-01-20)
  package_sets: PackageSet[];  // Application domain: PackageSets
  packages: Package[];  // Application domain: Packages
  // Package Set Standards Import (Iteration 6): Default rules for resolving "Default (Auto)" package sets
  // Loaded ordered by priority descending for correct rule matching
  package_set_default_rules?: PackageSetDefaultRule[];
  user_journeys: UserJourney[];  // Business domain: UserJourneys
  activity_steps: ActivityStep[];  // Business domain: ActivitySteps
  // Infrastructure Architecture: Infrastructure entities (Spec 2026-05-04)
  environments: Environment[];
  cloud_accounts: CloudAccount[];
  locations: Location[];
  networks: Network[];
  subnets: Subnet[];
  compute_clusters: ComputeCluster[];
  compute_resources: ComputeResource[];
  deployment_units: DeploymentUnit[];
  load_balancers: LoadBalancer[];
  listeners: Listener[];
  data_store_instances: DataStoreInstance[];
  infrastructure_resources: InfrastructureResource[];
  infrastructure_points: InfrastructurePoint[];
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  iac_sources: IaCSource[];
  // Spec 2026-05-06: Library Frontend Types & Tables - Application domain Library entity
  libraries: Library[];
}

export interface MetaModelRelationships {
  // Business Point relationship arrays
  business_user_business_points: BusinessUserBusinessPoint[];
  application_point_business_points: ApplicationPointBusinessPoint[];
  // ApplicationPoint to BusinessLogic join table
  application_point_business_logics: ApplicationPointBusinessLogic[];
  // Other relationships
  logical_data_entity_relationships: LogicalDataEntityRelationship[];
  logical_data_entity_physical_data_entities: LogicalDataEntityPhysicalDataEntity[];
  logical_data_attribute_physical_data_attributes: LogicalDataAttributePhysicalDataAttribute[];
  data_movements: DataMovement[];
  interface_logical_entities: InterfaceLogicalEntity[];
  // Spec: Endpoint→Data-Effect Call Graph (2026-05-29) — endpoint reads/writes a data entity
  endpoint_data_effects: EndpointDataEffect[];
  // UI Architecture: UIWorkflowTransitions
  ui_workflow_transitions: UIWorkflowTransition[];
  // Business domain: User Journey Links
  user_journey_links: UserJourneyLink[];
  // Infrastructure Architecture: Infrastructure relationships (Spec 2026-05-04)
  resource_subnet_hostings: ResourceSubnetHosting[];
  deployment_unit_compute_resources: DeploymentUnitComputeResource[];
  load_balancer_resource_routes: LoadBalancerResourceRoute[];
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship arrays
  application_compute_deployments: ApplicationComputeDeployment[];
  data_entity_data_store_hostings: DataEntityDataStoreHosting[];
  application_infrastructure_resource_uses: ApplicationInfrastructureResourceUse[];
  application_load_balancer_exposures: ApplicationLoadBalancerExposure[];
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  iac_resource_bindings: IaCResourceBinding[];
  // Spec 2026-05-06: Library Frontend Types & Tables - Library Dependency relationship
  code_unit_dependencies: CodeUnitDependency[];
}

export interface MetaModel {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

// Root Architecture Model
export interface ArchitectureModel {
  metaModel: MetaModel;
  diagrams: Diagram[];
}

// Entity type union for type-safe operations
export type EntityType =
  | 'business_users'
  | 'business_processes'
  | 'process_activities'
  | 'business_points'
  | 'applications'
  | 'app_components'
  | 'services'
  | 'interfaces'
  | 'endpoints'
  | 'classes'
  | 'methods'
  | 'application_points'
  | 'logical_data_entities'
  | 'logical_data_attributes'
  | 'physical_data_entities'
  | 'physical_data_attributes'
  | 'interactions'
  | 'app_business_points'
  | 'events'  // Behavioural domain: events EntityType
  | 'states'  // Behavioural domain: states EntityType
  | 'state_transitions'  // Behavioural domain: state_transitions EntityType
  | 'activities'  // Behavioural domain: activities EntityType
  | 'activity_flows'  // Behavioural domain: activity_flows EntityType
  | 'activity_partitions'  // Behavioural domain: activity_partitions EntityType
  | 'business_logics'  // Behavioural domain: business_logics EntityType
  | 'ui_screens'  // UI Architecture: ui_screens EntityType
  | 'ui_components'  // UI Architecture: ui_components EntityType
  | 'ui_actions'  // UI Architecture: ui_actions EntityType
  | 'ui_characteristics'  // UI Architecture: ui_characteristics EntityType (Spec 2026-01-20)
  | 'package_sets'  // Application domain: package_sets EntityType
  | 'packages'  // Application domain: packages EntityType
  | 'user_journeys'  // Business domain: user_journeys EntityType
  | 'activity_steps'  // Business domain: activity_steps EntityType
  // Infrastructure Architecture: Infrastructure entity types (Spec 2026-05-04)
  | 'environments'
  | 'cloud_accounts'
  | 'locations'
  | 'networks'
  | 'subnets'
  | 'compute_clusters'
  | 'compute_resources'
  | 'deployment_units'
  | 'load_balancers'
  | 'listeners'
  | 'data_store_instances'
  | 'infrastructure_resources'
  | 'infrastructure_points'
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  | 'iac_sources'
  // Spec 2026-05-06: Library Frontend Types & Tables
  | 'libraries';

// Relationship type union
export type RelationshipType =
  | 'business_user_business_points'
  | 'application_point_business_points'
  | 'application_point_business_logics'  // ApplicationPoint to BusinessLogic join table
  | 'logical_data_entity_relationships'
  | 'logical_data_entity_physical_data_entities'
  | 'logical_data_attribute_physical_data_attributes'
  | 'data_movements'
  | 'interface_logical_entities'
  | 'endpoint_data_effects'  // Spec: Endpoint→Data-Effect Call Graph (2026-05-29)
  | 'ui_workflow_transitions'  // UI Architecture: ui_workflow_transitions RelationshipType
  | 'user_journey_links'  // Business domain: user_journey_links RelationshipType
  // Infrastructure Architecture: Infrastructure relationship types (Spec 2026-05-04)
  | 'resource_subnet_hostings'
  | 'deployment_unit_compute_resources'
  | 'load_balancer_resource_routes'
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship types
  | 'application_compute_deployments'
  | 'data_entity_data_store_hostings'
  | 'application_infrastructure_resource_uses'
  | 'application_load_balancer_exposures'
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  | 'iac_resource_bindings'
  // Spec 2026-05-06: Library Frontend Types & Tables
  | 'code_unit_dependencies';

// Helper type for any entity
export type AnyEntity =
  | BusinessUser
  | BusinessProcess
  | ProcessActivity
  | BusinessPoint
  | Application
  | ApplicationComponent
  | Service
  | Interface
  | Endpoint
  | Class
  | Method
  | ApplicationPoint
  | LogicalDataEntity
  | LogicalDataAttribute
  | PhysicalDataEntity
  | PhysicalDataAttribute
  | Interaction
  | AppBusinessPoint
  | Event  // Behavioural domain: Event in AnyEntity union
  | State  // Behavioural domain: State in AnyEntity union
  | StateTransition  // Behavioural domain: StateTransition in AnyEntity union
  | Activity  // Behavioural domain: Activity in AnyEntity union
  | ActivityFlow  // Behavioural domain: ActivityFlow in AnyEntity union
  | ActivityPartition  // Behavioural domain: ActivityPartition in AnyEntity union
  | BusinessLogic  // Behavioural domain: BusinessLogic in AnyEntity union
  | UIScreen  // UI Architecture: UIScreen in AnyEntity union
  | UIComponent  // UI Architecture: UIComponent in AnyEntity union
  | UIAction  // UI Architecture: UIAction in AnyEntity union
  | UICharacteristic  // UI Architecture: UICharacteristic in AnyEntity union (Spec 2026-01-20)
  | PackageSet  // Application domain: PackageSet in AnyEntity union
  | Package  // Application domain: Package in AnyEntity union
  // Infrastructure Architecture: Infrastructure entities in AnyEntity union (Spec 2026-05-04)
  | Environment
  | CloudAccount
  | Location
  | Network
  | Subnet
  | ComputeCluster
  | ComputeResource
  | DeploymentUnit
  | LoadBalancer
  | Listener
  | DataStoreInstance
  | InfrastructureResource
  | InfrastructurePoint
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  | IaCSource
  // Spec 2026-05-06: Library Frontend Types & Tables
  | Library;

// Helper type for any relationship
export type AnyRelationship =
  | BusinessUserBusinessPoint
  | ApplicationPointBusinessPoint
  | ApplicationPointBusinessLogic  // ApplicationPoint to BusinessLogic join table
  | LogicalDataEntityRelationship
  | LogicalDataEntityPhysicalDataEntity
  | LogicalDataAttributePhysicalDataAttribute
  | DataMovement
  | InterfaceLogicalEntity
  | UIWorkflowTransition  // UI Architecture: UIWorkflowTransition in AnyRelationship union
  | UserJourneyLink  // Business domain: UserJourneyLink in AnyRelationship union
  // Infrastructure Architecture: Infrastructure relationships in AnyRelationship union (Spec 2026-05-04)
  | ResourceSubnetHosting
  | DeploymentUnitComputeResource
  | LoadBalancerResourceRoute
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationships in AnyRelationship union
  | ApplicationComputeDeployment
  | DataEntityDataStoreHosting
  | ApplicationInfrastructureResourceUse
  | ApplicationLoadBalancerExposure
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
  | IaCResourceBinding
  // Spec 2026-05-06: Library Frontend Types & Tables
  | CodeUnitDependency;
