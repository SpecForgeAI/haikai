import { Router, Request, Response, NextFunction } from 'express';
import { archModelClient } from '../services/archModelClient';
import { getOrCreateSession, updateSession } from '../services/sessionManager';
import { createHttpError } from '../middleware/errorHandler';
import { computeOasGaps } from '../services/computeOasGaps';
import { ComputeOasGapsRequest } from '../types';

/**
 * Express Router for the compute_oas_gaps MCP tool endpoint.
 * Mounts at /mcp/tools/compute_oas_gaps
 */
export const computeOasGapsRouter = Router();

/**
 * POST /
 *
 * Computes OAS gaps for a given interface.
 *
 * Request body:
 *   - sessionId: string (required)
 *   - interfaceId: string (required)
 *   - draftOas: string (optional, ignored in v1)
 *
 * Response:
 *   - GapReport object
 *
 * Session effects:
 *   - Stores lastSelectedInterfaceId in session
 *
 * Error handling:
 *   - 400 Bad Request: sessionId or interfaceId missing/blank
 *   - 404 Not Found: Interface not found (backend 404)
 *   - 502 Bad Gateway: Backend 5xx or network failure
 */
computeOasGapsRouter.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { sessionId, interfaceId } = req.body as ComputeOasGapsRequest;

      // Validate sessionId (required, non-empty string)
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
        throw createHttpError(400, 'sessionId is required and must be a non-empty string');
      }

      // Validate interfaceId (required, non-empty string)
      if (!interfaceId || typeof interfaceId !== 'string' || interfaceId.trim() === '') {
        throw createHttpError(400, 'interfaceId is required and must be a non-empty string');
      }

      // Get or create session
      getOrCreateSession(sessionId);

      // Fetch interface context from backend
      const context = await archModelClient.getInterfaceOasContext(interfaceId);

      // Compute OAS gaps (deterministic, stateless)
      const gapReport = computeOasGaps(context);

      // Update session with lastSelectedInterfaceId
      updateSession(sessionId, {
        lastSelectedInterfaceId: interfaceId,
      });

      // Return GapReport as JSON response
      res.json(gapReport);
    } catch (error) {
      next(error);
    }
  }
);
