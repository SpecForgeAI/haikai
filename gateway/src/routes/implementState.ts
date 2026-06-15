/**
 * Implement State Route
 *
 * Provides GET and PUT endpoints for persisting and retrieving
 * Implement Assistant screen state (everything except chat messages).
 *
 * Follows the same pattern as implementConversations.ts:
 * - Atomic writes (temp file + rename)
 * - Graceful ENOENT handling on GET
 * - Schema version validation on PUT
 *
 * Spec 2026-02-11: Persist Implementation Screen State to Disk
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
import { logger } from '../services/logger';

const IMPLEMENTATION_STATE_FILENAME = 'implementation-state.json';
const TEMP_FILE_SUFFIX = '.tmp';

export const implementStateRouter = Router();

/**
 * Validates GET query parameters.
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
  if (!body.state || typeof body.state !== 'object') {
    return 'state object is required';
  }
  if (!body.state.schemaVersion) {
    return 'state.schemaVersion is required';
  }
  return null;
}

/**
 * GET /
 *
 * Retrieves implementation state for a specific project/feature combination.
 *
 * Query Parameters:
 * - projectId (string, required): The project identifier
 * - featureId (string, required): The feature identifier
 * - projectParentFolder (string, required): Base path for file storage
 * - featureTitle (string, required): Human-readable feature title
 * - kind (string, optional): Conversation kind; defaults to "implement"
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Accepts optional kind query parameter; validates via normalizeKind
 * - Returns 400 on invalid kind values
 *
 * Response:
 * - { exists: true, state: {...} } when file exists
 * - { exists: false, state: null } when file missing or unreadable
 */
implementStateRouter.get('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  const validationError = validateGetParams(req.query);
  if (validationError) {
    logger.warn('GET implement-state validation failed', {
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

  logger.debug('GET implement-state request', {
    requestId,
    projectId,
    featureId,
    projectParentFolder,
    featureTitle,
  });

  try {
    const folderName = deriveFolderName(featureTitle, featureId);
    const basePath = projectParentFolder;
    const { dirPath } = buildTranscriptPath(basePath, folderName, kind);
    const jsonFilePath = path.join(dirPath, IMPLEMENTATION_STATE_FILENAME);

    const fileContent = await fs.readFile(jsonFilePath, 'utf8');
    const state = JSON.parse(fileContent);

    logger.info('GET implement-state success', {
      requestId,
      projectId,
      featureId,
      projectParentFolder,
      featureTitle,
    });

    return res.json({ exists: true, state });
  } catch (error) {
    const errorCode = (error as any).code;
    if (errorCode === 'ENOENT') {
      logger.debug('GET implement-state file not found', {
        requestId,
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
      });
    } else {
      logger.warn('GET implement-state read error', {
        requestId,
        projectId,
        featureId,
        projectParentFolder,
        featureTitle,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode,
      });
    }

    return res.json({ exists: false, state: null });
  }
});

/**
 * PUT /
 *
 * Persists implementation state for a specific project/feature combination.
 * Uses atomic write pattern (temp file + rename) to prevent partial reads.
 *
 * Request Body:
 * - projectId (string, required): The project identifier
 * - featureId (string, required): The feature identifier
 * - projectParentFolder (string, required): Base path for file storage
 * - featureTitle (string, required): Human-readable feature title
 * - state (object, required): The implementation state to persist (must include schemaVersion)
 * - kind (string, optional): Conversation kind; defaults to "implement"
 *
 * Spec 2026-02-12: Generalize Conversation Persistence to Support Kind
 * - Accepts optional kind in body or query; body takes precedence
 * - Validates via normalizeKind; returns 400 on invalid values
 *
 * Response:
 * - { success: true } on successful write
 * - { success: false } on write failure
 */
implementStateRouter.put('/', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  const validationError = validatePutBody(req.body);
  if (validationError) {
    logger.warn('PUT implement-state validation failed', {
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

  const { projectId, featureId, projectParentFolder, featureTitle, state } = req.body;

  logger.debug('PUT implement-state request', {
    requestId,
    projectId,
    featureId,
    featureTitle,
    schemaVersion: state.schemaVersion,
  });

  try {
    const folderName = deriveFolderName(featureTitle, featureId);
    const { dirPath } = buildTranscriptPath(projectParentFolder, folderName, kind);

    await fs.mkdir(dirPath, { recursive: true });

    const jsonFilePath = path.join(dirPath, IMPLEMENTATION_STATE_FILENAME);
    const jsonTempPath = jsonFilePath + TEMP_FILE_SUFFIX;

    const jsonContent = JSON.stringify(state, null, 2);
    await fs.writeFile(jsonTempPath, jsonContent, 'utf8');
    await fs.rename(jsonTempPath, jsonFilePath);

    logger.info('PUT implement-state success', {
      requestId,
      projectId,
      featureId,
      featureTitle,
      jsonPath: jsonFilePath,
    });

    return res.json({ success: true });
  } catch (error) {
    logger.error('PUT implement-state write error', {
      requestId,
      projectId,
      featureId,
      featureTitle,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.json({ success: false });
  }
});
