/**
 * ChatThread Component
 *
 * Spec 2026-02-28: Unified Chat Panel v1 (Frontend)
 * Task Group 5, Task 5.3: Create ChatThread component
 *
 * Spec 2026-02-28: Hub Bootstrap 1 -- Product Definition (PM) End-to-End
 * Task Group 7, Task 7.10: Pass new props through to MessageBubble
 * - onConfirmArtifact, onRejectArtifact, onDownloadTranscript, sealedTaskIds,
 *   isConfirmingArtifact wired to each MessageBubble
 * - Messages in sealed segments have disabled=true
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 8, Task 8.1: Thread onActionClick prop to MessageBubble
 * - Added onActionClick prop to ChatThreadProps
 * - Passes onActionClick through to each MessageBubble instance
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 3, Task 3.3: Update onActionClick prop type
 * - Updated onActionClick prop to use imported NextAction type
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 6, Task 6.3: Thread onWorkItemSelect and onPickerCancel props
 * - Added onWorkItemSelect and onPickerCancel props to ChatThreadProps
 * - Passes both through to each MessageBubble instance
 *
 * Spec 2026-03-26: Render Temporary Architecture Diagrams in Frontend (Increment 4)
 * Task Group 5, Task 5.6: Thread onViewTemporaryDiagram prop to MessageBubble
 * - Added onViewTemporaryDiagram prop to ChatThreadProps
 * - Passes onViewTemporaryDiagram through to each MessageBubble instance
 *
 * Scrollable message list with auto-scroll behavior adapted from ChatMessageList.tsx.
 * Renders each message using MessageBubble.
 *
 * Features:
 * - Auto-scrolls to bottom on new messages unless user has scrolled up
 *   (uses 20px threshold logic from ChatMessageList.tsx)
 * - Shows typing indicator (three-dot bounce animation) when isLoading is true
 * - Passes onSelectTask and onSubmitAnswers through to MessageBubble
 * - Passes artifact and transcript callbacks through to MessageBubble
 * - Passes onActionClick through to MessageBubble for "What's Next" action cards
 * - Passes onWorkItemSelect and onPickerCancel through to MessageBubble for work item picker
 * - Passes onViewTemporaryDiagram through to MessageBubble for temporary diagram viewing
 * - Determines disabled state for messages in sealed segments
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { NextAction } from './WhatsNextActionList';
import type { ThreadMessage, FileAttachment } from '../../api/chatV2Api';
import styles from './ChatThread.module.css';

// ============================================================================
// Props Interface
// ============================================================================

export interface ChatThreadProps {
  /** Ordered array of thread messages to render */
  messages: ThreadMessage[];
  /** Whether a message send is in progress (shows typing indicator) */
  isLoading: boolean;
  /** Callback when a task is selected from a task menu in a message */
  onSelectTask?: (taskId: string) => void;
  /** Callback when structured question answers are submitted from a message (with optional file attachments) */
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
   * Callback when user clicks "View Diagram" on a temporary architecture diagram.
   * Receives the temporaryDiagramId extracted from the code block.
   * Spec 2026-03-26: Render Temporary Architecture Diagrams -- TG5.6
   */
  onViewTemporaryDiagram?: (temporaryDiagramId: string) => void;
  /** Set of taskIds that have been completed (sealed by a completion chip) */
  sealedTaskIds?: Set<string>;
  /** Whether an artifact confirmation is in progress */
  isConfirmingArtifact?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function ChatThread({
  messages,
  isLoading,
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
  sealedTaskIds,
  isConfirmingArtifact,
}: ChatThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);

  // ---------------------------------------------------------------------------
  // Scroll Tracking: detect when user scrolls up from bottom
  // Uses 20px threshold for near-bottom detection (adapted from ChatMessageList.tsx)
  // ---------------------------------------------------------------------------

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 20;
    setUserHasScrolledUp(!isAtBottom);
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-scroll helper: double-RAF ensures DOM layout is complete before scroll
  // ---------------------------------------------------------------------------

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Auto-scroll: scroll to bottom on new messages
  // When a new user message is added, always scroll (reset userHasScrolledUp).
  // When a new assistant message is added, scroll unless user has scrolled up.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const messagesAdded = messages.length > prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;

    if (!messagesAdded) return;

    // Check if the latest message is from the user — if so, always scroll
    const latestMessage = messages[messages.length - 1];
    if (latestMessage?.role === 'user') {
      setUserHasScrolledUp(false);
      scrollToBottom();
      return;
    }

    // Assistant/system message: only scroll if user hasn't scrolled up
    if (!userHasScrolledUp) {
      scrollToBottom();
    }
  }, [messages, userHasScrolledUp, scrollToBottom]);

  // Also auto-scroll when isLoading changes to true (typing indicator appears)
  useEffect(() => {
    if (isLoading && !userHasScrolledUp) {
      scrollToBottom();
    }
  }, [isLoading, userHasScrolledUp, scrollToBottom]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onScroll={handleScroll}
      data-testid="chat-thread"
    >
      {(() => {
        // Precompute last completion-chip index per taskId so messages AFTER
        // the chip are not disabled (allows re-running a completed task).
        const lastChipIndexByTask = new Map<string, number>();
        if (sealedTaskIds && sealedTaskIds.size > 0) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const sr = messages[i].structuredResponse as { type?: string; taskId?: string } | null;
            if (sr && sr.type === 'completion-chip' && sr.taskId && !lastChipIndexByTask.has(sr.taskId)) {
              lastChipIndexByTask.set(sr.taskId, i);
            }
          }
        }

        return messages.map((message, msgIndex) => {
          const taskId = message.taskId || '';
          const lastChipIndex = lastChipIndexByTask.get(taskId) ?? -1;
          const isSealed = lastChipIndex >= 0 && msgIndex <= lastChipIndex;

          return (
            <MessageBubble
              key={message.id}
              message={message}
              onSelectTask={onSelectTask}
              onSubmitAnswers={onSubmitAnswers}
              onConfirmArtifact={onConfirmArtifact}
              onRejectArtifact={onRejectArtifact}
              onDownloadTranscript={onDownloadTranscript}
              onActionClick={onActionClick}
              onWorkItemSelect={onWorkItemSelect}
              onPickerCancel={onPickerCancel}
              onDiscussMore={onDiscussMore}
              onCancelProposal={onCancelProposal}
              onViewTemporaryDiagram={onViewTemporaryDiagram}
              disabled={isSealed}
              isConfirmingArtifact={isConfirmingArtifact}
            />
          );
        });
      })()}

      {/* Typing indicator: three-dot bounce animation */}
      {isLoading && (
        <div className={styles.typingIndicator} data-testid="typing-indicator">
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
          <span className={styles.typingDot} />
        </div>
      )}
    </div>
  );
}
