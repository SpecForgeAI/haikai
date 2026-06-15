/**
 * TypeScript type definitions for the v2 conversation engine
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * - ThreadKey discriminated union for hub, feature, and panel thread scopes
 * - ThreadMessage and Thread interfaces for thread persistence model
 * - PersonaDefinition, TaskDefinition, PhaseDefinition for registry config
 * - ContextResolverConfig for context resolution configuration
 * - ChatV2Request and ChatV2Response for POST /api/chat/v2 endpoint
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) -- Task Group 5:
 * - `saveTargetResolution` field on PersonaDefinition + TaskDefinition (per-task overrides win).
 * - `architectureId` optional field on ChatV2Request (URL-active architecture for bound mode).
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5):
 * - Group 2: `saveTargetResolution` union extended to include `'derived-from-context'`,
 *   plus `ThreadArchitectureBindingMetadata` sub-shape on `Thread.metadata`.
 * - Group 6: `bindingError` optional field on ChatV2Response so the chatV2 handler
 *   can surface DerivedBindingError 422 codes back to the frontend without breaking
 *   the existing `error` (validation-failure) channel.
 */

// ============================================================================
// Thread Key Types
// ============================================================================

/**
 * Hub thread key -- one thread per project at the hub level.
 * Serialized form: `project:{projectId}:hub`
 */
export interface HubThreadKey {
  type: 'hub';
  projectId: string;
}

/**
 * Feature thread key -- one thread per feature within a project.
 * Serialized form: `project:{projectId}:feature:{featureId}`
 */
export interface FeatureThreadKey {
  type: 'feature';
  projectId: string;
  featureId: string;
}

/**
 * Panel thread key -- one thread per panel view within a project.
 * Serialized form: `project:{projectId}:panel:{screen}:{entityId}` (entityId optional)
 */
export interface PanelThreadKey {
  type: 'panel';
  projectId: string;
  screen: string;
  entityId?: string;
}

/**
 * Discriminated union for all thread key variants.
 * Discriminant field is `type`.
 *
 * Variants:
 * - `hub`: Project-level hub thread
 * - `feature`: Feature-scoped thread
 * - `panel`: Side panel thread
 */
export type ThreadKey = HubThreadKey | FeatureThreadKey | PanelThreadKey;

/**
 * Serializes a ThreadKey to its deterministic string form.
 *
 * Patterns:
 * - hub:     `project:{projectId}:hub`
 * - feature: `project:{projectId}:feature:{featureId}`
 * - panel:   `project:{projectId}:panel:{screen}` or `project:{projectId}:panel:{screen}:{entityId}`
 */
export function threadKeyToString(key: ThreadKey): string {
  switch (key.type) {
    case 'hub':
      return `project:${key.projectId}:hub`;
    case 'feature':
      return `project:${key.projectId}:feature:${key.featureId}`;
    case 'panel':
      return key.entityId
        ? `project:${key.projectId}:panel:${key.screen}:${key.entityId}`
        : `project:${key.projectId}:panel:${key.screen}`;
  }
}

/**
 * Parses a serialized thread key string back into a ThreadKey object.
 * Throws an Error if the string does not match any known pattern.
 *
 * Expected patterns:
 * - `project:{projectId}:hub`
 * - `project:{projectId}:feature:{featureId}`
 * - `project:{projectId}:panel:{screen}` or `project:{projectId}:panel:{screen}:{entityId}`
 */
export function parseThreadKey(raw: string): ThreadKey {
  const parts = raw.split(':');

  if (parts.length < 3 || parts[0] !== 'project') {
    throw new Error(`Invalid thread key format: ${raw}`);
  }

  const projectId = parts[1];
  const keyType = parts[2];

  switch (keyType) {
    case 'hub':
      if (parts.length !== 3) {
        throw new Error(`Invalid hub thread key format: ${raw}`);
      }
      return { type: 'hub', projectId };

    case 'feature':
      if (parts.length !== 4 || !parts[3]) {
        throw new Error(`Invalid feature thread key format: ${raw}`);
      }
      return { type: 'feature', projectId, featureId: parts[3] };

    case 'panel':
      if (parts.length < 4 || !parts[3]) {
        throw new Error(`Invalid panel thread key format: ${raw}`);
      }
      return {
        type: 'panel',
        projectId,
        screen: parts[3],
        ...(parts.length >= 5 && parts[4] ? { entityId: parts[4] } : {}),
      };

    default:
      throw new Error(`Unknown thread key type '${keyType}' in: ${raw}`);
  }
}

// ============================================================================
// Thread Message and Thread Types
// ============================================================================

/**
 * A single message within a conversation thread.
 */
export interface ThreadMessage {
  /** Unique message identifier (UUID v4) */
  id: string;
  /** Message role */
  role: 'user' | 'assistant' | 'system';
  /** Persona ID that generated this message (null for user messages) */
  personaId: string | null;
  /** Task ID active when this message was created (null for user messages) */
  taskId: string | null;
  /** Raw text content of the message */
  content: string;
  /** Parsed structured response data (null for user messages or freeform responses) */
  structuredResponse: unknown | null;
  /** ISO-8601 timestamp of when the message was created */
  timestamp: string;
}

/**
 * Known sub-shape that may appear inside `Thread.metadata` to record an
 * established architecture binding for a `derived-from-context` (or after-bind
 * `bound-by-system-prompt`) conversation.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2 (declaration) + Task Group 6 (write site in chatV2 handler).
 *
 * Persisted by the chatV2 response handler (Group 6) once the LLM has emitted
 * a `contextBinding` block and the `derivedBindingResolver` has successfully
 * resolved the entity to an architecture. Read by:
 *   - `composeSystemPrompt` (Group 4) -- to inject the
 *     `Architecture: <name> (id: <id>)` line on subsequent turns once the
 *     conversation is bound, and to omit the line until then for
 *     `derived-from-context` mode.
 *   - The chatV2 handler (Group 6) -- to ignore second `contextBinding`
 *     blocks (V1 does not allow re-binding within a single thread; user must
 *     start a new conversation to switch entity).
 *   - The frontend invalidation banner (Group 9) -- compares
 *     `boundArchitectureId` to `useActiveArchitectureId()` and renders the
 *     mid-conversation switch warning when they differ.
 *
 * The fields live on `Thread.metadata` (existing free-form
 * `Record<string, unknown>` field) rather than as a top-level `Thread`
 * field so the storage layout stays unchanged. Callers are expected to spread
 * known binding keys into `metadata` directly (no nested `binding: {}`
 * wrapper) to keep persistence flat.
 */
export interface ThreadArchitectureBindingMetadata {
  /** UUID of the architecture the thread is bound to. */
  boundArchitectureId?: string;
  /** Human-readable name of the bound architecture (snapshot at bind time). */
  boundArchitectureName?: string;
  /**
   * Entity type that produced the binding (V1: always `'interface'` because
   * `derivedBindingResolver` only accepts interfaces; future: `'service'`,
   * `'application'`, etc.). Stored so future re-binding flexibility can
   * decide whether a second `contextBinding` of the same entity-type is a
   * no-op or a re-bind.
   */
  boundEntityType?: string;
  /** ID of the entity (e.g. interface UUID) the LLM identified. */
  boundEntityId?: string;
}

/**
 * A conversation thread containing a sequence of messages.
 */
export interface Thread {
  /** Serialized thread key string */
  threadKey: string;
  /** Project identifier */
  projectId: string;
  /** Ordered array of messages in this thread */
  messages: ThreadMessage[];
  /** Currently active persona ID (null if no persona is active) */
  activePersonaId: string | null;
  /** Currently active task ID (null if no task is active) */
  activeTaskId: string | null;
  /** Rolling summary of older messages (null if no summarisation has occurred) */
  summary: string | null;
  /** Index into thread.messages up to which messages have been summarised */
  summarisedUpToIndex: number;
  /** ISO-8601 timestamp of when the thread was created */
  createdAt: string;
  /** ISO-8601 timestamp of the last update to this thread */
  updatedAt: string;
  /**
   * Optional key-value metadata for task-specific data (e.g., deterministic
   * extractions). May also carry the
   * {@link ThreadArchitectureBindingMetadata} fields once a
   * `derived-from-context` thread has been bound by the chatV2 response
   * handler (Spec #5 Group 6). The intersection type keeps the field
   * permissive (any string-keyed value still allowed) while documenting the
   * known binding sub-shape for type-checked callers.
   */
  metadata?: Record<string, unknown> & ThreadArchitectureBindingMetadata;
}

// ============================================================================
// Registry Definition Types
// ============================================================================

/**
 * Save-target architecture resolution mode union shared by
 * {@link PersonaDefinition.saveTargetResolution} and
 * {@link TaskDefinition.saveTargetResolution}.
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) Group 5
 *   - `'bound-by-system-prompt'` shipped (Discovery tasks).
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) Group 2
 *   - `'derived-from-context'` added (architect--oas-spec, V1 interfaces only).
 *   - `'clarify-at-save'` added (UX tasks; picker fires at save time).
 */
export type SaveTargetResolutionMode =
  | 'bound-by-system-prompt'
  | 'derived-from-context'
  | 'clarify-at-save';

/**
 * Definition of a persona loaded from a JSON config file.
 * Stored under `gateway/src/config/personas/{id}.json`.
 */
export interface PersonaDefinition {
  /** Unique persona identifier (e.g., 'product-manager', 'architect') */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Color for UI rendering (hex or Tailwind token) */
  color: string;
  /** Relative path to the identity prompt .md file */
  identityPromptRef: string;
  /** Array of task IDs available to this persona */
  tasks: string[];
  /** Label for UI menus */
  menuLabel: string;
  /**
   * Save-target architecture resolution mode -- persona-level DEFAULT only.
   * Per-task overrides win when {@link TaskDefinition.saveTargetResolution}
   * is set. See {@link SaveTargetResolutionMode} for the union semantics and
   * spec references.
   */
  saveTargetResolution?: SaveTargetResolutionMode;
}

/**
 * Definition of a phase within a workflow-mode task.
 */
export interface PhaseDefinition {
  /** Unique phase identifier within the task */
  id: string;
  /** Human-readable label */
  label: string;
  /** Relative path to the phase-specific prompt .md file */
  phasePromptRef: string;
  /** JSON schema for the phase's structured response (null for freeform phases) */
  responseFormat: Record<string, unknown> | null;
}

/**
 * Definition of a task loaded from a JSON config file.
 * Stored under `gateway/src/config/tasks/{personaId}--{taskSlug}.json`.
 */
export interface TaskDefinition {
  /** Unique task identifier (e.g., 'product-manager--define-product') */
  id: string;
  /** Persona ID that owns this task */
  personaId: string;
  /** Label for UI menus */
  menuLabel: string;
  /** Description of what this task does */
  description: string;
  /** Task mode: discovery, advisory, workflow, or assessment */
  mode: 'discovery' | 'advisory' | 'workflow' | 'assessment';
  /** Relative path to the task prompt .md file */
  taskPromptRef: string;
  /** JSON schema describing the structured response shape (null for freeform tasks) */
  responseFormat: Record<string, unknown> | null;
  /** Array of context resolver keys needed by this task */
  contextNeeds: string[];
  /** Thread scope type for persistence */
  persistence: string;
  /** Array of artifact slot declarations */
  artifacts: Array<Record<string, unknown>>;
  /** Array of phase definitions for workflow-mode tasks (null for other modes) */
  phases: PhaseDefinition[] | null;
  /** Entry point types from which this task is available */
  availableFrom: string[];
  /**
   * Save-target architecture resolution mode for THIS task. Overrides the
   * persona-level default (`PersonaDefinition.saveTargetResolution`) when
   * set. See {@link SaveTargetResolutionMode} for the union semantics and
   * spec references.
   */
  saveTargetResolution?: SaveTargetResolutionMode;
}

// ============================================================================
// Context Resolver Config
// ============================================================================

/**
 * Configuration for a context resolver entry.
 * Maps a context-need key to a resolver type.
 */
export interface ContextResolverConfig {
  /** Context-need key (e.g., 'mission', 'tech-stack') */
  key: string;
  /** Resolver type identifier */
  resolverType: string;
}

// ============================================================================
// Chat V2 Request / Response Types
// ============================================================================

/**
 * Request body for POST /api/chat/v2 endpoint.
 */
export interface ChatV2Request {
  /** Thread key object identifying the conversation scope */
  threadKey: {
    type: 'hub' | 'feature' | 'panel';
    projectId: string;
    featureId?: string;
    screen?: string;
    entityId?: string;
  };
  /** Persona ID to use for this request */
  personaId: string;
  /** Task ID to execute (use 'unknown' to trigger menu hook) */
  taskId: string;
  /** User message content */
  message: string;
  /** Optional array of base64-encoded file attachments */
  files?: Array<{ filename: string; mimeType: string; base64: string }>;
  /** Optional array of allowed persona IDs for server-side validation */
  allowedPersonaIds?: string[];
  /** Optional picker action type for work-item picker flow */
  pickerAction?: 'initiate' | 'search' | 'select' | 'cancel';
  /** Optional picker payload carrying action-specific data */
  pickerPayload?: {
    actionId?: string;       // for 'initiate'
    query?: string;          // for 'search'
    workItemId?: string;     // for 'select'
    workItemTitle?: string;  // for 'select'
    scopeType?: string;      // for 'search'
    scopeValue?: string;     // for 'search'
  };
  /**
   * Optional URL-active architecture id used for `bound-by-system-prompt`
   * mode: the chatV2 handler resolves this to a name and asks
   * {@link composeSystemPrompt} to inject the
   * `Architecture: <name> (id: <id>)` line.
   *
   * Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4)
   * Group 5; extended to non-Discovery architect tasks in Spec #5 Group 8.
   */
  architectureId?: string;
}

/**
 * Discriminated set of failure codes the chatV2 handler returns when the
 * derived-binding resolver refuses a `contextBinding` block. Mirrors
 * {@link ../services/derivedBindingResolver.DerivedBindingErrorCode}.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
 * Group 6.
 */
export type ChatV2BindingErrorCode =
  | 'unsupported_binding_type'
  | 'archived_architecture'
  | 'lookup_failed';

/**
 * Structured binding-error payload returned on
 * {@link ChatV2Response.bindingError} when the LLM emitted a
 * `contextBinding` block but the derived-binding resolver refused it.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
 * Group 6.
 */
export interface ChatV2BindingError {
  /** HTTP status code class (always 422 in V1). */
  status: number;
  /** Machine-readable failure code; mirrors DerivedBindingErrorCode. */
  code: ChatV2BindingErrorCode;
  /** Human-readable message safe to show in the chat panel. */
  message: string;
}

/**
 * Response body from POST /api/chat/v2 endpoint.
 */
export interface ChatV2Response {
  /** Serialized thread key string */
  threadKey: string;
  /** Persona ID that generated the response */
  personaId: string;
  /** Task ID that was executed */
  taskId: string;
  /** Assistant's response content */
  assistant: { message: string };
  /** Structured response data (shape determined by task's responseFormat, null for freeform) */
  structuredResponse: unknown | null;
  /** Error message for validation failures (optional) */
  error?: string;
  /**
   * Optional binding-error payload populated when the LLM emitted a
   * `contextBinding` block in `derived-from-context` mode but the
   * `derivedBindingResolver` refused (unsupported entity type, archived
   * architecture, or upstream lookup failure).
   *
   * The HTTP response itself is still 200 -- the chat turn completed and
   * the user-facing assistant message is included; only the binding side-
   * effect failed. Frontend (Group 9) renders the failure inline so the
   * user can pick a different entity on the next turn.
   *
   * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
   * Group 6.
   */
  bindingError?: ChatV2BindingError;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to validate that an object has the required fields for a ChatV2Request.
 * Checks presence and types of required fields only -- does not validate values.
 */
export function isChatV2Request(obj: unknown): obj is ChatV2Request {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  // Check threadKey is an object with required type and projectId
  if (typeof candidate.threadKey !== 'object' || candidate.threadKey === null) {
    return false;
  }
  const threadKey = candidate.threadKey as Record<string, unknown>;
  if (typeof threadKey.type !== 'string' || typeof threadKey.projectId !== 'string') {
    return false;
  }
  if (!['hub', 'feature', 'panel'].includes(threadKey.type)) {
    return false;
  }

  // Check required string fields
  if (typeof candidate.personaId !== 'string') {
    return false;
  }
  if (typeof candidate.taskId !== 'string') {
    return false;
  }
  if (typeof candidate.message !== 'string') {
    return false;
  }

  // Check optional files array
  if (candidate.files !== undefined) {
    if (!Array.isArray(candidate.files)) {
      return false;
    }
    for (const file of candidate.files) {
      if (typeof file !== 'object' || file === null) {
        return false;
      }
      const f = file as Record<string, unknown>;
      if (typeof f.filename !== 'string' || typeof f.mimeType !== 'string' || typeof f.base64 !== 'string') {
        return false;
      }
    }
  }

  // Check optional allowedPersonaIds array
  if (candidate.allowedPersonaIds !== undefined) {
    if (!Array.isArray(candidate.allowedPersonaIds)) {
      return false;
    }
    for (const id of candidate.allowedPersonaIds) {
      if (typeof id !== 'string') {
        return false;
      }
    }
  }

  // Check optional architectureId (Spec #4 Task Group 5)
  if (candidate.architectureId !== undefined && typeof candidate.architectureId !== 'string') {
    return false;
  }

  return true;
}

/**
 * Type guard to validate that an object has the required fields for a ChatV2Response.
 * Checks presence and types of required fields only -- does not validate values.
 */
export function isChatV2Response(obj: unknown): obj is ChatV2Response {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;

  if (typeof candidate.threadKey !== 'string') {
    return false;
  }
  if (typeof candidate.personaId !== 'string') {
    return false;
  }
  if (typeof candidate.taskId !== 'string') {
    return false;
  }

  // Check assistant object with message field
  if (typeof candidate.assistant !== 'object' || candidate.assistant === null) {
    return false;
  }
  const assistant = candidate.assistant as Record<string, unknown>;
  if (typeof assistant.message !== 'string') {
    return false;
  }

  // structuredResponse can be anything (unknown | null), so no check needed
  // error is optional string
  if (candidate.error !== undefined && typeof candidate.error !== 'string') {
    return false;
  }

  return true;
}
