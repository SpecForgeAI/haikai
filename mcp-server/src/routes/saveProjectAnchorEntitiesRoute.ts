import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { saveProjectAnchorEntities } from '../services/anchorEntitiesService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_project_anchor_entities MCP tool endpoint.
 * Mounts at /mcp/tools/save_project_anchor_entities
 */
export const saveProjectAnchorEntitiesRouter = Router();

/**
 * POST /
 *
 * Saves anchor entities (applications and app_components) to the architecture
 * model using a GET-merge-PUT strategy with name-based deduplication.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - applications: Array<{name: string, description: string}> (required)
 *   - appComponents: Array<{name: string, applicationName: string, description: string}> (required)
 *
 * Response:
 *   - { projectId, applicationsCreated, appComponentsCreated }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveProjectAnchorEntitiesRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, applications, appComponents } = req.body;

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

      // Validate applications (required, must be an array)
      if (!Array.isArray(applications)) {
        throw createHttpError(400, 'applications is required and must be an array');
      }

      // Validate appComponents (required, must be an array)
      if (!Array.isArray(appComponents)) {
        throw createHttpError(400, 'appComponents is required and must be an array');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveProjectAnchorEntities(projectId, applications, appComponents);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_project_anchor_entities] Success', {
        projectId,
        applicationsCreated: response.applicationsCreated,
        appComponentsCreated: response.appComponentsCreated,
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
        console.error('[save_project_anchor_entities] Upstream failure', {
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
