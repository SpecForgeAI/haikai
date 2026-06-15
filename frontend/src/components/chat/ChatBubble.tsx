/**
 * ChatBubble Component
 *
 * Displays a single chat message with role-based styling.
 * User messages are green and right-aligned, assistant messages are grey and left-aligned.
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 5: Update ChatBubble with Persona Labels
 *
 * Spec 2026-03-15: Chat Bubble Style - Hub Pattern
 * Restructured to render persona [icon]+name ABOVE the bubble instead of inside it,
 * matching the Hub's MessageBubble.tsx pattern.
 *
 * Features:
 * - Wrapper classes for column layout (userWrapper / assistantWrapper)
 * - Assistant header with avatar circle + persona name above bubble
 * - "You" label above user bubble (green accent)
 * - "Product Manager" default for assistant messages
 * - Support for custom personas with colored avatars
 */

import type { ChatMessage } from '../../api/chatApi';
import styles from './ChatBubble.module.css';

/**
 * Props interface for ChatBubble
 */
interface ChatBubbleProps {
  /** The chat message to display */
  message: ChatMessage;
  /**
   * Optional custom persona label.
   * Defaults to "You" for user role, "Product Manager" for assistant role.
   */
  persona?: string;
  /**
   * Optional color accent for the persona label.
   * Kept for backward compatibility but no longer used for styling.
   * Colors now come from getAvatarConfig.
   */
  personaColor?: 'green' | 'blue' | 'purple';
}

/** Map persona names to avatar config */
function getAvatarConfig(persona: string): { initials: string; color: string } {
  switch (persona) {
    case 'Product Manager':
      return { initials: 'PM', color: '#C62828' };
    case 'Software Developer':
      return { initials: 'SD', color: '#455A64' };
    case 'Test Engineer':
      return { initials: 'TE', color: '#2E7D32' };
    default:
      return { initials: persona.substring(0, 2).toUpperCase(), color: '#9E9E9E' };
  }
}

/**
 * ChatBubble component displays a single chat message with role-based styling.
 * User messages are green and right-aligned, assistant messages are grey and left-aligned.
 *
 * Spec 2026-03-15: Restructured to Hub pattern with persona header above bubble.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ChatBubble({ message, persona, personaColor: _personaColor }: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const wrapperClass = isUser ? styles.userWrapper : styles.assistantWrapper;
  const bubbleClass = isUser ? styles.userBubble : styles.assistantBubble;

  const personaLabel = persona ?? (isUser ? 'You' : 'Product Manager');

  return (
    <div className={wrapperClass}>
      {isUser ? (
        <span className={styles.userLabel}>You</span>
      ) : (
        <div className={styles.assistantHeader}>
          <div
            className={styles.personaAvatar}
            style={{ backgroundColor: getAvatarConfig(personaLabel).color }}
          >
            {getAvatarConfig(personaLabel).initials}
          </div>
          <span className={styles.personaLabel}>{personaLabel}</span>
        </div>
      )}
      <div className={`${styles.bubble} ${bubbleClass}`}>
        <div className={styles.messageContent}>
          {message.content}
        </div>
      </div>
    </div>
  );
}
