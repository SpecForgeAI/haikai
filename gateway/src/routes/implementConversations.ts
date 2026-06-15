/**
 * Implement Conversations Route
 *
 * Provides GET and PUT endpoints for persisting and retrieving
 * Implement Assistant conversation history.
 *
 * Spec 2026-01-16: Implement Assistant Conversation Persistence and Rehydration
 * Task Group 2: Implement Conversations Route (GET and PUT)
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * Task Group 1: GET Endpoint Validation and Path Derivation
 * - Added projectParentFolder and featureTitle validation to GET endpoint
 * - Fixed GET path derivation to match PUT endpoint
 * - Removed fallback to config.conversationPersistBasePath
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * Task Group 2: Route Handler Updates
 * - Added kind parameter support to GET and PUT handlers
 * - Validates kind via normalizeKind; returns 400 on invalid values
 * - Defaults to "implement" when kind is omitted
 */

import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { deriveFolderName, buildTranscriptPath, normalizeKind } from '../services/transcriptWriter';
import { MessageEntry } from '../types';
import { logger } from '../services/logger';

const CONVERSATION_JSON_FILENAME = 'conversation.json';
const FULL_CONVERSATION_TXT_FILENAME = 'full-conversation.txt';
const TEMP_FILE_SUFFIX = '.tmp';

export const implementConversationsRouter = Router();

/**
 * Validates GET query parameters.
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * - Added validation for projectParentFolder (string, required, non-empty after trim)
 * - Added validation for featureTitle (string, required, non-empty after trim)
 *
 * @param query - Request query object
 * @returns Error message if validation fails, null if valid
 */
function validateGetParams(query: any): string | null {
  if (!query.projectId || typeof query.projectId !== 'string' || query.projectId.trim() === '') {
    return 'projectId is required';
  }
  if (!query.featureId || typeof query.featureId !== 'string' || query.featureId.trim() === '') {
    return 'featureId is required';
  }
  if (!query.projectParentFolder || typeof query.projectParentFolder !== 'string' || query.projectParentFolder.trim() === '') {
    return 'projectParentFolder is required';
  }
  if (!query.featureTitle || typeof query.featureTitle !== 'string' || query.featureTitle.trim() === '') {
    return 'featureTitle is required';
  }
  return null;
}

/**
 * Validates PUT request body.
 *
 * @param body - Request body object
 * @returns Error message if validation fails, null if valid
 */
function validatePutBody(body: any): string | null {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }
  if (!body.projectId || typeof body.projectId !== 'string' || body.projectId.trim() === '') {
    return 'projectId is required';
  }
  if (!body.featureId || typeof body.featureId !== 'string' || body.featureId.trim() === '') {
    return 'featureId is required';
  }
  if (!body.projectParentFolder || typeof body.projectParentFolder !== 'string' || body.projectParentFolder.trim() === '') {
    return 'projectParentFolder is required';
  }
  if (!body.featureTitle || typeof body.featureTitle !== 'string' || body.featureTitle.trim() === '') {
    return 'featureTitle is required';
  }
  if (!body.messages || !Array.isArray(body.messages)) {
    return 'messages array is required';
  }
  return null;
}

/**
 * Formats messages into human-readable transcript text.
 * Reuses the formatTranscript pattern from transcriptWriter.ts but works with MessageEntry[].
 *
 * @param messages - Array of MessageEntry to format
 * @returns Formatted plain text content
 */
function formatMessagesToTranscriptText(messages: MessageEntry[]): string {
  const lines: string[] = [];
  lines.push('=== IMPLEMENT ASSISTANT CONVERSATION TRANSCRIPT ===');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('');

  for (const entry of messages) {
    // Map lowercase role back to uppercase for transcript format
    const roleUpper = entry.role.toUpperCase();
    lines.push('--- [' + roleUpper + '] (phase: ' + entry.phase + ') @ ' + entry.timestamp + ' ---');
    lines.push(entry.content);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * GET /
 *
 * Retrieves conversation history for a specific project/feature combination.
 *
 * Query Parameters:
 * - projectId (string, required): The project identifier
 * - featureId (string, required): The feature identifier
 * - projectParentFolder (string, required): Base path for file storage
 * - featureTitle (string, required): Human-readable feature title
 * - kind (string, optional): Conversation kind; defaults to "implement"
 *
 * Spec 2026-01-16: Fix Implement Conversation Rehydration Path Alignment
 * - Now requires projectParentFolder and featureTitle to match PUT path derivation
 * - Uses deriveFolderName(featureTitle, featureId) same as PUT endpoint
 * - Uses projectParentFolder as basePath same as PUT endpoint
 * - Final path: <projectParentFolder>/conversations/<kind>/<derivedFolderName>/conversation.json
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Accepts optional kind query parameter; validates via normalizeKind
 * - Returns 400 on invalid kind values
 *
 * Response:
 * - { exists: true, messages: MessageEntry[] } when file exists
 * - { exists: false, messages: [] } when file missing or unreadable
 */
implementConversationsRouter.get('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  // Validate query parameters
  const validationError = validateGetParams(req.query);
  if (validationError) {
    logger.warn('GET conversation validation failed', {
      requestId,
      error: validationError,
    });
    return res.status(400).json({ error: validationError });
  }

  // Validate kind parameter separately via normalizeKind
  const rawKind = req.query.kind as string | undefined;
  let kind: string;
  try {
    kind = normalizeKind(rawKind);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const projectId = req.query.projectId as string;
  const featureId = req.query.featureId as string;
  const projectParentFolder = req.query.projectParentFolder as string;
  const featureTitle = req.query.featureTitle as string;

  logger.debug('GET conversation request', {
    requestId,
    projectId,
    featureId,
    projectParentFolder,
    featureTitle,
  });

  try {
    // Derive folder name using featureTitle and featureId (same as PUT endpoint)
    const folderName = deriveFolderName(featureTitle, featureId);

    // Use projectParentFolder as basePath (same as PUT endpoint)
    const basePath = projectParentFolder;

    const { dirPath } = buildTranscriptPath(basePath, folderName, kind);
    const jsonFilePath = path.join(dirPath, CONVERSATION_JSON_FILENAME);

    // Attempt to read the file
    const fileContent = await fs.readFile(jsonFilePath, 'utf8');
    const messages: MessageEntry[] = JSON.parse(fileContent);

    logger.info('GET conversation success', {
      requestId,
      projectId,
      featureId,
      projectParentFolder,
      featureTitle,
      messageCount: messages.length,
    });

    return res.json({ exists: true, messages });
  } catch (error) {
    // Log the error but return graceful response
    const errorCode = (error as any).code;
    if (errorCode === 'ENOENT') {
      logger.debug('GET conversation file not found', {
        requestId,
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
      });
    } else {
      logger.warn('GET conversation read error', {
        requestId,
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode,
      });
    }

    // Return exists: false for any read error (graceful degradation)
    return res.json({ exists: false, messages: [] });
  }
});

/**
 * PUT /
 *
 * Persists conversation history for a specific project/feature combination.
 *
 * Request Body:
 * - projectId (string, required): The project identifier
 * - featureId (string, required): The feature identifier
 * - projectParentFolder (string, required): Base path for file storage
 * - featureTitle (string, required): Human-readable feature title
 * - messages (MessageEntry[], required): Array of conversation messages
 * - kind (string, optional): Conversation kind; defaults to "implement"
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Accepts optional kind in body or query; body takes precedence
 * - Validates via normalizeKind; returns 400 on invalid values
 *
 * Response:
 * - { success: true } on successful write
 * - { success: false } on write failure (errors logged, not thrown)
 */
implementConversationsRouter.put('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  // Validate request body
  const validationError = validatePutBody(req.body);
  if (validationError) {
    logger.warn('PUT conversation validation failed', {
      requestId,
      error: validationError,
    });
    return res.status(400).json({ error: validationError });
  }

  // Resolve kind with precedence: body.kind > query.kind > default
  const resolvedRawKind = req.body.kind ?? (req.query.kind as string | undefined) ?? undefined;
  let kind: string;
  try {
    kind = normalizeKind(resolvedRawKind);
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  const { projectId, featureId, projectParentFolder, featureTitle, messages } = req.body;

  logger.debug('PUT conversation request', {
    requestId,
    projectId,
    featureId,
    featureTitle,
    messageCount: messages.length,
  });

  try {
    // Derive folder name using featureTitle and featureId
    const folderName = deriveFolderName(featureTitle, featureId);
    const { dirPath } = buildTranscriptPath(projectParentFolder, folderName, kind);

    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    // Paths for files
    const jsonFilePath = path.join(dirPath, CONVERSATION_JSON_FILENAME);
    const txtFilePath = path.join(dirPath, FULL_CONVERSATION_TXT_FILENAME);
    const jsonTempPath = jsonFilePath + TEMP_FILE_SUFFIX;
    const txtTempPath = txtFilePath + TEMP_FILE_SUFFIX;

    // Write conversation.json atomically
    const jsonContent = JSON.stringify(messages, null, 2);
    await fs.writeFile(jsonTempPath, jsonContent, 'utf8');
    await fs.rename(jsonTempPath, jsonFilePath);

    // Write full-conversation.txt atomically using transcript format
    const txtContent = formatMessagesToTranscriptText(messages);
    await fs.writeFile(txtTempPath, txtContent, 'utf8');
    await fs.rename(txtTempPath, txtFilePath);

    logger.info('PUT conversation success', {
      requestId,
      projectId,
      featureId,
      featureTitle,
      messageCount: messages.length,
      jsonPath: jsonFilePath,
      txtPath: txtFilePath,
    });

    return res.json({ success: true });
  } catch (error) {
    // Log error but return success: false (don't break the endpoint)
    logger.error('PUT conversation write error', {
      requestId,
      projectId,
      featureId,
      featureTitle,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.json({ success: false });
  }
});
