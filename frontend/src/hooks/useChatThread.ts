/**
 * useChatThread Custom Hook
 *
 * Manages conversation thread state for the Unified Chat Panel.
 * Provides local state for messages, active persona/task, loading, and error,
 * plus actions to send messages, select personas, and select tasks.
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 4: useChatThread Custom Hook
 *
 * Spec 2026-02-28: Hub Chat MVP v1 (Frontend + Backend Wiring)
 * Task Group 3: useChatThread Hook Enhancements
 * - @-mention stripping from messages before display and API send
 * - Message queuing when activeTaskId is 'unknown'
 * - Persona handoff system messages with postHandoff persistence
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 7: useChatThread Hook Extensions
 * - Generation, confirmation, rejection flows for artifact preview
 * - Phase detection: auto-trigger generateArtifact after user confirms readiness
 * - Sealed segment tracking via sealedTaskIds computed from completion-chip messages
 * - Dashboard re-fetch callback wiring via onArtifactSaved
 * - missionExists warning for re-run flow
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 6: useChatThread Hook Generalization
 * - TASK_ARTIFACT_MAP constant for task-agnostic artifact handling
 * - artifactExists record replaces missionExists boolean
 * - Generalized generateArtifact, confirmArtifact, selectTask
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 4: useChatThread Hook Extension
 * - Added architect--define-architecture entry to TASK_ARTIFACT_MAP
 * - Added architecture-preview routing in generateArtifact
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 5: useChatThread Hook Extension
 * - Added architect--define-tech-stack entry to TASK_ARTIFACT_MAP
 * - Added test-engineer--test-strategy entry to TASK_ARTIFACT_MAP
 * - Added tech-stack-preview and test-strategy-preview routing in generateArtifact
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 2: Frontend API Client + useChatThread Hook -- Thread allowedPersonaIds
 * - Added allowedPersonaIdsRef to hold options.allowedPersonaIds
 * - Thread allowedPersonaIds through to postChatV2, postGenerateArtifact, postSaveArtifact
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 1: FR2 + FR4
 * - FR2: selectPersona now calls sendMessage('') after switch to trigger greeting + task menu
 * - FR4: selectTask sends menuLabel directly instead of "Selected task: {label}"
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 8, Task 8.3: Extend sendMessage to accept picker fields
 * - Added optional third parameter pickerFields to sendMessage
 * - Merges pickerAction and pickerPayload into the ChatV2Request when present
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 4: useChatThread Hook Extension
 * - Added architect--detailed-data-model entry to TASK_ARTIFACT_MAP
 * - Added data-model-preview routing in generateArtifact
 *
 * Spec 2026-04-04: Phase 0 Completion and Handoff
 * Task Group 5: Task Definition + Frontend TASK_ARTIFACT_MAP
 * - Added architect--discovery-framing entry to TASK_ARTIFACT_MAP
 * - Uses previewType 'artifact-preview' for markdown rendering
 *
 * Spec 2026-05-01: Multi-Architecture Save-Target Resolution (Spec #5)
 * Task Group 7: chatV2 request-side architectureId threading
 * - sendMessage consults `shouldSendArchitectureIdForTask` for the active task
 *   and threads `useActiveArchitectureId()` into the chatV2 request body when
 *   the task is `bound-by-system-prompt` or `derived-from-context`. The field
 *   is omitted for `clarify-at-save` (the picker handles save-time selection)
 *   and unmapped project-level tasks. Mirrors the spec #4 Group 6 Discovery
 *   wiring pattern that already threads architectureId into createDiscoveryRun.
 *
 * Spec 2026-05-01: Multi-Architecture Save-Target Resolution (Spec #5)
 * Task Group 10: Chat panel wiring -- read thread metadata, surface bindingError,
 *                accept clarify-at-save architectureId override on confirmArtifact
 * - On thread history load, lift `Thread.metadata.boundArchitectureId` and
 *   `boundArchitectureName` into hook state so the chat panel can decide
 *   whether to mount the invalidation banner and whether to disable the
 *   chat input (Group 9 banner; Group 10 panel wiring).
 * - On every chatV2 response, refresh the bound architecture state from any
 *   newly-persisted binding fields the gateway returned (Group 6 wires the
 *   resolver to mutate `Thread.metadata` when the LLM emits a
 *   `contextBinding` block) so the banner reflects the latest state without
 *   a thread reload.
 * - When the chatV2 response includes `bindingError`, surface it as an
 *   inline system message in the message stream with code-specific guidance
 *   so the user understands why the LLM's `contextBinding` was refused.
 * - `confirmArtifact` accepts an optional `targetArchitectureId` parameter so
 *   the clarify-at-save picker can thread its chosen architecture through to
 *   `postSaveArtifact`. Bound / derived / project-level tasks pass nothing
 *   and the field is omitted from the wire payload as before.
 *
 * - Pure local state hook (no React Context)
 * - Loads thread history on mount and threadKey changes
 * - Optimistic message append on send
 * - Task menu handling: keeps activeTaskId as 'unknown' when task-menu is returned
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ThreadKey,
  ThreadMessage,
  FileAttachment,
  ChatV2Response,
  ChatV2BindingError,
  postChatV2,
  getThreadHistory,
  postHandoff,
  postGenerateArtifact,
  postSaveArtifact,
  deleteThread,
  generateMessageId,
  threadKeyToString,
} from '../api/chatV2Api';
import { PERSONA_CONFIGS, getPersonaConfig } from '../config/personaConfig';
import { createDiscoveryRun, LlmSoloConfirmationRequiredError } from '../api/discoveryApi';
// Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
// useActiveArchitectureId provides the URL-bound architecture id which is
// passed into createDiscoveryRun so the new run is bound to that
// architecture for life. The hook returns null when the URL has no
// `:architectureId` segment (in which case we skip the run creation).
//
// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG7
// The same hook is also threaded into the chatV2 request body for tasks whose
// `saveTargetResolution` is `bound-by-system-prompt` or `derived-from-context`.
import { useActiveArchitectureId } from '../contexts/ArchitectureContext';
// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG7
// Frontend mirror of the backend `saveTargetResolution` field used to decide
// whether the chatV2 request should carry the URL active architectureId.
import { shouldSendArchitectureIdForTask } from '../config/taskConfig';

// ============================================================================
// Task-to-Artifact Mapping
// Spec 2026-03-01: Hub Bootstrap 2 -- TG6.2
// Spec 2026-03-01: Hub Bootstrap 3 -- TG4.2: Added architect--define-architecture
// Spec 2026-03-01: Hub Bootstrap 4 -- TG5.8: Added architect--define-tech-stack, test-engineer--test-strategy
// Spec 2026-03-14: Detailed Data Model Task -- TG4.5: Added architect--detailed-data-model
// Spec 2026-04-04: Phase 0 Completion and Handoff -- TG5.3: Added architect--discovery-framing
// ============================================================================

export const TASK_ARTIFACT_MAP: Record<string, {
  artifactId: string;
  artifactName: string;
  artifactKey: string;
  completionMessage: string;
  warningText: string;
  previewType: string;
  headerLabel?: string;
  confirmLabel?: string;
}> = {
  'product-manager--define-product': {
    artifactId: 'mission-md',
    artifactName: 'MISSION.MD',
    artifactKey: 'mission',
    completionMessage: 'Product Definition complete.',
    warningText: 'A Product Definition (MISSION.md) already exists. Completing this conversation will replace it.',
    previewType: 'artifact-preview',
  },
  'product-manager--roadmap': {
    artifactId: 'roadmap',
    artifactName: 'ROADMAP',
    artifactKey: 'roadmap',
    completionMessage: 'Roadmap complete.',
    warningText: 'A Roadmap already exists. Completing this conversation will update it.',
    previewType: 'roadmap-preview',
  },
  'architect--define-architecture': {
    artifactId: 'architecture-baseline',
    artifactName: 'ARCHITECTURE_BASELINE',
    artifactKey: 'architecture',
    completionMessage: 'Architecture Baseline complete.',
    warningText: 'An Architecture Baseline already exists. Completing this conversation will replace it.',
    previewType: 'architecture-preview',
  },
  'architect--detailed-data-model': {
    artifactId: 'data-model',
    artifactName: 'DATA_MODEL',
    artifactKey: 'dataModel',
    completionMessage: 'Data Model complete.',
    warningText: 'Data model entities already exist in the architecture. Completing this conversation will add to them.',
    previewType: 'data-model-preview',
  },
  'architect--define-tech-stack': {
    artifactId: 'tech-stack',
    artifactName: 'TECH-STACK.MD',
    artifactKey: 'techStack',
    completionMessage: 'Tech Stack complete.',
    warningText: 'A Tech Stack already exists. Completing this conversation will replace it.',
    previewType: 'tech-stack-preview',
  },
  'test-engineer--test-strategy': {
    artifactId: 'test-strategy',
    artifactName: 'TEST-STRATEGY.MD',
    artifactKey: 'testStrategy',
    completionMessage: 'Test Strategy complete.',
    warningText: 'A Test Strategy already exists. Completing this conversation will replace it.',
    previewType: 'test-strategy-preview',
  },
  'ux-designer--users-interactions': {
    artifactId: 'user-journeys',
    artifactName: 'USER_JOURNEYS',
    artifactKey: 'usersAndInteractions',
    completionMessage: 'User journeys and activity steps saved to architecture.',
    warningText: 'User journey data already exists in the architecture. Completing this conversation will update it.',
    previewType: 'user-journeys-preview',
  },
  'product-manager--backlog': {
    artifactId: 'backlog',
    artifactName: 'BACKLOG',
    artifactKey: 'backlog',
    completionMessage: 'Backlog complete.',
    warningText: 'Features and stories already exist for this epic. Completing this conversation will update them.',
    previewType: 'backlog-preview',
  },
  'architect--oas-spec': {
    artifactId: 'oas-spec',
    artifactName: 'OAS Spec',
    artifactKey: 'oasSpec',
    completionMessage: 'OAS Spec saved.',
    warningText: 'An OAS Spec already exists for this interface. Completing this conversation will replace it.',
    previewType: 'artifact-preview',
    headerLabel: 'OpenAPI Specification',
    confirmLabel: 'Save Spec',
  },
  'architect--discovery-framing': {
    artifactId: 'discovery-framing',
    artifactName: 'DISCOVERY_BRIEF',
    artifactKey: 'discoveryBrief',
    completionMessage: 'Discovery Framing complete.',
    warningText: 'A Discovery Brief already exists. Completing this conversation will create a new revision.',
    previewType: 'artifact-preview',
    headerLabel: 'Discovery Brief',
    confirmLabel: 'Start Discovery',
  },
};

// ============================================================================
// Picker Fields Type
// Spec 2026-03-04: What's Next v1-C -- Work Item Picker -- TG8.3
// ============================================================================

export interface PickerFields {
  pickerAction: 'initiate' | 'search' | 'select' | 'cancel';
  pickerPayload?: Record<string, string | undefined>;
}

// ============================================================================
// Hook Options
// ============================================================================

export interface UseChatThreadOptions {
  /** Initial persona ID to use if thread has no active persona */
  initialPersonaId?: string;
  /** Restrict which personas can be @-mentioned */
  allowedPersonaIds?: string[];
  /** Callback triggered after an artifact is successfully saved (e.g., dashboard re-fetch) */
  onArtifactSaved?: (info?: { artifactType?: string; epicId?: string }) => void;
  /** Record of artifact existence flags keyed by artifact key (e.g., { mission: true, roadmap: false }) */
  artifactExists?: Record<string, boolean>;
}

// ============================================================================
// Binding Error Code -> User-Friendly Message
// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
// ============================================================================

/**
 * Builds the user-facing message body for a `bindingError` returned by the
 * chatV2 response (Group 6). Code-specific guidance overrides the gateway's
 * raw message so the user gets actionable copy; the gateway message is
 * appended in parentheses for diagnostic context.
 */
function buildBindingErrorMessage(bindingError: ChatV2BindingError): string {
  const detail = bindingError.message ? ` (${bindingError.message})` : '';
  switch (bindingError.code) {
    case 'archived_architecture':
      return `Cannot bind to archived architecture. Pick a different entity.${detail}`;
    case 'unsupported_binding_type':
      return `This entity type isn't supported in V1.${detail}`;
    case 'lookup_failed':
      return `Failed to look up architecture for the provided entity.${detail}`;
    default:
      return `Could not bind conversation to an architecture.${detail}`;
  }
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseChatThreadReturn {
  /** Ordered array of messages in the current thread */
  messages: ThreadMessage[];
  /** Currently active persona ID */
  activePersonaId: string;
  /** Currently active task ID */
  activeTaskId: string;
  /** Whether a message send is in progress */
  isLoading: boolean;
  /** Error message from last failed operation, or null */
  error: string | null;
  /** Whether artifact generation is in progress */
  isGenerating: boolean;
  /** Whether artifact save is in progress */
  isSaving: boolean;
  /** Current artifact preview state (taskId + content), or null if none */
  artifactPreview: { taskId: string; content: string } | null;
  /** Set of taskIds that have been completed (sealed by a completion chip) */
  sealedTaskIds: Set<string>;
  /**
   * Architecture id this thread is bound to (Spec #5 Group 6/7/10). Sourced
   * from `Thread.metadata.boundArchitectureId` on history load and refreshed
   * after every chatV2 turn. Null for clarify-at-save tasks and pre-spec
   * legacy threads. Drives the chat panel's invalidation banner mount + the
   * save-input disable in Group 10.
   */
  boundArchitectureId: string | null;
  /**
   * Display name of the bound architecture (Spec #5 Group 6/7/10). Mirrors
   * `boundArchitectureId` lifecycle.
   */
  boundArchitectureName: string | null;
  /** Send a user message, optionally with file attachments and picker fields */
  sendMessage: (text: string, files?: FileAttachment[], pickerFields?: PickerFields) => Promise<void>;
  /** Switch the active persona and reset task to unknown */
  selectPersona: (personaId: string) => void;
  /** Select a task and auto-send a system-style message */
  selectTask: (taskId: string) => void;
  /** Set persona + task simultaneously and send initial message, skipping greeting/menu */
  startTask: (personaId: string, taskId: string) => void;
  /** Generate an artifact for the given task using the thread conversation history */
  generateArtifact: (taskId: string) => Promise<void>;
  /**
   * Confirm and save the current artifact preview.
   *
   * Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
   * - Optional `targetArchitectureId` is the architecture chosen via the
   *   clarify-at-save picker. When provided, it is forwarded to
   *   `postSaveArtifact` so the backend persists the artefact under that
   *   architecture. Bound / derived / project-level tasks pass nothing.
   */
  confirmArtifact: (targetArchitectureId?: string) => Promise<void>;
  /** Reject the current artifact preview and resume discovery */
  rejectArtifact: () => Promise<void>;
  /** Clear roadmap proposal and ask for further refinement */
  discussMore: () => Promise<void>;
  /** Clear roadmap proposal state without sending a message */
  cancelProposal: () => void;
  /** Clear the conversation: delete thread from backend and reset all local state */
  clearThread: () => Promise<void>;
  /**
   * V3 Tier UX (Spec 2026-04-20): Pending Tier C LLM-solo confirmation.
   * Populated when POST /discovery/runs returned 409 LLM_SOLO_CONFIRMATION_REQUIRED.
   * UI renders a confirm dialog sourcing warnings from .warnings; the user clicks
   * confirm (retries with confirmLlmSolo=true) or cancel (clears state silently).
   */
  llmSoloConfirm: {
    warnings: string[];
    projectId: string;
  } | null;
  /** Confirm the pending Tier C LLM-solo run and retry with confirmLlmSolo=true. */
  confirmLlmSoloRun: () => Promise<void>;
  /** Cancel the pending Tier C LLM-solo run without retrying. */
  cancelLlmSoloRun: () => void;
}

// ============================================================================
// @-mention Stripping Regex
// ============================================================================

/**
 * Regex to strip leading @DisplayName from message text.
 * Built from all 6 persona display names in PERSONA_CONFIGS.
 * Matches the exact pattern MentionInput.handleSelectPersona inserts:
 * `@{displayName} ` (with trailing space) at the start of the message.
 */
const mentionRegex = new RegExp(
  '^@(' + PERSONA_CONFIGS.map(p => p.displayName.replace(/\s/g, '\\s')).join('|') + ')\\s',
  'i'
);

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook for managing a conversation thread with the v2 chat API.
 *
 * @param threadKey - Identifies the conversation scope (hub, feature, or panel)
 * @param options - Optional initial persona ID and allowed persona constraints
 * @returns Thread state and action functions
 */
export function useChatThread(
  threadKey: ThreadKey,
  options?: UseChatThreadOptions
): UseChatThreadReturn {
  // ---------------------------------------------------------------------------
  // Local State
  // ---------------------------------------------------------------------------

  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string>(
    options?.initialPersonaId ?? 'assistant'
  );
  const [activeTaskId, setActiveTaskId] = useState<string>('unknown');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.2: New state for artifact flow
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [artifactPreview, setArtifactPreview] = useState<{ taskId: string; content: string } | null>(null);

  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
  // Bound architecture sourced from `Thread.metadata` on load and refreshed
  // after every chatV2 turn (Group 6 may have mutated metadata via the
  // `contextBinding` resolver). Null when the thread is not bound (e.g.
  // clarify-at-save tasks or pre-spec legacy threads).
  const [boundArchitectureId, setBoundArchitectureId] = useState<string | null>(null);
  const [boundArchitectureName, setBoundArchitectureName] = useState<string | null>(null);

  // V3 Tier UX (Spec 2026-04-20): pending Tier C LLM-solo confirmation.
  // Populated when POST /discovery/runs returned 409 LLM_SOLO_CONFIRMATION_REQUIRED.
  // Spec #4 Task Group 6: extended with architectureId so the retry POST
  // targets the same architecture the failed first attempt was bound to.
  const [llmSoloConfirm, setLlmSoloConfirm] = useState<{ warnings: string[]; projectId: string; architectureId: string } | null>(null);

  // Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 6
  // The URL-bound active architecture id. This is the architecture every
  // Discovery-triggered run started from this thread will be bound to.
  // Discovery LLM threads do NOT have a per-run picker; the URL is the
  // source of truth. If the URL has no architecture id, run creation is
  // skipped (the warning lands in the existing console.warn fallback).
  //
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG7
  // The same id is also threaded into the chatV2 request body when the active
  // task's `saveTargetResolution` is `bound-by-system-prompt` or
  // `derived-from-context` (see sendMessage below).
  const activeArchitectureId = useActiveArchitectureId();
  const activeArchitectureIdRef = useRef(activeArchitectureId);
  activeArchitectureIdRef.current = activeArchitectureId;

  // Ref to track the last structuredResponse for task menu label lookup in selectTask
  const lastStructuredResponseRef = useRef<unknown>(null);

  // Ref to hold the latest activePersonaId for use inside callbacks without stale closures
  const activePersonaIdRef = useRef(activePersonaId);
  activePersonaIdRef.current = activePersonaId;

  // Ref to hold the latest activeTaskId for use inside callbacks without stale closures
  const activeTaskIdRef = useRef(activeTaskId);
  activeTaskIdRef.current = activeTaskId;

  // Ref for threadKey to avoid stale closure in sendMessage
  const threadKeyRef = useRef(threadKey);
  threadKeyRef.current = threadKey;

  // Ref for pending queued message when activeTaskId is 'unknown'
  const pendingMessageRef = useRef<string | null>(null);

  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.5: Ref for onArtifactSaved callback
  const onArtifactSavedRef = useRef(options?.onArtifactSaved);
  onArtifactSavedRef.current = options?.onArtifactSaved;

  // Spec 2026-03-01: Hub Bootstrap 2 -- TG6.3: Ref for artifactExists (replaces missionExistsRef)
  const artifactExistsRef = useRef(options?.artifactExists);
  artifactExistsRef.current = options?.artifactExists;

  // Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.5: Ref for allowedPersonaIds
  const allowedPersonaIdsRef = useRef(options?.allowedPersonaIds);
  allowedPersonaIdsRef.current = options?.allowedPersonaIds;

  // Ref to hold current messages for use in sendMessage phase detection
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Ref to hold current artifactPreview for use in sendMessage phase detection
  const artifactPreviewRef = useRef(artifactPreview);
  artifactPreviewRef.current = artifactPreview;

  // ---------------------------------------------------------------------------
  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.3: sealedTaskIds computed value
  // Scans messages for completion-chip structuredResponse types, collects
  // their taskIds into a Set.
  // ---------------------------------------------------------------------------

  const sealedTaskIds = useMemo(() => {
    const sealed = new Set<string>();
    for (const msg of messages) {
      const sr = msg.structuredResponse as { type?: string; taskId?: string } | null;
      if (sr && sr.type === 'completion-chip' && sr.taskId) {
        sealed.add(sr.taskId);
      }
    }
    return sealed;
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Load Thread History on Mount and threadKey Changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const thread = await getThreadHistory(threadKey);

        if (cancelled) return;

        setMessages(thread.messages);

        if (thread.activePersonaId != null) {
          setActivePersonaId(thread.activePersonaId);
        }
        if (thread.activeTaskId != null) {
          setActiveTaskId(thread.activeTaskId);
        }

        // Spec #5 TG10: lift the binding fields off the persisted metadata
        // so the chat panel can immediately mount the invalidation banner
        // (Group 9) for already-bound conversations on first render. The
        // gateway persists these fields on bound-mode first turn (Group 6
        // wires bound-by-system-prompt + derived-from-context resolver).
        const meta = thread.metadata;
        setBoundArchitectureId(
          typeof meta?.boundArchitectureId === 'string' ? meta.boundArchitectureId : null
        );
        setBoundArchitectureName(
          typeof meta?.boundArchitectureName === 'string' ? meta.boundArchitectureName : null
        );
      } catch (err) {
        if (cancelled) return;
        // Silently handle history load failure -- thread starts empty
        console.error('Failed to load thread history:', err);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
    // Re-run when threadKey changes (serialize to string for stable comparison)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadKeyToString(threadKey)]);

  // ---------------------------------------------------------------------------
  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.4: generateArtifact
  // Spec 2026-03-01: Hub Bootstrap 2 -- TG6.4: Generalized with TASK_ARTIFACT_MAP
  // Spec 2026-03-01: Hub Bootstrap 3 -- TG4.3: Added architecture-preview routing
  // Spec 2026-03-01: Hub Bootstrap 4 -- TG5.9: Added tech-stack-preview, test-strategy-preview routing
  // Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.5: Pass allowedPersonaIds
  // Spec 2026-03-14: Detailed Data Model Task -- TG4.6: Added data-model-preview routing
  // ---------------------------------------------------------------------------

  const generateArtifact = useCallback(async (taskId: string) => {
    const mapping = TASK_ARTIFACT_MAP[taskId];
    const artifactName = mapping?.artifactName ?? 'Artifact';

    setIsGenerating(true);
    setError(null);
    try {
      const result = await postGenerateArtifact(
        threadKeyRef.current,
        activePersonaIdRef.current,
        taskId,
        allowedPersonaIdsRef.current
      );

      // Prefer artifactContent (generalized), fall back to missionMarkdown (backward compat)
      const artifactContent = result.artifactContent ?? result.missionMarkdown;

      if (result.success && artifactContent) {
        // Determine preview type from mapping
        const previewType = mapping?.previewType ?? 'artifact-preview';

        // Build structuredResponse based on preview type
        let structuredResponse: unknown;
        if (previewType === 'roadmap-preview') {
          structuredResponse = {
            type: 'roadmap-preview',
            content: artifactContent,
          };
        } else if (previewType === 'architecture-preview') {
          structuredResponse = {
            type: 'architecture-preview',
            content: artifactContent,
          };
        } else if (previewType === 'data-model-preview') {
          structuredResponse = {
            type: 'data-model-preview',
            content: artifactContent,
          };
        } else if (previewType === 'tech-stack-preview') {
          structuredResponse = {
            type: 'tech-stack-preview',
            content: artifactContent,
          };
        } else if (previewType === 'test-strategy-preview') {
          structuredResponse = {
            type: 'test-strategy-preview',
            content: artifactContent,
          };
        } else if (previewType === 'users-interactions-preview') {
          structuredResponse = {
            type: 'users-interactions-preview',
            content: artifactContent,
          };
        } else if (previewType === 'user-journeys-preview') {
          structuredResponse = {
            type: 'user-journeys-preview',
            content: artifactContent,
          };
        } else if (previewType === 'backlog-preview') {
          structuredResponse = {
            type: 'backlog-preview',
            content: artifactContent,
          };
        } else {
          // For artifact-preview, try to extract markdownBrief from JSON content
          // (e.g., discovery-framing returns { structuredData, markdownBrief })
          let displayContent = artifactContent;
          try {
            const parsed = JSON.parse(artifactContent);
            if (typeof parsed.markdownBrief === 'string') {
              displayContent = parsed.markdownBrief;
            }
          } catch { /* not JSON, use as-is */ }

          structuredResponse = {
            type: 'artifact-preview',
            markdownContent: displayContent,
            ...(mapping?.headerLabel ? { headerLabel: mapping.headerLabel } : {}),
            ...(mapping?.confirmLabel ? { confirmLabel: mapping.confirmLabel } : {}),
          };
        }

        // Insert artifact preview message
        const previewMessage: ThreadMessage = {
          id: generateMessageId(),
          role: 'assistant',
          personaId: activePersonaIdRef.current,
          taskId: taskId,
          content: '',
          structuredResponse,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, previewMessage]);
        setArtifactPreview({ taskId, content: artifactContent });
      } else {
        // Insert error message
        const errorMsg: ThreadMessage = {
          id: generateMessageId(),
          role: 'system',
          personaId: null,
          taskId: null,
          content: `${artifactName} generation failed: ${result.error || 'Unknown error'}. You can try again.`,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Generation failed';
      const errorMsg: ThreadMessage = {
        id: generateMessageId(),
        role: 'system',
        personaId: null,
        taskId: null,
        content: `${artifactName} generation failed: ${errorMessage}. You can try again.`,
        structuredResponse: null,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.5: confirmArtifact
  // Spec 2026-03-01: Hub Bootstrap 2 -- TG6.5: Generalized with TASK_ARTIFACT_MAP
  // Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.5: Pass allowedPersonaIds
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10:
  //   Optional `targetArchitectureId` argument lets the clarify-at-save picker
  //   thread its chosen architecture through to `postSaveArtifact`.
  // ---------------------------------------------------------------------------

  const confirmArtifact = useCallback(async (targetArchitectureId?: string) => {
    if (!artifactPreview) return;

    const mapping = TASK_ARTIFACT_MAP[artifactPreview.taskId];
    const artifactId = mapping?.artifactId ?? 'unknown';
    const artifactName = mapping?.artifactName ?? 'Artifact';
    const completionMessage = mapping?.completionMessage ?? 'Artifact saved.';

    setIsSaving(true);
    setError(null);
    try {
      const result = await postSaveArtifact(
        threadKeyRef.current,
        artifactPreview.taskId,
        artifactId,
        artifactPreview.content,
        allowedPersonaIdsRef.current,
        targetArchitectureId
      );
      if (result.success) {
        // Insert completion chip (optimistic -- backend also persists it)
        const chipMessage: ThreadMessage = {
          id: generateMessageId(),
          role: 'assistant',
          personaId: activePersonaIdRef.current,
          taskId: artifactPreview.taskId,
          content: completionMessage,
          structuredResponse: {
            type: 'completion-chip',
            artifactId: artifactId,
            artifactName: artifactName,
            taskId: artifactPreview.taskId,
            personaId: activePersonaIdRef.current,
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, chipMessage]);
        setArtifactPreview(null);

        // After discovery framing save, automatically start the discovery run.
        // V3 Tier UX: a 409 LLM_SOLO_CONFIRMATION_REQUIRED surfaces a confirm dialog
        // via the llmSoloConfirm state; the user's response triggers a retry or abort.
        if (artifactId === 'discovery-framing' && threadKeyRef.current.projectId) {
          // Spec #4 Task Group 6: bind the new run to the URL-active
          // architecture. Without an active architecture id we cannot
          // form the architecture-scoped URL, so the run-start is
          // skipped with a console warning (the artifact save itself
          // already succeeded).
          const archId = activeArchitectureIdRef.current;
          if (!archId) {
            console.warn('Discovery run creation skipped: no active architecture id in URL.');
          } else {
            try {
              await createDiscoveryRun(threadKeyRef.current.projectId, archId);
            } catch (runErr) {
              if (runErr instanceof LlmSoloConfirmationRequiredError) {
                setLlmSoloConfirm({
                  warnings: runErr.warnings,
                  projectId: threadKeyRef.current.projectId,
                  architectureId: archId,
                });
              } else {
                console.warn('Discovery run creation failed (non-blocking):', runErr);
              }
            }
          }
        }

        // Trigger dashboard re-fetch with artifact context
        const artifactInfo: { artifactType?: string; epicId?: string } = { artifactType: artifactId };
        if (artifactId === 'backlog' && artifactPreview.content) {
          try {
            const parsed = JSON.parse(artifactPreview.content);
            if (parsed.epicId) artifactInfo.epicId = parsed.epicId;
          } catch { /* ignore parse errors */ }
        }
        onArtifactSavedRef.current?.(artifactInfo);
      } else {
        const errorMsg: ThreadMessage = {
          id: generateMessageId(),
          role: 'system',
          personaId: null,
          taskId: null,
          content: `Failed to save ${artifactName}: ${result.error || 'Unknown error'}. Click Confirm to retry.`,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Save failed';
      const isTimeout = errorMessage.toLowerCase().includes('timeout');
      const errorMsg: ThreadMessage = {
        id: generateMessageId(),
        role: 'system',
        personaId: null,
        taskId: null,
        content: isTimeout
          ? 'Save timed out. Please try again.'
          : `Failed to save ${artifactName}: ${errorMessage}. Click Confirm to retry.`,
        structuredResponse: null,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsSaving(false);
    }
  }, [artifactPreview]);

  // ---------------------------------------------------------------------------
  // sendMessage
  // Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- TG2.5: Pass allowedPersonaIds
  // Spec 2026-03-04: What's Next v1-C -- Work Item Picker -- TG8.3: Added pickerFields parameter
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG7:
  //   When the active task is `bound-by-system-prompt` or `derived-from-context`
  //   (per the frontend `taskConfig` mirror of the backend declaration),
  //   include the URL-active architectureId on the wire so the gateway can
  //   inject the `Architecture: <name>` line into the system prompt or
  //   thread it into the derived-binding resolver. Omitted for
  //   `clarify-at-save` (the picker handles save-time selection) and
  //   project-level tasks (no architecture binding).
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10:
  //   On every chatV2 response, surface any `bindingError` payload as an
  //   inline system message in the message stream so the user understands
  //   why the gateway's `derived-from-context` resolver refused the LLM's
  //   `contextBinding` block. Independent of the invalidation banner.
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, files?: FileAttachment[], pickerFields?: PickerFields) => {
      // Clear any previous error
      setError(null);

      // Strip @-mention prefix if present at start of message
      const strippedText = text.replace(mentionRegex, '');

      // -------------------------------------------------------------------
      // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.7: Phase detection
      // Check if the latest assistant message has phase='ready'. If so,
      // this user message is a confirmation, and we auto-trigger generation
      // instead of the normal sendMessage flow.
      // -------------------------------------------------------------------
      const currentMessages = messagesRef.current;
      const latestAssistant = [...currentMessages].reverse().find(m => m.role === 'assistant');
      const latestSr = latestAssistant?.structuredResponse as { phase?: string } | null;
      // Skip artifact generation for ER diagram task -- its "ready" phase is a confirmation
      // step, not an artifact trigger. The user's confirmation goes through the normal chat
      // flow where the gateway switches to free-text mode for diagram generation.
      const isERDiagramTask = activeTaskIdRef.current === 'architect--generate-architecture-diagram';
      if (latestSr && latestSr.phase === 'ready' && !artifactPreviewRef.current && !isERDiagramTask) {
        // User is confirming readiness -- append user message optimistically, then generate
        const userMessage: ThreadMessage = {
          id: generateMessageId(),
          role: 'user',
          personaId: null,
          taskId: null,
          content: strippedText,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);
        // Trigger generation using the current taskId
        await generateArtifact(activeTaskIdRef.current);
        return; // Skip the normal sendMessage flow
      }

      // Build optimistic user message
      const userMessage: ThreadMessage = {
        id: generateMessageId(),
        role: 'user',
        personaId: null,
        taskId: null,
        content: strippedText,
        structuredResponse: null,
        timestamp: new Date().toISOString(),
      };

      // Append optimistic user message immediately (skip for empty auto-send triggers)
      if (strippedText) {
        setMessages((prev) => [...prev, userMessage]);
      }

      // Determine the message to send to the API based on queuing state
      const isQueuing = activeTaskIdRef.current === 'unknown';
      const apiMessage = isQueuing ? '' : strippedText;

      // If queuing, store the stripped text for later auto-send
      if (isQueuing) {
        pendingMessageRef.current = strippedText;
      }

      // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) TG7
      // Decide whether to thread the URL-active architectureId into the request
      // body. Tasks declared `bound-by-system-prompt` or `derived-from-context`
      // need it; `clarify-at-save` and project-level tasks (no declaration) do
      // not. We also require a non-empty active architecture id (otherwise the
      // gateway has nothing to look up; safer to omit the field than to send an
      // empty string and force the gateway to handle it as a special case).
      const currentTaskId = activeTaskIdRef.current;
      const currentArchitectureId = activeArchitectureIdRef.current;
      const includeArchitectureId =
        currentTaskId !== 'unknown' &&
        shouldSendArchitectureIdForTask(currentTaskId) &&
        typeof currentArchitectureId === 'string' &&
        currentArchitectureId.length > 0;

      // Build ChatV2Request
      const request = {
        threadKey: threadKeyRef.current as {
          type: 'hub' | 'feature' | 'panel';
          projectId: string;
          featureId?: string;
          screen?: string;
          entityId?: string;
        },
        personaId: activePersonaIdRef.current,
        taskId: currentTaskId,
        message: apiMessage,
        ...(files && files.length > 0 ? { files } : {}),
        ...(allowedPersonaIdsRef.current ? { allowedPersonaIds: allowedPersonaIdsRef.current } : {}),
        ...(pickerFields ? { pickerAction: pickerFields.pickerAction, pickerPayload: pickerFields.pickerPayload } : {}),
        ...(includeArchitectureId ? { architectureId: currentArchitectureId as string } : {}),
      };

      setIsLoading(true);

      try {
        const response: ChatV2Response = await postChatV2(request);

        // Build assistant message from response
        const assistantMessage: ThreadMessage = {
          id: generateMessageId(),
          role: 'assistant',
          personaId: response.personaId,
          taskId: response.taskId,
          content: response.assistant.message,
          structuredResponse: response.structuredResponse,
          timestamp: new Date().toISOString(),
        };

        // Append assistant message
        setMessages((prev) => [...prev, assistantMessage]);

        // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) TG10
        // Surface any `bindingError` from the gateway as an inline system
        // message in the message stream. This is independent of the
        // invalidation banner -- both can be visible at once. Code-specific
        // guidance overrides the gateway's raw message so the user gets
        // actionable copy.
        if (response.bindingError) {
          const bindingErrorMsg: ThreadMessage = {
            id: generateMessageId(),
            role: 'system',
            personaId: null,
            taskId: null,
            content: buildBindingErrorMessage(response.bindingError),
            structuredResponse: {
              type: 'binding-error',
              code: response.bindingError.code,
              status: response.bindingError.status,
            },
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, bindingErrorMsg]);
        }

        // Store the latest structuredResponse for selectTask label lookup
        lastStructuredResponseRef.current = response.structuredResponse;

        // Auto-set artifactPreview when roadmap proposal is detected (phase="ready" with proposedInitiatives)
        const srProposal = response.structuredResponse as Record<string, unknown> | null;
        if (srProposal?.phase === 'ready' && Array.isArray(srProposal?.proposedInitiatives) && (srProposal.proposedInitiatives as unknown[]).length > 0) {
          const artifactContent = JSON.stringify({ initiatives: srProposal.proposedInitiatives });
          setArtifactPreview({ taskId: activeTaskIdRef.current, content: artifactContent });
        }

        // Auto-set artifactPreview when backlog proposal is detected (phase="ready" with proposedFeatures + selectedEpic)
        if (srProposal?.phase === 'ready' && Array.isArray(srProposal?.proposedFeatures) && (srProposal.proposedFeatures as unknown[]).length > 0 && srProposal?.selectedEpic) {
          const selectedEpic = srProposal.selectedEpic as { id: string; title: string };
          const artifactContent = JSON.stringify({
            epicId: selectedEpic.id,
            epicTitle: selectedEpic.title,
            features: srProposal.proposedFeatures,
            epicPriorityUpdates: srProposal.epicPriorityUpdates || [],
          });
          setArtifactPreview({ taskId: activeTaskIdRef.current, content: artifactContent });
        }

        // If response is a task-menu, keep activeTaskId as 'unknown'
        const sr = response.structuredResponse as
          | { type?: string }
          | null
          | undefined;
        if (sr && sr.type === 'task-menu') {
          setActiveTaskId('unknown');
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'An unknown error occurred';
        setError(errorMessage);

        // Append error-indicator message
        const errorIndicator: ThreadMessage = {
          id: generateMessageId(),
          role: 'system',
          personaId: null,
          taskId: null,
          content: `Error: ${errorMessage}`,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorIndicator]);
      } finally {
        setIsLoading(false);
      }
    },
    [generateArtifact]
  );

  // ---------------------------------------------------------------------------
  // Spec 2026-02-28: Hub Bootstrap 1 -- TG7.6: rejectArtifact
  // ---------------------------------------------------------------------------

  const rejectArtifact = useCallback(async () => {
    setArtifactPreview(null);
    // Send a follow-up message to resume discovery
    await sendMessage("I'd like to make changes.");
  }, [sendMessage]);

  // ---------------------------------------------------------------------------
  // discussMore — clear proposal and ask for further refinement
  // ---------------------------------------------------------------------------

  const discussMore = useCallback(async () => {
    setArtifactPreview(null);
    const taskId = activeTaskIdRef.current;
    const message = taskId === 'product-manager--backlog'
      ? "I'd like to discuss the backlog for this epic more."
      : "I'd like to refine the roadmap further.";
    await sendMessage(message);
  }, [sendMessage]);

  // ---------------------------------------------------------------------------
  // cancelProposal — clear proposal state without sending a message
  // ---------------------------------------------------------------------------

  const cancelProposal = useCallback(() => {
    setArtifactPreview(null);
  }, []);

  // ---------------------------------------------------------------------------
  // selectPersona
  // Spec 2026-03-03: UnifiedChatPanel UX Polish -- FR2: Auto-send after switch
  // ---------------------------------------------------------------------------

  const selectPersona = useCallback((personaId: string) => {
    // Insert handoff system message if persona is actually changing
    if (personaId !== activePersonaIdRef.current) {
      const displayName = getPersonaConfig(personaId).displayName;
      const systemMessage: ThreadMessage = {
        id: generateMessageId(),
        role: 'system',
        personaId: null,
        taskId: null,
        content: `Switched to ${displayName}`,
        structuredResponse: null,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, systemMessage]);

      // Fire-and-forget: persist handoff to backend
      postHandoff(threadKeyRef.current, personaId).catch(err =>
        console.error('Failed to persist handoff:', err)
      );
    }

    setActivePersonaId(personaId);
    setActiveTaskId('unknown');

    // Update refs synchronously so sendMessage (called below) reads the new
    // personaId and taskId instead of the stale values from the previous render.
    // This mirrors the pattern used in selectTask for activeTaskIdRef.
    activePersonaIdRef.current = personaId;
    activeTaskIdRef.current = 'unknown';

    // Spec 2026-03-03: UX Polish FR2 -- Auto-send empty message to trigger
    // greeting + task menu. Because activeTaskIdRef.current is set to 'unknown'
    // synchronously above, sendMessage('') enters the queuing path and hits
    // the backend with taskId='unknown', triggering the task-menu response.
    sendMessage('');
  }, [sendMessage]);

  // ---------------------------------------------------------------------------
  // selectTask
  // Spec 2026-03-01: Hub Bootstrap 2 -- TG6.6: Generalized warning logic
  // Spec 2026-03-03: UnifiedChatPanel UX Polish -- FR4: Send label directly
  // ---------------------------------------------------------------------------

  const selectTask = useCallback(
    (taskId: string) => {
      setActiveTaskId(taskId);
      // Update ref synchronously so sendMessage (called below) reads the new
      // taskId instead of the stale 'unknown' value from the previous render.
      activeTaskIdRef.current = taskId;

      // Spec 2026-03-01: Hub Bootstrap 2 -- TG6.6: Generalized artifact-exists warning
      const mapping = TASK_ARTIFACT_MAP[taskId];
      if (mapping && artifactExistsRef.current?.[mapping.artifactKey]) {
        const warningMsg: ThreadMessage = {
          id: generateMessageId(),
          role: 'system',
          personaId: null,
          taskId: null,
          content: mapping.warningText,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, warningMsg]);
      }

      // Check for a queued pending message (truthy: excludes null and empty string)
      const queuedText = pendingMessageRef.current;
      pendingMessageRef.current = null;
      if (queuedText) {
        sendMessage(queuedText);
      } else {
        // Try to find the menuLabel from the last structuredResponse task-menu data
        let label = taskId;
        const sr = lastStructuredResponseRef.current as
          | { type?: string; tasks?: Array<{ taskId: string; menuLabel: string }> }
          | null
          | undefined;

        if (sr && sr.type === 'task-menu' && Array.isArray(sr.tasks)) {
          const found = sr.tasks.find(
            (t: { taskId: string; menuLabel: string }) => t.taskId === taskId
          );
          if (found) {
            label = found.menuLabel;
          }
        }

        // Spec 2026-03-03: UX Polish FR4 -- Send menuLabel directly
        sendMessage(label);
      }
    },
    [sendMessage]
  );

  // ---------------------------------------------------------------------------
  // startTask — set persona + task simultaneously and send an initial message
  // without triggering the greeting/task-menu flow.
  // Used by pendingAction (What's Next navigation) where both persona and task
  // are already known.
  // ---------------------------------------------------------------------------

  const startTask = useCallback(
    (personaId: string, taskId: string) => {
      setActivePersonaId(personaId);
      setActiveTaskId(taskId);
      activePersonaIdRef.current = personaId;
      activeTaskIdRef.current = taskId;

      // Send an initial message that tells the LLM to begin the task
      sendMessage('');
    },
    [sendMessage]
  );

  // ---------------------------------------------------------------------------
  // clearThread — delete backend thread and reset all local state
  // ---------------------------------------------------------------------------

  const clearThread = useCallback(async () => {
    try {
      await deleteThread(threadKeyRef.current);
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
    setMessages([]);
    setActivePersonaId(options?.initialPersonaId ?? 'assistant');
    setActiveTaskId('unknown');
    setIsLoading(false);
    setError(null);
    setIsGenerating(false);
    setIsSaving(false);
    setArtifactPreview(null);
    // Spec #5 TG10: clear bound architecture state too -- the conversation
    // is being abandoned so the binding no longer applies (a fresh thread
    // with the same key will start unbound and re-bind on first turn).
    setBoundArchitectureId(null);
    setBoundArchitectureName(null);
    pendingMessageRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // V3 Tier UX (Spec 2026-04-20): LLM-solo confirm/cancel callbacks
  // ---------------------------------------------------------------------------

  const confirmLlmSoloRun = useCallback(async () => {
    const pending = llmSoloConfirm;
    if (!pending) return;
    setLlmSoloConfirm(null);
    try {
      // Spec #4 Task Group 6: the retry uses the same architectureId
      // that the failed first attempt was bound to (captured into the
      // pending state when the 409 was received).
      await createDiscoveryRun(pending.projectId, pending.architectureId, { confirmLlmSolo: true });
    } catch (retryErr) {
      console.warn('Discovery run retry failed (non-blocking):', retryErr);
    }
  }, [llmSoloConfirm]);

  const cancelLlmSoloRun = useCallback(() => {
    setLlmSoloConfirm(null);
  }, []);

  return {
    messages,
    activePersonaId,
    activeTaskId,
    isLoading,
    error,
    isGenerating,
    isSaving,
    artifactPreview,
    sealedTaskIds,
    boundArchitectureId,
    boundArchitectureName,
    sendMessage,
    selectPersona,
    selectTask,
    startTask,
    generateArtifact,
    confirmArtifact,
    rejectArtifact,
    discussMore,
    cancelProposal,
    clearThread,
    llmSoloConfirm,
    confirmLlmSoloRun,
    cancelLlmSoloRun,
  };
}
