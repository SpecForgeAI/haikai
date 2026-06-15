import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveRoadmapStructureRequest } from '../types';
import { saveRoadmapStructure } from '../services/roadmapStructureService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_roadmap_structure MCP tool endpoint.
 * Mounts at /mcp/tools/save_roadmap_structure
 */
export const saveRoadmapStructureRouter = Router();

/**
 * POST /
 *
 * Saves a roadmap structure: persists initiatives and epics as canonical
 * work_items in the architecture model service using an externalRef-first,
 * title-fallback upsert strategy.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - roadmapJson: string (required, valid JSON string)
 *
 * Response:
 *   - { createdInitiatives, updatedInitiatives, createdEpics, updatedEpics, warnings }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields or validation errors
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveRoadmapStructureRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, roadmapJson } = req.body as SaveRoadmapStructureRequest;

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

      // Validate roadmapJson (required, non-empty string)
      if (!roadmapJson || typeof roadmapJson !== 'string' || roadmapJson.trim() === '') {
        throw createHttpError(400, 'roadmapJson is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveRoadmapStructure(projectId, roadmapJson);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_roadmap_structure] Success', {
        projectId,
        createdInitiatives: response.createdInitiatives,
        updatedInitiatives: response.updatedInitiatives,
        createdEpics: response.createdEpics,
        updatedEpics: response.updatedEpics,
      });

      res.json(response);
    } catch (error: any) {
      // Handle 400 validation errors from the service
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
        console.error('[save_roadmap_structure] Upstream failure', {
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
