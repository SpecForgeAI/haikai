import { Router, Request, Response, NextFunction } from 'express';
import { getOrCreateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveDiscoveryConfigRequest } from '../types/saveDiscoveryConfig';
import { saveDiscoveryConfig } from '../services/discoveryConfigService';

/**
 * UUID v4 regex pattern for projectId validation
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Express Router for the save_discovery_config MCP tool endpoint.
 * Mounts at /mcp/tools/save_discovery_config
 */
export const saveDiscoveryConfigRouter = Router();

/**
 * POST /
 *
 * Saves a discovery config: validates the payload and persists
 * it as a discovery config resource in the architecture model service.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - projectId: string (required, UUID v4)
 *   - discoveryConfigJson: string (required, valid JSON string)
 *
 * Response:
 *   - { projectId, status }
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields or validation errors
 *   - 502 Bad Gateway: Upstream communication failure
 */
saveDiscoveryConfigRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, projectId, discoveryConfigJson } = req.body as SaveDiscoveryConfigRequest;

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

      // Validate discoveryConfigJson (required, non-empty string)
      if (!discoveryConfigJson || typeof discoveryConfigJson !== 'string' || discoveryConfigJson.trim() === '') {
        throw createHttpError(400, 'discoveryConfigJson is required and must be a non-empty string');
      }

      // ====================================================================
      // Session Management
      // ====================================================================

      getOrCreateSession(sessionId);

      // ====================================================================
      // Delegate to Service
      // ====================================================================

      const response = await saveDiscoveryConfig(projectId, discoveryConfigJson);

      // ====================================================================
      // Success Response
      // ====================================================================

      console.log('[save_discovery_config] Success', {
        projectId,
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
        console.error('[save_discovery_config] Upstream failure', {
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
