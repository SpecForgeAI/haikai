/**
 * MessageBubble Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 5, Task 5.2: Create MessageBubble component
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 4: MessageBubble Updates and Question Normalization
 * - Updated hasQuestions to detect plain string arrays (4.2)
 * - Updated extractQuestions to normalize plain strings to { id, question } objects (4.3)
 * - Added isArtifactPreview and isCompletionChip type guards (4.4)
 * - Added new callback props for artifact and transcript actions (4.5)
 * - Added rendering branches for artifact-preview and completion-chip types (4.6)
 *
 * Spec 2026-03-01: Hub Bootstrap 2 -- Roadmap (PM) End-to-End
 * Task Group 5, Task 5.4: Added isRoadmapPreview type guard and rendering
 * - Added isRoadmapPreview type guard for structuredResponse.type === 'roadmap-preview'
 * - Added rendering branch for RoadmapPreviewBubble
 * - Updated showQuestions guard to exclude roadmap preview
 *
 * Spec 2026-03-01: Hub Bootstrap 3 -- Solution Architect Baseline Architecture End-to-End
 * Task Group 4, Tasks 4.6-4.7: Added isArchitecturePreview type guard and rendering
 * - Added isArchitecturePreview type guard for structuredResponse.type === 'architecture-preview'
 * - Added rendering branch for ArchitecturePreviewBubble
 * - Updated showQuestions guard to exclude architecture preview
 *
 * Spec 2026-03-01: Hub Bootstrap 4 -- SA Tech Stack + TE Test Strategy End-to-End
 * Task Group 5, Tasks 5.6-5.7: Added isTechStackPreview and isTestStrategyPreview type guards and rendering
 * - Added isTechStackPreview type guard for structuredResponse.type === 'tech-stack-preview'
 * - Added isTestStrategyPreview type guard for structuredResponse.type === 'test-strategy-preview'
 * - Added rendering branches for TechStackPreviewBubble and TestStrategyPreviewBubble
 * - Updated showQuestions guard to exclude both new preview types
 *
 * Spec 2026-03-03: UnifiedChatPanel UX Polish
 * Task Group 3 (FR5): Questions Response Renders Summary Only
 * - Moved showQuestions branch into the main ternary chain (between completionChip and regular text)
 * - When showQuestions is true, message.content is suppressed entirely
 * - structuredResponse.summary is rendered as plain text above the questions table when present
 * - Removed standalone showQuestions block that previously rendered after content
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 7: MessageBubble Integration
 * - Added isWhatsNextActions type guard for structuredResponse.type === 'whats-next-actions'
 * - Added onActionClick prop for "What's Next" action card clicks
 * - Added rendering branch for WhatsNextActionList component
 * - Updated showQuestions guard to exclude whats-next-actions
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 3, Task 3.2: Update onActionClick prop type and isWhatsNextActions type guard
 * - Updated onActionClick prop to use imported NextAction type
 * - Updated isWhatsNextActions type guard for discriminated union shape
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 6, Task 6.2: Add isWorkItemSearchResults type guard and new props
 * - Added isWorkItemSearchResults type guard for structuredResponse.type === 'work-item-search-results'
 * - Added onWorkItemSelect and onPickerCancel props
 * - Updated isWhatsNextActions launch annotation to include 'implementPicker'
 * - Added rendering branch for WorkItemSearchResults component
 * - Updated showQuestions guard to exclude work-item-search-results
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 4, Tasks 4.3-4.4: Added isDataModelPreview type guard and rendering
 * - Added isDataModelPreview type guard for structuredResponse.type === 'data-model-preview'
 * - Added rendering branch for ArchitecturePreviewBubble (reused for data model preview)
 * - Updated showQuestions and showDiscoveryFinalReview guards to exclude data model preview
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 5: Chat Panel "View Diagram" Link
 * - Added extractTemporaryDiagramId helper to detect json:temporaryArchitectureDiagram code blocks
 * - Added onViewTemporaryDiagram callback prop for diagram link clicks
 * - Added "View Diagram" link rendering below regular text content when code block detected
 *
 * Renders a single chat message with role-based alignment and styling:
 * - User messages: right-aligned with "You" label, no avatar
 * - Assistant messages: left-aligned with colored circle avatar (28px, persona initials)
 *   and persona displayName above message content
 * - System messages: centered, muted text, no avatar
 *
 * Delegates to TaskMenu when structuredResponse.type === 'task-menu'.
 * Delegates to StructuredQuestionsRenderer when structuredResponse contains
 * a questions or openQuestions array.
 * Delegates to ArtifactPreviewBubble when structuredResponse.type === 'artifact-preview'.
 * Delegates to RoadmapPreviewBubble when structuredResponse.type === 'roadmap-preview'.
 * Delegates to ArchitecturePreviewBubble when structuredResponse.type === 'architecture-preview'.
 * Delegates to ArchitecturePreviewBubble when structuredResponse.type === 'data-model-preview'.
 * Delegates to TechStackPreviewBubble when structuredResponse.type === 'tech-stack-preview'.
 * Delegates to TestStrategyPreviewBubble when structuredResponse.type === 'test-strategy-preview'.
 * Delegates to CompletionChip when structuredResponse.type === 'completion-chip'.
 * Delegates to WhatsNextActionList when structuredResponse.type === 'whats-next-actions'.
 * Delegates to WorkItemSearchResults when structuredResponse.type === 'work-item-search-results'.
 *
 * Message content is rendered as plain text (no markdown in v1).
 */

import { getPersonaConfig } from '../../config/personaConfig';
import { TaskMenu } from './TaskMenu';
import { StructuredQuestionsRenderer } from './StructuredQuestionsRenderer';
import { ArtifactPreviewBubble } from './ArtifactPreviewBubble';
import { RoadmapPreviewBubble } from './RoadmapPreviewBubble';
import { RoadmapProposalBubble } from './RoadmapProposalBubble';
import { ArchitecturePreviewBubble } from './ArchitecturePreviewBubble';
import { TechStackPreviewBubble } from './TechStackPreviewBubble';
import { TestStrategyPreviewBubble } from './TestStrategyPreviewBubble';
import { UsersInteractionsPreviewBubble } from './UsersInteractionsPreviewBubble';
import { UserJourneysPreviewBubble } from './UserJourneysPreviewBubble';
import { BacklogProposalBubble } from './BacklogProposalBubble';
import { BacklogPreviewBubble } from './BacklogPreviewBubble';
import { CompletionChip } from './CompletionChip';
import { WhatsNextActionList, NextAction } from './WhatsNextActionList';
import { WorkItemSearchResults } from './WorkItemSearchResults';
import type { WorkItemSearchResult } from './WorkItemSearchResults';
import type { ThreadMessage, FileAttachment } from '../../api/chatV2Api';
import styles from './MessageBubble.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface MessageBubbleProps {
  /** The thread message to display */
  message: ThreadMessage;
  /** Callback when a task is selected from a task menu */
  onSelectTask?: (taskId: string) => void;
  /** Callback when structured question answers are submitted (with optional file attachments) */
  onSubmitAnswers?: (answers: Array<{ id: string; question: string; answer: string }>, files?: FileAttachment[]) => void;
  /** Callback when user confirms an artifact preview */
  onConfirmArtifact?: () => void;
  /** Callback when user rejects an artifact preview */
  onRejectArtifact?: () => void;
  /** Callback to download the transcript for a completed segment */
  onDownloadTranscript?: () => void;
  /** Callback when a "What's Next" action card is clicked */
  onActionClick?: (action: NextAction) => void;
  /** Callback when a work item is selected from search results */
  onWorkItemSelect?: (workItemId: string, title: string) => void;
  /** Callback when the picker is cancelled from search results */
  onPickerCancel?: () => void;
  /** Callback when user wants to continue refining a roadmap proposal */
  onDiscussMore?: () => void;
  /** Callback when user cancels a roadmap proposal */
  onCancelProposal?: () => void;
  /**
   * Callback when user clicks the "View Diagram" link for a temporary architecture diagram.
   * Receives the temporaryDiagramId extracted from the json:temporaryArchitectureDiagram code block.
   * The parent component handles navigation dispatch and temporary diagram activation.
   * Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.5
   */
  onViewTemporaryDiagram?: (temporaryDiagramId: string) => void;
  /** Whether this message is in a sealed segment (disables interactions) */
  disabled?: boolean;
  /** Whether an artifact confirmation is in progress */
  isConfirmingArtifact?: boolean;
}

// ============================================================================
// Temporary Architecture Diagram Code Block Detection
// ============================================================================

/**
 * Regex pattern for detecting json:temporaryArchitectureDiagram code blocks.
 * Uses the same pattern as the backend (gateway/src/routes/chatV2.ts).
 * Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.2
 */
const TEMPORARY_DIAGRAM_CODE_BLOCK_REGEX = /```json:temporaryArchitectureDiagram\s*\n([\s\S]*?)\n```/;

/**
 * Detects a json:temporaryArchitectureDiagram code block in message content,
 * parses the JSON payload, and extracts the diagram ID.
 *
 * Returns the diagram ID string if the code block is found and contains valid
 * JSON with an `id` field, or null if not found or malformed.
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.2
 */
export function extractTemporaryDiagramId(content: string): string | null {
  if (!content) return null;

  const match = content.match(TEMPORARY_DIAGRAM_CODE_BLOCK_REGEX);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id;
    }
    return null;
  } catch {
    // Malformed JSON -- handle gracefully by returning null (no link shown)
    return null;
  }
}

// ============================================================================
// Structured Response Type Guards
// ============================================================================

/**
 * Checks if the structuredResponse is a task-menu type.
 */
function isTaskMenu(
  sr: unknown
): sr is { type: 'task-menu'; tasks: Array<{ taskId: string; menuLabel: string; description: string }> } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'task-menu' && Array.isArray(obj.tasks);
}

/**
 * Checks if the structuredResponse contains questions (questions or openQuestions array).
 * Accepts arrays of plain strings OR arrays of { id, question } objects.
 */
function hasQuestions(sr: unknown): boolean {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  const qs = obj.questions ?? obj.openQuestions;
  if (!Array.isArray(qs) || qs.length === 0) return false;
  // Accept arrays of strings OR arrays of {id, question} objects
  return typeof qs[0] === 'string' || (typeof qs[0] === 'object' && qs[0] !== null && 'question' in qs[0]);
}

/**
 * Extracts the questions array from a structuredResponse.
 * Normalizes plain string items into { id, question } objects with auto-generated IDs.
 */
function extractQuestions(sr: Record<string, unknown>): Array<{ id: string; question: string }> {
  const raw = (Array.isArray(sr.questions) && sr.questions.length > 0)
    ? sr.questions
    : (Array.isArray(sr.openQuestions) && sr.openQuestions.length > 0)
      ? sr.openQuestions
      : [];
  return raw.map((item: unknown, index: number) => {
    if (typeof item === 'string') {
      return { id: `q-${index}`, question: item };
    }
    return item as { id: string; question: string };
  });
}

/**
 * Checks if the structuredResponse is an artifact-preview type.
 */
function isArtifactPreview(
  sr: unknown
): sr is { type: 'artifact-preview'; markdownContent: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'artifact-preview' && typeof obj.markdownContent === 'string';
}

/**
 * Checks if the structuredResponse is a roadmap-preview type.
 */
function isRoadmapPreview(
  sr: unknown
): sr is { type: 'roadmap-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'roadmap-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is an architecture-preview type.
 * Spec 2026-03-01: Hub Bootstrap 3 -- TG4.6
 */
export function isArchitecturePreview(
  sr: unknown
): sr is { type: 'architecture-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'architecture-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a data-model-preview type.
 * Spec 2026-03-14: Detailed Data Model Task -- TG4.3
 */
export function isDataModelPreview(
  sr: unknown
): sr is { type: 'data-model-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'data-model-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a tech-stack-preview type.
 * Spec 2026-03-01: Hub Bootstrap 4 -- TG5.6
 */
export function isTechStackPreview(
  sr: unknown
): sr is { type: 'tech-stack-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'tech-stack-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a test-strategy-preview type.
 * Spec 2026-03-01: Hub Bootstrap 4 -- TG5.6
 */
export function isTestStrategyPreview(
  sr: unknown
): sr is { type: 'test-strategy-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'test-strategy-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a completion-chip type.
 */
function isCompletionChip(
  sr: unknown
): sr is { type: 'completion-chip'; taskId: string; personaId: string; artifactName: string; artifactId: string; timestamp: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'completion-chip' && typeof obj.taskId === 'string' && typeof obj.artifactName === 'string';
}

/**
 * Checks if the structuredResponse is a whats-next-actions type.
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch (TG3.2: updated for discriminated union)
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker (TG6.2: added 'implementPicker' launch)
 */
function isWhatsNextActions(
  sr: unknown
): sr is { type: 'whats-next-actions'; explanation: string; actions: Array<{ id: string; label: string; reason: string; priority: number; target: { personaId: string; screen?: string; tab?: string; taskId?: string }; launch: 'panel' | 'modal' | 'implementPicker' }> } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'whats-next-actions' && Array.isArray(obj.actions);
}

/**
 * Checks if the structuredResponse is a work-item-search-results type.
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker (TG6.2)
 */
function isWorkItemSearchResults(
  sr: unknown
): sr is { type: 'work-item-search-results'; query: string; results: Array<{ id: string; title: string; type: string; status: string; parentTitle: string | null; inScope: boolean }> } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'work-item-search-results' && Array.isArray(obj.results);
}

/**
 * Checks if the structuredResponse is a roadmap proposal (phase="ready" with proposedInitiatives).
 * This detects the raw LLM response before it's been converted to a roadmap-preview.
 */
function isRoadmapProposal(sr: unknown): sr is {
  phase: 'ready';
  proposedInitiatives: Array<{ title: string; description?: string; epics: Array<{ title: string; description?: string }> }>;
  assumptions?: string[];
  openItems?: string[];
  summary?: string;
} {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.phase === 'ready'
    && Array.isArray(obj.proposedInitiatives)
    && (obj.proposedInitiatives as unknown[]).length > 0;
}

/**
 * Checks if the structuredResponse is a backlog-preview type.
 */
function isBacklogPreview(
  sr: unknown
): sr is { type: 'backlog-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'backlog-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a backlog proposal (phase="ready" with proposedFeatures + selectedEpic).
 */
function isBacklogProposal(sr: unknown): sr is {
  phase: 'ready';
  selectedEpic: { id: string; title: string; initiativeTitle?: string };
  proposedFeatures: Array<{ title: string; description?: string; stories: Array<{ title: string; description?: string; acceptanceCriteria?: string[] }> }>;
  epicPriorityUpdates?: Array<{ id: string; title: string; priority: number }>;
  assumptions?: string[];
  openItems?: string[];
  summary?: string;
} {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.phase === 'ready'
    && obj.selectedEpic != null
    && typeof obj.selectedEpic === 'object'
    && Array.isArray(obj.proposedFeatures)
    && (obj.proposedFeatures as unknown[]).length > 0;
}

/**
 * Checks if the structuredResponse is a users-interactions-preview type.
 */
function isUsersInteractionsPreview(
  sr: unknown
): sr is { type: 'users-interactions-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'users-interactions-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a user-journeys-preview type.
 */
function isUserJourneysPreview(
  sr: unknown
): sr is { type: 'user-journeys-preview'; content: string } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'user-journeys-preview' && typeof obj.content === 'string';
}

/**
 * Checks if the structuredResponse is a discovery final review (phase="ready" with summary string).
 * This handles the case where a discovery task reaches phase="ready" with questions: []
 * and a summary string -- renders the summary instead of raw JSON.
 */
function isDiscoveryFinalReview(sr: unknown): sr is { phase: 'ready'; summary: string; questions: unknown[] } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.phase === 'ready'
    && typeof obj.summary === 'string'
    && Array.isArray(obj.questions)
    && (obj.questions as unknown[]).length === 0;
}

// ============================================================================
// Component
// ============================================================================

export function MessageBubble({
  message,
  onSelectTask,
  onSubmitAnswers,
  onConfirmArtifact,
  onRejectArtifact,
  onDownloadTranscript,
  onActionClick,
  onWorkItemSelect,
  onPickerCancel,
  onDiscussMore,
  onCancelProposal,
  onViewTemporaryDiagram,
  disabled,
  isConfirmingArtifact,
}: MessageBubbleProps) {
  const { role, personaId, content, structuredResponse } = message;

  // Get persona config for assistant messages
  const personaConfig = role === 'assistant' && personaId ? getPersonaConfig(personaId) : null;

  // Check for structured response types
  const showTaskMenu = isTaskMenu(structuredResponse);
  const showArtifactPreview = isArtifactPreview(structuredResponse);
  const showRoadmapPreview = isRoadmapPreview(structuredResponse);
  const showArchitecturePreview = isArchitecturePreview(structuredResponse);
  const showDataModelPreview = isDataModelPreview(structuredResponse);
  const showTechStackPreview = isTechStackPreview(structuredResponse);
  const showTestStrategyPreview = isTestStrategyPreview(structuredResponse);
  const showCompletionChip = isCompletionChip(structuredResponse);
  const showWhatsNextActions = isWhatsNextActions(structuredResponse);
  const showWorkItemSearchResults = isWorkItemSearchResults(structuredResponse);
  const showRoadmapProposal = isRoadmapProposal(structuredResponse);
  const showBacklogPreview = isBacklogPreview(structuredResponse);
  const showBacklogProposal = !showRoadmapProposal && isBacklogProposal(structuredResponse);
  const showUsersInteractionsPreview = isUsersInteractionsPreview(structuredResponse);
  const showUserJourneysPreview = isUserJourneysPreview(structuredResponse);
  const showDiscoveryFinalReview = !showTaskMenu && !showArtifactPreview && !showRoadmapPreview && !showArchitecturePreview && !showDataModelPreview && !showTechStackPreview && !showTestStrategyPreview && !showUsersInteractionsPreview && !showUserJourneysPreview && !showBacklogPreview && !showCompletionChip && !showWhatsNextActions && !showWorkItemSearchResults && !showRoadmapProposal && !showBacklogProposal && isDiscoveryFinalReview(structuredResponse);
  const showQuestions = !showTaskMenu && !showArtifactPreview && !showRoadmapPreview && !showArchitecturePreview && !showDataModelPreview && !showTechStackPreview && !showTestStrategyPreview && !showUsersInteractionsPreview && !showUserJourneysPreview && !showBacklogPreview && !showCompletionChip && !showWhatsNextActions && !showWorkItemSearchResults && !showRoadmapProposal && !showBacklogProposal && !showDiscoveryFinalReview && hasQuestions(structuredResponse);
  const questions = showQuestions ? extractQuestions(structuredResponse as Record<string, unknown>) : [];

  // Detect temporary architecture diagram code block in message content
  // Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.2
  const temporaryDiagramId = role === 'assistant' && content
    ? extractTemporaryDiagramId(content)
    : null;
  // Also detect the code block pattern even when JSON is malformed (extractTemporaryDiagramId
  // returns null for invalid JSON). This allows stripping the raw code block from display.
  const hasDiagramCodeBlock = role === 'assistant' && content
    ? TEMPORARY_DIAGRAM_CODE_BLOCK_REGEX.test(content)
    : false;

  // Determine wrapper class based on role
  const wrapperClass = `${styles.wrapper} ${
    role === 'user'
      ? styles.wrapperUser
      : role === 'assistant'
        ? styles.wrapperAssistant
        : styles.wrapperSystem
  }`;

  // Determine bubble class based on role
  const bubbleClass = `${styles.bubble} ${
    role === 'user'
      ? styles.bubbleUser
      : role === 'assistant'
        ? styles.bubbleAssistant
        : styles.bubbleSystem
  }`;

  return (
    <div className={wrapperClass} data-testid="message-bubble" data-role={role}>
      {/* Assistant header: avatar + persona name */}
      {role === 'assistant' && personaConfig && (
        <div className={styles.assistantHeader}>
          <div
            className={styles.personaAvatar}
            style={{ backgroundColor: personaConfig.color }}
            data-testid="persona-avatar"
          >
            {personaConfig.initials}
          </div>
          <span className={styles.personaLabel}>{personaConfig.displayName}</span>
        </div>
      )}

      {/* User label */}
      {role === 'user' && <span className={styles.userLabel}>You</span>}

      {/* Message bubble */}
      <div className={bubbleClass}>
        {/* Task menu: render inline instead of plain text */}
        {showTaskMenu && onSelectTask ? (
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <TaskMenu
              tasks={(structuredResponse as { tasks: Array<{ taskId: string; menuLabel: string; description: string }> }).tasks}
              onSelectTask={onSelectTask}
            />
          </div>
        ) : showArtifactPreview && onConfirmArtifact ? (
          /* Artifact preview: render ArtifactPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <ArtifactPreviewBubble
              markdownContent={(structuredResponse as { markdownContent: string }).markdownContent}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
              headerLabel={(structuredResponse as { headerLabel?: string }).headerLabel}
              confirmLabel={(structuredResponse as { confirmLabel?: string }).confirmLabel}
            />
          </div>
        ) : showRoadmapPreview && onConfirmArtifact ? (
          /* Roadmap preview: render RoadmapPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <RoadmapPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showBacklogPreview && onConfirmArtifact ? (
          /* Backlog preview: render BacklogPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <BacklogPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showArchitecturePreview && onConfirmArtifact ? (
          /* Architecture preview: render ArchitecturePreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <ArchitecturePreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showDataModelPreview && onConfirmArtifact ? (
          /* Data model preview: render ArchitecturePreviewBubble (reused) */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <ArchitecturePreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showTechStackPreview && onConfirmArtifact ? (
          /* Tech stack preview: render TechStackPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <TechStackPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showTestStrategyPreview && onConfirmArtifact ? (
          /* Test strategy preview: render TestStrategyPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <TestStrategyPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showUsersInteractionsPreview && onConfirmArtifact ? (
          /* Users & Interactions preview: render UsersInteractionsPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <UsersInteractionsPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showUserJourneysPreview && onConfirmArtifact ? (
          /* User Journeys preview: render UserJourneysPreviewBubble */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
                {content}
              </div>
            )}
            <UserJourneysPreviewBubble
              content={(structuredResponse as { content: string }).content}
              onConfirm={onConfirmArtifact}
              onReject={onRejectArtifact!}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showCompletionChip && onDownloadTranscript ? (
          /* Completion chip: render CompletionChip */
          <div className={styles.structuredResponseArea}>
            <CompletionChip
              taskLabel={(structuredResponse as { taskId: string }).taskId}
              personaColor={personaConfig?.color || '#9E9E9E'}
              artifactName={(structuredResponse as { artifactName: string }).artifactName}
              timestamp={(structuredResponse as { timestamp: string }).timestamp}
              onDownloadTranscript={onDownloadTranscript}
            />
          </div>
        ) : showWhatsNextActions && onActionClick ? (
          /* What's Next Actions: render as clickable action cards
             Content is suppressed because WhatsNextActionList renders the explanation */
          <div className={styles.structuredResponseArea}>
            <WhatsNextActionList
              explanation={(structuredResponse as { explanation: string }).explanation}
              actions={(structuredResponse as { actions: NextAction[] }).actions}
              onActionClick={onActionClick}
            />
          </div>
        ) : showWorkItemSearchResults && onWorkItemSelect ? (
          /* Work Item Search Results: render as clickable result cards */
          <div className={styles.structuredResponseArea}>
            {content && (
              <div className={styles.messageContent}>{content}</div>
            )}
            <WorkItemSearchResults
              results={(structuredResponse as { results: WorkItemSearchResult[] }).results}
              query={(structuredResponse as { query: string }).query}
              onSelect={onWorkItemSelect}
              onCancel={onPickerCancel || (() => {})}
            />
          </div>
        ) : showRoadmapProposal && onConfirmArtifact && onDiscussMore && onCancelProposal ? (
          /* Roadmap proposal: render formatted proposal with 3 action buttons */
          <div className={styles.structuredResponseArea}>
            <RoadmapProposalBubble
              proposedInitiatives={(structuredResponse as { proposedInitiatives: Array<{ title: string; description?: string; epics: Array<{ title: string; description?: string }> }> }).proposedInitiatives}
              summary={(structuredResponse as { summary?: string }).summary}
              assumptions={(structuredResponse as { assumptions?: string[] }).assumptions}
              openItems={(structuredResponse as { openItems?: string[] }).openItems}
              onConfirm={onConfirmArtifact}
              onDiscussMore={onDiscussMore}
              onCancel={onCancelProposal}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showBacklogProposal && onConfirmArtifact && onDiscussMore && onCancelProposal ? (
          /* Backlog proposal: render formatted proposal with 3 action buttons */
          <div className={styles.structuredResponseArea}>
            <BacklogProposalBubble
              selectedEpic={(structuredResponse as { selectedEpic: { id: string; title: string; initiativeTitle?: string } }).selectedEpic}
              proposedFeatures={(structuredResponse as { proposedFeatures: Array<{ title: string; description?: string; stories: Array<{ title: string; description?: string; acceptanceCriteria?: string[] }> }> }).proposedFeatures}
              summary={(structuredResponse as { summary?: string }).summary}
              assumptions={(structuredResponse as { assumptions?: string[] }).assumptions}
              openItems={(structuredResponse as { openItems?: string[] }).openItems}
              epicPriorityUpdates={(structuredResponse as { epicPriorityUpdates?: Array<{ id: string; title: string; priority: number }> }).epicPriorityUpdates}
              onConfirm={onConfirmArtifact}
              onDiscussMore={onDiscussMore}
              onCancel={onCancelProposal}
              isConfirming={isConfirmingArtifact || false}
              disabled={disabled || false}
            />
          </div>
        ) : showDiscoveryFinalReview ? (
          /* Discovery final review: show summary text, suppress raw JSON content */
          <div className={styles.structuredResponseArea}>
            <div className={styles.messageContent}>
              {(structuredResponse as { summary: string }).summary}
            </div>
          </div>
        ) : showQuestions && onSubmitAnswers ? (
          /* Questions: suppress content, show summary + questions table */
          <div className={styles.structuredResponseArea}>
            {(() => {
              const sr = structuredResponse as { summary?: string } | null;
              const summary = sr && typeof sr === 'object' ? sr.summary : undefined;
              return summary ? (
                <div className={styles.messageContent}>{summary}</div>
              ) : null;
            })()}
            <StructuredQuestionsRenderer
              questions={questions}
              onSubmitAnswers={onSubmitAnswers}
              disabled={disabled}
            />
          </div>
        ) : (
          /* Regular text content — strip diagram JSON code block if present */
          <div className={role === 'system' ? styles.systemContent : styles.messageContent}>
            {hasDiagramCodeBlock
              ? (content?.replace(TEMPORARY_DIAGRAM_CODE_BLOCK_REGEX, '').trim() || 'Your diagram has been generated.')
              : content}
          </div>
        )}

        {/* View Diagram link: shown below message content when a temporary diagram
            code block is detected in the message content.
            Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.3, TG5.4, TG5.5 */}
        {temporaryDiagramId && onViewTemporaryDiagram && (
          <button
            className={styles.viewDiagramLink}
            onClick={() => onViewTemporaryDiagram(temporaryDiagramId)}
            data-testid="view-temporary-diagram-link"
          >
            View Diagram
          </button>
        )}
      </div>
    </div>
  );
}
