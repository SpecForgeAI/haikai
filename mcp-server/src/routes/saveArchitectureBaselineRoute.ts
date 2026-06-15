import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveArchitectureBaselineRequest } from '../types';
import { saveArchitectureBaseline } from '../services/architectureBaselineService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_architecture_baseline MCP tool endpoint.
 * Mounts at /mcp/tools/save_architecture_baseline
 */
export const saveArchitectureBaselineRouter = Router();

/**
 * POST /
 *
 * Saves an architecture baseline: persists services, interfaces, endpoints,
 * data entities, business logic, and data movements into the architecture model
 * using a GET-merge-PUT strategy that preserves existing model data.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - architectureBaselineJson: string (required, valid JSON string)
 *
 * Response:
 *   - { success, projectId, filename, summary, createdEntities }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields or validation errors
 *   - 502 Bad Gateway: Upstream PUT failure
 */
saveArchitectureBaselineRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        sessionId,
        projectId,
        architectureBaselineJson,
      } = req.body as SaveArchitectureBaselineRequest;

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

      // Validate architectureBaselineJson (required, non-empty string)
      if (!architectureBaselineJson || typeof architectureBaselineJson !== 'string' || architectureBaselineJson.trim() === '') {
        throw createHttpError(400, 'architectureBaselineJson is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveArchitectureBaseline(projectId, architectureBaselineJson);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_architecture_baseline] Success', {
        projectId,
        filename: response.filename,
        summary: response.summary,
      });

      res.json(response);
    } catch (error: any) {
      // Handle validation errors (400) from the service with structured error response
      if (error.statusCode === 400 && error.message) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.errors) {
            res.status(400).json(parsed);
            return;
          }
        } catch (_) {
          // Not a JSON error message, fall through to next(error)
        }
      }

      // Handle upstream failures (502) from the service
      if (error.statusCode === 502) {
        console.error('[save_architecture_baseline] Upstream failure', {
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
