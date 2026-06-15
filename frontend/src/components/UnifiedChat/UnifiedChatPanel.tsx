/**
 * UnifiedChatPanel Container Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 7, Task 7.2: Create UnifiedChatPanel container
 *
 * Spec 2026-02-28: Hub Chat MVP v1 -- Removed openPanel wiring; card buttons navigate only (UnifiedChatPanel unmounts on navigation); side-panel wiring deferred to Increments 8-9
 * Task Group 7, Task 7.11: Wire new hook values to ChatThread
 * - onArtifactSaved and missionExists props passed to useChatThread options
 * - Destructures isGenerating, isSaving, artifactPreview, sealedTaskIds,
 *   confirmArtifact, rejectArtifact from useChatThread
 * - handleDownloadTranscript callback using buildTranscriptMarkdown + downloadMarkdownFile
 * - All new props wired through to ChatThread
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 7, Tasks 7.2 + 7.3: Generalize props and handleDownloadTranscript
 * - Replaced missionExists?: boolean with artifactExists?: Record<string, boolean>
 * - Pass artifactExists through to useChatThread options
 * - handleDownloadTranscript determines taskId and artifactDescription from the
 *   last completion chip message instead of hardcoding mission values
 * - Import TASK_ARTIFACT_MAP from useChatThread for artifact description lookup
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 5, Task 5.3: Extend handleDownloadTranscript for architecture task
 * - Added architect--define-architecture branch for artifactDescription and filename
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 6, Task 6.3: Extend handleDownloadTranscript for tech stack and test strategy
 * - Added architect--define-tech-stack branch for artifactDescription and filename
 * - Added test-engineer--test-strategy branch for artifactDescription and filename
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities
 * Task Group 3: Panel State Persistence and Default-Open Behavior
 * - Added defaultOpen prop to control initial collapse state
 * - Per-threadKey collapse state persistence via localStorage
 * - Per-threadKey width persistence via localStorage (replaces shared key)
 * - Import threadKeyToString for building per-threadKey storage keys
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 2: Room Header Redesign (FR1)
 * - Added getRoomName helper to derive room name from threadKey
 * - Imported PERSONA_CONFIGS and added useMemo for availablePersonas computation
 * - Replaced simple header with multi-section layout: Chat - Room - In - Available - collapse
 * - Available persona icons are clickable and call selectPersona
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 9: UnifiedChatPanel Integration
 * - Added usePendingAction and useArchitectureDispatch imports
 * - Added handleWhatsNextAction callback for action card clicks
 * - Added pending action consumption useEffect for cross-screen handoff
 * - Passes onActionClick={handleWhatsNextAction} to ChatThread
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 4: UnifiedChatPanel Handler Branch
 * - Imported useModalActions from ModalActionContext
 * - Added modal branch to handleWhatsNextAction: if action.launch === 'modal',
 *   calls openGenerateStandardsModal() and returns early (no navigation)
 * - Updated action parameter type to NextAction discriminated union
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 8: UnifiedChatPanel Integration
 * - Task 8.1: Added selectedScope prop for work item search ranking
 * - Task 8.2: Added implementPicker branch to handleWhatsNextAction
 * - Task 8.4: Added handleWorkItemSelect and handlePickerCancel callbacks
 * Task Group 9: Picker mode + selectedScope wiring
 * - Task 9.2: Added pickerMode state, handleSend wrapper for search interception,
 *   threaded selectedScope into picker search calls
 *
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 3
 * - Added layout prop ('overlay' | 'inline') to UnifiedChatPanelProps
 * - When layout === 'inline': uses .panelInline / .collapsedTabInline CSS classes
 *   (position: relative, no z-index, no box-shadow, no fixed positioning)
 * - When layout is absent or 'overlay': uses existing .panel / .collapsedTab classes
 * - In inline mode, width style is not applied (controlled by flex parent)
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 5, Task 5.6: Wire onViewTemporaryDiagram handler
 * - Imported useActivateTemporaryDiagram from TemporaryDiagramContext
 * - Imported useProject from ProjectContext
 * - Added handleViewTemporaryDiagram callback that dispatches SET_VIEW with 'diagrams'
 *   and activates temporary diagram mode via useActivateTemporaryDiagram
 * - Passes onViewTemporaryDiagram={handleViewTemporaryDiagram} to ChatThread
 *
 * Spec 2026-05-01: Multi-Architecture Save-Target Resolution (Spec #5)
 * Task Group 10: Chat panel wiring (banner + picker + save-input disable +
 *                bindingError surface)
 * - Mounts `ConversationArchitectureInvalidationBanner` (Group 9) for tasks
 *   whose `saveTargetResolution` is `bound-by-system-prompt` or
 *   `derived-from-context`. The banner reads
 *   `Thread.metadata.boundArchitectureId` (lifted into hook state by Group 7
 *   `useChatThread`) and self-suppresses when the active arch matches.
 * - Disables `ChatInputBar` while the banner is active so the user cannot
 *   send new messages until they swap back or abandon the conversation.
 * - Mounts `SaveTargetArchitecturePickerModal` (Group 8) for `clarify-at-save`
 *   tasks at save time: a wrapper around `confirmArtifact` opens the picker
 *   instead of saving directly, then on confirm threads the chosen
 *   architectureId through to `confirmArtifact(targetArchitectureId)` and
 *   then to `postSaveArtifact`.
 * - The chatV2 response's `bindingError` surface is owned by `useChatThread`
 *   (it appends an inline system message); the panel needs no explicit
 *   wiring beyond the existing message-stream rendering.
 *
 * Thin container that:
 * - Calls useChatThread for all state and actions
 * - Manages panel width state with per-threadKey localStorage persistence
 *   (key: "unified-chat-width:{serializedThreadKey}"; default 380px; min 280px; max 50vw)
 * - Manages collapsed/expanded boolean state with per-threadKey localStorage persistence
 *   (key: "unified-chat-collapsed:{serializedThreadKey}")
 * - Collapsed state: slim vertical tab (32px) with MessageSquare icon + vertical "Chat" label
 * - Expanded state: header, ChatThread, ChatInputBar, left-edge drag resize handle
 * - Wires onSelectTask, onSubmitAnswers, and onPersonaSelected through subcomponents
 *
 * Resize pattern follows ChatPanel.tsx mousedown/mousemove/mouseup,
 * but drag handle is on the LEFT edge (right-anchored panel):
 *   newWidth = window.innerWidth - e.clientX
 *
 * Panel CSS follows PersonaHelperPanel.module.css positioning.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { MessageSquare, PanelRightClose, Trash2 } from 'lucide-react';
import { useChatThread, TASK_ARTIFACT_MAP } from '../../hooks/useChatThread';
import { LlmSoloConfirmDialog } from '../DashboardView/LlmSoloConfirmDialog';
import { getPersonaConfig, PERSONA_CONFIGS } from '../../config/personaConfig';
import { ChatThread } from './ChatThread';
import { ChatInputBar } from './ChatInputBar';
import { buildTranscriptMarkdown, downloadMarkdownFile } from '../../utils/transcriptExport';
import { threadKeyToString } from '../../api/chatV2Api';
import { usePendingAction } from '../../contexts/PendingActionContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
// Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
// useNavigate replaces SET_VIEW dispatch + history.pushState navigation.
// useCurrentView reports the current view (was state.currentView) for the
// 'previousView' token passed into journey review activation.
import { useNavigate } from 'react-router-dom';
import { useCurrentView } from '../../hooks/useCurrentView';
import { useModalActions } from '../../contexts/ModalActionContext';
import { useActivateTemporaryDiagram } from '../../contexts/TemporaryDiagramContext';
import { useActivateJourneyReview } from '../../contexts/UserJourneyReviewContext';
import { fetchTemporaryUserJourneyDiagrams } from '../../api/userJourneyDiagramApi';
import { fetchTemporaryUserJourneyOverviewDiagram } from '../../api/userJourneyOverviewDiagramApi';
import { useProject } from '../../contexts/ProjectContext';
import { NextAction } from './WhatsNextActionList';
import type { ThreadKey, FileAttachment } from '../../api/chatV2Api';
// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
// Group 9's banner and Group 8's picker live under the lowercase chat/common
// directory roots (the Windows filesystem is case-insensitive but tsc is
// case-sensitive — match the on-disk casing used by the existing test files).
import { ConversationArchitectureInvalidationBanner } from '../chat/ConversationArchitectureInvalidationBanner';
import { SaveTargetArchitecturePickerModal } from '../common/SaveTargetArchitecturePickerModal';
import { getTaskSaveTargetResolution } from '../../config/taskConfig';
import styles from './UnifiedChatPanel.module.css';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const INLINE_DEFAULT_WIDTH_PERCENT = 0.3;

/**
 * Maps task IDs to navigation targets for cross-screen handoff.
 * When a user clicks one of these tasks in the hub task menu,
 * instead of starting the task in the hub thread, we navigate
 * to the appropriate Product & Delivery tab and start the
 * conversation in the RHS panel.
 */
const TASK_NAVIGATION_TARGETS: Record<string, { screen: string; tab: string }> = {
  'product-manager--define-product': { screen: 'product', tab: 'product' },
  'product-manager--roadmap': { screen: 'product', tab: 'roadmap' },
  'product-manager--backlog': { screen: 'product', tab: 'backlog' },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read persisted width from localStorage, falling back to default.
 * @param storageKey - The per-threadKey localStorage key for width
 */
function getInitialWidth(storageKey: string): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // Ignore localStorage errors (e.g., SSR, private browsing)
  }
  return DEFAULT_WIDTH;
}

/**
 * Derives the room name from the threadKey discriminated union.
 * - hub => "Project Room"
 * - panel with screen product/roadmap/backlog => "Product Strategy Room"
 * - panel with screen metamodel/architecture => "Architecture Room"
 * - all others => "Room"
 */
function getRoomName(threadKey: ThreadKey): string {
  switch (threadKey.type) {
    case 'hub':
      return 'Project Room';
    case 'panel': {
      const screen = (threadKey as { screen?: string }).screen;
      if (screen === 'product' || screen === 'roadmap' || screen === 'backlog') {
        return 'Product Strategy Room';
      }
      if (screen === 'metamodel' || screen === 'architecture') {
        return 'Architecture Room';
      }
      return 'Room';
    }
    default:
      return 'Room';
  }
}

// ============================================================================
// Props Interface
// ============================================================================

export interface UnifiedChatPanelProps {
  /** Thread key identifying the conversation scope */
  threadKey: ThreadKey;
  /** Initial persona ID (default: 'assistant') */
  initialPersonaId?: string;
  /** Restrict which personas can be @-mentioned */
  allowedPersonaIds?: string[];
  /** Callback triggered after an artifact is successfully saved (e.g., dashboard re-fetch) */
  onArtifactSaved?: (info?: { artifactType?: string; epicId?: string }) => void;
  /** Record of artifact existence flags keyed by artifact key (e.g., { mission: true, roadmap: false }) */
  artifactExists?: Record<string, boolean>;
  /** When true, panel starts expanded if no persisted collapse state exists */
  defaultOpen?: boolean;
  /** Current dashboard scope for work item search ranking */
  selectedScope?: { type: string; value?: string };
  /**
   * Layout mode for the panel.
   * - 'overlay' (default): fixed-position right-anchored panel overlaying content
   * - 'inline': relative-position panel flowing in a flex parent (e.g., Dashboard side-by-side layout)
   */
  layout?: 'overlay' | 'inline';
}

// ============================================================================
// Component
// ============================================================================

export function UnifiedChatPanel({
  threadKey,
  initialPersonaId,
  allowedPersonaIds,
  onArtifactSaved,
  artifactExists,
  defaultOpen,
  selectedScope,
  layout = 'overlay',
}: UnifiedChatPanelProps) {
  // ---------------------------------------------------------------------------
  // Spec 2026-04-03: User Journey Review - hooks and wrapped onArtifactSaved
  // ---------------------------------------------------------------------------

  const activateJourneyReview = useActivateJourneyReview();
  const activeProject = useProject();
  // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4
  const activeArchitectureId = useActiveArchitectureId();
  // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
  // navigate replaces SET_VIEW dispatch; currentView replaces
  // architectureState.currentView for the 'previousView' token threaded
  // into journey review activation.
  const navigate = useNavigate();
  const currentView = useCurrentView();

  // Wrap onArtifactSaved to also trigger journey review for UX Designer task
  const wrappedOnArtifactSaved = useCallback(
    async (info?: { artifactType?: string; epicId?: string }) => {
      // Call original callback first
      onArtifactSaved?.(info);

      // Trigger journey review for ux-designer--users-interactions task
      // Spec 2026-05-01 Multi-Architecture Plumbing -- Task Group 4: require architectureId
      if (info?.artifactType === 'user-journeys' && activeProject?.id && activeArchitectureId) {
        try {
          const diagrams = await fetchTemporaryUserJourneyDiagrams(activeProject.id, activeArchitectureId);
          if (diagrams.length === 0) {
            // Zero journeys: no-op (empty state message handled by completion chip)
            return;
          }

          // Fetch overview diagrams for all unique business user roles
          const businessUserIds = [...new Set(
            diagrams.map(d => d.journey.user_role_id).filter(Boolean)
          )];
          const overviewDiagrams = [];
          for (const userId of businessUserIds) {
            try {
              const dto = await fetchTemporaryUserJourneyOverviewDiagram(activeProject.id, activeArchitectureId, userId);
              if (dto && dto.nodes && dto.nodes.length > 0) {
                overviewDiagrams.push(dto);
              } else {
                console.warn(`[UnifiedChatPanel] Overview for user ${userId} returned empty or no nodes`);
              }
            } catch (overviewErr) {
              console.warn(`[UnifiedChatPanel] Failed to fetch overview for user ${userId}:`, overviewErr);
            }
          }
          console.log(`[UnifiedChatPanel] Fetched ${overviewDiagrams.length} overview diagrams for ${businessUserIds.length} business users`);

          // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
          // prevView is the URL-derived current view; navigate (instead of
          // dispatching SET_VIEW) to the canonical diagrams URL on the
          // active architecture.
          const prevView = currentView;
          if (diagrams.length === 1 && overviewDiagrams.length === 0) {
            activateJourneyReview(activeProject.id, 'ux-designer--users-interactions', diagrams, prevView, 0);
          } else {
            activateJourneyReview(activeProject.id, 'ux-designer--users-interactions', diagrams, prevView, null, overviewDiagrams);
          }
          if (activeArchitectureId) {
            navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/diagrams`);
          }
        } catch (err) {
          console.warn('[UnifiedChatPanel] Failed to fetch journey diagrams:', err);
        }
      }
    },
    [onArtifactSaved, activeProject, activeArchitectureId, currentView, activateJourneyReview, navigate]
  );
  // ---------------------------------------------------------------------------
  // Chat Thread Hook (all state and actions)
  // ---------------------------------------------------------------------------

  const {
    messages,
    activePersonaId,
    activeTaskId,
    isLoading,
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
    confirmArtifact,
    rejectArtifact,
    discussMore,
    cancelProposal,
    clearThread,
    llmSoloConfirm,
    confirmLlmSoloRun,
    cancelLlmSoloRun,
  } = useChatThread(threadKey, { initialPersonaId, allowedPersonaIds, onArtifactSaved: wrappedOnArtifactSaved, artifactExists });

  // ---------------------------------------------------------------------------
  // Pending Action Context & Architecture Dispatch
  // Spec 2026-03-04: Assistant "What's Next" v1
  // ---------------------------------------------------------------------------

  const { pendingAction, setPendingAction, clearPendingAction } = usePendingAction();

  // ---------------------------------------------------------------------------
  // Modal Action Context
  // Spec 2026-03-04: What's Next v1-B -- Modal Launch (TG4.1)
  // ---------------------------------------------------------------------------

  const { openGenerateStandardsModal } = useModalActions();

  // ---------------------------------------------------------------------------
  // Temporary Diagram Activation and Project Context
  // Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.6
  // ---------------------------------------------------------------------------

  const activateTemporaryDiagram = useActivateTemporaryDiagram();

  // ---------------------------------------------------------------------------
  // Picker Mode State
  // Spec 2026-03-04: What's Next v1-C -- Work Item Picker (TG9.2)
  // ---------------------------------------------------------------------------

  const [pickerMode, setPickerMode] = useState(false);

  // ---------------------------------------------------------------------------
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
  // Save-target architecture picker modal state for `clarify-at-save` tasks.
  // When the user clicks Confirm on an artifact preview for a clarify-at-save
  // task, we open the picker instead of saving directly. Once the picker
  // resolves with a chosen architecture id, the wrapped confirm proceeds with
  // that id threaded through to postSaveArtifact (via useChatThread.confirmArtifact).
  // ---------------------------------------------------------------------------

  const [savePickerOpen, setSavePickerOpen] = useState(false);

  // Memoise the active task's mode so the panel can branch on it for both
  // banner mount and confirmArtifact wrapping. undefined means project-level
  // (no architecture binding) -- the panel treats it the same as bound for
  // banner purposes (banner only mounts when bound id is present anyway) and
  // the same as no-op for picker purposes.
  const activeSaveTargetMode = useMemo(
    () => getTaskSaveTargetResolution(activeTaskId),
    [activeTaskId]
  );

  // The invalidation banner only mounts for bound/derived tasks where the
  // thread metadata carries a bound architecture id. The banner itself
  // self-suppresses when the active arch matches the bound arch (no
  // divergence) so the panel does not need that comparison. For pre-spec
  // legacy threads (no `boundArchitectureId` even though the task is bound
  // mode), the banner is also skipped -- those threads behave as
  // clarify-at-save per the spec's forward-only rule.
  const shouldShowInvalidationBanner =
    (activeSaveTargetMode === 'bound-by-system-prompt' ||
      activeSaveTargetMode === 'derived-from-context') &&
    typeof boundArchitectureId === 'string' &&
    boundArchitectureId.length > 0 &&
    typeof boundArchitectureName === 'string';

  // The chat input is disabled when the banner is actively rendered
  // (i.e. bound id is set AND active arch differs from bound). The
  // banner mount alone is not enough -- it self-suppresses on no-divergence
  // so we replicate the comparison here to gate the input.
  const isInvalidationActive =
    shouldShowInvalidationBanner &&
    activeArchitectureId !== boundArchitectureId;

  // ---------------------------------------------------------------------------
  // Clear Conversation Confirmation State
  // ---------------------------------------------------------------------------

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearClick = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const handleClearConfirm = useCallback(async () => {
    setShowClearConfirm(false);
    await clearThread();
  }, [clearThread]);

  const handleClearCancel = useCallback(() => {
    setShowClearConfirm(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Per-ThreadKey Storage Keys
  // ---------------------------------------------------------------------------

  const serializedThreadKey = threadKeyToString(threadKey);
  const widthStorageKey = `unified-chat-width:${serializedThreadKey}`;
  const collapsedStorageKey = `unified-chat-collapsed:${serializedThreadKey}`;

  // ---------------------------------------------------------------------------
  // Panel State
  // ---------------------------------------------------------------------------

  const [width, setWidth] = useState<number>(() => {
    if (layout === 'inline') {
      // Inline mode: default to 30% of viewport, but respect persisted width
      try {
        const stored = localStorage.getItem(widthStorageKey);
        if (stored) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed >= MIN_WIDTH) return parsed;
        }
      } catch { /* ignore */ }
      return Math.round(window.innerWidth * INLINE_DEFAULT_WIDTH_PERCENT);
    }
    return getInitialWidth(widthStorageKey);
  });
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    // Inline mode: always start expanded (dashboard side-by-side requires visible panel)
    if (layout === 'inline') return false;
    try {
      const stored = localStorage.getItem(collapsedStorageKey);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      // Ignore localStorage errors
    }
    // No persisted state: use defaultOpen prop (defaultOpen=true means NOT collapsed)
    return defaultOpen ? false : true;
  });
  const isResizing = useRef(false);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const panelRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Collapse/Expand Toggle
  // ---------------------------------------------------------------------------

  const handleToggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapsedStorageKey, String(next));
      } catch {
        // Ignore localStorage errors
      }
      return next;
    });
  }, [collapsedStorageKey]);

  // ---------------------------------------------------------------------------
  // Left-Edge Resize Handle
  // Follows ChatPanel.tsx mousedown/mousemove/mouseup pattern
  // BUT: drag on LEFT edge of right-anchored panel
  //   newWidth = window.innerWidth - e.clientX
  // ---------------------------------------------------------------------------

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing.current) {
        let newWidth: number;
        if (layoutRef.current === 'inline' && panelRef.current) {
          // Inline mode: calculate relative to the panel's right edge in the flex container
          const rect = panelRef.current.getBoundingClientRect();
          newWidth = rect.right - e.clientX;
        } else {
          // Overlay mode: panel is fixed to the right edge of the viewport
          newWidth = window.innerWidth - e.clientX;
        }
        const maxWidth = window.innerWidth * 0.5;
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
        setWidth(clampedWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Persist Width to localStorage on Change (per-threadKey)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    try {
      localStorage.setItem(widthStorageKey, String(width));
    } catch {
      // Ignore localStorage errors
    }
  }, [width, widthStorageKey]);

  // ---------------------------------------------------------------------------
  // Wire onSubmitAnswers: format answers as numbered list and send
  // ---------------------------------------------------------------------------

  const handleSubmitAnswers = useCallback(
    (answers: Array<{ id: string; question: string; answer: string }>, files?: FileAttachment[]) => {
      const lines = answers.map(
        (a, i) => `${i + 1}. Q: ${a.question} A: ${a.answer}`
      );
      sendMessage(lines.join('\n'), files);
    },
    [sendMessage]
  );

  // ---------------------------------------------------------------------------
  // Spec 2026-03-01: Hub Bootstrap 2 -- TG7.3: Generalized Transcript Download
  // Spec 2026-03-01: Hub Bootstrap 3 -- TG5.3: Architecture task branch
  // Spec 2026-03-01: Hub Bootstrap 4 -- TG6.3: Tech stack and test strategy branches
  // Determines taskId and artifactDescription from the last completion chip
  // message rather than hardcoding mission values.
  // ---------------------------------------------------------------------------

  const handleDownloadTranscript = useCallback(() => {
    // Find the last completion chip message to determine the taskId
    let lastCompletionTaskId = 'product-manager--define-product'; // fallback default
    for (let i = messages.length - 1; i >= 0; i--) {
      const sr = messages[i].structuredResponse as { type?: string; taskId?: string } | null;
      if (sr && sr.type === 'completion-chip' && sr.taskId) {
        lastCompletionTaskId = sr.taskId;
        break;
      }
    }

    // Look up artifact description from TASK_ARTIFACT_MAP (kept for parity
    // with the existing branch logic; the explicit branches below take
    // precedence for the documented task ids).
    void TASK_ARTIFACT_MAP[lastCompletionTaskId];
    let artifactDescription: string;
    let filename: string;

    if (lastCompletionTaskId === 'product-manager--roadmap') {
      artifactDescription = 'ROADMAP (initiative/epic structure)';
      filename = 'pm-roadmap-transcript.md';
    } else if (lastCompletionTaskId === 'architect--define-architecture') {
      artifactDescription = 'ARCHITECTURE_BASELINE (architecture meta-model)';
      filename = 'architect-define-architecture-transcript.md';
    } else if (lastCompletionTaskId === 'architect--define-tech-stack') {
      artifactDescription = 'TECH-STACK.MD (technology stack)';
      filename = 'architect-define-tech-stack-transcript.md';
    } else if (lastCompletionTaskId === 'test-engineer--test-strategy') {
      artifactDescription = 'TEST-STRATEGY.MD (test strategy)';
      filename = 'test-engineer-test-strategy-transcript.md';
    } else {
      artifactDescription = 'agent-os/product/MISSION.MD';
      filename = 'pm-define-product-transcript.md';
    }

    const artifactContent = artifactPreview?.content || '';
    const md = buildTranscriptMarkdown(messages, lastCompletionTaskId, artifactContent, artifactDescription);

    downloadMarkdownFile(md, filename);
  }, [messages, artifactPreview]);

  // ---------------------------------------------------------------------------
  // Spec 2026-03-04: Assistant "What's Next" v1
  // Task Group 9, Task 9.3: handleWhatsNextAction callback
  //
  // Spec 2026-03-04: What's Next v1-B -- Modal Launch
  // Task Group 4, Task 4.2: Added modal branch at top of handler
  // - If action.launch === 'modal': calls openGenerateStandardsModal() and returns
  // - If action.launch === 'panel': existing navigation logic unchanged
  //
  // Spec 2026-03-04: What's Next v1-C -- Work Item Picker
  // Task Group 8, Task 8.2: Added implementPicker branch
  // - If action.launch === 'implementPicker': sets pickerMode, sends initiate action
  // ---------------------------------------------------------------------------

  const handleWhatsNextAction = useCallback(
    (action: NextAction) => {
      // ---- Modal launch: open modal directly, no navigation ----
      if (action.launch === 'modal') {
        openGenerateStandardsModal();
        return;
      }

      // ---- Picker launch: initiate work item picker flow ----
      if (action.launch === 'implementPicker') {
        setPickerMode(true);
        sendMessage('[Action: Start Implementation]', undefined, {
          pickerAction: 'initiate' as const,
          pickerPayload: { actionId: action.id },
        });
        return;
      }

      // ---- Panel launch: existing logic unchanged ----
      const target = action.target;

      // Determine current screen from threadKey
      const currentScreen = threadKey.type === 'hub' ? 'dashboard'
        : (threadKey as { screen: string }).screen;

      if (target.screen === currentScreen || (target.screen === 'dashboard' && threadKey.type === 'hub')) {
        // Same screen: jump straight into the task if known
        if (target.taskId) {
          startTask(target.personaId, target.taskId);
        } else {
          selectPersona(target.personaId);
        }
      } else {
        // Different screen: set pending action and navigate
        setPendingAction({
          screen: target.screen,
          tab: target.tab,
          personaId: target.personaId,
          taskId: target.taskId,
        });
        // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
        // Navigate to the canonical architecture-scoped URL. The target
        // screen names (product / metamodel / diagrams / dashboard) match
        // the URL view segment 1:1.
        if (activeProject?.id && activeArchitectureId) {
          const base = `/projects/${activeProject.id}/architectures/${activeArchitectureId}`;
          if (target.screen === 'product' && target.tab) {
            // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
            // Product tabs are now sub-routes; the legacy `product` tab
            // token maps to the `mission` sub-path (Mission tab hosts the
            // ProductPage body).
            const subPath = target.tab === 'product' ? 'mission' : target.tab;
            navigate(`${base}/product/${subPath}`);
          } else {
            navigate(`${base}/${target.screen}`);
          }
        }
      }
    },
    [threadKey, selectPersona, startTask, setPendingAction, navigate, activeProject, activeArchitectureId, openGenerateStandardsModal, sendMessage]
  );

  // ---------------------------------------------------------------------------
  // Task Menu -> Screen Navigation
  // When user clicks a task in the hub task menu that has a navigation target,
  // navigate to the appropriate Product & Delivery tab and set a pending action
  // so the target screen's panel picks up the task.
  // ---------------------------------------------------------------------------

  const handleSelectTask = useCallback(
    (taskId: string) => {
      const navTarget = TASK_NAVIGATION_TARGETS[taskId];

      // If we're in the hub and this task has a navigation target, navigate instead
      if (threadKey.type === 'hub' && navTarget) {
        setPendingAction({
          screen: navTarget.screen,
          tab: navTarget.tab,
          personaId: activePersonaId,
          taskId: taskId,
        });
        // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
        // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
        // Product tabs are sub-routes; map legacy `product` tab token
        // to the `mission` sub-path.
        if (activeProject?.id && activeArchitectureId) {
          const subPath = navTarget.tab === 'product' ? 'mission' : navTarget.tab;
          navigate(
            `/projects/${activeProject.id}/architectures/${activeArchitectureId}/product/${subPath}`
          );
        }
        return;
      }

      // Default: select task in current thread
      selectTask(taskId);
    },
    [threadKey, activePersonaId, selectTask, setPendingAction, navigate, activeProject, activeArchitectureId]
  );

  // ---------------------------------------------------------------------------
  // Spec 2026-03-04: What's Next v1-C -- Work Item Picker
  // Task Group 8, Task 8.4: Work item select and picker cancel handlers
  // ---------------------------------------------------------------------------

  const handleWorkItemSelect = useCallback(
    (workItemId: string, workItemTitle: string) => {
      setPickerMode(false);
      sendMessage(`[Selected: ${workItemId}]`, undefined, {
        pickerAction: 'select',
        pickerPayload: { workItemId, workItemTitle },
      });
      // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
      // Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 6
      // Implement tab requires the workItemId in the URL path now.
      if (activeProject?.id && activeArchitectureId) {
        navigate(
          `/projects/${activeProject.id}/architectures/${activeArchitectureId}/product/implement/${workItemId}`
        );
      }
    },
    [sendMessage, navigate, activeProject, activeArchitectureId]
  );

  const handlePickerCancel = useCallback(() => {
    setPickerMode(false);
    sendMessage('[Cancel picker]', undefined, {
      pickerAction: 'cancel',
    });
  }, [sendMessage]);

  // ---------------------------------------------------------------------------
  // Spec 2026-03-04: What's Next v1-C -- Work Item Picker
  // Task Group 9, Task 9.2: handleSend wrapper for picker mode interception
  // When pickerMode is true, intercepts messages and adds search picker fields
  // with the current selectedScope. Otherwise, delegates to raw sendMessage.
  // ---------------------------------------------------------------------------

  const handleSend = useCallback(
    (text: string, files?: FileAttachment[]) => {
      if (pickerMode) {
        sendMessage(text, files, {
          pickerAction: 'search',
          pickerPayload: {
            query: text,
            scopeType: selectedScope?.type,
            scopeValue: selectedScope?.value,
          },
        });
      } else {
        sendMessage(text, files);
      }
    },
    [pickerMode, selectedScope, sendMessage]
  );

  // ---------------------------------------------------------------------------
  // Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
  // Task Group 5, Task 5.6: handleViewTemporaryDiagram callback
  // Dispatches SET_VIEW with 'diagrams' and activates temporary diagram mode
  // via useActivateTemporaryDiagram from TemporaryDiagramContext.
  // ---------------------------------------------------------------------------

  const handleViewTemporaryDiagram = useCallback(
    (temporaryDiagramId: string) => {
      const projectId = activeProject?.id;
      if (!projectId) return; // No active project, cannot navigate

      // Spec 2026-05-02 Multi-Architecture Selector + URL Routing -- Task Group 4
      // Navigate to the architecture-scoped diagrams URL, then activate
      // the temporary diagram preview mode via context.
      if (activeArchitectureId) {
        navigate(`/projects/${projectId}/architectures/${activeArchitectureId}/diagrams`);
      }
      activateTemporaryDiagram(projectId, temporaryDiagramId);
    },
    [activeProject, activeArchitectureId, navigate, activateTemporaryDiagram]
  );

  // ---------------------------------------------------------------------------
  // Spec 2026-03-04: Assistant "What's Next" v1
  // Task Group 9, Task 9.4: Consume Pending Action on Mount
  // When navigating from a "What's Next" action card, the target screen's
  // UnifiedChatPanel auto-expands, switches persona, and selects the task.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (pendingAction) {
      // Expand the panel if collapsed
      setIsCollapsed(false);

      if (pendingAction.taskId) {
        // Both persona and task are known: jump straight into the task
        // without greeting or task-menu
        startTask(pendingAction.personaId, pendingAction.taskId);
      } else {
        // Only persona known: show greeting + task menu
        selectPersona(pendingAction.personaId);
      }

      // Clear immediately to prevent re-triggering
      clearPendingAction();
    }
  }, [pendingAction, startTask, selectPersona, clearPendingAction]);

  // ---------------------------------------------------------------------------
  // Persona Config for Header Indicator
  // ---------------------------------------------------------------------------

  const personaConfig = getPersonaConfig(activePersonaId);

  // ---------------------------------------------------------------------------
  // Available Personas for Header (FR1)
  // Computed from allowedPersonaIds (or all PERSONA_CONFIGS if undefined),
  // always including 'assistant', excluding the currently active persona.
  // ---------------------------------------------------------------------------

  const availablePersonas = useMemo(() => {
    const allowedSet = allowedPersonaIds
      ? new Set(allowedPersonaIds)
      : new Set(PERSONA_CONFIGS.map(p => p.id));
    // Always include assistant
    allowedSet.add('assistant');
    // Remove the currently active persona
    allowedSet.delete(activePersonaId);
    return PERSONA_CONFIGS.filter(p => allowedSet.has(p.id));
  }, [allowedPersonaIds, activePersonaId]);

  // ---------------------------------------------------------------------------
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
  // confirmArtifact wrapper for the clarify-at-save picker.
  //
  // Default behaviour for bound / derived / project-level tasks: pass through
  // to `confirmArtifact()` directly (no targetArchitectureId override).
  //
  // For `clarify-at-save` tasks: open the picker modal instead. The picker's
  // onConfirm callback will then call `confirmArtifact(architectureId)` with
  // the user's chosen architecture and close itself on success.
  // ---------------------------------------------------------------------------

  const handleConfirmArtifact = useCallback(() => {
    if (activeSaveTargetMode === 'clarify-at-save') {
      setSavePickerOpen(true);
      return;
    }
    // Bound / derived / project-level: save directly with no override.
    confirmArtifact();
  }, [activeSaveTargetMode, confirmArtifact]);

  const handleSavePickerConfirm = useCallback(
    async (architectureId: string) => {
      await confirmArtifact(architectureId);
    },
    [confirmArtifact]
  );

  const handleSavePickerClose = useCallback(() => {
    setSavePickerOpen(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- TG10
  // Banner abandon handler: clear the thread state. The chat panel owns the
  // semantics here -- the banner just signals user intent.
  // ---------------------------------------------------------------------------

  const handleAbandonConversation = useCallback(async () => {
    await clearThread();
  }, [clearThread]);

  // ---------------------------------------------------------------------------
  // Render: Collapsed State
  // Spec 2026-03-06: Dashboard UX Improvements -- Task Group 3 (Task 3.3)
  // When layout === 'inline': use .collapsedTabInline (relative position, no z-index)
  // When layout === 'overlay' (default): use .collapsedTab (fixed position)
  // ---------------------------------------------------------------------------

  if (isCollapsed) {
    return (
      <div
        className={layout === 'inline' ? styles.collapsedTabInline : styles.collapsedTab}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
        aria-label="Open chat panel"
        data-testid="unified-chat-panel-collapsed"
      >
        <MessageSquare size={20} className={styles.chatIcon} />
        <span className={styles.tabLabel}>Chat</span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Expanded State
  // Spec 2026-03-06: Dashboard UX Improvements -- Task Group 3 (Task 3.4)
  // When layout === 'inline': use .panelInline (relative position, width from flex parent)
  // When layout === 'overlay' (default): use .panel (fixed position, explicit width)
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={panelRef}
      className={layout === 'inline' ? styles.panelInline : styles.panel}
      style={{ width: `${width}px` }}
      data-testid="unified-chat-panel"
    >
      {/* Left-edge resize handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
        data-testid="unified-chat-resize-handle"
      />

      {/* Header */}
      <div className={styles.header} data-testid="unified-chat-header">
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Chat</span>
          <span className={styles.headerSeparator}>&ndash;</span>
          <div className={styles.headerSection} data-testid="header-room-name">
            <span className={styles.headerLabel}>Room:</span>
            <span className={styles.headerPersonaName}>{getRoomName(threadKey)}</span>
          </div>
          <span className={styles.headerSeparator}>&ndash;</span>
          <div className={styles.headerSection} data-testid="header-active-persona">
            <span className={styles.headerLabel}>In:</span>
            <div
              className={styles.personaIndicator}
              style={{ backgroundColor: personaConfig.color }}
              title={personaConfig.displayName}
              data-testid="persona-indicator"
            >
              {personaConfig.initials}
            </div>
            <span className={styles.headerPersonaName}>{personaConfig.displayName}</span>
          </div>
          <span className={styles.headerSeparator}>&ndash;</span>
          <div className={styles.headerSection} data-testid="header-available-personas">
            <span className={styles.headerLabel}>Available:</span>
            {availablePersonas.map(p => (
              <div
                key={p.id}
                className={`${styles.personaIndicator} ${styles.availableIcon}`}
                style={{ backgroundColor: p.color }}
                title={p.displayName}
                onClick={() => selectPersona(p.id)}
                role="button"
                tabIndex={0}
                data-testid={`available-persona-${p.id}`}
              >
                {p.initials}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.collapseButton}
            onClick={handleClearClick}
            aria-label="Clear conversation"
            data-testid="unified-chat-clear-button"
          >
            <Trash2 size={18} />
          </button>
          <button
            className={styles.collapseButton}
            onClick={handleToggle}
            aria-label="Collapse chat panel"
            data-testid="unified-chat-collapse-button"
          >
            <PanelRightClose size={20} />
          </button>
        </div>
      </div>

      {/* Clear Conversation Confirmation Dialog */}
      {showClearConfirm && (
        <div
          className={styles.confirmOverlay}
          onClick={handleClearCancel}
          data-testid="clear-confirm-overlay"
        >
          <div
            className={styles.confirmDialog}
            onClick={(e) => e.stopPropagation()}
            data-testid="clear-confirm-dialog"
          >
            <p className={styles.confirmMessage}>
              Do you want to clear the conversation history?
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.confirmCancelButton}
                onClick={handleClearCancel}
                data-testid="clear-confirm-cancel"
              >
                Cancel
              </button>
              <button
                className={styles.confirmClearButton}
                onClick={handleClearConfirm}
                data-testid="clear-confirm-clear"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spec #5 TG10: Conversation Architecture Invalidation Banner.
          Mounted unconditionally for bound/derived tasks where the thread has a
          bound architecture id. The banner self-suppresses when the active
          arch matches bound. Save inputs are gated separately (see input
          disabled below) using the same divergence comparison so the banner
          and the input disable stay in sync. */}
      {shouldShowInvalidationBanner && (
        <ConversationArchitectureInvalidationBanner
          boundArchitectureId={boundArchitectureId as string}
          boundArchitectureName={boundArchitectureName as string}
          onAbandon={handleAbandonConversation}
        />
      )}

      {/* Chat Thread (scrollable message list) */}
      <div className={styles.threadArea}>
        <ChatThread
          messages={messages}
          isLoading={isLoading || isGenerating}
          onSelectTask={handleSelectTask}
          onSubmitAnswers={handleSubmitAnswers}
          onConfirmArtifact={handleConfirmArtifact}
          onRejectArtifact={rejectArtifact}
          onDownloadTranscript={handleDownloadTranscript}
          onActionClick={handleWhatsNextAction}
          onWorkItemSelect={handleWorkItemSelect}
          onPickerCancel={handlePickerCancel}
          onDiscussMore={discussMore}
          onCancelProposal={cancelProposal}
          onViewTemporaryDiagram={handleViewTemporaryDiagram}
          sealedTaskIds={sealedTaskIds}
          isConfirmingArtifact={isSaving}
        />
      </div>

      {/* Chat Input Bar.
          Spec #5 TG10: Disabled while the invalidation banner is active so
          the user cannot post new messages until they swap back to the bound
          architecture or abandon the conversation. The aria-label /
          data-testid hints surface the gate reason for accessibility +
          downstream tests. */}
      <div
        className={styles.inputArea}
        data-testid="unified-chat-input-area"
        data-input-disabled-reason={
          isInvalidationActive ? 'architecture-invalidation' : undefined
        }
        title={
          isInvalidationActive
            ? `Save inputs disabled: this conversation is bound to ${boundArchitectureName}. Swap back or abandon to continue.`
            : undefined
        }
      >
        <ChatInputBar
          onSend={handleSend}
          disabled={isLoading || isInvalidationActive}
          allowedPersonaIds={allowedPersonaIds}
          onPersonaSelected={selectPersona}
        />
      </div>

      {/* Spec #5 TG10: Save-target architecture picker for clarify-at-save tasks.
          Mounted permanently (state-toggled) so the modal can animate in/out
          consistently. The picker is mode-agnostic; suppression for
          non-clarify-at-save tasks lives in handleConfirmArtifact above (it
          never opens the picker for those modes). */}
      <SaveTargetArchitecturePickerModal
        open={savePickerOpen}
        onClose={handleSavePickerClose}
        onConfirm={handleSavePickerConfirm}
        defaultArchitectureId={activeArchitectureId ?? undefined}
        taskName={activeTaskId}
      />

      {/* V3 Tier UX: LLM-solo confirmation dialog */}
      {llmSoloConfirm && (
        <LlmSoloConfirmDialog
          warnings={llmSoloConfirm.warnings}
          onConfirm={confirmLlmSoloRun}
          onCancel={cancelLlmSoloRun}
        />
      )}
    </div>
  );
}
