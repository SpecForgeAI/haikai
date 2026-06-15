import { Router, Request, Response, NextFunction } from 'express';
import { archModelClient } from '../services/archModelClient';
import { getOrCreateSession, updateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { SaveOasSpecRequest } from '../types';

/**
 * Express Router for the save_oas_spec MCP tool endpoint.
 * Mounts at /mcp/tools/save_oas_spec
 */
export const saveOasSpecRouter = Router();

/**
 * POST /
 *
 * Saves an OpenAPI specification for a given interface.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - filename: string (required)
 *   - interfaceId: string (required)
 *   - format: string (required, 'yaml' or 'json')
 *   - oasContents: string (required)
 *
 * Response:
 *   - SaveOasSpecSummaryDto object
 *
 * Session effects:
 *   - Stores filename and lastSelectedInterfaceId in session
 *
 * Error handling:
 *   - 400 Bad Request: Missing/invalid required fields
 *   - 404 Not Found: Interface or filename not found (backend 404)
 *   - 502 Bad Gateway: Backend 5xx or network failure
 */
saveOasSpecRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, filename, interfaceId, format, oasContents } = req.body as SaveOasSpecRequest;

      // Validate sessionId (required, non-empty string)
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate filename (required, non-empty string)
      if (!filename || typeof filename !== 'string' || filename.trim() === '') {
        throw createHttpError(400, 'filename is required and must be a non-empty string');
      }

      // Validate interfaceId (required, non-empty string)
      if (!interfaceId || typeof interfaceId !== 'string' || interfaceId.trim() === '') {
        throw createHttpError(400, 'interfaceId is required and must be a non-empty string');
      }

      // Validate format (required, must be 'yaml' or 'json')
      if (!format || typeof format !== 'string' || format.trim() === '') {
        throw createHttpError(400, 'format is required and must be a non-empty string');
      }
      const normalizedFormat = format.toLowerCase().trim();
      if (normalizedFormat !== 'yaml' && normalizedFormat !== 'json') {
        throw createHttpError(400, "format must be 'yaml' or 'json'");
      }

      // Validate oasContents (required, non-empty string)
      if (!oasContents || typeof oasContents !== 'string' || oasContents.trim() === '') {
        throw createHttpError(400, 'oasContents is required and must be a non-empty string');
      }

      // Get or create session
      getOrCreateSession(sessionId);

      // Call backend service
      const summary = await archModelClient.saveOasSpec(
        interfaceId,
        filename,
        normalizedFormat,
        oasContents
      );

      // Update session with filename and lastSelectedInterfaceId
      updateSession(sessionId, {
        filename,
        lastSelectedInterfaceId: interfaceId,
      });

      // Return response with appropriate status code
      // Note: Express returns 200 by default; the backend already determines created flag
      // The MCP layer passes through the result; clients can check the created flag
      const statusCode = summary.created ? 201 : 200;
      res.status(statusCode).json(summary);
    } catch (error) {
      next(error);
    }
  }
);
