import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveTemporaryArchitectureDiagramRequest } from '../types/saveTemporaryArchitectureDiagram';
import { saveTemporaryArchitectureDiagram } from '../services/temporaryArchitectureDiagramService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the saveTemporaryArchitectureDiagram MCP tool endpoint.
 * Mounts at /mcp/tools/saveTemporaryArchitectureDiagram
 */
export const saveTemporaryArchitectureDiagramRouter = Router();

/**
 * POST /
 *
 * Saves a temporary architecture diagram: validates the payload and persists
 * it as a temporary diagram resource in the architecture model service.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - diagramJson: string (required, valid JSON string)
 *
 * Response:
 *   - { id, status: "saved", createdAt }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields or validation errors
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveTemporaryArchitectureDiagramRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, architectureId, diagramJson } = req.body as SaveTemporaryArchitectureDiagramRequest;

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

      // Validate architectureId (optional, but must be a valid UUID when present)
      if (architectureId !== undefined && architectureId !== null) {
        if (typeof architectureId !== 'string' || !UUID_V4_REGEX.test(architectureId)) {
          throw createHttpError(400, 'architectureId must be a valid UUID when provided');
        }
      }

      // Validate diagramJson (required, non-empty string)
      if (!diagramJson || typeof diagramJson !== 'string' || diagramJson.trim() === '') {
        throw createHttpError(400, 'diagramJson is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveTemporaryArchitectureDiagram(
        projectId,
        diagramJson,
        architectureId,
      );

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[saveTemporaryArchitectureDiagram] Success', {
        projectId,
        diagramId: response.id,
        status: response.status,
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
        console.error('[saveTemporaryArchitectureDiagram] Upstream failure', {
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
