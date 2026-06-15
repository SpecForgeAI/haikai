import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveUserJourneysRequest } from '../types';
import { saveUserJourneys } from '../services/userJourneysService';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const saveUserJourneysRouter = Router();

/**
 * POST /
 *
 * Saves user journeys and activity steps: persists them into the architecture
 * model using a GET-merge-PUT strategy that preserves existing model data.
 * Performs name-to-ID resolution and upsert with CREATED/UPDATED reporting.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - userJourneysJson: string (required, valid JSON string)
 */
saveUserJourneysRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        sessionId,
        projectId,
        userJourneysJson,
      } = req.body as SaveUserJourneysRequest;

      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate projectId
      if (!projectId || typeof projectId !== 'string' || !UUID_V4_REGEX.test(projectId)) {
        throw createHttpError(400, 'projectId is required and must be a valid UUID');
      }

      // Validate userJourneysJson
      if (!userJourneysJson || typeof userJourneysJson !== 'string' || userJourneysJson.trim() === '') {
        throw createHttpError(400, 'userJourneysJson is required and must be a non-empty string');
      }

      getOrCreateSession(sessionId);

      const response = await saveUserJourneys(projectId, userJourneysJson);

      console.log('[save_user_journeys] Success', {
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
        console.error('[save_user_journeys] Upstream failure', {
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
