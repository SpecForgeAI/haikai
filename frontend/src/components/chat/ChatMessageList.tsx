/**
 * ChatMessageList Component
 *
 * Displays a scrollable list of chat messages with auto-scroll behavior.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 7: Route Chat to SA Persona Based on Phase
 * - Added currentPhase prop to determine persona for assistant messages
 * - implementation_clarification phase uses "Software Developer" persona with purple color
 * - Other phases use "Product Manager" persona with blue color
 *
 * Spec 2026-01-28: Implement Button Starts Shape-Spec Stream
 * Task Group 5: Streaming Chat Message Rendering
 * - Enhanced auto-scroll to also work during streaming content updates
 * - Auto-scrolls when message content changes (not just when message count changes)
 * - Supports incremental content appending during streaming
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 3: ChatMessage Persona and Streaming Delta Handling
 * - Use stored message.persona when available for stable attribution
 * - Fallback to phase-based persona for messages without stored persona
 *
 * Spec 2026-01-30: Auto-scroll LHS Feature Content Panel and RHS Team Chat Panel
 * Task Group 1: RHS ChatMessageList Audit and Fix
 * - Added requestAnimationFrame wrapper for reliable scroll timing during streaming
 * - Ensures DOM has updated before measuring/scrolling
 * - Only scrolls the internal .container element, never page/root
 *
 * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
 * Task Group 1: ChatMessageList Scroll Bypass
 * - Added disableAutoScroll prop to bypass internal scroll logic
 * - When enabled, no scroll event handlers are attached
 * - When enabled, useEffect scroll logic is skipped
 * - When enabled, userHasScrolledUp state is not tracked
 * - Allows parent components to take ownership of scroll behavior
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type { ChatMessage, ImplementChatPhase, ChatMessagePersona } from '../../api/chatApi';
import { ChatBubble } from './ChatBubble';
import styles from './ChatMessageList.module.css';

/**
 * Props interface for ChatMessageList
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Added currentPhase prop for persona routing.
 *
 * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
 * Task Group 1: Added disableAutoScroll prop for scroll bypass.
 */
interface ChatMessageListProps {
  messages: ChatMessage[];
  /**
   * Current phase of the conversation for persona routing.
   * - 'implementation_clarification': Uses "Software Developer" persona (purple)
   * - Other phases: Uses "Product Manager" persona (blue)
   *
   * Used as fallback when message.persona is not set.
   *
   * Spec 2026-01-23: SA Handoff Per Increment - Task Group 7
   * Spec 2026-01-30: Now a fallback - message.persona takes precedence
   */
  currentPhase?: ImplementChatPhase;
  /**
   * When true, disables all internal scroll behavior.
   * - Does not attach scroll event handler
   * - Does not execute auto-scroll useEffect
   * - Does not track userHasScrolledUp state
   *
   * Use this when a parent component should own scroll behavior.
   *
   * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 1
   */
  disableAutoScroll?: boolean;
}

/**
 * Determines the persona and color based on the current phase.
 * Used as fallback when message.persona is not set.
 *
 * Spec 2026-01-23: SA Handoff Per Increment - Task Group 7
 *
 * @param phase - Current conversation phase
 * @returns Object with persona string and personaColor
 */
function getPersonaForPhase(phase: ImplementChatPhase | undefined): {
  persona: string;
  personaColor: 'green' | 'blue' | 'purple';
} {
  if (phase === 'implementation_clarification') {
    return {
      persona: 'Software Developer',
      personaColor: 'purple',
    };
  }
  // Default to Product Manager for all other phases
  return {
    persona: 'Product Manager',
    personaColor: 'blue',
  };
}

/**
 * Gets the color for a given persona.
 *
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 * Task Group 3: Map stored persona to color
 *
 * @param persona - The persona value from ChatMessage
 * @returns The color for the persona label
 */
function getColorForPersona(persona: ChatMessagePersona): 'blue' | 'purple' {
  if (persona === 'Software Developer') {
    return 'purple';
  }
  return 'blue';
}

/**
 * ChatMessageList component displays a scrollable list of chat messages.
 * Auto-scrolls to the bottom when new messages are added or when message
 * content is updated (for streaming), unless the user has manually scrolled up.
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Now passes persona and personaColor to ChatBubble based on currentPhase.
 *
 * Spec 2026-01-28: Task Group 5 - Enhanced auto-scroll for streaming
 * Now also auto-scrolls when message content changes during streaming,
 * not just when message count changes.
 *
 * Spec 2026-01-30: Task Group 3 - Use stored persona when available
 * Now checks message.persona first and uses it if available, falling back
 * to phase-based persona for messages without stored persona.
 *
 * Spec 2026-01-30: Auto-scroll LHS Feature Content Panel and RHS Team Chat Panel
 * Task Group 1: Uses requestAnimationFrame for reliable scroll timing.
 * Only scrolls the internal .container element (never page/root).
 *
 * Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom
 * Task Group 1: Added disableAutoScroll prop to bypass internal scroll logic.
 * When disableAutoScroll is true, no scroll operations occur within this component.
 */
export function ChatMessageList({ messages, currentPhase, disableAutoScroll }: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);
  // Spec 2026-01-28 Task 5.5: Track last message content for streaming auto-scroll
  const prevLastMessageContentRef = useRef<string | null>(null);

  // Track whether user has scrolled up from the bottom
  // Uses 20px threshold for near-bottom detection (Spec 2026-01-30)
  // Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 1
  // Only define the callback when scroll tracking is enabled
  const handleScroll = useCallback(() => {
    // Guard: Skip scroll tracking when disableAutoScroll is true
    if (disableAutoScroll) return;

    const container = containerRef.current;
    if (!container) return;

    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 20;
    setUserHasScrolledUp(!isAtBottom);
  }, [disableAutoScroll]);

  // Auto-scroll to bottom when new messages are added or content is updated during streaming
  // Spec 2026-01-30: Uses requestAnimationFrame to ensure DOM has updated before scrolling
  // Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 1
  // Guard: Skip all scroll logic when disableAutoScroll is true
  useEffect(() => {
    // Early return when scroll logic is disabled
    if (disableAutoScroll) {
      // Still update refs to track message state (for when prop changes)
      prevMessagesLengthRef.current = messages.length;
      const lastMessage = messages[messages.length - 1];
      prevLastMessageContentRef.current = lastMessage?.content ?? null;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const lastMessage = messages[messages.length - 1];
    const lastMessageContent = lastMessage?.content ?? null;
    const prevLastContent = prevLastMessageContentRef.current;

    // Spec 2026-01-28 Task 5.5: Auto-scroll in two cases:
    // 1. New messages were added (message count increased)
    // 2. Last message content changed (streaming content update)
    const messagesAdded = messages.length > prevMessagesLengthRef.current;
    const contentChanged = lastMessageContent !== prevLastContent;

    if (!userHasScrolledUp && (messagesAdded || contentChanged)) {
      // Spec 2026-01-30: Wrap scrollTop assignment in requestAnimationFrame
      // This ensures DOM has updated before measuring/scrolling
      // IMPORTANT: Only set scrollTop on the internal container, never use
      // window.scrollTo, document.body.scrollTop, or scrollIntoView
      requestAnimationFrame(() => {
        // Re-check container exists after async callback
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }

    prevMessagesLengthRef.current = messages.length;
    prevLastMessageContentRef.current = lastMessageContent;
  }, [messages, userHasScrolledUp, disableAutoScroll]);

  // Get fallback persona for assistant messages based on current phase
  const fallbackPersonaInfo = getPersonaForPhase(currentPhase);

  /**
   * Gets the persona and color for a specific message.
   * Uses stored message.persona if available, otherwise falls back to phase-based persona.
   *
   * Spec 2026-01-30: Task Group 3 - Stable persona attribution
   */
  const getMessagePersonaInfo = (message: ChatMessage): {
    persona: string;
    personaColor: 'green' | 'blue' | 'purple';
  } => {
    // For user messages, don't pass persona props (ChatBubble handles "You" label)
    if (message.role === 'user') {
      return { persona: 'You', personaColor: 'green' };
    }

    // Check if message has stored persona (Spec 2026-01-30 Task 3.4)
    if (message.persona) {
      return {
        persona: message.persona,
        personaColor: getColorForPersona(message.persona),
      };
    }

    // Fallback to phase-based persona for messages without stored persona
    return fallbackPersonaInfo;
  };

  return (
    <div
      ref={containerRef}
      className={styles.container}
      // Spec 2026-01-30: Force RHS Team Chat Scroll to Bottom - Task Group 1
      // Only attach scroll handler when scroll tracking is enabled
      onScroll={disableAutoScroll ? undefined : handleScroll}
      data-testid="chat-message-list"
    >
      {messages.map((message) => {
        const personaInfo = getMessagePersonaInfo(message);
        return (
          <ChatBubble
            key={message.id}
            message={message}
            // Pass persona props only for assistant messages
            persona={message.role === 'assistant' ? personaInfo.persona : undefined}
            personaColor={message.role === 'assistant' ? personaInfo.personaColor : undefined}
          />
        );
      })}
    </div>
  );
}
