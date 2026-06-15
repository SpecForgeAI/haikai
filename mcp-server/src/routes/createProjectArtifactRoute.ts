import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { archModelClient } from '../services/archModelClient';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the create_project_artifact MCP tool endpoint.
 * Mounts at /mcp/tools/create_project_artifact
 */
export const createProjectArtifactRouter = Router();

/**
 * POST /
 *
 * Creates a project artifact via the architecture-model-service.
 * Delegates to archModelClient.createProjectArtifact.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - artifactType: string (required, non-empty)
 *   - content: string (required, non-empty)
 *   - source: string (required, non-empty)
 *
 * Response:
 *   - The created artifact response from the architecture-model-service
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 502 Bad Gateway: Upstream communication failure
 */
createProjectArtifactRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, artifactType, content, source } = req.body;

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

      // Validate artifactType (required, non-empty string)
      if (!artifactType || typeof artifactType !== 'string' || artifactType.trim() === '') {
        throw createHttpError(400, 'artifactType is required and must be a non-empty string');
      }

      // Validate content (required, non-empty string)
      if (!content || typeof content !== 'string' || content.trim() === '') {
        throw createHttpError(400, 'content is required and must be a non-empty string');
      }

      // Validate source (required, non-empty string)
      if (!source || typeof source !== 'string' || source.trim() === '') {
        throw createHttpError(400, 'source is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to archModelClient
      // ====================================================================

      const response = await archModelClient.createProjectArtifact(
        projectId,
        artifactType,
        content,
        source
      );

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[create_project_artifact] Success', {
        projectId,
        artifactType,
        source,
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
        console.error('[create_project_artifact] Upstream failure', {
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
