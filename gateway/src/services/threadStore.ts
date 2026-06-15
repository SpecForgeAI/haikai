/**
 * Thread Persistence Store
 *
 * Disk-based thread persistence service for the v2 conversation engine.
 * Stores Thread objects as JSON files on the filesystem using atomic writes.
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 5: Thread Persistence Store
 *
 * This is an entirely new service module with no interaction with
 * the existing session store or conversation.ts utilities.
 *
 * Patterns followed from implementConversations.ts:
 * - Atomic writes: write to .tmp file then fs.rename()
 * - fs.mkdir with { recursive: true } for directory creation
 * - ENOENT graceful degradation (returns null, does not throw)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ThreadKey, Thread, ThreadMessage, threadKeyToString } from '../types/chatV2';
import { logger } from './logger';
import { fetchProjectFolder } from './architectureModelClient';

const THREAD_JSON_FILENAME = 'thread.json';
const TEMP_FILE_SUFFIX = '.tmp';

/**
 * Converts a ThreadKey to a deterministic filesystem path.
 *
 * Path patterns (projectId removed — basePath already scopes to project folder):
 * - Hub:     {basePath}/threads/hub/thread.json
 * - Feature: {basePath}/threads/feature/{featureId}/thread.json
 * - Panel:   {basePath}/threads/panel/{screen}/{entityId || '_'}/thread.json
 *
 * @param threadKey - The ThreadKey discriminated union
 * @param basePath - Base directory for thread storage (project parent folder)
 * @returns Absolute path to the thread JSON file
 */
export function threadKeyToPath(threadKey: ThreadKey, basePath: string): string {
  switch (threadKey.type) {
    case 'hub':
      return path.join(basePath, 'threads', 'hub', THREAD_JSON_FILENAME);

    case 'feature':
      return path.join(basePath, 'threads', 'feature', threadKey.featureId, THREAD_JSON_FILENAME);

    case 'panel':
      return path.join(
        basePath,
        'threads',
        'panel',
        threadKey.screen,
        threadKey.entityId || '_',
        THREAD_JSON_FILENAME
      );
  }
}

/**
 * Resolves the base path for thread storage by looking up the project's
 * parent folder from the architecture-model-service.
 *
 * Falls back to process.cwd() if the lookup fails.
 *
 * @param projectId - The project ID to resolve the folder for
 * @returns The base path for thread storage
 */
async function resolveThreadBasePath(projectId: string): Promise<string> {
  const folder = await fetchProjectFolder(projectId);
  if (folder) {
    return folder;
  }
  logger.warn('Could not resolve project folder, falling back to cwd', { projectId });
  return process.cwd();
}

/**
 * Writes a Thread object to disk atomically.
 * Writes to a .tmp file first, then renames to the final path.
 * Creates parent directories as needed.
 *
 * @param filePath - Absolute path to the thread JSON file
 * @param thread - The Thread object to persist
 */
async function atomicWriteThread(filePath: string, thread: Thread): Promise<void> {
  const dirPath = path.dirname(filePath);
  const tempPath = filePath + TEMP_FILE_SUFFIX;

  // Ensure directory exists
  await fs.mkdir(dirPath, { recursive: true });

  // Write to temp file then rename (atomic write pattern)
  const jsonContent = JSON.stringify(thread, null, 2);
  await fs.writeFile(tempPath, jsonContent, 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Creates a new thread on disk for the given ThreadKey.
 * Initializes an empty Thread with timestamps and no messages.
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @returns The newly created Thread object
 */
export async function createThread(threadKey: ThreadKey): Promise<Thread> {
  const basePath = await resolveThreadBasePath(threadKey.projectId);
  const filePath = threadKeyToPath(threadKey, basePath);
  const now = new Date().toISOString();

  const thread: Thread = {
    threadKey: threadKeyToString(threadKey),
    projectId: threadKey.projectId,
    messages: [],
    activePersonaId: null,
    activeTaskId: null,
    summary: null,
    summarisedUpToIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  logger.debug('Creating new thread', {
    threadKey: thread.threadKey,
    filePath,
  });

  await atomicWriteThread(filePath, thread);

  logger.debug('Thread created successfully', {
    threadKey: thread.threadKey,
    filePath,
  });

  return thread;
}

/**
 * Reads a thread from disk for the given ThreadKey.
 * Returns null if the thread file does not exist (ENOENT graceful degradation).
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @returns The Thread object if found, or null if not found
 */
export async function getThread(threadKey: ThreadKey): Promise<Thread | null> {
  const basePath = await resolveThreadBasePath(threadKey.projectId);
  const filePath = threadKeyToPath(threadKey, basePath);

  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const thread: Thread = JSON.parse(fileContent);

    // Backward compatibility: default missing summary fields for pre-Inc11 thread files
    if (thread.summary === undefined) thread.summary = null;
    if (thread.summarisedUpToIndex === undefined) thread.summarisedUpToIndex = 0;

    logger.debug('Thread loaded from disk', {
      threadKey: threadKeyToString(threadKey),
      filePath,
      messageCount: thread.messages.length,
    });

    return thread;
  } catch (error) {
    const errorCode = (error as any).code;

    if (errorCode === 'ENOENT') {
      logger.debug('Thread file not found', {
        threadKey: threadKeyToString(threadKey),
        filePath,
      });
      return null;
    }

    // Log non-ENOENT errors and re-throw
    logger.error('Error reading thread file', {
      threadKey: threadKeyToString(threadKey),
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode,
    });
    throw error;
  }
}

/**
 * Appends a message to an existing thread and persists it to disk atomically.
 * Loads the current thread state, pushes the new message, updates the
 * updatedAt timestamp, and writes back to disk.
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @param message - The ThreadMessage to append
 * @returns The updated Thread object with the appended message
 * @throws Error if the thread does not exist on disk
 */
export async function appendMessage(threadKey: ThreadKey, message: ThreadMessage): Promise<Thread> {
  const basePath = await resolveThreadBasePath(threadKey.projectId);
  const filePath = threadKeyToPath(threadKey, basePath);

  // Load existing thread
  const thread = await getThread(threadKey);
  if (!thread) {
    throw new Error(`Thread not found for key: ${threadKeyToString(threadKey)}`);
  }

  // Append message and update timestamp
  thread.messages.push(message);
  thread.updatedAt = new Date().toISOString();

  logger.debug('Appending message to thread', {
    threadKey: thread.threadKey,
    messageId: message.id,
    role: message.role,
    messageCount: thread.messages.length,
  });

  await atomicWriteThread(filePath, thread);

  logger.debug('Message appended successfully', {
    threadKey: thread.threadKey,
    messageId: message.id,
    totalMessages: thread.messages.length,
  });

  return thread;
}

/**
 * Persists a modified Thread object to disk atomically.
 * Used by the summariser to update summary fields.
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @param thread - The modified Thread object to persist
 */
export async function saveThread(threadKey: ThreadKey, thread: Thread): Promise<void> {
  const basePath = await resolveThreadBasePath(threadKey.projectId);
  const filePath = threadKeyToPath(threadKey, basePath);

  thread.updatedAt = new Date().toISOString();

  logger.debug('Saving thread', {
    threadKey: thread.threadKey,
    filePath,
  });

  await atomicWriteThread(filePath, thread);

  logger.debug('Thread saved successfully', {
    threadKey: thread.threadKey,
    filePath,
  });
}

/**
 * Rehydrates a full thread from disk including all messages.
 * This is an alias for getThread with explicit intent of full disk load.
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @returns The Thread object if found, or null if not found
 */
export async function rehydrate(threadKey: ThreadKey): Promise<Thread | null> {
  logger.debug('Rehydrating thread from disk', {
    threadKey: threadKeyToString(threadKey),
  });

  return getThread(threadKey);
}

/**
 * Deletes a thread file from disk for the given ThreadKey.
 * Gracefully handles ENOENT (returns false if file didn't exist).
 *
 * @param threadKey - The ThreadKey identifying the thread scope
 * @returns true if the file was deleted, false if it didn't exist
 */
export async function deleteThread(threadKey: ThreadKey): Promise<boolean> {
  const basePath = await resolveThreadBasePath(threadKey.projectId);
  const filePath = threadKeyToPath(threadKey, basePath);

  logger.debug('Deleting thread file', {
    threadKey: threadKeyToString(threadKey),
    filePath,
  });

  try {
    await fs.unlink(filePath);
    logger.debug('Thread file deleted successfully', {
      threadKey: threadKeyToString(threadKey),
      filePath,
    });
    return true;
  } catch (error) {
    const errorCode = (error as any).code;
    if (errorCode === 'ENOENT') {
      logger.debug('Thread file not found for deletion', {
        threadKey: threadKeyToString(threadKey),
        filePath,
      });
      return false;
    }
    logger.error('Error deleting thread file', {
      threadKey: threadKeyToString(threadKey),
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode,
    });
    throw error;
  }
}
