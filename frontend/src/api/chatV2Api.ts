/**
 * Chat V2 API Client
 *
 * API client for Gateway v2 chat endpoints (POST /api/chat/v2, GET /api/chat/v2/thread).
 * Provides frontend-only type definitions mirroring `gateway/src/types/chatV2.ts`
 * and utility functions for thread key serialization.
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * - Frontend-only interfaces -- do NOT import from gateway
 * - threadKeyToString matches exact backend serialization logic
 * - API client functions follow fetch + error-throw pattern from chatApi.ts
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 7
 * - `architectureId?: string` field on ChatV2Request: populated by callers when the
 *   active task's `saveTargetResolution` is `bound-by-system-prompt` or
 *   `derived-from-context` so the gateway can inject the `Architecture: <name>`
 *   line into the system prompt (bound) or persist a derived binding (derived).
 * - `Thread.metadata?` field: free-form bag the gateway uses for binding fields
 *   (`boundArchitectureId`, `boundArchitectureName`, `boundEntityType`,
 *   `boundEntityId`). The frontend invalidation banner (Group 9) reads
 *   `boundArchitectureId` here to detect mid-conversation architecture switches.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 10
 * - `postSaveArtifact` accepts an optional `architectureId` argument so the
 *   chat panel can thread the picker-chosen architecture through to the
 *   backend for `clarify-at-save` mode tasks. The backend save handler will
 *   honour this in a future change; for now the frontend forwards the field
 *   so the wire shape is in place when the backend lands the consumer.
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
 */
export type ThreadKey = HubThreadKey | FeatureThreadKey | PanelThreadKey;

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
 * Optional architecture-binding sub-shape stored on `Thread.metadata` by the
 * gateway. Populated for `bound-by-system-prompt` threads (after the first
 * successful turn against a known architecture) and for already-bound
 * `derived-from-context` threads (after the resolver has fired). Absent for
 * `clarify-at-save` and pre-spec legacy threads.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 7
 */
export interface ThreadArchitectureBindingMetadata {
  boundArchitectureId?: string;
  boundArchitectureName?: string;
  boundEntityType?: string;
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
   * Free-form metadata bag persisted by the gateway. Architecture binding
   * sub-shape (Spec #5 Group 7) is documented for type-checked callers; other
   * keys may exist (e.g., `extractedProcessActivities` from the XLSX intercept).
   */
  metadata?: Record<string, unknown> & ThreadArchitectureBindingMetadata;
}

// ============================================================================
// File Attachment Type
// ============================================================================

/**
 * A base64-encoded file attachment for chat messages.
 */
export interface FileAttachment {
  /** Original filename */
  filename: string;
  /** MIME type of the file */
  mimeType: string;
  /** Base64-encoded file content */
  base64: string;
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
  files?: FileAttachment[];
  /** Optional array of persona IDs allowed in this context (server-side enforcement) */
  allowedPersonaIds?: string[];
  /** Optional picker action type for work-item picker flow */
  pickerAction?: 'initiate' | 'search' | 'select' | 'cancel';
  /** Optional picker payload carrying action-specific data */
  pickerPayload?: {
    actionId?: string;
    query?: string;
    workItemId?: string;
    workItemTitle?: string;
    scopeType?: string;
    scopeValue?: string;
  };
  /**
   * Optional URL-active architecture id. Populated by callers when the active
   * task's `saveTargetResolution` is `bound-by-system-prompt` or
   * `derived-from-context` so the gateway can inject the `Architecture: <name>`
   * line into the system prompt (bound mode) or thread it through to the
   * derived-binding resolver. Omitted for `clarify-at-save` and project-level
   * tasks. See `frontend/src/config/taskConfig.ts` for the mode mapping.
   *
   * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG7
   */
  architectureId?: string;
}

/**
 * Optional binding-error payload that the gateway may return on the chatV2
 * response when a `derived-from-context` `contextBinding` block was refused
 * by the resolver. The HTTP status remains 200 (the chat turn itself
 * succeeded); only the binding side effect failed. Mirrors the gateway's
 * `ChatV2BindingError` interface from `gateway/src/types/chatV2.ts`.
 *
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Group 6
 */
export interface ChatV2BindingError {
  status: 422;
  code: 'unsupported_binding_type' | 'archived_architecture' | 'lookup_failed';
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
   * Optional binding-error payload (Spec #5 Group 6). Surfaced when the
   * gateway's `derived-from-context` resolver refused the LLM's
   * `contextBinding` block. The frontend invalidation banner / inline error
   * surface (Group 9) renders this to inform the user.
   */
  bindingError?: ChatV2BindingError;
}

// ============================================================================
// Thread Key Serialization
// ============================================================================

/**
 * Serializes a ThreadKey to its deterministic string form.
 * Matches the exact serialization logic from `gateway/src/types/chatV2.ts`.
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

// ============================================================================
// Message ID Generation
// ============================================================================

/**
 * Generate a unique message ID for optimistic client-side messages.
 * Follows the pattern from chatApi.ts generateMessageId().
 */
export function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// API Client
// ============================================================================

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Sends a v2 chat message to the Gateway and returns the assistant response.
 *
 * @param request - The ChatV2Request containing threadKey, personaId, taskId, message, optional files, and optional allowedPersonaIds
 * @returns Promise resolving to the ChatV2Response
 * @throws Error if the request fails
 */
export async function postChatV2(request: ChatV2Request): Promise<ChatV2Response> {
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error(`Chat v2 request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Retrieves thread history from the Gateway GET /api/chat/v2/thread endpoint.
 *
 * @param threadKey - The ThreadKey identifying the conversation to load
 * @returns Promise resolving to the Thread object with messages
 * @throws Error if the request fails
 */
export async function getThreadHistory(threadKey: ThreadKey): Promise<Thread> {
  const serialized = threadKeyToString(threadKey);
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2/thread?key=${encodeURIComponent(serialized)}`);

  if (!res.ok) {
    throw new Error(`Thread history request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Sends a persona handoff request to the Gateway POST /api/chat/v2/handoff endpoint.
 * Persists a "Switched to {displayName}" system message in the thread.
 * Fire-and-forget from the caller's perspective -- does not return the response body.
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 *
 * @param threadKey - The ThreadKey identifying the conversation thread
 * @param personaId - The persona ID being switched to
 * @throws Error if the request fails (non-2xx response)
 */
export async function postHandoff(threadKey: ThreadKey, personaId: string): Promise<void> {
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadKey, personaId }),
  });

  if (!res.ok) {
    throw new Error(`Handoff failed with status ${res.status}`);
  }
}

/**
 * Sends a generation request to produce an artifact (e.g., MISSION.MD or Roadmap)
 * from the current thread conversation history.
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End (Task Group 4)
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.3: Added allowedPersonaIds parameter
 *
 * @param threadKey - The ThreadKey identifying the conversation thread
 * @param personaId - The persona ID that owns the generation (e.g., 'product-manager')
 * @param taskId - The task ID to generate the artifact for (e.g., 'product-manager--define-product' or 'product-manager--roadmap')
 * @param allowedPersonaIds - Optional array of persona IDs allowed in this context (server-side enforcement)
 * @returns Promise resolving to the generation result with success status and optional artifactContent (generalized) or missionMarkdown (legacy)
 * @throws Error if the request fails (non-2xx response)
 */
export async function postGenerateArtifact(
  threadKey: ThreadKey,
  personaId: string,
  taskId: string,
  allowedPersonaIds?: string[]
): Promise<{ success: boolean; missionMarkdown?: string; artifactContent?: string; error?: string }> {
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadKey,
      personaId,
      taskId,
      ...(allowedPersonaIds ? { allowedPersonaIds } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Generate artifact request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Sends a save request to persist an artifact (e.g., MISSION.MD) to disk
 * via the MCP tool execution pipeline.
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.4: Added allowedPersonaIds parameter
 * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10:
 *   `architectureId` parameter forwards the picker-chosen architecture for
 *   `clarify-at-save` tasks. Omitted for bound / derived / project-level
 *   tasks (the architecture binding for those modes is already on the
 *   thread metadata or the request body upstream).
 *
 * @param threadKey - The ThreadKey identifying the conversation thread
 * @param taskId - The task ID that produced the artifact
 * @param artifactId - The artifact slot identifier (e.g., 'mission-md')
 * @param content - The artifact content to save (e.g., the generated markdown)
 * @param allowedPersonaIds - Optional array of persona IDs allowed in this context (server-side enforcement)
 * @param architectureId - Optional architecture id chosen via the clarify-at-save picker (Spec #5 TG10)
 * @returns Promise resolving to the save result with success status
 * @throws Error if the request fails (non-2xx response)
 */
export async function postSaveArtifact(
  threadKey: ThreadKey,
  taskId: string,
  artifactId: string,
  content: string,
  allowedPersonaIds?: string[],
  architectureId?: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2/save-artifact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadKey,
      taskId,
      artifactId,
      content,
      ...(allowedPersonaIds ? { allowedPersonaIds } : {}),
      ...(architectureId ? { architectureId } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`Save artifact request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Deletes a thread from the Gateway via DELETE /api/chat/v2/thread.
 *
 * @param threadKey - The ThreadKey identifying the conversation to delete
 * @returns Promise resolving to { success: boolean }
 * @throws Error if the request fails
 */
export async function deleteThread(threadKey: ThreadKey): Promise<{ success: boolean }> {
  const serialized = threadKeyToString(threadKey);
  const res = await fetch(`${GATEWAY_BASE}/api/chat/v2/thread?key=${encodeURIComponent(serialized)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    throw new Error(`Delete thread request failed: ${res.status}`);
  }

  return res.json();
}
