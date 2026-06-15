/**
 * Discovery-Review Conversation Store (Spec 3 — capstone, Task Group 3.2).
 *
 * Disk-based thread persistence for the conversational "Architect" discovery-
 * review persona. A direct sibling/mirror of
 * `gateway/src/services/targetStateConversationStore.ts` — same atomic-write
 * pattern, same `fetchProjectFolder` base-path resolution, same opaque-turns
 * envelope. NOT an extension of that helper (kept untouched).
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Decision 7).
 *
 * File path convention:
 *   {projectParentFolder}/threads/discovery-review/{runId}/thread.json
 *
 * Where {projectParentFolder} comes from `fetchProjectFolder(projectId)` and
 * projectId is NOT a path segment (matching the existing thread storage
 * pattern). The path is keyed by the PRIMARY run id (the first chosen run in a
 * deterministic order — per-service scan selection,
 * `2026-06-05-per-service-scan-selection`). The rest of the selected scan SET is
 * recorded on the `open` turn (`scanPair.runs[]`), NOT in the path.
 *
 * The helper does not inspect turn contents — `reviewTurnShape.ts` owns the turn
 * shape. Only the minimal envelope { schemaVersion, threadId, turns } is
 * enforced.
 *
 * Concurrency: single-writer per run during the review conversation (matching
 * the target-state thread); the lock-free read-then-write is acceptable.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { fetchProjectFolder } from '../architectureModelClient';

const THREAD_DIR_NAME = 'threads';
const DISCOVERY_REVIEW_SUBDIR = 'discovery-review';
const THREAD_JSON_FILENAME = 'thread.json';
const TEMP_FILE_SUFFIX = '.tmp';

/**
 * Minimal envelope shape for a discovery-review conversation thread. The turn
 * shape is owned by `reviewTurnShape.ts`; turns stay `unknown[]` here so this
 * helper never inspects or validates them.
 */
export interface DiscoveryReviewConversationThread {
  schemaVersion: 1;
  threadId: string;
  turns: unknown[];
}

/**
 * Compute the on-disk path for a discovery-review thread keyed by the PRIMARY
 * run id under a resolved project base path. Pure helper — exported for test
 * assertions; production callers resolve the base path via `fetchProjectFolder`.
 */
export function discoveryReviewConversationPath(basePath: string, runId: string): string {
  return path.join(
    basePath,
    THREAD_DIR_NAME,
    DISCOVERY_REVIEW_SUBDIR,
    runId,
    THREAD_JSON_FILENAME,
  );
}

/**
 * Resolve the base path for thread storage via the project's parent folder.
 * Falls back to process.cwd() on lookup failure, matching the sibling store.
 */
async function resolveBasePath(projectId: string): Promise<string> {
  const folder = await fetchProjectFolder(projectId);
  if (folder) {
    return folder;
  }
  logger.warn(
    'Could not resolve project folder for discovery-review conversation, falling back to cwd',
    { projectId },
  );
  return process.cwd();
}

/**
 * Write the thread envelope to disk atomically (write to .tmp then rename).
 * Creates parent directories as needed.
 */
async function atomicWrite(
  filePath: string,
  thread: DiscoveryReviewConversationThread,
): Promise<void> {
  const dirPath = path.dirname(filePath);
  const tempPath = filePath + TEMP_FILE_SUFFIX;

  await fs.mkdir(dirPath, { recursive: true });

  const jsonContent = JSON.stringify(thread, null, 2);
  await fs.writeFile(tempPath, jsonContent, 'utf8');
  await fs.rename(tempPath, filePath);
}

/**
 * Load the discovery-review conversation thread for a project + PRIMARY run id.
 * Returns a default empty envelope on ENOENT — does NOT write the default
 * envelope to disk.
 *
 * @param projectId  ID of the project (resolves the base path; NOT a path segment).
 * @param runId      The PRIMARY run id (the path segment).
 */
export async function loadDiscoveryReviewConversation(
  projectId: string,
  runId: string,
): Promise<DiscoveryReviewConversationThread> {
  const basePath = await resolveBasePath(projectId);
  const filePath = discoveryReviewConversationPath(basePath, runId);

  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const thread = JSON.parse(fileContent) as DiscoveryReviewConversationThread;

    // Backward-compat defensive defaults — helper owns only the envelope.
    if (thread.schemaVersion !== 1) {
      thread.schemaVersion = 1;
    }
    if (!Array.isArray(thread.turns)) {
      thread.turns = [];
    }
    if (typeof thread.threadId !== 'string' || thread.threadId.length === 0) {
      thread.threadId = uuidv4();
    }

    logger.debug('Loaded discovery-review conversation thread', {
      projectId,
      runId,
      filePath,
      turnCount: thread.turns.length,
    });

    return thread;
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      logger.debug('Discovery-review conversation thread not found, returning default envelope', {
        projectId,
        runId,
        filePath,
      });
      return {
        schemaVersion: 1,
        threadId: uuidv4(),
        turns: [],
      };
    }
    logger.error('Error reading discovery-review conversation thread', {
      projectId,
      runId,
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode,
    });
    throw error;
  }
}

/**
 * Append a turn to the discovery-review conversation thread for a project +
 * PRIMARY run id. Atomically writes the updated thread, creating the parent
 * directory if missing.
 *
 * The turn is opaque — this helper does not inspect or validate its shape
 * (`reviewTurnShape.ts` owns the schema).
 *
 * @param projectId  ID of the project.
 * @param runId      The PRIMARY run id.
 * @param turn       Opaque turn payload (review turn-union shape).
 */
export async function appendReviewTurn(
  projectId: string,
  runId: string,
  turn: unknown,
): Promise<void> {
  const basePath = await resolveBasePath(projectId);
  const filePath = discoveryReviewConversationPath(basePath, runId);

  const thread = await loadDiscoveryReviewConversation(projectId, runId);
  thread.turns.push(turn);

  logger.debug('Appending turn to discovery-review conversation thread', {
    projectId,
    runId,
    filePath,
    newTurnCount: thread.turns.length,
  });

  await atomicWrite(filePath, thread);
}
