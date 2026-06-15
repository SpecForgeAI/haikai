/**
 * Conversation helper service for multi-turn conversation management.
 *
 * Provides functions for:
 * - Building message arrays for OpenAI API calls with conversation history
 * - Persisting conversation state to sessions (excluding system prompts)
 * - Truncating conversations to stay within limits (FIFO order)
 * - Calculating conversation byte sizes
 */

import { OpenAIMessage, GatewaySession } from '../types/session';
import { updateSession } from './sessionStore';
import { getConfig } from '../config';
import { logger } from './logger';

/**
 * Calculates the total byte size of conversation content.
 * Uses UTF-8 encoding for accurate byte counting.
 *
 * When message.content is an array (ContentPart[]), it is serialized to a
 * JSON string via JSON.stringify before measuring bytes.
 * When message.content is a string, it is used directly.
 *
 * Spec 2026-02-17: Multi-File Upload + URL References for SA and PM Chat
 * - Added array content handling via typeof guard and JSON.stringify
 *
 * @param conversation - Array of OpenAI messages
 * @returns Total bytes of all message content
 */
export function calculateConversationBytes(conversation: OpenAIMessage[]): number {
  return conversation.reduce((total, message) => {
    const rawContent = message.content;
    const content = typeof rawContent === 'string'
      ? rawContent
      : JSON.stringify(rawContent || '');
    return total + Buffer.byteLength(content, 'utf8');
  }, 0);
}

/**
 * Truncates conversation to stay within configured limits.
 * Removes oldest messages first (FIFO) to respect both message count and byte size limits.
 *
 * Truncation strategy:
 * 1. Check message count limit first, remove oldest messages
 * 2. Then check byte size limit, continue removing oldest until under limit
 *
 * @param conversation - Array of OpenAI messages to truncate
 * @returns New truncated conversation array (does not mutate input)
 */
export function truncateConversation(conversation: OpenAIMessage[]): OpenAIMessage[] {
  const config = getConfig();
  const maxMessages = config.maxConversationMessages;
  const maxBytes = config.maxConversationBytes;

  // Create a copy to avoid mutating input
  let truncated = [...conversation];

  // Step 1: Enforce message count limit (remove oldest first - FIFO)
  if (truncated.length > maxMessages) {
    const removeCount = truncated.length - maxMessages;
    truncated = truncated.slice(removeCount);
  }

  // Step 2: Enforce byte size limit (continue removing oldest until under limit)
  while (truncated.length > 0 && calculateConversationBytes(truncated) > maxBytes) {
    truncated = truncated.slice(1);
  }

  return truncated;
}

/**
 * Builds the complete message array for an OpenAI API turn.
 * Combines system prompt, conversation history, and current user message.
 *
 * @param session - Gateway session containing conversation history
 * @param systemPrompt - System prompt to prepend
 * @param userMessage - Current user message to append
 * @returns Complete message array: [system, ...conversation, user]
 */
export function buildMessagesForTurn(
  session: GatewaySession,
  systemPrompt: string,
  userMessage: string
): OpenAIMessage[] {
  // Handle undefined conversation (legacy sessions) as empty array
  const conversation = session.conversation || [];

  return [
    { role: 'system', content: systemPrompt },
    ...conversation,
    { role: 'user', content: userMessage },
  ];
}

/**
 * Persists conversation to session storage.
 * Filters out system prompts (they are rebuilt fresh per-request).
 * Applies truncation to enforce message count and byte size limits.
 *
 * @param sessionId - Session ID to update
 * @param messages - Complete message array from the turn (including system prompt)
 */
export function persistConversation(sessionId: string, messages: OpenAIMessage[]): void {
  // Filter out system prompt (role === 'system')
  const conversationWithoutSystem = messages.filter(m => m.role !== 'system');

  // Apply truncation to enforce limits
  const truncated = truncateConversation(conversationWithoutSystem);

  // Calculate metrics for logging
  const originalCount = conversationWithoutSystem.length;
  const truncatedCount = truncated.length;
  const truncatedBytes = calculateConversationBytes(truncated);
  const messagesRemoved = originalCount - truncatedCount;

  // Debug logging for conversation size metrics
  logger.debug('Persisting conversation', {
    sessionId,
    originalMessageCount: originalCount,
    truncatedMessageCount: truncatedCount,
    conversationBytes: truncatedBytes,
    messagesRemoved,
  });

  // Update session with truncated conversation
  updateSession(sessionId, { conversation: truncated });
}
