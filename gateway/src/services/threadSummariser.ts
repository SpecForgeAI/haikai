/**
 * Thread Summarisation Service
 *
 * Spec 2026-03-02: Increment 11 -- Hub Bootstrap 6: Summarisation End-to-End
 * Task Group 2: threadSummariser.ts and Summarisation Prompt
 *
 * Standalone module providing rolling summarisation for long-running Hub and
 * panel conversation threads. Follows the extraction pattern from
 * chatValidation.ts: exported pure functions with JSDoc comments and clear
 * parameter types, imported into chatV2.ts.
 *
 * Exports:
 * - getSealedTaskIds: Detects sealed bootstrap segment task IDs from completion-chip messages
 * - countEligibleMessages: Counts messages eligible for the summarisation threshold check
 * - maybeSummariseThread: Orchestrates the full threshold-check, message-selection, LLM-call, and persist cycle
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Thread, ThreadKey, ThreadMessage } from '../types/chatV2';
import { OpenAIMessage } from './openaiClient';
import { getLlmClient } from './llmClient';
import { getThread, saveThread } from './threadStore';
import { logger } from './logger';

/** Number of eligible messages required before summarisation is triggered */
const SUMMARISATION_THRESHOLD = 40;

/** Cached summarisation prompt content (loaded once from disk) */
let summarisationPrompt: string | null = null;

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Scans thread messages for completion-chip structured responses and collects
 * their taskIds into a Set. Messages with a taskId present in this set belong
 * to sealed bootstrap segments and are excluded from summarisation.
 *
 * Follows the same logic as `sealedTaskIds` in `useChatThread.ts` lines 260-269.
 *
 * @param thread - The Thread object to scan
 * @returns Set of task IDs that have been sealed via completion-chip messages
 */
export function getSealedTaskIds(thread: Thread): Set<string> {
  const sealed = new Set<string>();
  for (const msg of thread.messages) {
    const sr = msg.structuredResponse as { type?: string; taskId?: string } | null;
    if (sr && sr.type === 'completion-chip' && sr.taskId) {
      sealed.add(sr.taskId);
    }
  }
  return sealed;
}

/**
 * Counts the number of messages eligible for the summarisation threshold check.
 * Eligible messages are those that are: (a) not role: 'system', and (b) not
 * belonging to a sealed bootstrap segment (per getSealedTaskIds).
 *
 * A message is considered sealed if its `taskId` is present in the sealed set.
 * Messages with a null taskId are never considered sealed.
 *
 * @param thread - The Thread object to count eligible messages for
 * @returns The number of eligible (non-system, non-sealed) messages
 */
export function countEligibleMessages(thread: Thread): number {
  const sealedTaskIds = getSealedTaskIds(thread);
  let count = 0;
  for (const msg of thread.messages) {
    if (msg.role === 'system') continue;
    if (msg.taskId && sealedTaskIds.has(msg.taskId)) continue;
    count++;
  }
  return count;
}

/**
 * Orchestrates the full summarisation cycle: threshold check, message selection,
 * LLM call, and thread persistence.
 *
 * - If the eligible message count does not exceed the threshold (40), returns immediately (no-op).
 * - For first-time summarisation (thread.summary is null): sends all eligible messages.
 * - For rolling summarisation (thread.summary is non-null): sends the previous summary
 *   plus only messages from thread.summarisedUpToIndex onward.
 * - After the LLM call, re-reads the thread from disk (atomic read-modify-write),
 *   updates summary fields, and persists via saveThread.
 *
 * This function does NOT contain its own try/catch -- the caller in chatV2.ts
 * handles errors per R4 of the specification.
 *
 * @param thread - The Thread object (snapshot at call time)
 * @param threadKey - The ThreadKey identifying the thread scope
 * @param requestId - Request ID for logging and LLM call tracking
 */
export async function maybeSummariseThread(
  thread: Thread,
  threadKey: ThreadKey,
  requestId: string
): Promise<void> {
  // Step 1: Check threshold
  const eligibleCount = countEligibleMessages(thread);
  if (eligibleCount <= SUMMARISATION_THRESHOLD) {
    return;
  }

  // Step 2: Load the summarisation prompt
  const promptContent = await loadSummarisationPrompt();

  // Step 3: Build user-content string
  const sealedTaskIds = getSealedTaskIds(thread);
  let userContent: string;

  if (thread.summary === null) {
    // First-time summarisation: format all eligible messages
    userContent = formatMessagesForSummary(thread.messages, sealedTaskIds);
  } else {
    // Rolling summarisation: previous summary + new messages from summarisedUpToIndex onward
    const newMessages = thread.messages.slice(thread.summarisedUpToIndex);
    const formattedNew = formatMessagesForSummary(newMessages, sealedTaskIds);
    userContent = `PREVIOUS SUMMARY:\n${thread.summary}\n\nNEW MESSAGES:\n${formattedNew}`;
  }

  // Step 4: Build the messages array for the LLM call
  const messages: OpenAIMessage[] = [
    { role: 'system', content: promptContent },
    { role: 'user', content: userContent },
  ];

  // Step 5: Call sendChatRequest with summarisation options
  const llmResponse = await getLlmClient().sendChatRequest(messages, requestId, 'summarisation', {
    temperature: 0.2,
    maxTokens: 2000,
    tools: [],
    toolChoice: 'none',
  });

  // Step 6: Extract the new summary text
  const newSummary = llmResponse.content || '';

  // Step 7: Re-read the thread from disk (atomic read-modify-write)
  const freshThread = await getThread(threadKey);
  if (!freshThread) {
    logger.error('Thread not found during summarisation persist step', {
      requestId,
      threadKey: thread.threadKey,
    });
    return;
  }

  // Step 8: Set summary fields
  freshThread.summary = newSummary;
  freshThread.summarisedUpToIndex = freshThread.messages.length;

  // Step 9: Persist via saveThread
  await saveThread(threadKey, freshThread);

  // Step 10: Log success
  logger.info('Thread summarisation completed', {
    requestId,
    threadKey: thread.threadKey,
    summaryLength: newSummary.length,
  });
}

// ============================================================================
// Internal Helpers (not exported)
// ============================================================================

/**
 * Loads the summarisation prompt template from disk.
 * Caches the prompt content in a module-level variable for subsequent calls.
 *
 * @returns The prompt template content as a string
 */
async function loadSummarisationPrompt(): Promise<string> {
  if (summarisationPrompt !== null) {
    return summarisationPrompt;
  }

  const promptPath = path.resolve(__dirname, '../config/prompts/summarisation.prompt.md');
  summarisationPrompt = await fs.readFile(promptPath, 'utf-8');
  return summarisationPrompt;
}

/**
 * Formats thread messages for inclusion in the summarisation LLM call.
 * Filters out system-role messages and messages belonging to sealed bootstrap
 * segments, then formats each remaining message as "{Role}: {content}".
 *
 * Follows the pattern from buildConversationTranscript in chatValidation.ts
 * lines 112-123.
 *
 * @param messages - Array of ThreadMessages to format
 * @param sealedTaskIds - Set of sealed task IDs to exclude
 * @returns Formatted string with one "{Role}: {content}" line per eligible message
 */
function formatMessagesForSummary(messages: ThreadMessage[], sealedTaskIds: Set<string>): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.taskId && sealedTaskIds.has(msg.taskId)) continue;

    // Capitalize the first letter of the role
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
    lines.push(`${role}: ${msg.content}`);
  }
  return lines.join('\n');
}
