/**
 * Target State Conversation Store
 *
 * Disk-based thread persistence helper for the target-state architect-persona
 * conversation. Sibling file to threadStore.ts -- mirrors the same atomic-write
 * pattern and fetchProjectFolder base-path resolution, but is NOT an extension
 * of threadStore.ts (kept untouched).
 *
 * Spec: 2026-05-24 Target State Captured Decisions -- Data Plane
 * Task Group 7.2.
 *
 * File path convention:
 *   {projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json
 *
 * Where {projectParentFolder} comes from fetchProjectFolder(projectId), matching
 * the existing thread storage pattern (projectId is NOT a path segment).
 *
 * The helper does not inspect turn contents -- Spec 3 defines the turn shape.
 * Only the minimal envelope { schemaVersion, threadId, turns } is enforced.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { fetchProjectFolder } from './architectureModelClient';

const THREAD_DIR_NAME = 'threads';
const TARGET_STATE_SUBDIR = 'target-state-conversation';
const THREAD_JSON_FILENAME = 'thread.json';
const TEMP_FILE_SUFFIX = '.tmp';

/**
 * Minimal envelope shape for a target-state conversation thread.
 *
 * Spec 3 owns the turn shape; this helper deliberately keeps turns typed as
 * unknown[] so it never inspects or validates turn contents.
 */
export interface TargetStateConversationThread {
  schemaVersion: 1;
  threadId: string;
  turns: unknown[];
}

/**
 * Computes the on-disk path for the target-state conversation thread of a
 * given target architecture under a resolved project base path.
 *
 * Pure helper -- exported for test assertions; production callers resolve the
 * base path via fetchProjectFolder.
 */
export function targetStateConversationPath(basePath: string, targetArchitectureId: string): string {
  return path.join(
    basePath,
    THREAD_DIR_NAME,
    TARGET_STATE_SUBDIR,
    targetArchitectureId,
    THREAD_JSON_FILENAME,
  );
}

/**
 * Resolves the base path for thread storage by looking up the project's
 * parent folder via the architecture-model-service.
 *
 * Falls back to process.cwd() on lookup failure, matching threadStore.ts.
 */
async function resolveBasePath(projectId: string): Promise<string> {
  const folder = await fetchProjectFolder(projectId);
  if (folder) {
    return folder;
  }
  logger.warn(
    'Could not resolve project folder for target-state conversation, falling back to cwd',
    { projectId }
  );
  return process.cwd();
}

/**
 * Writes the thread envelope to disk atomically (write to .tmp then rename).
 * Creates parent directories as needed.
 */
async function atomicWrite(filePath: string, thread: TargetStateConversationThread): Promise<void> {
  const dirPath = path.dirname(filePath);
  const tempPath = filePath + TEMP_FILE_SUFFIX;

  await fs.mkdir(dirPath, { recursive: true });

  const jsonContent = JSON.stringify(thread, null, 2);
  await fs.writeFile(tempPath, jsonContent, 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Loads the target-state conversation thread for the given project +
 * target architecture. Returns a default empty envelope on ENOENT --
 * does NOT write the default envelope to disk.
 *
 * @param projectId             ID of the project (used to resolve base path).
 * @param targetArchitectureId  ID of the target architecture (path segment).
 * @returns                     Existing thread or a fresh default envelope.
 */
export async function loadTargetStateConversation(
  projectId: string,
  targetArchitectureId: string,
): Promise<TargetStateConversationThread> {
  const basePath = await resolveBasePath(projectId);
  const filePath = targetStateConversationPath(basePath, targetArchitectureId);

  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const thread = JSON.parse(fileContent) as TargetStateConversationThread;

    // Backward-compat defensive defaults -- helper owns only the envelope
    if (thread.schemaVersion !== 1) {
      thread.schemaVersion = 1;
    }
    if (!Array.isArray(thread.turns)) {
      thread.turns = [];
    }
    if (typeof thread.threadId !== 'string' || thread.threadId.length === 0) {
      thread.threadId = uuidv4();
    }

    logger.debug('Loaded target-state conversation thread', {
      projectId,
      targetArchitectureId,
      filePath,
      turnCount: thread.turns.length,
    });

    return thread;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      logger.debug('Target-state conversation thread not found, returning default envelope', {
        projectId,
        targetArchitectureId,
        filePath,
      });
      return {
        schemaVersion: 1,
        threadId: uuidv4(),
        turns: [],
      };
    }
    logger.error('Error reading target-state conversation thread', {
      projectId,
      targetArchitectureId,
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode,
    });
    throw error;
  }
}

/**
 * Appends a turn to the target-state conversation thread for the given project
 * + target architecture. Atomically writes the updated thread, creating the
 * parent directory if missing.
 *
 * The turn is opaque -- this helper does not inspect or validate its shape
 * (Spec 3 defines the turn schema).
 *
 * Concurrency note: this is a read-then-write sequence with no file-lock.
 * Two concurrent appendTurn calls against the same target architecture could
 * race and lose one turn. Spec 3 is single-writer per (project, target arch)
 * during the architect conversation, so the lock-free read-then-write is
 * acceptable here.
 *
 * @param projectId             ID of the project.
 * @param targetArchitectureId  ID of the target architecture.
 * @param turn                  Opaque turn payload (Spec 3-owned shape).
 */
export async function appendTurn(
  projectId: string,
  targetArchitectureId: string,
  turn: unknown,
): Promise<void> {
  const basePath = await resolveBasePath(projectId);
  const filePath = targetStateConversationPath(basePath, targetArchitectureId);

  const thread = await loadTargetStateConversation(projectId, targetArchitectureId);
  thread.turns.push(turn);

  logger.debug('Appending turn to target-state conversation thread', {
    projectId,
    targetArchitectureId,
    filePath,
    newTurnCount: thread.turns.length,
  });

  await atomicWrite(filePath, thread);
}
