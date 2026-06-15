import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveUsersInteractionsRequest } from '../types';
import { saveUsersInteractions } from '../services/usersInteractionsService';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const saveUsersInteractionsRouter = Router();

/**
 * POST /
 *
 * Saves users & interactions: persists business users, business processes,
 * process activities, and UI screens into the architecture model using a
 * GET-merge-PUT strategy that preserves existing model data.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - usersInteractionsJson: string (required, valid JSON string)
 */
saveUsersInteractionsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        sessionId,
        projectId,
        usersInteractionsJson,
      } = req.body as SaveUsersInteractionsRequest;

      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate projectId
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Validate usersInteractionsJson
      if (!usersInteractionsJson || typeof usersInteractionsJson !== 'string' || usersInteractionsJson.trim() === '') {
        throw createHttpError(400, 'usersInteractionsJson is required and must be a non-empty string');
      }

      getOrCreateSession(sessionId);

      const response = await saveUsersInteractions(projectId, usersInteractionsJson);

      console.log('[save_users_interactions] Success', {
        projectId,
        filename: response.filename,
        summary: response.summary,
      });

      res.json(response);
    } catch (error: any) {
      if (error.statusCode === 400 && error.message) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.errors) {
            res.status(400).json(parsed);
            return;
          }
        } catch (_) {
          // Not a JSON error message, fall through
        }
      }

      if (error.statusCode === 502) {
        console.error('[save_users_interactions] Upstream failure', {
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
