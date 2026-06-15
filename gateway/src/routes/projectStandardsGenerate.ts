/**
 * Project Standards Generation Route
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 1: Gateway Route for Project Standards Generation
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring - Use implementationLlmProxyClient
 *
 * Provides endpoint for triggering project-level standards generation via the
 * external Standards service, with automatic Bearer authentication.
 *
 * This route:
 * - Accepts project standards request format (company, project, sources)
 * - Proxies POST /generate requests to the external Standards service
 * - Uses postJson from implementationLlmProxyClient for automatic Bearer token injection
 * - Returns opaque error responses (no auth details exposed)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { postJson } from '../services/implementationLlmProxyClient';
import { logger } from '../services/logger';

/** Path to the upstream Project Standards generation endpoint */
const PROJECT_STANDARDS_GENERATE_PATH = '/api/v1/standards/product/generate';

/**
 * Request body for the Gateway project standards generation endpoint.
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Frontend sends company name, project name, and optional sources array.
 */
export interface ProjectStandardsGenerateRequest {
  /** Company name (required, maps to organisation name) */
  company: string;
  /** Project name (required) */
  project: string;
  /** Source URLs or file paths (optional array) */
  sources?: string[];
}

/**
 * Request body format for the external Standards service API.
 * Same as ProjectStandardsGenerateRequest - passed through directly.
 */
interface ExternalProjectStandardsRequest {
  company: string;
  project: string;
  sources: string[];
}

// ============================================================================
// Router
// ============================================================================

export const projectStandardsGenerateRouter = Router();

/**
 * POST /generate - Trigger project standards generation
 *
 * Spec 2026-01-31: Project-level Standards Generation - Task Group 1
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config - Task Group 3
 *
 * This endpoint:
 * - Accepts project standards format (company, project, sources)
 * - Proxies to external Standards service with Bearer auth via implementationLlmProxyClient
 * - Returns appropriate status to frontend for toast decision
 */
projectStandardsGenerateRouter.post(
  '/generate',
  async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    const body = req.body as ProjectStandardsGenerateRequest;

    // Validate required fields
    if (!body.company) {
      logger.warn('Project standards generation request missing company', { requestId });
      return res.status(400).json({ error: 'company is required' });
    }

    if (!body.project) {
      logger.warn('Project standards generation request missing project', { requestId });
      return res.status(400).json({ error: 'project is required' });
    }

    logger.info('Processing project standards generation request', {
      requestId,
      company: body.company,
      project: body.project,
    });

    try {
      // Build external request body
      const externalRequestBody: ExternalProjectStandardsRequest = {
        company: body.company,
        project: body.project,
        sources: body.sources || [],
      };

      // Make the upstream request to the Standards service using postJson
      // Spec 2026-02-01: Use implementationLlmProxyClient for unified auth
      // Note: Gateway path '/generate' maps to upstream path '/api/v1/standards/product/generate'
      const upstreamResponse = await postJson(PROJECT_STANDARDS_GENERATE_PATH, externalRequestBody);

      // Handle upstream authentication failures (401/403)
      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        logger.error('Upstream authentication failed', {
          requestId,
          status: upstreamResponse.status,
        });
        // Return 502 - do not expose auth details
        return res.status(502).json({ error: 'Upstream authentication failed' });
      }

      // Handle success (200/201) - project standards don't need flag updates
      if (upstreamResponse.ok) {
        logger.info('Project standards generation successful', {
          requestId,
          company: body.company,
          project: body.project,
          upstreamStatus: upstreamResponse.status,
        });

        // Return success to frontend
        return res.status(200).json({
          success: true,
          message: 'Project standards generated successfully',
        });
      }

      // Handle other non-success responses from upstream
      logger.error('Upstream returned error status', {
        requestId,
        status: upstreamResponse.status,
      });

      // Try to get error details from response
      let errorMessage = 'Project standards generation failed';
      try {
        const errorBody = await upstreamResponse.json();
        if (errorBody.error || errorBody.message) {
          errorMessage = errorBody.error || errorBody.message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      // Return 502 for upstream errors
      return res.status(502).json({ error: errorMessage });

    } catch (error) {
      // Handle errors based on type
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorName = error instanceof Error ? error.name : 'Unknown';

      // Check if this is a token configuration error
      // Spec 2026-02-01: Updated error message to match new client
      if (errorMessage.includes('Implementation LLM Service Bearer token is not configured')) {
        logger.error('Project standards generation failed: token not configured', {
          requestId,
        });
        // Return generic 500 - do NOT expose token absence to frontend
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Network errors, timeouts, and other failures
      logger.error('Project standards generation failed', {
        requestId,
        error: errorMessage,
        errorName,
      });

      // Return 503 for service unavailability (network, timeout, etc.)
      return res.status(503).json({ error: 'Standards service unavailable' });
    }
  }
);
