/**
 * Chat API Client
 *
 * API client for Gateway chat endpoints.
 * Provides functions to send messages and receive assistant responses.
 *
 * Spec 2026-01-13: Added ImplementChatPhase for phased conversation workflow.
 * Spec 2026-01-14: Added HandoffIntent and HandoffPlanResponse for handoff planning.
 * Spec 2026-01-15: Added projectParentFolder, featureId, featureTitle for persistence.
 * Spec 2026-01-16: Added MessageEntry, getImplementConversation, putImplementConversation for rehydration.
 * Spec 2026-01-16: Updated getImplementConversation to include projectParentFolder and featureTitle params.
 * Spec 2026-01-17: Added EntityBundleSelection, DiagramBundleSelection for context bundle expansion.
 * Spec 2026-01-22: Added PlannerResponse, ImplementationPlan, Increment types for Feature Shaping UI.
 * Spec 2026-01-23: Added Question, OpenQuestion interfaces for Questions System v1.
 * Spec 2026-01-23: Added 'implementation_planning' to ImplementChatPhase for plan generation.
 * Spec 2026-01-23: Added 'implementation_clarification' to ImplementChatPhase for SA handoff.
 * Spec 2026-01-23: Added incrementId to Question interface for SA per-increment questions.
 * Spec 2026-01-23: Added ImplementerResponse interface for SA clarification responses.
 * Spec 2026-01-23: Added activeIncrementId to ImplementChatContext for SA answer submission.
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added RelationshipContextPayload interface
 * - Extended ArchitectureContextPayload with optional relationships array
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * - Added optional persona field to ChatMessage for stable persona attribution
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * - Added files field to ChatRequest for base64-encoded file attachments
 * Spec 2026-03-02: Increment 10 - Legacy Chat Removal and Cleanup
 * - Removed ProductManagerResponse, SolutionArchitectResponse, RoadmapPmResponse interfaces
 * - Removed productManagerResponse, solutionArchitectResponse, roadmapPmResponse fields from ChatResponse
 */

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Work item context for implement_feature mode.
 * Contains metadata about the work item being clarified.
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

// ============================================================================
// Context Bundle Selection Types
// Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End
// ============================================================================

/**
 * Entity bundle selection for expand-resolve endpoint.
 * Specifies an entity to expand with its bundle type and optional depth.
 *
 * Bundle types determine how much related context to include:
 * - For interfaces: interface_only, interface_with_endpoints, interface_with_endpoints_and_schemas
 * - For services: service_only, service_with_parents_and_children
 * - For data entities: entity_only, entity_with_attributes_and_relationships
 *
 * Mirrors gateway type definition from `gateway/src/types/chat.ts`
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 1
 */
export interface EntityBundleSelection {
  /** Entity type (e.g., "interfaces", "services", "logicalDataEntities", "physicalDataEntities") */
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
   */
  depth?: number;
}

/**
 * Diagram bundle selection for expand-resolve endpoint.
 * Specifies a diagram to expand with its bundle type.
 *
 * Bundle types for diagrams:
 * - diagram_only: Include only the diagram itself
 *
 * Mirrors gateway type definition from `gateway/src/types/chat.ts`
 *
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 1
 */
export interface DiagramBundleSelection {
  /** Diagram unique identifier */
  diagram_id: string;
  /** Bundle type determining expansion scope */
  bundle_type: string;
}

/**
 * Relationship context payload for including user-selected relationships.
 * Sent to gateway as part of ArchitectureContextPayload.
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
 * Architecture context for implement_feature mode.
 * Contains references to linked entities and diagrams from the architecture model.
 *
 * Spec 2026-01-17: Extended with optional entities[] and diagrams[] arrays
 * for structured bundle-based context expansion with depth control.
 * Legacy entityIds/diagramIds arrays are maintained for backward compatibility.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added optional relationships array for user-selected relationships
 */
export interface ArchitectureContextPayload {
  /** Array of linked entity IDs (legacy format for backward compatibility) */
  entityIds: string[];
  /** Array of linked diagram IDs (legacy format for backward compatibility) */
  diagramIds: string[];
  /**
   * Optional array of entity bundle selections with bundle_type and depth.
   * When present and contains items with bundle_type, triggers expand-resolve behavior.
   * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 1
   */
  entities?: EntityBundleSelection[];
  /**
   * Optional array of diagram bundle selections with bundle_type.
   * When present and contains items with bundle_type, triggers expand-resolve behavior.
   * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 1
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
 * Chat intent types for implement_feature mode.
 * - "normal_chat": Standard clarification dialog (steps 1a-1e)
 * - "generate_specs": Generate /agent-os:write-spec commands (step 2a)
 *
 * Spec: Implement Generate Specs - Iteration 4
 */
export type ImplementChatIntent = 'normal_chat' | 'generate_specs';

/**
 * Chat phase types for workflow stages in implement_feature mode.
 * - "bootstrap": Initial context loading phase (auto-triggered on mount)
 * - "refine": Exploratory dialog phase (steps 1a-1e) for requirement clarification
 * - "handoff": Transition phase from clarification to spec generation
 * - "implementation_planning": Plan generation phase (triggers implementation plan creation)
 * - "implementation_clarification": SA per-increment clarification phase
 *
 * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
 * Spec 2026-01-13: Implement Assistant Stage 3 - Bootstrap Phase (added 'bootstrap')
 * Spec 2026-01-23: Implement Triggers Plan Generation (added 'implementation_planning')
 * Spec 2026-01-23: SA Handoff Per Increment (added 'implementation_clarification')
 */
export type ImplementChatPhase =
  | 'bootstrap'
  | 'refine'
  | 'handoff'
  | 'implementation_planning'
  | 'test_planning'
  | 'test_planning_holistic'
  | 'implementation_clarification';

/**
 * Context for implement_feature mode conversations.
 * Used in the Implementation Assistant panel for Planner-style clarification dialog.
 *
 * Spec 2026-01-15: Added projectParentFolder, featureId, featureTitle for persistence.
 * Spec 2026-01-23: Added activeIncrementId for SA per-increment clarification.
 */
export interface ImplementChatContext {
  /** Chat mode - must be "implement_feature" for this context */
  mode: 'implement_feature';
  /**
   * Chat intent - determines the conversation purpose
   * - "normal_chat": Clarification dialog
   * - "generate_specs": Generate specification commands
   */
  intent?: ImplementChatIntent;
  /**
   * Chat phase - indicates which stage of the workflow the conversation is in
   * - "bootstrap": Initial context loading (auto-triggered on mount)
   * - "refine": Exploratory dialog for requirement clarification
   * - "handoff": Transition from clarification to spec generation
   * - "implementation_planning": Generate implementation plan with increments
   * - "implementation_clarification": SA per-increment clarification
   * Optional for backward compatibility - defaults to "refine" behavior when absent.
   *
   * Spec 2026-01-13: Implement Assistant Stage 2 - Phased Conversations
   * Spec 2026-01-13: Implement Assistant Stage 3 - Bootstrap Phase (added 'bootstrap')
   * Spec 2026-01-23: Implement Triggers Plan Generation (added 'implementation_planning')
   * Spec 2026-01-23: SA Handoff Per Increment (added 'implementation_clarification')
   */
  phase?: ImplementChatPhase;
  /** Project identifier (architecture filename) for context resolution */
  filename?: string;
  /** Work item metadata being clarified */
  workItem?: WorkItemContext;
  /** Architecture context with linked entities and diagrams */
  architectureContext?: ArchitectureContextPayload;

  // ==========================================================================
  // Persistence Metadata Fields
  // Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
  // These fields are REQUIRED for transcript persistence to the correct location.
  // ==========================================================================

  /**
   * Absolute path to the project's parent folder.
   * Used as the base path for writing transcript files.
   * Output path: <projectParentFolder>/conversations/<feature_name_and_id>/full-conversation.txt
   *
   * REQUIRED for transcript persistence.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  projectParentFolder?: string;

  /**
   * Work item unique identifier for folder naming.
   * Used as suffix in transcript folder name for deterministic naming across sessions.
   * Example: "feat-123-abc" becomes folder suffix "feat-123" (first 8 chars)
   *
   * REQUIRED for transcript persistence.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  featureId?: string;

  /**
   * Work item title for folder naming.
   * Used as prefix in transcript folder name (sanitized: lowercase, hyphens, no special chars).
   * Example: "Add User Login" becomes "add-user-login"
   *
   * REQUIRED for transcript persistence.
   *
   * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
   */
  featureTitle?: string;

  // ==========================================================================
  // SA Handoff Per Increment Fields
  // Spec 2026-01-23: SA Handoff Per Increment - Task Group 9
  // ==========================================================================

  /**
   * Active increment ID for SA per-increment clarification.
   * Identifies which increment the user is currently asking questions about.
   * Used during implementation_clarification phase.
   *
   * Spec 2026-01-23: SA Handoff Per Increment - Task Group 9
   */
  activeIncrementId?: string;
}

// ============================================================================
// Handoff Plan Types
// Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
// ============================================================================

/**
 * A single sub-feature intent within a handoff plan.
 * Each intent represents a self-contained, implementation-ready unit of work.
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
 */
export interface HandoffPlanResponse {
  /** Whether the feature is split into multiple sub-intents */
  is_split: boolean;
  /** Human-readable summary of the handoff plan */
  handoff_plan_summary: string;
  /** Array of sub-feature intents (length >= 1) */
  handoff_intents: HandoffIntent[];
}

// ============================================================================
// PlannerResponse Types
// Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
// Spec 2026-01-23: Questions System v1 - OpenQuestion and Question interfaces
// Spec 2026-01-23: SA Handoff Per Increment - incrementId field
// ============================================================================

/**
 * An open question from the Planner LLM that needs user clarification.
 * This is the raw type from API responses, with id assigned by gateway.
 *
 * Spec 2026-01-23: Questions System v1 - Task Group 3
 */
export interface OpenQuestion {
  /** Unique identifier for this question (UUID v4, assigned by gateway) */
  id: string;
  /** The question text that needs user clarification */
  question: string;
}

/**
 * Frontend Question type with derived and user-editable fields.
 * Extends OpenQuestion with status, answer, source, and incrementId fields.
 *
 * Spec 2026-01-23: Questions System v1 - Task Group 3
 * Spec 2026-01-23: SA Handoff Per Increment - Added incrementId field
 */
export interface Question {
  /** Unique identifier for this question (from gateway OpenQuestion.id) */
  id: string;
  /** The question text that needs user clarification (from gateway OpenQuestion.question) */
  question: string;
  /** Current status - derived from answer presence, not stored */
  status: 'Open' | 'Answered';
  /** User-provided answer text */
  answer: string;
  /** Source of the question - 'Product Manager' for PO questions, 'Software Developer' for SA, 'Test Engineer' for TE */
  source: 'Product Manager' | 'Software Developer' | 'Test Engineer';
  /**
   * Optional increment ID for SA questions.
   * - undefined/absent: PO question (feature-level, not linked to an increment)
   * - populated: SA question (linked to a specific increment)
   *
   * Used for filtering questions by activeIncrementId in the UI.
   *
   * Spec 2026-01-23: SA Handoff Per Increment - Task Group 5
   */
  incrementId?: string;
}

/**
 * A single increment within an implementation plan.
 * Represents an implementation-ready unit of work for the Software Developer.
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON - Task Group 1
 */
export interface Increment {
  /** Unique identifier for this increment (e.g., "INC-1", "INC-2") */
  id: string;
  /** 1-based index of this increment */
  partIndex: number;
  /** Short title for this increment */
  title: string;
  /** Detailed intent / specification for the Software Developer */
  intent: string;
  /** Optional dependency references (e.g., "Part 1: Database Schema") */
  dependencies?: string[];
}

/**
 * Implementation plan containing increments.
 * Represents how a feature will be broken down for implementation.
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON - Task Group 1
 */
export interface ImplementationPlan {
  /** Title of the overall implementation plan */
  planTitle: string;
  /** Array of increments that make up this plan */
  increments: Increment[];
  /** When true, the feature is split into independent parts (extremely rare) */
  isSplit?: boolean;
}

/**
 * Structured response from the Planner LLM during feature shaping.
 * Contains all the fields needed to render the Feature Definition panel.
 *
 * The `message` field contains conversational text for the chat bubbles,
 * while the other fields contain structured data for the Feature Definition area.
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON - Task Group 1
 * Spec 2026-01-23: Questions System v1 - openQuestions is now OpenQuestion[]
 */
export interface PlannerResponse {
  /** Schema version for this response format */
  schemaVersion: '1.1';
  /** Conversational message for display in chat bubbles */
  message: string;
  /** Product Manager's understanding of the feature - the primary evolving definition */
  featureUnderstanding: string;
  /** Scope definition with in-scope and out-of-scope items */
  scope: {
    /** Items explicitly included in scope */
    in: string[];
    /** Items explicitly excluded from scope */
    out: string[];
  };
  /** List of assumptions being made about the feature */
  assumptions: string[];
  /** List of acceptance criteria that define completion */
  acceptanceCriteria: string[];
  /**
   * List of open questions that need clarification.
   * Each question has a unique ID (UUID v4) assigned by the gateway.
   *
   * Spec 2026-01-23: Questions System v1 - Changed from string[] to OpenQuestion[]
   */
  openQuestions: OpenQuestion[];
  /** Whether the planner has enough information to generate a spec */
  plannerReadyForSpec: boolean;
  /** Optional implementation plan - present when ready for handoff */
  implementationPlan: ImplementationPlan | null;
}

// ============================================================================
// ImplementerResponse Types
// Spec 2026-01-23: SA Handoff Per Increment
// ============================================================================

/**
 * Structured response from the Software Developer (Implementer) LLM.
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
  schemaVersion: '1.0';
  /** Chat bubble text (conversational explanation from SA) */
  message: string;
  /**
   * Technical clarifying questions about the increment's implementation.
   * Uses OpenQuestion interface (id, question).
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
 * Chat request payload sent to the Gateway.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * - Added files field for base64-encoded file attachments
 */
export interface ChatRequest {
  /** Optional session ID for conversation continuity */
  sessionId?: string;
  /** Users message content */
  message: string;
  /** Optional context for implement_feature mode */
  context?: ImplementChatContext;
  /** Optional array of file paths or URLs to include as document sources */
  sources?: string[];
  /**
   * Optional array of base64-encoded file attachments.
   * Each entry contains the filename, MIME type, and raw base64 data (without the data URI prefix).
   * Used for inline file attachment.
   *
   * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
   */
  files?: Array<{ filename: string; mimeType: string; base64: string }>;
}

/**
 * Chat response payload received from the Gateway.
 * Contains the assistant response plus optional structured data for implement_feature mode.
 *
 * Supported modes: oas_assistant, implement_feature.
 *
 * Spec 2026-01-22: Added optional plannerResponse field for Feature Shaping UI.
 * Spec 2026-01-23: Added optional implementerResponse field for SA clarification.
 * Spec 2026-03-02: Increment 10 - Removed legacy productManagerResponse,
 *   solutionArchitectResponse, and roadmapPmResponse fields.
 */
export interface ChatResponse {
  sessionId: string;
  assistant: {
    message: string;
    artifacts?: {
      savedSpec?: {
        interfaceId: string;
        interfaceName: string;
        architectureFilename: string;
        format: string;
        savedPath: string;
        specLink: string;
      };
    };
  };
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
   */
  handoffPlan?: HandoffPlanResponse;
  /**
   * Structured planner response - populated when the Planner returns JSON during feature shaping.
   * Contains structured feature definition data for the Feature Definition panel.
   * The `message` field is extracted for chat bubbles; other fields populate the Feature Definition.
   *
   * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON - Task Group 1
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
   * Signals the frontend to reload the model from the backend.
   */
  baselineSaved?: boolean;
}

/**
 * Persona types for chat messages.
 * Used to identify who sent the message for stable attribution.
 *
 * - 'Product Manager': Messages from the PO LLM during refine/bootstrap/handoff phases
 * - 'Software Developer': Messages from the SA LLM during implementation phases
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 3: ChatMessage Persona and Streaming Delta Handling
 */
export type ChatMessagePersona = 'Product Manager' | 'Test Engineer' | 'Software Developer';

/**
 * Chat message for display in the UI.
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 3: Added optional persona field for stable message attribution
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  /**
   * Optional persona for assistant messages.
   * When set, used for rendering instead of deriving from phase.
   * - 'Product Manager': Messages from PO during refine/bootstrap/handoff phases
   * - 'Software Developer': Streaming messages from SA during implementation
   *
   * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
   * Task Group 3: Store persona on ChatMessage for stable attribution
   */
  persona?: ChatMessagePersona;
}

// ============================================================================
// Message Entry Types for Conversation Persistence
// Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
// ============================================================================

/**
 * A message entry for conversation.json persistence and rehydration.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * This type aligns with the Gateway's MessageEntry but is defined here for
 * frontend use. Uses lowercase role names for JSON serialization compatibility.
 *
 * Structure:
 * - role: "system" | "user" | "assistant" (lowercase for JSON)
 * - phase: ImplementChatPhase (bootstrap | refine | handoff | implementation_planning | test_planning | implementation_clarification)
 * - content: The message content
 * - timestamp: ISO-8601 timestamp string
 */
export interface MessageEntry {
  /** Lowercase role for JSON serialization: "system", "user", or "assistant" */
  role: 'system' | 'user' | 'assistant';
  /** Phase of the conversation when this entry was created */
  phase: ImplementChatPhase;
  /** Content of the message */
  content: string;
  /** ISO-8601 timestamp of when this entry was created */
  timestamp: string;
}

/**
 * Response from GET /api/implement-conversations endpoint.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 */
export interface GetConversationResponse {
  /** Whether a conversation file exists on disk */
  exists: boolean;
  /** Array of message entries (empty if exists is false) */
  messages: MessageEntry[];
}

/**
 * Request body for PUT /api/implement-conversations endpoint.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 */
export interface PutConversationRequest {
  /** Project identifier */
  projectId: string;
  /** Feature/work item identifier */
  featureId: string;
  /** Absolute path to project's parent folder for file storage */
  projectParentFolder: string;
  /** Feature title for folder naming */
  featureTitle: string;
  /** Array of message entries to persist */
  messages: MessageEntry[];
}

/**
 * Response from PUT /api/implement-conversations endpoint.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 */
export interface PutConversationResponse {
  /** Whether the write operation succeeded */
  success: boolean;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Sends a chat message to the Gateway and returns the assistant response.
 *
 * @param request - The chat request containing the message and optional sessionId
 * @returns Promise resolving to the ChatResponse
 * @throws Error if the request fails
 */
export async function postChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${GATEWAY_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error(`Chat request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Retrieves a persisted conversation from the Gateway.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 *   - Added projectParentFolder and featureTitle parameters for correct path derivation
 *
 * @param projectId - The project identifier
 * @param featureId - The feature/work item identifier
 * @param projectParentFolder - Absolute path to project's parent folder for file storage
 * @param featureTitle - Feature title for folder naming
 * @returns Promise resolving to { exists, messages } - exists indicates if file was found
 * @throws Error if the request fails
 */
export async function getImplementConversation(
  projectId: string,
  featureId: string,
  projectParentFolder: string,
  featureTitle: string,
  kind?: string
): Promise<GetConversationResponse> {
  let url = `${GATEWAY_BASE}/api/implement-conversations?projectId=${encodeURIComponent(projectId)}&featureId=${encodeURIComponent(featureId)}&projectParentFolder=${encodeURIComponent(projectParentFolder)}&featureTitle=${encodeURIComponent(featureTitle)}`;
  if (kind) {
    url += `&kind=${encodeURIComponent(kind)}`;
  }

  const res = await fetch(url, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`Failed to get conversation: ${res.status}`);
  }

  return res.json();
}

/**
 * Persists a conversation to disk via the Gateway.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * @param params - The conversation data to persist
 * @returns Promise resolving to { success } - indicates if write succeeded
 * @throws Error if the request fails
 */
export async function putImplementConversation(
  params: PutConversationRequest
): Promise<PutConversationResponse> {
  const res = await fetch(`${GATEWAY_BASE}/api/implement-conversations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`Failed to put conversation: ${res.status}`);
  }

  return res.json();
}

// ============================================================================
// Implement State API Functions
// Spec 2026-02-11: Persist Implementation Screen State to Disk
// Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
// ============================================================================

/**
 * Response from GET /api/implement-state endpoint.
 */
export interface GetImplementStateResponse {
  /** Whether a state file exists on disk */
  exists: boolean;
  /** The persisted state object (null if exists is false) */
  state: Record<string, unknown> | null;
}

/**
 * Request body for PUT /api/implement-state endpoint.
 */
export interface PutImplementStateRequest {
  /** Project identifier */
  projectId: string;
  /** Feature/work item identifier */
  featureId: string;
  /** Absolute path to project's parent folder for file storage */
  projectParentFolder: string;
  /** Feature title for folder naming */
  featureTitle: string;
  /** The implementation state to persist */
  state: Record<string, unknown>;
  /** Conversation kind (defaults to "implement") */
  kind?: string;
}

/**
 * Retrieves persisted implementation state from the Gateway.
 *
 * Spec 2026-02-11: Persist Implementation Screen State to Disk
 * Spec 2026-02-12: Added kind parameter support
 *
 * @param projectId - The project identifier
 * @param featureId - The feature/work item identifier
 * @param projectParentFolder - Absolute path to project's parent folder
 * @param featureTitle - Feature title for folder naming
 * @param kind - Optional conversation kind (defaults to "implement")
 * @returns Promise resolving to { exists, state }
 */
export async function getImplementState(
  projectId: string,
  featureId: string,
  projectParentFolder: string,
  featureTitle: string,
  kind?: string
): Promise<GetImplementStateResponse> {
  let url = `${GATEWAY_BASE}/api/implement-state?projectId=${encodeURIComponent(projectId)}&featureId=${encodeURIComponent(featureId)}&projectParentFolder=${encodeURIComponent(projectParentFolder)}&featureTitle=${encodeURIComponent(featureTitle)}`;
  if (kind) {
    url += `&kind=${encodeURIComponent(kind)}`;
  }

  const res = await fetch(url, { method: 'GET' });

  if (!res.ok) {
    throw new Error(`Failed to get implement state: ${res.status}`);
  }

  return res.json();
}

/**
 * Persists implementation state to disk via the Gateway.
 *
 * Spec 2026-02-11: Persist Implementation Screen State to Disk
 * Spec 2026-02-12: Added kind parameter support
 *
 * @param params - The state data to persist
 * @returns Promise resolving to { success }
 */
export async function putImplementState(
  params: PutImplementStateRequest
): Promise<{ success: boolean }> {
  const res = await fetch(`${GATEWAY_BASE}/api/implement-state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`Failed to put implement state: ${res.status}`);
  }

  return res.json();
}

// ============================================================================
// Helper Functions for Conversation Rehydration
// Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
// ============================================================================

/**
 * Generate a unique message ID.
 * Used when converting MessageEntry to ChatMessage.
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Converts a MessageEntry from disk to a ChatMessage for UI display.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * @param entry - The MessageEntry to convert
 * @returns ChatMessage with generated ID, mapped role, Date timestamp
 */
export function convertMessageEntryToChatMessage(entry: MessageEntry): ChatMessage {
  // Filter out 'system' role as ChatMessage only supports 'user' | 'assistant'
  // System messages are typically not displayed in the UI
  const role = entry.role === 'system' ? 'assistant' : entry.role;

  return {
    id: generateMessageId(),
    role: role as 'user' | 'assistant',
    content: entry.content,
    timestamp: new Date(entry.timestamp),
  };
}
