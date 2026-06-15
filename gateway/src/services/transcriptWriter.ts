/**
 * Transcript Writer Service
 *
 * Spec 2026-01-14: Implement Assistant Stage 7
 * Spec 2026-01-15: Fix Implement Assistant Conversation Persistence
 * - Modified deriveFolderName to use featureId instead of sessionId
 * - Modified writeTranscriptToFile to accept projectParentFolder parameter
 * - Added featureId parameter to writeTranscriptToFile
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * - Added formatMessagesFromTranscript() for converting TranscriptEntry[] to MessageEntry[]
 * - Added writeConversationJson() for atomic JSON file writing
 * - Extended writeTranscriptToFile() to also write conversation.json alongside full-conversation.txt
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Extended formatTranscript() to include splitPlan metadata in output
 * - writeTranscriptToFile() now persists splitPlan when present
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Added normalizeKind() helper for validating and defaulting the conversation kind
 * - Updated buildTranscriptPath() to accept optional kind parameter
 * - Updated writeConversationJson(), writeDisplayedConversation(), writeTranscriptToFile() to thread kind
 * - Path structure changed from conversations/<folderName>/ to conversations/<kind>/<folderName>/
 *
 * Spec 2026-02-13: SA Increment 1 - Add Solution Architect Mode
 * - Added 'solution_architect' to ALLOWED_KINDS array
 *
 * Spec 2026-02-15: RM Increment 1 - Roadmap PM Mode + LHS Chat Panel
 * - Added 'roadmap_pm' to ALLOWED_KINDS array
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getConfig } from '../config';
import { logger } from './logger';
import { ConversationTranscript, TranscriptEntry, MessageEntry, MessageEntryRole, TranscriptRole } from '../types/transcript';
import { DisplayedMessage } from '../types/chat';

const MAX_FOLDER_NAME_LENGTH = 50;
const TEMP_FILE_SUFFIX = '.tmp';
const TRANSCRIPT_FILENAME = 'full-conversation.txt';
const CONVERSATION_JSON_FILENAME = 'conversation.json';
const DISPLAYED_CONVERSATION_FILENAME = 'short-displayed-conversation.txt';
const CONVERSATIONS_FOLDER = 'conversations';

const ALLOWED_KINDS = ['implement', 'product', 'solution_architect', 'roadmap_pm'];

/**
 * Maps TranscriptRole to lowercase MessageEntryRole.
 * Only maps roles that are relevant for conversation rehydration.
 *
 * @param role - The TranscriptRole to map
 * @returns The lowercase MessageEntryRole or null if role should be filtered
 */
function mapTranscriptRoleToMessageRole(role: TranscriptRole): MessageEntryRole | null {
  switch (role) {
    case 'SYSTEM':
      return 'system';
    case 'USER':
      return 'user';
    case 'ASSISTANT':
      return 'assistant';
    case 'PLANNER_HANDOFF':
    case 'ORCHESTRATION':
      // These roles are not needed for rehydration
      return null;
    default:
      return null;
  }
}

/**
 * Derives a filesystem-safe folder name from work item title and feature ID.
 *
 * Spec 2026-01-15: Changed from sessionId to featureId for deterministic naming.
 * Using featureId ensures the same folder is used across sessions for the same feature.
 *
 * @param workItemTitle - The work item title to sanitize
 * @param featureId - The feature ID to use as suffix (first 8 chars)
 * @returns Filesystem-safe folder name in format: <sanitized_title>-<featureId_prefix>
 */
export function deriveFolderName(workItemTitle: string, featureId: string): string {
  // Handle empty featureId
  if (!featureId || featureId.trim() === '') {
    if (!workItemTitle || workItemTitle.trim() === '') {
      return 'conversation-';
    }
    // Fall through to use empty suffix
  }

  if (!workItemTitle || workItemTitle.trim() === '') {
    return 'conversation-' + featureId.slice(0, 8);
  }

  let folderName = workItemTitle.toLowerCase();
  folderName = folderName.replace(/\s+/g, '-');
  folderName = folderName.replace(/[^a-z0-9-]/g, '');
  folderName = folderName.replace(/-+/g, '-');
  folderName = folderName.replace(/^-+|-+$/g, '');

  if (folderName === '') {
    return 'conversation-' + featureId.slice(0, 8);
  }

  if (folderName.length > MAX_FOLDER_NAME_LENGTH) {
    folderName = folderName.slice(0, MAX_FOLDER_NAME_LENGTH);
    folderName = folderName.replace(/-+$/, '');
  }

  // Use featureId (first 8 chars) as suffix for deterministic folder naming
  const suffix = featureId.slice(0, 8);
  return folderName + '-' + suffix;
}

/**
 * Normalizes and validates a conversation kind value.
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 *
 * @param inputKind - Optional kind string to normalize; defaults to "implement" when undefined/null/empty
 * @returns Normalized kind string (lowercase, validated against allowlist)
 * @throws Error if the normalized value is not in the allowlist
 */
export function normalizeKind(inputKind?: string): string {
  if (!inputKind || inputKind.trim() === '') {
    return 'implement';
  }

  const normalized = inputKind.toLowerCase();

  if (!ALLOWED_KINDS.includes(normalized)) {
    throw new Error("Invalid kind '" + normalized + "'. Allowed values: " + ALLOWED_KINDS.join(', '));
  }

  return normalized;
}

/**
 * Builds the full transcript path from base path, folder name, and optional kind.
 *
 * Spec 2026-02-12: Updated to accept optional kind parameter for kind-prefixed paths.
 * Path structure: <basePath>/conversations/<kind>/<folderName>/
 *
 * @param basePath - The base directory path
 * @param folderName - The folder name for this transcript
 * @param kind - Optional conversation kind; defaults to "implement"
 * @returns Object with dirPath and filePath
 */
export function buildTranscriptPath(basePath: string, folderName: string, kind?: string): { dirPath: string; filePath: string } {
  const resolvedKind = kind || 'implement';
  const dirPath = path.join(basePath, CONVERSATIONS_FOLDER, resolvedKind, folderName);
  const filePath = path.join(dirPath, TRANSCRIPT_FILENAME);
  return { dirPath, filePath };
}

/**
 * Formats a transcript into human-readable text.
 *
 * Spec 2026-02-06: Extended to include splitPlan metadata when present.
 *
 * @param transcript - The conversation transcript to format
 * @returns Formatted plain text content
 */
export function formatTranscript(transcript: ConversationTranscript): string {
  const lines: string[] = [];
  lines.push('=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('Session ID: ' + transcript.sessionId);
  lines.push('Created: ' + transcript.createdAt);
  lines.push('');

  // Spec 2026-02-06: Include split plan summary if present
  if (transcript.splitPlan) {
    lines.push('=== SPLIT PLAN SUMMARY ===');
    lines.push('Total Parts: ' + transcript.splitPlan.parts.length);
    lines.push('');

    for (const part of transcript.splitPlan.parts) {
      const status = transcript.splitPlan.partStatuses[part.partIndex] || 'UNKNOWN';
      const timestamps = transcript.splitPlan.partTimestamps[part.partIndex] || {};
      const jobId = transcript.splitPlan.partJobIds[part.partIndex];
      const partEntries = transcript.splitPlan.partTranscripts[part.partIndex] || [];

      lines.push('--- Part ' + part.partIndex + ': ' + part.title + ' ---');
      lines.push('Status: ' + status);
      lines.push('Intent: ' + part.intent);
      if (part.dependencies && part.dependencies.length > 0) {
        lines.push('Dependencies: ' + part.dependencies.join(', '));
      }
      if (timestamps.startedAt) {
        lines.push('Started: ' + timestamps.startedAt);
      }
      if (timestamps.completedAt) {
        lines.push('Completed: ' + timestamps.completedAt);
      }
      if (jobId) {
        lines.push('Job ID: ' + jobId);
      }
      lines.push('Transcript Entries: ' + partEntries.length);
      lines.push('');
    }

    lines.push('=== END SPLIT PLAN SUMMARY ===');
    lines.push('');
  }

  for (const entry of transcript.entries) {
    if (entry.role === 'PLANNER_HANDOFF') {
      lines.push('');
      lines.push('=== FINAL HANDOFF PLAN (PLANNER OUTPUT) ===');
      lines.push('');
    } else if (entry.role === 'ORCHESTRATION') {
      lines.push('');
      lines.push('=== ORCHESTRATION EXECUTION ===');
      lines.push('');
    }
    lines.push('--- [' + entry.role + '] (phase: ' + entry.phase + ') @ ' + entry.timestamp + ' ---');
    lines.push(entry.content);
    lines.push('');
  }

  // Spec 2026-02-06: Include per-part transcripts if present
  if (transcript.splitPlan && Object.keys(transcript.splitPlan.partTranscripts).length > 0) {
    lines.push('');
    lines.push('=== PER-PART TRANSCRIPTS ===');
    lines.push('');

    for (const part of transcript.splitPlan.parts) {
      const partEntries = transcript.splitPlan.partTranscripts[part.partIndex];
      if (partEntries && partEntries.length > 0) {
        lines.push('--- Part ' + part.partIndex + ': ' + part.title + ' ---');
        lines.push('');

        for (const entry of partEntries) {
          lines.push('[' + entry.role + '] (phase: ' + entry.phase + ') @ ' + entry.timestamp);
          lines.push(entry.content);
          lines.push('');
        }
      }
    }

    lines.push('=== END PER-PART TRANSCRIPTS ===');
  }

  return lines.join('\n');
}

/**
 * Converts TranscriptEntry[] to MessageEntry[] for JSON serialization.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 *
 * This function:
 * - Maps TranscriptRole to lowercase MessageEntryRole (SYSTEM -> "system", etc.)
 * - Filters out PLANNER_HANDOFF and ORCHESTRATION entries (not needed for rehydration)
 * - Preserves phase, content, and timestamp fields
 *
 * @param entries - Array of TranscriptEntry to convert
 * @returns Array of MessageEntry suitable for conversation.json
 */
export function formatMessagesFromTranscript(entries: TranscriptEntry[]): MessageEntry[] {
  const messages: MessageEntry[] = [];

  for (const entry of entries) {
    const role = mapTranscriptRoleToMessageRole(entry.role);

    // Skip entries that should not be included in rehydration
    if (role === null) {
      continue;
    }

    messages.push({
      role,
      phase: entry.phase,
      content: entry.content,
      timestamp: entry.timestamp,
    });
  }

  return messages;
}

/**
 * Writes conversation.json to disk using atomic write pattern.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * Spec 2026-02-12: Updated to accept optional kind parameter for kind-prefixed paths.
 *
 * This function:
 * - Accepts MessageEntry[], basePath, folderName, and optional kind
 * - Writes to <basePath>/conversations/<kind>/<folderName>/conversation.json
 * - Uses atomic write pattern (temp file + rename)
 * - Non-blocking error handling (logs errors, never throws)
 *
 * @param messages - Array of MessageEntry to write
 * @param basePath - The base directory path
 * @param folderName - The folder name for this conversation
 * @param kind - Optional conversation kind; defaults to "implement"
 */
export async function writeConversationJson(
  messages: MessageEntry[],
  basePath: string,
  folderName: string,
  kind?: string
): Promise<void> {
  const { dirPath } = buildTranscriptPath(basePath, folderName, kind);
  const jsonFilePath = path.join(dirPath, CONVERSATION_JSON_FILENAME);
  const tempFilePath = jsonFilePath + TEMP_FILE_SUFFIX;

  try {
    // Ensure directory exists
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (mkdirError) {
      logger.warn('Failed to create directory for conversation.json: ' + dirPath, {
        folderName,
        error: (mkdirError as Error).message,
      });
      return;
    }

    // Write to temp file
    const jsonContent = JSON.stringify(messages, null, 2);
    try {
      await fs.writeFile(tempFilePath, jsonContent, 'utf8');
    } catch (writeError) {
      logger.error('Failed to write temp file for conversation.json: ' + tempFilePath, {
        folderName,
        error: (writeError as Error).message,
      });
      return;
    }

    // Atomic rename
    try {
      await fs.rename(tempFilePath, jsonFilePath);
      logger.info('Conversation JSON written: ' + jsonFilePath, {
        folderName,
        messageCount: messages.length,
        path: jsonFilePath,
      });
    } catch (renameError) {
      logger.error('Partial persistence - rename failed for conversation.json: ' + tempFilePath, {
        folderName,
        error: (renameError as Error).message,
      });
      return;
    }
  } catch (error) {
    logger.error('Unexpected error during conversation.json persistence', {
      folderName,
      error: (error as Error).message,
    });
  }
}

/**
 * Formats displayed messages into a human-readable conversation transcript.
 * This produces a simple, clean text file that mirrors the frontend chat panel.
 *
 * @param displayedMessages - Array of DisplayedMessage from the frontend
 * @returns Formatted plain text content
 */
export function formatDisplayedConversation(displayedMessages: DisplayedMessage[]): string {
  const lines: string[] = [];
  lines.push('=== DISPLAYED CONVERSATION ===');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('');

  for (const msg of displayedMessages) {
    lines.push('--- ' + msg.displayRole + ' ---');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Writes short-displayed-conversation.txt to disk using atomic write pattern.
 * Non-blocking: logs errors but never throws.
 *
 * Spec 2026-02-12: Updated to accept optional kind parameter for kind-prefixed paths.
 *
 * @param displayedMessages - Array of DisplayedMessage from the frontend
 * @param basePath - The base directory path
 * @param folderName - The folder name for this conversation
 * @param kind - Optional conversation kind; defaults to "implement"
 */
export async function writeDisplayedConversation(
  displayedMessages: DisplayedMessage[],
  basePath: string,
  folderName: string,
  kind?: string
): Promise<void> {
  const { dirPath } = buildTranscriptPath(basePath, folderName, kind);
  const filePath = path.join(dirPath, DISPLAYED_CONVERSATION_FILENAME);
  const tempFilePath = filePath + TEMP_FILE_SUFFIX;

  try {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (mkdirError) {
      logger.warn('Failed to create directory for short-displayed-conversation.txt: ' + dirPath, {
        folderName,
        error: (mkdirError as Error).message,
      });
      return;
    }

    const content = formatDisplayedConversation(displayedMessages);

    try {
      await fs.writeFile(tempFilePath, content, 'utf8');
    } catch (writeError) {
      logger.error('Failed to write temp file for short-displayed-conversation.txt: ' + tempFilePath, {
        folderName,
        error: (writeError as Error).message,
      });
      return;
    }

    try {
      await fs.rename(tempFilePath, filePath);
      logger.info('Displayed conversation written: ' + filePath, {
        folderName,
        messageCount: displayedMessages.length,
        path: filePath,
      });
    } catch (renameError) {
      logger.error('Partial persistence - rename failed for short-displayed-conversation.txt: ' + tempFilePath, {
        folderName,
        error: (renameError as Error).message,
      });
      return;
    }
  } catch (error) {
    logger.error('Unexpected error during short-displayed-conversation.txt persistence', {
      folderName,
      error: (error as Error).message,
    });
  }
}

/**
 * Writes the transcript to a file using atomic write pattern.
 *
 * Spec 2026-01-15: Modified to accept projectParentFolder and featureId parameters.
 * - If projectParentFolder is provided and non-empty, use it as base path
 * - Otherwise fall back to config.conversationPersistBasePath
 * - Uses featureId for deterministic folder naming (same folder across sessions)
 *
 * Spec 2026-01-16: Extended to also write conversation.json alongside full-conversation.txt.
 * - After writing full-conversation.txt, calls writeConversationJson()
 * - Converts transcript entries using formatMessagesFromTranscript()
 * - Both files written in same operation
 *
 * Spec 2026-02-06: Extended to include splitPlan in formatted transcript output.
 * - formatTranscript() now includes splitPlan summary and per-part transcripts
 * - splitPlan state is persisted as part of the full-conversation.txt file
 *
 * Spec 2026-02-12: Updated to accept optional kind parameter for kind-prefixed paths.
 * - kind is threaded through to buildTranscriptPath, writeConversationJson, writeDisplayedConversation
 * - Defaults to "implement" when not provided
 *
 * @param transcript - The conversation transcript to write
 * @param workItemTitle - Work item title for folder naming
 * @param featureId - Feature ID for deterministic folder naming (first 8 chars used as suffix)
 * @param projectParentFolder - Optional base path; if not provided, uses config default
 * @param kind - Optional conversation kind; defaults to "implement"
 * @param displayedMessages - Optional displayed messages from the frontend for short-displayed-conversation.txt
 */
export async function writeTranscriptToFile(
  transcript: ConversationTranscript,
  workItemTitle: string,
  featureId: string,
  projectParentFolder?: string,
  kind?: string,
  displayedMessages?: DisplayedMessage[]
): Promise<void> {
  const config = getConfig();
  const sessionId = transcript.sessionId;
  const resolvedKind = kind || 'implement';

  // Resolve base path: use projectParentFolder if provided and non-empty, else config default
  const basePath = (projectParentFolder && projectParentFolder.trim() !== '')
    ? projectParentFolder
    : config.conversationPersistBasePath;

  try {
    const folderName = deriveFolderName(workItemTitle, featureId);
    const { dirPath, filePath } = buildTranscriptPath(basePath, folderName, resolvedKind);
    const tempFilePath = filePath + TEMP_FILE_SUFFIX;
    const content = formatTranscript(transcript);

    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (mkdirError) {
      logger.warn('Failed to create directory: ' + dirPath, {
        sessionId,
        featureId,
        projectParentFolder: projectParentFolder || 'not provided',
        error: (mkdirError as Error).message,
      });
      return;
    }

    try {
      await fs.writeFile(tempFilePath, content, 'utf8');
    } catch (writeError) {
      logger.error('Failed to write temp file: ' + tempFilePath, {
        sessionId,
        featureId,
        projectParentFolder: projectParentFolder || 'not provided',
        error: (writeError as Error).message,
      });
      return;
    }

    try {
      await fs.rename(tempFilePath, filePath);
      logger.info('Transcript written: ' + filePath, {
        sessionId,
        featureId,
        projectParentFolder: projectParentFolder || 'not provided',
        path: filePath,
        hasSplitPlan: !!transcript.splitPlan,
      });
    } catch (renameError) {
      logger.error('Partial persistence - rename failed: ' + tempFilePath, {
        sessionId,
        featureId,
        projectParentFolder: projectParentFolder || 'not provided',
        error: (renameError as Error).message,
      });
      return;
    }

    // Spec 2026-01-16: Also write conversation.json alongside full-conversation.txt
    const messages = formatMessagesFromTranscript(transcript.entries);
    await writeConversationJson(messages, basePath, folderName, resolvedKind);

    // Write short-displayed-conversation.txt if displayed messages are provided
    if (displayedMessages && displayedMessages.length > 0) {
      await writeDisplayedConversation(displayedMessages, basePath, folderName, resolvedKind);
    }

  } catch (error) {
    logger.error('Unexpected error during persistence', {
      sessionId,
      featureId,
      projectParentFolder: projectParentFolder || 'not provided',
      error: (error as Error).message,
    });
  }
}
