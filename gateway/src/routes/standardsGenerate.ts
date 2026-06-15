/**
 * Standards Generation Route
 *
 * Provides endpoint for triggering global standards generation via the
 * external Standards service, with automatic Bearer authentication and
 * backend PATCH orchestration.
 *
 * Spec 2026-01-31: Trigger Global Standards Generation
 * Task Group 3: Gateway Standards Service Client and Route
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow
 * Task Group 4: Gateway Standards Route - Resolve Org by Name
 *
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config
 * Task Group 3: Route Refactoring - Use implementationLlmProxyClient
 *
 * This route:
 * - Accepts external-compatible format directly (company, sources, technical_documents)
 * - Proxies POST /generate requests to the external Standards service
 * - Uses postJson from implementationLlmProxyClient for automatic Bearer token injection
 * - On success: resolves organisationId by company name, then PATCH
 * - Returns opaque error responses (no auth details exposed)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { postJson } from '../services/implementationLlmProxyClient';
import { getConfig } from '../config';
import { logger } from '../services/logger';

/** Path to the upstream Standards generation endpoint */
const STANDARDS_GENERATE_PATH = '/api/v1/standards/global/generate';

/**
 * Request body for the Gateway standards generation endpoint.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 4
 * Frontend sends in external-compatible format directly (no organisationId).
 * Gateway resolves organisationId by company name after successful generation.
 */
export interface StandardsGenerateRequest {
  /** Company name (required, maps to organisation name) */
  company: string;
  /** Documents applied to all sources */
  sources: string[];
  /** Technical documents with snake_case keys */
  technical_documents: {
    tech_stack: string[];
    coding_style: string[];
    conventions: string[];
    error_handling: string[];
    validation: string[];
  };
}

/**
 * Request body format for the external Standards service API.
 * Same as StandardsGenerateRequest - frontend sends in external format.
 */
interface ExternalStandardsRequest {
  company: string;
  sources: string[];
  technical_documents: {
    tech_stack: string[];
    coding_style: string[];
    conventions: string[];
    error_handling: string[];
    validation: string[];
  };
}

/**
 * Response from organisation lookup by name.
 */
interface OrganisationDto {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Looks up an organisation by its exact name.
 *
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 4
 * Calls GET /api/v1/organisations/by-name/{name} to resolve organisationId.
 *
 * @param companyName - The organisation/company name to lookup
 * @returns Promise resolving to organisation ID if found, null if not found or error
 */
async function lookupOrganisationByName(companyName: string): Promise<string | null> {
  const config = getConfig();
  // URL-encode the company name for the path
  const encodedName = encodeURIComponent(companyName);
  const lookupUrl = `${config.architectureModelServiceBaseUrl}/api/v1/organisations/by-name/${encodedName}`;

  try {
    const response = await fetch(lookupUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const org: OrganisationDto = await response.json();
      logger.info('Successfully looked up organisation by name', {
        companyName,
        organisationId: org.id,
      });
      return org.id;
    } else {
      logger.warn('Organisation lookup by name failed', {
        companyName,
        status: response.status,
      });
      return null;
    }
  } catch (error) {
    logger.error('Error looking up organisation by name', {
      companyName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Calls the backend PATCH endpoint to update techStandardsGenerated flag.
 *
 * @param organisationId - The organisation ID to update
 * @param techStandardsGenerated - The value to set for the flag
 * @returns Promise resolving to true on success, false on failure
 */
async function patchOrganisationFlag(
  organisationId: string,
  techStandardsGenerated: boolean
): Promise<boolean> {
  const config = getConfig();
  const backendUrl = `${config.architectureModelServiceBaseUrl}/api/v1/organisations/${organisationId}`;

  try {
    const response = await fetch(backendUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tech_standards_generated: techStandardsGenerated,
      }),
    });

    if (response.ok) {
      logger.info('Successfully updated organisation techStandardsGenerated flag', {
        organisationId,
        techStandardsGenerated,
      });
      return true;
    } else {
      logger.error('Failed to update organisation flag', {
        organisationId,
        status: response.status,
      });
      return false;
    }
  } catch (error) {
    logger.error('Error calling backend PATCH endpoint', {
      organisationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

// ============================================================================
// Router
// ============================================================================

export const standardsGenerateRouter = Router();

/**
 * POST /generate - Trigger global standards generation
 *
 * Spec 2026-01-31: Trigger Global Standards Generation - Task Group 3
 * Spec 2026-01-31: Fix Create Organisation Standards Flow - Task Group 4
 * Spec 2026-02-01: Unify Implementation LLM Proxy Service Config - Task Group 3
 *
 * This endpoint:
 * - Accepts external-compatible format directly (company, sources, technical_documents)
 * - Proxies to external Standards service with Bearer auth via implementationLlmProxyClient
 * - On success (200/201): resolves organisationId by company name, then PATCH
 * - Returns appropriate status to frontend for toast decision
 */
standardsGenerateRouter.post(
  '/generate',
  async (req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId || 'unknown';
    const body = req.body as StandardsGenerateRequest;

    // Validate required fields - new format uses 'company' instead of 'name'
    if (!body.company) {
      logger.warn('Standards generation request missing company', { requestId });
      return res.status(400).json({ error: 'company is required' });
    }

    logger.info('Processing standards generation request', {
      requestId,
      company: body.company,
    });

    try {
      // Request is already in external format - pass through directly
      const externalRequestBody: ExternalStandardsRequest = {
        company: body.company,
        sources: body.sources || [],
        technical_documents: body.technical_documents || {
          tech_stack: [],
          coding_style: [],
          conventions: [],
          error_handling: [],
          validation: [],
        },
      };

      // Make the upstream request to the Standards service using postJson
      // Spec 2026-02-01: Use implementationLlmProxyClient for unified auth
      const upstreamResponse = await postJson(STANDARDS_GENERATE_PATH, externalRequestBody);

      // Handle upstream authentication failures (401/403)
      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        logger.error('Upstream authentication failed', {
          requestId,
          status: upstreamResponse.status,
        });
        // Return 502 - do not expose auth details
        return res.status(502).json({ error: 'Upstream authentication failed' });
      }

      // Handle success (200/201) - resolve org by name, then orchestrate backend PATCH
      if (upstreamResponse.ok) {
        logger.info('Standards generation successful, resolving organisation and updating flag', {
          requestId,
          company: body.company,
          upstreamStatus: upstreamResponse.status,
        });

        // Resolve organisationId by company name
        const organisationId = await lookupOrganisationByName(body.company);

        if (organisationId) {
          // Orchestrate backend PATCH to set techStandardsGenerated=true
          const patchSuccess = await patchOrganisationFlag(organisationId, true);

          if (patchSuccess) {
            // Return success to frontend
            return res.status(200).json({
              success: true,
              message: 'Standards generated successfully',
            });
          } else {
            // Standards generated but flag update failed
            // Still return success to frontend - the standards are generated
            logger.warn('Standards generated but flag update failed', {
              requestId,
              organisationId,
            });
            return res.status(200).json({
              success: true,
              message: 'Standards generated successfully',
              flagUpdateFailed: true,
            });
          }
        } else {
          // Organisation lookup failed - still return success (standards were generated)
          logger.warn('Standards generated but organisation lookup failed', {
            requestId,
            company: body.company,
          });
          return res.status(200).json({
            success: true,
            message: 'Standards generated successfully',
            flagUpdateFailed: true,
          });
        }
      }

      // Handle other non-success responses from upstream
      logger.error('Upstream returned error status', {
        requestId,
        status: upstreamResponse.status,
      });

      // Try to get error details from response
      let errorMessage = 'Standards generation failed';
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
        logger.error('Standards generation failed: token not configured', {
          requestId,
        });
        // Return generic 500 - do NOT expose token absence to frontend
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Network errors, timeouts, and other failures
      logger.error('Standards generation failed', {
        requestId,
        error: errorMessage,
        errorName,
      });

      // Return 503 for service unavailability (network, timeout, etc.)
      return res.status(503).json({ error: 'Standards service unavailable' });
    }
  }
);
