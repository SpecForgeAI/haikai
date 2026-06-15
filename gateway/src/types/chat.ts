/**
 * TypeScript type definitions for chat request/response and SSE events
 *
 * Spec 2026-01-14: Implement Assistant Stage 4 - Feature-Specific Context Highlighting
 * - Updated ArchitectureContext documentation to clarify "highlighted" semantics
 * - Added referenced_entity_names to ResolvedDiagramSummary
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * - Added HandoffIntent interface for sub-feature intent definition
 * - Added HandoffPlanResponse interface for handoff planning output
 * - Extended ChatResponse with optional handoffPlan field
 *
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * - Added projectParentFolder, featureId, featureTitle to ChatContext
 * - These fields are REQUIRED for mode=implement_feature persistence
 *
 * Spec 2026-01-16: Context Bundles Backend Expansion
 * - Added EntityBundleSelection, DiagramBundleSelection interfaces
 * - Added ExpandResolveRequestDto, ExpandResolveResponseDto interfaces
 * - Extended ArchitectureContext with optional entities/diagrams arrays for bundle expansion
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM
 * - Added condensed DTO types for entity_and_attributes, interface_contract, service_slice, diagram_summary
 * - Added helper types: AttributeInfo, EndpointInfo, EntityRelationshipInfo, ServiceDependencyInfo
 * - Added CondensedContextDto union type
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * - Added optional depth field to EntityBundleSelection for relationship expansion control
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * - Added PlannerSchemaVersion type: "1.1"
 * - Added PlannerResponse interface for structured refine phase output
 * - Added ImplementationPlan and Increment interfaces
 * - Added PlannerValidationResult interface
 * - Added ImplementChatPhase type with 'implementation_planning' phase
 * - Deprecated HandoffPlanResponse and HandoffIntent (keep for backward compatibility)
 * - Added plannerResponse field to ChatResponse
 *
 * Spec 2026-01-23: Questions System v1
 * - Added OpenQuestion interface with id and question fields
 * - Changed PlannerResponse.openQuestions from string[] to OpenQuestion[]
 * - UUIDs are assigned in gateway, not frontend
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * - Added 'implementation_clarification' to ImplementChatPhase
 * - Added ImplementerResponse interface for SA clarification responses
 * - Added implementerResponse field to ChatResponse
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added RelationshipContextPayload interface for relationship selection
 * - Extended ArchitectureContext with optional relationships array
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Added Part interface for split implementation parts
 * - Added PartStatus type for per-part lifecycle states
 * - Added JobStatus type for orchestration job polling
 * - Extended ImplementationPlan with optional isSplit and parts fields
 *
 * Spec 2026-02-17: Multi-File Upload + URL References
 * - Added files field to ChatRequest for base64 file attachments
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * - Removed 'product_manager', 'solution_architect', 'roadmap_pm' from ChatMode
 * - Removed ProductManagerResponse, ProductManagerValidationResult interfaces
 * - Removed SolutionArchitectResponse, SolutionArchitectValidationResult interfaces
 * - Removed RoadmapPmResponse, RoadmapPmValidationResult interfaces
 * - Removed productManagerResponse, solutionArchitectResponse, roadmapPmResponse fields from ChatResponse
 * - These modes are now served exclusively by chatV2.ts
 */

// ============================================================================
// Request Types
// ============================================================================

/**
 * Chat mode types for different assistant behaviors
 * - "oas_assistant": Default OAS specification assistant (existing behavior)
 * - "implement_feature": Planner conversation loop for work item clarification
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * Shrunk from 5 values to 2. Legacy modes (product_manager, solution_architect,
 * roadmap_pm) are now handled exclusively by the v2 chat engine (chatV2.ts).
 */
export type ChatMode = 'oas_assistant' | 'implement_feature';

/**
 * Chat intent types for different conversation purposes
 * - "normal_chat": Standard clarification dialog
 * - "generate_specs": Generate /agent-os:write-spec commands (Iteration 4)
 */
export type ChatIntent = 'normal_chat' | 'generate_specs';

/**
 * Chat phase types for workflow stages in implement_feature mode
 * - "bootstrap": Initial context loading phase (auto-triggered on mount)
 * - "refine": Exploratory dialog phase (steps 1a-1e) for requirement clarification
 * - "handoff": Transition phase to spec generation
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Spec 2026-01-13: Implement Assistant Stage 3 - Bootstrap Phase (added 'bootstrap')
 */
export type ChatPhase = 'bootstrap' | 'refine' | 'handoff';

/**
 * Extended chat phase types for implement_feature mode workflow stages.
 * Includes phases for planning and clarification workflows.
 *
 * - "bootstrap": Initial context loading phase (auto-triggered on mount)
 * - "refine": Exploratory dialog phase for requirement clarification (returns structured JSON)
 * - "implementation_planning": Plan generation phase (returns structured JSON with implementationPlan)
 * - "test_planning": Test Engineer review phase for adding test definitions to the spec
 * - "generate_specs": JSON spec commands generation
 * - "implementation_clarification": SA clarification phase for per-increment handoff
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Spec 2026-01-23: SA Handoff Per Increment (added 'implementation_clarification')
 */
export type ImplementChatPhase =
  | 'bootstrap'
  | 'refine'
  | 'implementation_planning'
  | 'test_planning'
  | 'test_planning_holistic'
  | 'generate_specs'
  | 'implementation_clarification';

/**
 * Work item metadata for implement_feature mode
 */
export interface WorkItemContext {
  /** Work item unique identifier */
  id: string;
  /** Work item title */
  title: string;
  /** Work item type (e.g., Feature, Story, Epic) */
  type: string;
  /** Work item description */
  description: string;
  /** Sibling work items under the same parent — provides scope boundary awareness */
  siblingStories?: Array<{ title: string; description: string | null; status: string }>;
}

/**
 * Relationship context payload for including user-selected relationships.
 * Sent from frontend to gateway as part of ArchitectureContext.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
export interface RelationshipContextPayload {
  /** Relationship type (e.g., "fk", "association", "contains", "uses") */
  relationship_type: string;
  /** Unique identifier for this relationship */
  relationship_id: string;
  /** Human-readable label describing the relationship */
  label: string;
}

/**
 * Architecture context for implement_feature mode
 * Contains references to linked entities and diagrams
 *
 * Spec 2026-01-16: Context Bundles Backend Expansion
 * - Added optional entities array for bundle-based entity selections
 * - Added optional diagrams array for bundle-based diagram selections
 * - When entities/diagrams arrays are present with bundle_type, expand-resolve is used
 * - Falls back to entityIds/diagramIds when no bundle_type selections present
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added optional relationships array for user-selected relationships
 */
export interface ArchitectureContext {
  /** Array of linked entity IDs (legacy format for backward compatibility) */
  entityIds: string[];
  /** Array of linked diagram IDs (legacy format for backward compatibility) */
  diagramIds: string[];
  /**
   * Optional array of entity bundle selections with bundle_type.
   * When present and contains items with bundle_type, triggers expand-resolve behavior.
   * Spec 2026-01-16: Context Bundles Backend Expansion
   */
  entities?: EntityBundleSelection[];
  /**
   * Optional array of diagram bundle selections with bundle_type.
   * When present and contains items with bundle_type, triggers expand-resolve behavior.
   * Spec 2026-01-16: Context Bundles Backend Expansion
   */
  diagrams?: DiagramBundleSelection[];
  /**
   * Optional array of user-selected relationships to include in planner context.
   * These relationships are passed through to the LLM prompt builder.
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  relationships?: RelationshipContextPayload[];
}

/**
 * Context from the UI that helps the assistant understand the current state
 */
export interface ChatContext {
  /** @deprecated Use projectId (UUID) instead. Kept for backward compatibility with file-mode. */
  filename?: string;
  /** Project UUID (from project table PK). Primary project identifier for all API calls. */
  projectId?: string;
  /** Currently selected interface ID */
  interfaceId?: string;
  /** Draft OAS content pasted by user (for partial spec completion) */
  draftOas?: string;
  /** User's preferred output format */
  preferredFormat?: 'yaml' | 'json';
  /**
   * Chat mode - determines which system prompt and behavior to use
   * - undefined or "oas_assistant": OAS specification assistant (default)
   * - "implement_feature": Planner conversation loop for work items
   *
   * Spec 2026-03-02: Legacy modes (product_manager, solution_architect, roadmap_pm)
   * have been removed from v1 and are now served exclusively by chatV2.ts.
   */
  mode?: ChatMode;
  /**
   * Chat intent - specifies the purpose of the conversation
   * - "normal_chat": Standard clarification dialog
   * - "generate_specs": Generate /agent-os:write-spec commands (Iteration 4)
   */
  intent?: ChatIntent;
  /**
   * Chat phase - indicates which stage of the workflow the conversation is in
   * - "bootstrap": Initial context loading (auto-triggered on mount)
   * - "refine": Exploratory dialog for requirement clarification
   * - "handoff": Transition from clarification to spec generation
   * - "implementation_planning": Plan generation with increments (Spec 2026-01-22)
   * - "implementation_clarification": SA per-increment clarification (Spec 2026-01-23)
   * Optional for backward compatibility - defaults to "refine" behavior when absent.
   *
   * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
   * Spec 2026-01-13: Implement Assistant Stage 3 - Bootstrap Phase (added 'bootstrap')
   * Spec 2026-01-22: Expanded Planner JSON Contract (added 'implementation_planning')
   * Spec 2026-01-23: SA Handoff Per Increment (added 'implementation_clarification')
   */
  phase?: ChatPhase | ImplementChatPhase;
  /**
   * Work item metadata for implement_feature mode
   * Contains id, title, type, and description of the work item
   */
  workItem?: WorkItemContext;
  /**
   * Architecture context for implement_feature mode
   * Contains references to linked entities and diagrams
   */
  architectureContext?: ArchitectureContext;

  // ==========================================================================
  // Persistence Metadata Fields
  // Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
  // These fields are REQUIRED for mode=implement_feature transcript persistence.
  // If missing, chat will still work but persistence will be skipped with a warning.
  // ==========================================================================

  /**
   * Absolute path to the project's parent folder.
   * Used as the base path for writing transcript files.
   * Output path: <projectParentFolder>/conversations/<feature_name_and_id>/full-conversation.txt
   *
   * REQUIRED for mode=implement_feature persistence.
   * If not provided, falls back to config.conversationPersistBasePath.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  projectParentFolder?: string;

  /**
   * Work item unique identifier for folder naming.
   * Used as suffix in transcript folder name for deterministic naming across sessions.
   * Example: "feat-123-abc" becomes folder suffix "feat-123" (first 8 chars)
   *
   * REQUIRED for mode=implement_feature persistence.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  featureId?: string;

  /**
   * Work item title for folder naming.
   * Used as prefix in transcript folder name (sanitized: lowercase, hyphens, no special chars).
   * Example: "Add User Login" becomes "add-user-login"
   *
   * REQUIRED for mode=implement_feature persistence.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  featureTitle?: string;

  /**
   * Snapshot of the messages currently displayed in the frontend chat panel.
   * Each entry contains the display role ("You", "Product Owner", or
   * "Software Architect") and the message content.
   *
   * Used to write short-displayed-conversation.txt alongside the full transcript.
   */
  displayedMessages?: DisplayedMessage[];
}

/**
 * A message entry for short-displayed-conversation.txt persistence.
 * Represents a single chat bubble as shown in the frontend UI.
 */
export interface DisplayedMessage {
  /** Display role: "You", "Product Owner", or "Software Architect" */
  displayRole: string;
  /** The message content as displayed in the chat bubble */
  content: string;
}

/**
 * Request body for POST /api/chat endpoint
 */
export interface ChatRequest {
  /** Client-provided or Gateway-generated session ID (optional) */
  sessionId?: string;
  /** User message (required, max MAX_MESSAGE_BYTES) */
  message: string;
  /** Optional UI context */
  context?: ChatContext;
  /** Optional array of file paths or URLs to include as document content */
  sources?: string[];
  /**
   * Optional array of base64-encoded file attachments.
   * Each file includes the original filename, MIME type, and raw base64 data
   * (without the data URI prefix).
   *
   * Spec 2026-02-17: Multi-File Upload + URL References
   */
  files?: Array<{ filename: string; mimeType: string; base64: string }>;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Trace item for debugging tool calls
 */
export interface ToolTraceItem {
  /** Name of the tool that was called */
  toolName: string;
  /** HTTP status code returned from tool execution */
  status: number;
  /** Duration of tool execution in milliseconds */
  durationMs: number;
}

/**
 * Artifacts returned when certain tools are called (e.g., save_oas_spec)
 */
export interface ChatArtifacts {
  /** Summary when save_oas_spec was called */
  savedSpec?: SaveOasSpecSummaryDto;
}

/**
 * Summary returned after saving an OAS spec (matches MCP server response)
 */
export interface SaveOasSpecSummaryDto {
  /** The interface ID */
  interfaceId: string;
  /** The interface name */
  interfaceName: string;
  /** The architecture filename used */
  architectureFilename: string;
  /** Format of the saved content: 'yaml' or 'json' */
  format: string;
  /** Absolute file path where spec was saved */
  savedPath: string;
  /** Same as savedPath (stored in interface.specLink) */
  specLink: string;
  /** ISO-8601 timestamp of the update */
  updatedAt: string;
  /** true if file was newly created, false if overwritten */
  created: boolean;
}

/**
 * Assistant's response content
 */
export interface AssistantResponse {
  /** Assistant's text response message */
  message: string;
  /** Optional debug info about tool calls (if ENABLE_TOOL_TRACE) */
  toolTrace?: ToolTraceItem[];
  /** Artifacts from tool executions */
  artifacts?: ChatArtifacts;
}

// ============================================================================
// Planner Response Types (v1.1)
// Spec 2026-01-22: Expanded Planner JSON Contract
// Spec 2026-01-23: Questions System v1 - OpenQuestion with id and question
// ============================================================================

/**
 * Schema version for PlannerResponse.
 * Used for forward compatibility and contract evolution.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 */
export type PlannerSchemaVersion = '1.1';

/**
 * An open question from the Planner LLM that needs user clarification.
 * Each question has a unique ID (UUID v4) assigned by the gateway.
 *
 * Spec 2026-01-23: Questions System v1
 */
export interface OpenQuestion {
  /** Unique identifier for this question (UUID v4, assigned by gateway) */
  id: string;
  /** The question text that needs user clarification */
  question: string;
}

/**
 * Unified structured response from the Planner (Product Owner) LLM.
 * Returned during refine and implementation_planning phases.
 *
 * All fields are required, even if arrays are empty.
 * implementationPlan is null during refine phase, populated during implementation_planning phase.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Spec 2026-01-23: Questions System v1 - openQuestions is now OpenQuestion[]
 */
export interface PlannerResponse {
  /** Schema version for forward compatibility */
  schemaVersion: PlannerSchemaVersion;
  /** Chat bubble text (conversational summary) */
  message: string;
  /** Current human-readable definition of the feature */
  featureUnderstanding: string;
  /** Scope boundaries */
  scope: {
    /** Items explicitly included in scope */
    in: string[];
    /** Items explicitly excluded from scope */
    out: string[];
  };
  /** Assumptions made by the planner */
  assumptions: string[];
  /** Testable success conditions (populated during shaping) */
  acceptanceCriteria: string[];
  /**
   * Questions needing user clarification.
   * Each question has a unique ID (UUID v4) assigned by the gateway.
   *
   * Spec 2026-01-23: Questions System v1 - Changed from string[] to OpenQuestion[]
   */
  openQuestions: OpenQuestion[];
  /** Explicit planner signal that feature is ready for spec */
  plannerReadyForSpec: boolean;
  /** Implementation plan (null during shaping, populated on explicit request) */
  implementationPlan: ImplementationPlan | null;
}

// ============================================================================
// Part-Sequencing Types
// Spec 2026-02-06: Implement-Part Sequencing Workflow
// ============================================================================

/**
 * A single implementation part within a split implementation plan.
 * Each part represents an independent, sequential unit of work with its own
 * Q&A session and orchestration job.
 *
 * Parts are processed sequentially: for each part, the UI sends details to
 * shape-spec/stream, collects Q&A, calls the orchestration job, polls until
 * complete, then advances to the next part.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface Part {
  /** 1-based index of this part within the implementation plan */
  partIndex: number;
  /** Short descriptive title for this part */
  title: string;
  /** Detailed intent description for shape-spec handoff */
  intent: string;
  /**
   * Optional list of dependency references (e.g., "Part 1: Database Schema").
   * Used for context in the part payload but NOT for execution ordering
   * (parts are always executed sequentially).
   */
  dependencies?: string[];
}

/**
 * Status of a single part in the split implementation workflow.
 *
 * State transitions:
 * - PENDING: Initial state for all parts
 * - QA_IN_PROGRESS: When shape-spec Q&A starts for this part (session_mode="new")
 * - READY_TO_RUN: When SA indicates ready (no questions remaining)
 * - ORCHESTRATING: When orchestration job is created and polling begins
 * - COMPLETED: Job finished successfully, auto-advance to next part
 * - FAILED: Job failed or error occurred, requires manual intervention
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export type PartStatus =
  | 'PENDING'
  | 'QA_IN_PROGRESS'
  | 'READY_TO_RUN'
  | 'ORCHESTRATING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Status of an orchestration job for polling purposes.
 *
 * Returned from GET /api/v1/jobs/{job_id} proxy route.
 * Poll interval is 2 seconds (fixed, no backoff in v1).
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 */
export interface JobStatus {
  /** Current job status: pending, running, completed, or failed */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Error message when status is 'failed' (optional) */
  error?: string;
}

/**
 * Implementation plan containing increments for feature implementation.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Added optional isSplit field for split workflow detection
 * - Added optional parts array for part-based implementation
 */
export interface ImplementationPlan {
  /** Human-readable label for the plan */
  planTitle: string;
  /** Implementation increments (length >= 1) */
  increments: Increment[];
  /** When true, the feature is split into independent parts (extremely rare) */
  isSplit?: boolean;
}

/**
 * A single implementation increment within an implementation plan.
 * Each increment represents a self-contained, implementable unit of work.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 */
export interface Increment {
  /** Stable identifier for UI/status tracking (e.g., "INC-1", "INC-2") */
  id: string;
  /** 1-based index of this increment */
  partIndex: number;
  /** Short name of the increment */
  title: string;
  /** Detailed intent / specification for the Software Architect */
  intent: string;
  /** Optional dependency references (e.g., "Part 1: Database Schema") */
  dependencies?: string[];
}

/**
 * Result of validating a PlannerResponse.
 *
 * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
 */
export interface PlannerValidationResult {
  /** Whether the validation succeeded */
  valid: boolean;
  /** The parsed planner response (only present if valid) */
  plannerResponse?: PlannerResponse;
  /** Error message (only present if invalid) */
  error?: string;
}

// ============================================================================
// Implementer Response Types (v1.0)
// Spec 2026-01-23: SA Handoff Per Increment
// ============================================================================

/**
 * Schema version for ImplementerResponse.
 * Used for forward compatibility and contract evolution.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 */
export type ImplementerSchemaVersion = '1.0';

/**
 * Structured response from the Software Architect (Implementer) LLM.
 * Returned during implementation_clarification phase for per-increment clarification.
 *
 * Simpler than PlannerResponse; contains only:
 * - schemaVersion: Always "1.0"
 * - message: Explanation or conversational text for the user
 * - openQuestions: Technical clarifying questions about implementation
 *
 * When openQuestions is empty, the increment is considered "Ready" for implementation.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 */
export interface ImplementerResponse {
  /** Schema version for forward compatibility */
  schemaVersion: ImplementerSchemaVersion;
  /** Chat bubble text (conversational explanation from SA) */
  message: string;
  /**
   * Technical clarifying questions about the increment's implementation.
   * Uses existing OpenQuestion interface (id, question).
   * Empty array indicates increment is ready for implementation.
   */
  openQuestions: OpenQuestion[];
}

/**
 * Individual test definition produced by the Test Engineer during test_planning phase.
 */
export interface TestDefinition {
  /** Test title */
  title: string;
  /** Description of what this test verifies */
  description: string;
  /** Test type */
  type: 'unit' | 'functional' | 'integration' | 'e2e';
}

/**
 * Response from the Test Engineer during test_planning phase.
 * Contains test definitions for the current work item.
 */
export interface TestPlannerResponse {
  /** Schema version for forward compatibility */
  schemaVersion: string;
  /** Brief summary message from the Test Engineer */
  message: string;
  /** List of test definitions */
  testPlan: TestDefinition[];
  /** Open questions the Test Engineer needs answered */
  openQuestions: Array<{ id: string; question: string }>;
}

/**
 * Result of validating an ImplementerResponse.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 */
export interface ImplementerValidationResult {
  /** Whether the validation succeeded */
  valid: boolean;
  /** The parsed implementer response (only present if valid) */
  implementerResponse?: ImplementerResponse;
  /** Error message (only present if invalid) */
  error?: string;
}

// ============================================================================
// Handoff Plan Types (DEPRECATED)
// Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
// Deprecated by Spec 2026-01-22: Use PlannerResponse and ImplementationPlan instead
// ============================================================================

/**
 * A single sub-feature intent within a handoff plan.
 * Each intent represents a self-contained, implementation-ready unit of work.
 *
 * Constraints:
 * - id must be stable within the response (e.g., "S1", "S2", ...)
 * - intent must be self-contained and implementation-ready (no open questions)
 * - dependencies references other intent IDs within the same plan
 *
 * @deprecated Use Increment interface instead (Spec 2026-01-22)
 */
export interface HandoffIntent {
  /** Unique identifier for this intent within the plan (e.g., "S1", "S2") */
  id: string;
  /** Short descriptive title for this sub-feature */
  title: string;
  /** Detailed intent description - what this sub-feature accomplishes */
  intent: string;
  /** List of items explicitly included in this sub-features scope */
  in_scope: string[];
  /** List of items explicitly excluded from this sub-features scope */
  out_of_scope: string[];
  /** List of acceptance criteria that define completion */
  acceptance_criteria: string[];
  /** List of intent IDs that this sub-feature depends on */
  dependencies: string[];
}

/**
 * Response structure for handoff planning phase.
 * Contains the planners decision on whether to split the feature and the resulting sub-intents.
 *
 * Constraints:
 * - handoff_intents.length must be >= 1
 * - If handoff_intents.length == 1 then is_split must be false
 * - If handoff_intents.length > 1 then is_split must be true
 *
 * Splitting heuristics (when to set is_split = true):
 * - Multi-service boundary (frontend + gateway + backend) unless trivially small
 * - Multiple independent user-visible behaviors
 * - Data/schema concerns combined with non-trivial UI/UX
 * - Non-trivial prompt/LLM orchestration plus other concerns
 *
 * @deprecated Use PlannerResponse with implementationPlan instead (Spec 2026-01-22)
 */
export interface HandoffPlanResponse {
  /** Whether the feature is split into multiple sub-intents */
  is_split: boolean;
  /** Human-readable summary of the handoff plan (e.g., "This will be implemented as 3 sub-specs: [A, B, C]") */
  handoff_plan_summary: string;
  /** Array of sub-feature intents (length >= 1) */
  handoff_intents: HandoffIntent[];
}

/**
 * Response body for POST /api/chat endpoint
 *
 * Spec 2026-03-02: Legacy Chat Removal and Cleanup (Increment 10)
 * - Removed productManagerResponse, solutionArchitectResponse, roadmapPmResponse fields
 * - These modes are now served exclusively by chatV2.ts
 */
export interface ChatResponse {
  /** Session ID for this conversation */
  sessionId: string;
  /** Assistants response */
  assistant: AssistantResponse;
  /**
   * Generated specs array - only populated when intent is "generate_specs" and validation succeeds.
   * Each string is a complete /agent-os:write-spec command with YAML content inline.
   * Spec: Implement Generate Specs - Iteration 4
   */
  specs?: string[];
  /**
   * Handoff plan - only populated for phase='handoff' responses when validation succeeds.
   * Contains the structured plan for implementing the feature as one or more sub-specs.
   * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
   *
   * @deprecated Use plannerResponse.implementationPlan instead (Spec 2026-01-22)
   */
  handoffPlan?: HandoffPlanResponse;
  /**
   * Unified planner response - populated for phase='refine' and phase='implementation_planning'.
   * Contains structured shaping output including acceptanceCriteria and implementationPlan.
   * Replaces handoffPlan for new implementations.
   *
   * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
   */
  plannerResponse?: PlannerResponse;
  /**
   * Implementer response - populated for phase='implementation_clarification'.
   * Contains SA clarifying questions for a specific increment.
   * Parallel to plannerResponse field for different phases.
   *
   * Spec 2026-01-23: SA Handoff Per Increment
   */
  implementerResponse?: ImplementerResponse;
  /**
   * Test planner response - populated for phase='test_planning'.
   * Contains test definitions from the Test Engineer persona.
   *
   * Spec 2026-03-18: Refine Feature Flow
   */
  testPlannerResponse?: TestPlannerResponse;
  /**
   * Set to true when an architecture baseline was successfully saved.
   * Used by the frontend to trigger a model reload.
   */
  baselineSaved?: boolean;
  /**
   * Error message when validation fails (non-breaking).
   * Present when LLM output could not be parsed but fallback was used.
   *
   * Spec 2026-01-22: Expanded Planner JSON Contract (v1.1)
   */
  error?: string;
}

// ============================================================================
// SSE Event Types (for streaming endpoint)
// ============================================================================

/**
 * Token event - partial text content being streamed
 */
export interface SSETokenEvent {
  /** Partial text content */
  content: string;
}

/**
 * Tool call started event
 */
export interface SSEToolCallStartedEvent {
  /** Name of the tool being called */
  toolName: string;
  /** Unique call ID from OpenAI */
  callId: string;
}

/**
 * Tool call finished event
 */
export interface SSEToolCallFinishedEvent {
  /** Name of the tool that was called */
  toolName: string;
  /** Unique call ID from OpenAI */
  callId: string;
  /** HTTP status code from tool execution */
  status: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Final event - complete response
 */
export interface SSEFinalEvent {
  /** Session ID (provided or generated by gateway) */
  sessionId?: string;
  /** Complete assistant message */
  message: string;
  /** Any artifacts from tool executions */
  artifacts?: ChatArtifacts;
}

/**
 * Error event
 */
export interface SSEErrorEvent {
  /** HTTP error code */
  code: number;
  /** Error message (safe for client) */
  message: string;
}

/**
 * Union type for all SSE event data types
 */
export type SSEEventData =
  | SSETokenEvent
  | SSEToolCallStartedEvent
  | SSEToolCallFinishedEvent
  | SSEFinalEvent
  | SSEErrorEvent;

/**
 * SSE event type names
 */
export type SSEEventType =
  | 'token'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'final'
  | 'error';

// ============================================================================
// Resolved Implement Context Types
// Spec: Implement Context Resolution - Iteration 3
// ============================================================================

/**
 * Summary of a resolved architecture entity.
 * Contains compact information for LLM context enrichment.
 */
export interface ResolvedEntitySummary {
  /** Entity unique identifier */
  id: string;
  /** Entity display name */
  name: string;
  /** Entity type (e.g., services, classes, methods) */
  entity_type: string;
  /** Entity category (application, business, data, ui) */
  category: string;
  /** Key-value pairs of relevant entity fields */
  relevant_fields: Record<string, unknown>;
}

/**
 * Summary of a resolved diagram.
 * Contains compact information for LLM context enrichment.
 */
export interface ResolvedDiagramSummary {
  /** Diagram unique identifier */
  id: string;
  /** Diagram display name */
  name: string;
  /** Diagram type (General, Sequence, ER, Activity, State, UI_Workflow, UI_SCREEN) */
  diagram_type: string;
  /** List of entity IDs referenced by diagram nodes */
  referenced_entity_ids: string[];
  /**
   * Human-readable names of referenced entities (Stage 4).
   * Contains only successfully resolved names; may be undefined/null if resolution failed.
   * Used in "HIGHLIGHTED FEATURE CONTEXT" section for LLM prompt.
   */
  referenced_entity_names?: string[];
}

/**
 * Response from the implement context resolution API.
 * Contains resolved entity and diagram summaries.
 */
export interface ResolvedImplementContextDto {
  /** List of resolved entity summaries */
  resolved_entities: ResolvedEntitySummary[];
  /** List of resolved diagram summaries */
  resolved_diagrams: ResolvedDiagramSummary[];
}

// ============================================================================
// Bootstrap Phase Types
// Spec: Implement Assistant Stage 3 - Bootstrap Phase
// ============================================================================

/**
 * Summary of a Feature work item for product summary.
 */
export interface FeatureSummary {
  /** Feature unique identifier */
  id: string;
  /** Feature title */
  title: string;
  /** Feature description */
  description: string;
}

/**
 * Summary of an Epic work item for product summary.
 */
export interface EpicSummary {
  /** Epic unique identifier */
  id: string;
  /** Epic title */
  title: string;
  /** Epic description */
  description: string;
  /** Nested features under this epic */
  features: FeatureSummary[];
  /** Epic priority (lower number = higher priority, null if unset) */
  priority?: number | null;
  /** Epic sort order within its parent initiative */
  sortOrder?: number;
}

/**
 * Summary of an Initiative work item for product summary.
 */
export interface InitiativeSummary {
  /** Initiative unique identifier */
  id: string;
  /** Initiative title */
  title: string;
  /** Initiative description */
  description: string;
  /** Nested epics under this initiative */
  epics: EpicSummary[];
}

/**
 * Product Book of Work summary for bootstrap phase.
 * Contains condensed hierarchical structure: Initiatives > Epics > Features.
 * Stories and detailed specs are excluded for conciseness.
 */
export interface ProductSummaryDto {
  /** List of initiatives with nested epics and features */
  initiatives: InitiativeSummary[];
}

/**
 * Entity summary for meta-model (minimal fields for LLM context).
 */
export interface MetaModelEntitySummary {
  /** Entity unique identifier */
  id: string;
  /** Entity display name */
  name: string;
  /** Entity type (e.g., services, logicalDataEntities, interfaces) */
  entity_type: string;
}

/**
 * Relationship summary for meta-model.
 * Uses human-readable entity names (not IDs).
 */
export interface MetaModelRelationshipSummary {
  /** Source entity name */
  source_entity: string;
  /** Target entity name */
  target_entity: string;
  /** Type of relationship (e.g., exposes, uses) */
  relationship_type: string;
}

/**
 * Architecture meta-model summary for bootstrap phase.
 * Contains services, data entities, interfaces, and relationships.
 */
export interface MetaModelSummaryDto {
  /** List of applications */
  applications: MetaModelEntitySummary[];
  /** List of services */
  services: MetaModelEntitySummary[];
  /** List of data entities (logical and physical) */
  data_entities: MetaModelEntitySummary[];
  /** List of interfaces */
  interfaces: MetaModelEntitySummary[];
  /** List of relationships between entities */
  relationships: MetaModelRelationshipSummary[];
  /** List of business users */
  business_users: MetaModelEntitySummary[];
  /** List of process activities */
  process_activities: MetaModelEntitySummary[];
  /** List of UI screens */
  ui_screens: MetaModelEntitySummary[];
  /** Count of data stores (services under Persistence Tier app components) */
  data_store_count: number;
}

/**
 * Combined bootstrap context containing both product and meta-model summaries.
 */
export interface BootstrapContext {
  /** Product Book of Work summary */
  productSummary: ProductSummaryDto | null;
  /** Architecture meta-model summary */
  metaModelSummary: MetaModelSummaryDto | null;
}

// ============================================================================
// Expand-Resolve Types
// Spec 2026-01-16: Context Bundles Backend Expansion
// ============================================================================

/**
 * Entity bundle selection for expand-resolve endpoint.
 * Specifies an entity to expand with its bundle type.
 *
 * Bundle types determine how much related context to include:
 * - For interfaces: interface_only, interface_with_endpoints, interface_with_endpoints_and_schemas
 * - For services: service_only, service_with_parents_and_children
 * - For data entities: entity_only, entity_with_attributes_and_relationships
 *
 * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
 * - Added optional depth field for relationship expansion control
 */
export interface EntityBundleSelection {
  /** Entity type (e.g., "interfaces", "services", "logicalDataEntities") */
  entity_type: string;
  /** Entity unique identifier */
  entity_id: string;
  /** Bundle type determining expansion scope */
  bundle_type: string;
  /**
   * Optional depth for relationship expansion (only for entity bundles).
   * - 1 (default): Include direct relationships only
   * - 2: Include relationships up to 2 hops (may significantly increase context size)
   * When undefined, defaults to depth 1 for backward compatibility.
   *
   * Spec 2026-01-16: Context Picker Smart Defaults and Heuristic Suggestions
   */
  depth?: number;
}

/**
 * Diagram bundle selection for expand-resolve endpoint.
 * Specifies a diagram to expand with its bundle type.
 *
 * Bundle types for diagrams:
 * - diagram_only: Include only the diagram itself
 */
export interface DiagramBundleSelection {
  /** Diagram unique identifier */
  diagram_id: string;
  /** Bundle type determining expansion scope */
  bundle_type: string;
}

/**
 * Request body for expand-resolve endpoint.
 * Contains selected entities and diagrams with their bundle types.
 */
export interface ExpandResolveRequestDto {
  /** Array of entity bundle selections */
  selected_entities: EntityBundleSelection[];
  /** Array of diagram bundle selections */
  selected_diagrams: DiagramBundleSelection[];
}

/**
 * Response from expand-resolve endpoint.
 * Contains expanded entity/diagram IDs and their resolved summaries.
 *
 * Includes truncation metadata when limits are exceeded:
 * - Default max entities: 250
 * - Default max diagrams: 50
 */
export interface ExpandResolveResponseDto {
  /** List of expanded entity IDs in canonical format (entityType::entityId) */
  expanded_entity_ids: string[];
  /** List of expanded diagram IDs */
  expanded_diagram_ids: string[];
  /** List of resolved entity summaries */
  resolved_entities: ResolvedEntitySummary[];
  /** List of resolved diagram summaries */
  resolved_diagrams: ResolvedDiagramSummary[];
  /** True if results were truncated due to limits */
  truncated: boolean;
  /** Human-readable reason for truncation (present only when truncated=true) */
  truncation_reason?: string;
  /** Automatically discovered relationships between expanded entities. Returns empty array when no relationships exist. */
  resolved_relationships: ResolvedRelationship[];
}

// ============================================================================
// Relationship Types for Auto-Include
// Spec 2026-01-16: Context Bundles Auto-Include Relationships
// ============================================================================

/**
 * Endpoint of a relationship (either from or to).
 * Contains entity type, ID, and human-readable name.
 *
 * Spec 2026-01-16: Context Bundles Auto-Include Relationships - Task Group 7
 */
export interface RelationshipEndpoint {
  /** Entity type (e.g., logicalDataEntities, physicalDataEntities, interfaces, services) */
  entity_type: string;
  /** Entity unique identifier */
  entity_id: string;
  /** Human-readable name of the entity */
  name: string;
}

/**
 * A resolved relationship between entities in the expanded context.
 *
 * Relationship types supported:
 * - fk: Foreign key relationship (data entities)
 * - association: General association between data entities
 * - many_to_many: Many-to-many relationship (data entities)
 * - uses: Usage relationship (service uses data entity)
 * - exposes: Exposure relationship (service exposes interface)
 * - schema_ref: Schema reference (interface references data entity)
 * - contains: Containment relationship (app contains component, component contains service)
 *
 * Spec 2026-01-16: Context Bundles Auto-Include Relationships - Task Group 7
 */
export interface ResolvedRelationship {
  /** Unique identifier for this relationship */
  id: string;
  /** Relationship type: fk, association, many_to_many, uses, exposes, schema_ref, contains */
  type: string;
  /** Source endpoint of the relationship */
  from: RelationshipEndpoint;
  /** Target endpoint of the relationship */
  to: RelationshipEndpoint;
  /** Human-readable label describing the relationship */
  label: string;
  /** Additional metadata (cardinality, relationship_type, description) */
  summary_fields: Record<string, unknown>;
}

// ============================================================================
// Condensed Context DTO Types
// Spec 2026-01-16: Condensed Context DTOs for Planner LLM
// ============================================================================

/**
 * Attribute information for data entities.
 * Used in EntityAndAttributesDto to describe table columns or entity fields.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface AttributeInfo {
  /** Attribute name (column name or field name) */
  name: string;
  /** Attribute data type */
  type: string;
  /** True if this attribute is a primary key */
  pk?: boolean;
  /** True if this attribute allows null values */
  nullable?: boolean;
}

/**
 * Relationship information for data entities.
 * Describes relationships to other entities (FK, association, etc.)
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface EntityRelationshipInfo {
  /** Relationship type (fk, association, many_to_many) */
  type: string;
  /** Target entity name */
  target_entity: string;
  /** Cardinality expression (e.g., "1:N", "M:N") */
  cardinality?: string;
}

/**
 * Endpoint information for interface contracts.
 * Describes API endpoints with their input/output schemas.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface EndpointInfo {
  /** Endpoint name (e.g., "GET /users/{id}") */
  name: string;
  /** Input schema name (if any) */
  input_schema: string | null;
  /** Output schema name (if any) */
  output_schema: string | null;
  /** Additional notes or description */
  notes: string | null;
}

/**
 * Dependency information for service slices.
 * Describes dependencies from a service to other services or entities.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface ServiceDependencyInfo {
  /** Dependency type (uses, calls, depends_on) */
  type: string;
  /** Target entity or service name */
  target: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Condensed DTO representing a data entity with its attributes and relationships.
 * Used for physical_data_entity (tables) and logical_data_entity (domain objects).
 *
 * Shape follows spec requirement for entity_and_attributes kind.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface EntityAndAttributesDto {
  /** DTO kind discriminator */
  kind: 'entity_and_attributes';
  /** Stable ID in format "entityType::entityId" */
  id: string;
  /** Entity type: physical_data_entity or logical_data_entity */
  entity_type: 'physical_data_entity' | 'logical_data_entity';
  /** Entity display name */
  name: string;
  /** List of attributes (columns/fields) */
  attributes: AttributeInfo[];
  /** List of relationships to other entities */
  relationships: EntityRelationshipInfo[];
}

/**
 * Condensed DTO representing an interface with endpoints and schemas.
 * Used for API interfaces and their contract details.
 *
 * Shape follows spec requirement for interface_contract kind.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface InterfaceContractDto {
  /** DTO kind discriminator */
  kind: 'interface_contract';
  /** Interface unique identifier */
  id: string;
  /** Interface display name */
  name: string;
  /** List of endpoints with input/output schemas */
  endpoints: EndpointInfo[];
  /** List of schema entity names referenced by this interface */
  schemas: string[];
  /** Key relationships involving this interface */
  key_relationships: EntityRelationshipInfo[];
}

/**
 * Condensed DTO representing a service with its structural context.
 * Includes parent application/component and exposed interfaces.
 *
 * Shape follows spec requirement for service_slice kind.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface ServiceSliceDto {
  /** DTO kind discriminator */
  kind: 'service_slice';
  /** Service unique identifier */
  id: string;
  /** Parent application name (null if not in containment hierarchy) */
  application: string | null;
  /** Parent component name (null if not in containment hierarchy) */
  component: string | null;
  /** Service display name */
  service: string;
  /** List of interface names exposed by this service */
  interfaces: string[];
  /** List of endpoint names (from exposed interfaces) */
  endpoints: string[];
  /** List of key entity names referenced by service interfaces */
  key_entities: string[];
  /** List of dependencies (services/entities this service depends on) */
  dependencies: ServiceDependencyInfo[];
}

/**
 * Condensed DTO representing a diagram summary.
 * Minimal diagram metadata for reference in LLM context.
 *
 * Shape follows spec requirement for diagram_summary kind.
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export interface DiagramSummaryDto {
  /** DTO kind discriminator */
  kind: 'diagram_summary';
  /** Diagram unique identifier */
  id: string;
  /** Diagram display name */
  name: string;
  /** Diagram type (ER, Sequence, General, etc.) */
  diagram_type: string;
  /** List of entity names referenced in the diagram */
  referenced_entities: string[];
}

/**
 * Union type for all condensed context DTO kinds.
 * Discriminates on the 'kind' field for type narrowing.
 *
 * Usage:
 * ```typescript
 * function process(dto: CondensedContextDto) {
 *   if (dto.kind === 'entity_and_attributes') {
 *     // TypeScript knows dto is EntityAndAttributesDto
 *     console.log(dto.attributes);
 *   }
 * }
 * ```
 *
 * Spec 2026-01-16: Condensed Context DTOs for Planner LLM - Task Group 1
 */
export type CondensedContextDto =
  | EntityAndAttributesDto
  | InterfaceContractDto
  | ServiceSliceDto
  | DiagramSummaryDto;
