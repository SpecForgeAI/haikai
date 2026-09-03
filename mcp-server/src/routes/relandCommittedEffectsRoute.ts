import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { relandCommittedEffects } from '../services/relandCommittedEffectsService';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the reland_committed_effects MCP tool endpoint.
 * Mounts at /mcp/tools/reland_committed_effects
 *
 * Re-inserts the `endpoint_data_effects` rows of candidates that were stamped
 * `committed` by a save-back whose phase-2 PUT did not land (2026-09-03).
 * Body: { sessionId, projectId, architectureId, runIds: string[] }.
 */
export const relandCommittedEffectsRouter = Router();

relandCommittedEffectsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, runIds } = req.body ?? {};
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }
      if (!architectureId || typeof architectureId !== 'string' || !UUID_V4_REGEX.test(architectureId)) {
        throw createHttpError(400, 'architectureId is required and must be a valid UUID');
      }
      if (
        !Array.isArray(runIds) ||
        runIds.length === 0 ||
        runIds.some((r) => typeof r !== 'string' || r.trim() === '')
      ) {
        throw createHttpError(400, 'runIds is required and must be a non-empty array of strings');
      }
      getOrCreateSession(sessionId);
      const result = await relandCommittedEffects({
        projectId,
        architectureId,
        runIds: runIds as string[],
      });
      console.log('[reland_committed_effects] Success', {
        projectId,
        architectureId,
        ...result,
        skipped: result.skipped.length,
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof Error) {
        console.error('[reland_committed_effects] Failure', { error: error.message });
      }
      next(error);
    }
  }
);
