import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { saveDiscoveryCandidatesToModel, SaveBackMode } from '../services/candidateSaveBackService';

/**
 * UUID v4 regex pattern for projectId, architectureId, and runId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valid save-back modes
 */
const VALID_MODES: SaveBackMode[] = ['auto', 'manual'];

/**
 * Express Router for the save_discovery_candidates_to_model MCP tool endpoint.
 * Mounts at /mcp/tools/save_discovery_candidates_to_model
 *
 * Multi-architecture migration (2026-05-11): now requires an architectureId
 * in the request body and forwards it into the save-back orchestration so
 * the resulting model PUT lands on the correct (project, architecture) pair.
 */
export const saveDiscoveryCandidatesRouter = Router();

/**
 * POST /
 *
 * Promotes discovery candidates from a run into the canonical architecture
 * meta-model using a GET-merge-PUT strategy with name-based deduplication
 * and topological parent resolution.
 *
 * Supports two eligibility modes:
 * - 'auto' (default): confidence threshold + status/review_status filtering
 * - 'manual': only review_status === 'approved', ignores confidence
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - architectureId: string (required, UUID v4)
 *   - runId: string (required, UUID v4)
 *   - mode: 'auto' | 'manual' (optional, defaults to 'auto')
 *
 * Response:
 *   - { projectId, runId, entitiesCreated, entitiesSkipped, candidatesCommitted }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveDiscoveryCandidatesRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, runId, mode } = req.body;

      // ====================================================================
      // Request Validation
      // ====================================================================

      // Validate sessionId (required, non-empty string)
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate projectId (required, must match UUID v4 regex)
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Validate architectureId (required, must match UUID v4 regex)
      if (!architectureId || typeof architectureId !== 'string' || !UUID_V4_REGEX.test(architectureId)) {
        throw createHttpError(400, 'architectureId is required and must be a valid UUID');
      }

      // Validate runId (required, must match UUID v4 regex)
      if (!runId || typeof runId !== 'string' || !UUID_V4_REGEX.test(runId)) {
        throw createHttpError(400, 'runId is required and must be a valid UUID');
      }

      // Validate mode (optional, must be 'auto' or 'manual' if provided)
      const resolvedMode: SaveBackMode = mode || 'auto';
      if (!VALID_MODES.includes(resolvedMode)) {
        throw createHttpError(400, `mode must be one of: ${VALID_MODES.join(', ')}`);
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveDiscoveryCandidatesToModel(projectId, architectureId, runId, resolvedMode);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_discovery_candidates_to_model] Success', {
        projectId,
        architectureId,
        runId,
        mode: resolvedMode,
        entitiesCreated: response.entitiesCreated,
        entitiesSkipped: response.entitiesSkipped,
        candidatesCommitted: response.candidatesCommitted,
      });

      res.json(response);
    } catch (error: any) {
      // Handle 400 validation errors
      if (error.statusCode === 400) {
        res.status(400).json({
          error: {
            code: 400,
            message: error.message,
          },
        });
        return;
      }

      // Handle 502 upstream failures
      if (error.statusCode === 502) {
        console.error('[save_discovery_candidates_to_model] Upstream failure', {
          error: error.message,
        });
        res.status(502).json({
          error: {
            code: 502,
            message: error.message,
          },
        });
        return;
      }

      next(error);
    }
  }
);
