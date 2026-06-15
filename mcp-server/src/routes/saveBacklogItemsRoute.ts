import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveBacklogItemsRequest } from '../types/saveBacklogItems';
import { saveBacklogItems } from '../services/backlogItemsService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_backlog_items MCP tool endpoint.
 * Mounts at /mcp/tools/save_backlog_items
 */
export const saveBacklogItemsRouter = Router();

/**
 * POST /
 *
 * Saves backlog items: persists features and stories as canonical
 * work_items under a specific epic in the architecture model service
 * using an externalRef-first, title-fallback upsert strategy.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - backlogJson: string (required, valid JSON string)
 *
 * Response:
 *   - { createdFeatures, updatedFeatures, createdStories, updatedStories, updatedEpicPriorities, warnings }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields or validation errors
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveBacklogItemsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, backlogJson } = req.body as SaveBacklogItemsRequest;

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

      // Validate backlogJson (required, non-empty string)
      if (!backlogJson || typeof backlogJson !== 'string' || backlogJson.trim() === '') {
        throw createHttpError(400, 'backlogJson is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveBacklogItems(projectId, backlogJson);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_backlog_items] Success', {
        projectId,
        createdFeatures: response.createdFeatures,
        updatedFeatures: response.updatedFeatures,
        createdStories: response.createdStories,
        updatedStories: response.updatedStories,
        deletedWorkItems: response.deletedWorkItems,
        updatedEpicPriorities: response.updatedEpicPriorities,
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
        console.error('[save_backlog_items] Upstream failure', {
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
