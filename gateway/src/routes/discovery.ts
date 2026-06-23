/**
 * Discovery Route
 *
 * Provides a capability descriptor endpoint and proxy routes for the discovery service.
 *
 * Spec 2026-04-04: Legacy Discovery Capability Skeleton
 * Task Group 5: Minimal Gateway Awareness
 *
 * Spec 2026-04-04: Discovery Run Model and Orchestration
 * Task Group 6: Gateway Proxy Routes for Discovery Runs
 * - POST /runs proxies to discovery-service POST /discovery/runs
 * - POST /runs/:runId/resume proxies to discovery-service POST /discovery/runs/:runId/resume
 * - GET /runs/:runId proxies to discovery-service GET /discovery/runs/:runId
 *
 * Spec 2026-04-05: Discovery Results Visibility (Dashboard + Meta-Model)
 * Task Group 2: Gateway Proxy Routes for Discovery Read Endpoints
 * - GET /projects/:projectId/architectures/:architectureId/runs proxies to architecture-model-service list-runs
 * - GET /projects/:projectId/architectures/:architectureId/runs/:runId proxies to architecture-model-service get-run
 * - GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidates proxies with optional type/status query params
 * - GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/count proxies to count endpoint
 * - GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidate-entity-mappings proxies to mappings endpoint
 * - GET /projects/:projectId/architectures/:architectureId/summary proxies to discovery summary endpoint
 * - GET /projects/:projectId/architectures/:architectureId/entity-origins proxies to entity-origins endpoint
 *
 * Spec 2026-04-05: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 4: Gateway Proxy Routes for Review and Save-Approved
 * - PATCH /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/:candidateId/review proxies to architecture-model-service
 * - POST /projects/:projectId/architectures/:architectureId/runs/:runId/save-approved proxies to MCP server save_approved_candidates
 *
 * Spec 2026-04-05: Log-based Discovery Enrichment (Increment 14)
 * Task Group 6: Gateway Proxy Routes for Log Enrichment and Reprocessing
 * - POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-enrichment proxies to discovery-service POST /discovery/log-enrichment
 * - POST /projects/:projectId/architectures/:architectureId/runs/:runId/reprocess proxies to discovery-service POST /discovery/reprocess
 *
 * Spec 2026-04-06: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 4: Gateway Proxy Routes for Orphan Detection and Cleanup
 * - GET /projects/:projectId/architectures/:architectureId/orphans proxies to architecture-model-service GET /discovery/orphans
 * - POST /projects/:projectId/architectures/:architectureId/cleanup proxies to architecture-model-service POST /discovery/cleanup
 *
 * Task Group 6: Gateway Proxy Route for Diagnostics Endpoint
 * - GET /projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics proxies to discovery-service GET /discovery/runs/:runId/diagnostics
 *
 * Spec 2026-05-01: Multi-Architecture Discovery Integration (Spec #4) -- Task Group 3
 *  Every Discovery proxy that previously addressed a project (i.e. carried
 *  `:projectId` in the URL) now also embeds `:architectureId` between
 *  `:projectId` and the rest of the path. Forgetting `:architectureId`
 *  produces a 404 at the Express layer (no fallback / no silent
 *  default-resolution) -- mirrors the architecture-model-service backend's
 *  path-segment safety property (b).
 *  Downstream URLs to architecture-model-service embed `:architectureId`
 *  between `/projects/{projectId}/` and `/discovery/...` to match the
 *  Group 2 controller refactor. Downstream URLs to discovery-service add
 *  `architectureId` alongside `projectId` (query param or body field,
 *  matching the existing convention of each route) so Group 4 can pick it
 *  up without further gateway changes.
 *  The bare `/runs`, `/runs/:runId/...` proxies (no `:projectId` in the
 *  gateway URL) are deferred to Group 4, which will refactor the
 *  discovery-service route shape; this group only updates routes that
 *  already carried `:projectId`.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import { ArchitectureModelHttpError } from '../services/architectureModelClient';
import {
  writeLogFilesAndPatchRun,
  InvalidFileNameError,
  DiskWriteError,
  ProjectFolderResolutionError,
} from '../services/discoveryRunLogService';

export const discoveryRouter = Router();

/**
 * GET /
 * Returns the discovery capability descriptor.
 *
 * Response: { capability: 'discovery', status: 'registered', version: '0.1.0' }
 */
discoveryRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    capability: 'discovery',
    status: 'registered',
    version: '0.1.0',
  });
});

// ============================================================================
// Spec 2026-04-04: Discovery Run Proxy Routes (Task Group 6) +
// Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) -- Task Group 4
//
// All run proxies now carry :projectId AND :architectureId in the gateway URL
// AND in the downstream discovery-service URL. The discovery-service mounts
// its runs router at
//   /discovery/projects/:projectId/architectures/:architectureId/runs/...
// (see discovery-service/src/routes/index.ts) so forgetting :architectureId
// 404s at the Express layer of either service.
// ============================================================================

/**
 * POST /projects/:projectId/architectures/:architectureId/runs
 * Proxies run creation requests to the discovery-service. The
 * `:architectureId` segment is the run's bound architecture (picked at
 * run start by the user). Forwards { serviceId?, confirmLlmSolo? } from
 * the body untouched -- projectId and architectureId travel only via the
 * URL.
 *
 * Backend: POST {discoveryServiceBaseUrl}/discovery/projects/:projectId/architectures/:architectureId/runs
 *
 * Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 4.
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    const body = req.body;

    logger.info('Processing discovery run creation proxy request', {
      requestId,
      projectId,
      architectureId,
      serviceId: body?.serviceId || null,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs`;
      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify(body),
      });

      // Parse response body
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery run creation proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
        serviceId: body?.serviceId || null,
      });

      // Forward response transparently (including error status codes like 400, 409)
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery run creation proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery run creation proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/resume
 * Proxies run resume requests to the discovery-service.
 *
 * Accepts { fromStep } in request body and forwards to
 * discovery-service POST /discovery/projects/:projectId/architectures/:architectureId/runs/:runId/resume.
 * The discovery-service rejects the request with 409 if the URL
 * `:architectureId` does not match the run's stored bound id (defence in
 * depth -- spec #4 Group 4).
 *
 * On success, forwards the response body and status code transparently.
 * On network error, returns 503 with structured error.
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/resume', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    const body = req.body;

    logger.info('Processing discovery run resume proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
      fromStep: body?.fromStep,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/resume`;
      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify(body),
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery run resume proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery run resume proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery run resume proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/rescore
 * Proxies a re-scoring request to the discovery-service. Mirrors the
 * `/resume` proxy pattern.
 *
 * Forwards to discovery-service
 *   POST /discovery/projects/:projectId/architectures/:architectureId/runs/:runId/rescore
 * which defensively checks the URL `:architectureId` against the run's
 * stored bound id (mismatch -> 409). The discovery-service synchronously
 * runs `scoreRun()` and returns the result; the proxy passes the
 * response through transparently.
 *
 * On network error, returns 503.
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/rescore', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();
    const body = req.body;

    logger.info('Processing discovery run rescore proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/rescore`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      logger.info('Discovery run rescore proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      logger.error('Discovery run rescore proxy request failed', { requestId, projectId, architectureId, runId, error: errorMessage });
      return res.status(503).json({ error: { code: 503, message: 'Discovery service unavailable' } });
    }
  } catch (error) {
    logger.error('Discovery run rescore proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({ error: { code: 500, message: 'Internal server error' } });
  }
});

// NOTE: The bare GET /runs/:runId proxy (which forwarded to discovery-service)
// was removed by Spec #4 Task Group 4. The architecture-scoped
// GET /projects/:projectId/architectures/:architectureId/runs/:runId proxy
// (further down in this file) proxies directly to architecture-model-service
// and is the canonical run-fetch route -- discovery-service's GET /:runId
// itself only calls archModelClient.getDiscoveryRun, so the gateway can
// shortcut straight to architecture-model-service.

// ============================================================================
// Spec 2026-04-05: Discovery Results Visibility -- Read Proxy Routes (Task Group 2)
// + Spec 2026-05-01 Multi-Architecture Discovery Integration -- Task Group 3
//
// These routes proxy to the architecture-model-service (not discovery-service)
// because they read persisted data from the canonical model database.
//
// Every URL embeds `:architectureId` between `:projectId` and the resource
// path -- omitting the segment 404s at the Express layer.
// ============================================================================

/**
 * GET /projects/:projectId/architectures/:architectureId/runs
 * Proxies to architecture-model-service to list discovery runs for a
 * project filtered by architecture.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery list-runs proxy request', {
      requestId,
      projectId,
      architectureId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery list-runs proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery list-runs proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery list-runs proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});


// ============================================================================
// Spec 2026-04-06: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
// Task Group 6: Gateway Proxy Route for Diagnostics Endpoint
//
// NOTE: This route MUST be registered before /projects/:projectId/architectures/:architectureId/runs/:runId
// to prevent "diagnostics" from being captured as a runId-level sub-resource
// by the more general run detail route.
// ============================================================================

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics
 * Proxies to discovery-service to get run diagnostics (stepsPayload with timing and counts).
 *
 * Backend: GET {discoveryServiceBaseUrl}/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics
 *
 * Spec #4 Group 4 reshaped the downstream URL to embed projectId and
 * architectureId as path segments; the discovery-service routes router
 * is mounted at /discovery/projects/:projectId/architectures/:architectureId/runs.
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('Processing discovery diagnostics proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/diagnostics`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery diagnostics proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery diagnostics proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery diagnostics proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});
/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *       [?secondRunId=<run-id>]
 *
 * Spec 1 — Deterministic Review Model + Cascade/Dependency Graph + Aggregation
 * Backbone (Task Group 5). Pure proxy to the discovery-service review-model
 * endpoint (NOT architecture-model-service — discovery-service COMPUTES the
 * model live on read from AMS candidates + findings). Forwards the scan
 * selection (the primary run id in the path + the FULL additional-run-id set as
 * repeated secondRunId query params -- per-service scan selection,
 * `2026-06-05-per-service-scan-selection`), passes status + JSON body through
 * verbatim, and returns 503 on a downstream network error. The gateway applies
 * NO run-count cap; the discovery-service is the sole validator. snake_case on
 * the wire.
 *
 * Backend: GET {discoveryServiceBaseUrl}/discovery/projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *
 * NOTE: registered BEFORE the catch-all `/:runId` GET so `review-model` is never
 * captured as part of the runId.
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId/review-model', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('Processing discovery review-model proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
      secondRunId: (req.query.secondRunId as string | undefined) || null,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      let url = `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}/review-model`;

      // Forward the FULL additional-run-id set as repeated secondRunId query
      // params (per-service scan selection -- N runs beyond the primary). The
      // array is forwarded verbatim with NO >2 cap at the gateway; the
      // discovery-service review-model route is the sole run-set validator.
      const queryParams: string[] = [];
      const rawSecond = req.query.secondRunId;
      if (Array.isArray(rawSecond)) {
        for (const v of rawSecond) {
          queryParams.push(`secondRunId=${encodeURIComponent(String(v))}`);
        }
      } else if (typeof rawSecond === 'string' && rawSecond.length > 0) {
        queryParams.push(`secondRunId=${encodeURIComponent(rawSecond)}`);
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery review-model proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery review-model proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery review-model proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId
 * Proxies to architecture-model-service to get a specific discovery run.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery get-run proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery get-run proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery get-run proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery get-run proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * DELETE /projects/:projectId/architectures/:architectureId/runs/:runId
 * Proxies to architecture-model-service to delete a discovery run and all of
 * its child data. Powers the Discovery Runs UI right-click "Delete" action.
 *
 * Backend: DELETE {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId
 * Responds 204 on success, 404 when the run is not found in this architecture.
 */
discoveryRouter.delete('/projects/:projectId/architectures/:architectureId/runs/:runId', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery delete-run proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' },
      });

      logger.info('Discovery delete-run proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      // 204 No Content carries no body -- forward the status verbatim without a
      // JSON parse. Any non-204 (e.g. 404 with an error envelope) is relayed
      // with whatever body the backend sent.
      if (response.status === 204) {
        return res.status(204).send();
      }
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery delete-run proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery delete-run proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/count
 * Proxies to architecture-model-service to get candidate count for a run.
 *
 * NOTE: This route MUST be registered before /candidates to avoid :runId/candidates/count
 * being matched as /candidates with a trailing path segment.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates/count
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/count', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery candidate-count proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/count`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery candidate-count proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery candidate-count proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery candidate-count proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidates
 * Proxies to architecture-model-service to list candidates for a discovery run.
 * Forwards optional `type` and `status` query parameters.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates[?type=X&status=Y]
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId/candidates', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery list-candidates proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      let url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates`;

      // Forward optional type and status query parameters
      const queryParams: string[] = [];
      if (req.query.type) {
        queryParams.push(`type=${encodeURIComponent(req.query.type as string)}`);
      }
      if (req.query.status) {
        queryParams.push(`status=${encodeURIComponent(req.query.status as string)}`);
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery list-candidates proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery list-candidates proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery list-candidates proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/candidate-entity-mappings
 * Proxies to architecture-model-service to list candidate-entity mappings for a run.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidate-entity-mappings
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/runs/:runId/candidate-entity-mappings', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery candidate-entity-mappings proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidate-entity-mappings`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery candidate-entity-mappings proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery candidate-entity-mappings proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery candidate-entity-mappings proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/summary
 * Proxies to architecture-model-service to get the discovery summary for a project + architecture.
 * Returns DiscoverySummaryDto with latest run info, candidate counts, and coverage metrics.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/summary
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/summary', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery summary proxy request', {
      requestId,
      projectId,
      architectureId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/summary`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery summary proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery summary proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery summary proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/entity-origins
 * Proxies to architecture-model-service to get discovery entity-origin mappings
 * for a project + architecture.
 * Returns all candidate-entity-mappings across all runs in the architecture,
 * used for "Discovered" badge display.
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/entity-origins
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/entity-origins', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery entity-origins proxy request', {
      requestId,
      projectId,
      architectureId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/entity-origins`;

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery entity-origins proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery entity-origins proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery entity-origins proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

// ============================================================================
// Spec 2026-04-06: Discovery Refinement (Increment 16)
// Task Group 4: Gateway Proxy Routes for Orphan Detection and Cleanup
//
// GET orphans route proxies to architecture-model-service orphan detection endpoint.
// POST cleanup route proxies to architecture-model-service cleanup endpoint.
// ============================================================================

/**
 * GET /projects/:projectId/architectures/:architectureId/orphans
 * Proxies to architecture-model-service to detect orphaned discovery data
 * for a project + architecture.
 * Forwards optional `staleDays` query parameter (default 30).
 *
 * Backend: GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/orphans?staleDays=30
 */
discoveryRouter.get('/projects/:projectId/architectures/:architectureId/orphans', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery orphans proxy request', {
      requestId,
      projectId,
      architectureId,
    });

    const proxyHeaders: Record<string, string> = {
      'Accept': 'application/json',
    };

    try {
      let url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/orphans`;

      // Forward optional staleDays query parameter
      if (req.query.staleDays) {
        url += `?staleDays=${encodeURIComponent(req.query.staleDays as string)}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery orphans proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery orphans proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery orphans proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/cleanup
 * Proxies to architecture-model-service to clean up orphaned discovery data
 * for a project + architecture.
 * Forwards optional `staleDays` query parameter (default 30).
 *
 * Backend: POST {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/cleanup?staleDays=30
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/cleanup', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery cleanup proxy request', {
      requestId,
      projectId,
      architectureId,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      let url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/cleanup`;

      // Forward optional staleDays query parameter
      if (req.query.staleDays) {
        url += `?staleDays=${encodeURIComponent(req.query.staleDays as string)}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery cleanup proxy request completed', {
        requestId,
        projectId,
        architectureId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery cleanup proxy request failed', {
        requestId,
        projectId,
        architectureId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery cleanup proxy error', {
      requestId,
      projectId,
      architectureId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

// ============================================================================
// Spec 2026-04-05: Candidate Review and Approval Workflow (Increment 13)
// Task Group 4: Gateway Proxy Routes for Review and Save-Approved
//
// PATCH review route proxies to architecture-model-service.
// POST save-approved route proxies to MCP server save_approved_candidates endpoint.
// ============================================================================

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-review
 * Bulk review action: sets review_status on a set of candidates for a run.
 *
 * Request body:
 *   { "review_status": "approved"|"rejected"|"deferred",
 *     "candidate_ids"?: string[] }
 *
 * When `candidate_ids` is omitted, every actionable candidate in the run is
 * updated (legacy "Approve All" / "Reject All" path). When provided, only
 * those candidates are updated -- powers the "Approve Filtered" / "Reject
 * Filtered" buttons that act on the currently filtered subset of the table.
 * Committed candidates are always skipped regardless of which path is used.
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-review', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;
  const { review_status, candidate_ids } = req.body;

  if (!review_status || !['approved', 'rejected', 'deferred'].includes(review_status)) {
    return res.status(400).json({
      error: { code: 400, message: 'review_status is required and must be one of: approved, rejected, deferred' },
    });
  }

  if (
    candidate_ids !== undefined &&
    (!Array.isArray(candidate_ids) || candidate_ids.some((id) => typeof id !== 'string'))
  ) {
    return res.status(400).json({
      error: { code: 400, message: 'candidate_ids must be an array of strings when provided' },
    });
  }

  try {
    const { architectureModelServiceBaseUrl } = getConfig();
    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    logger.info('Processing bulk review request', {
      requestId,
      projectId,
      architectureId,
      runId,
      review_status,
      scope: candidate_ids ? `filtered(${candidate_ids.length})` : 'all',
    });

    // Step 1: Fetch all candidates for this run
    const listUrl = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates?page=0&size=5000`;
    const listResponse = await fetch(listUrl, { headers: proxyHeaders });
    if (!listResponse.ok) {
      return res.status(listResponse.status).json(await listResponse.json().catch(() => ({ error: 'Failed to fetch candidates' })));
    }
    const listData: any = await listResponse.json();
    const allCandidates: any[] = listData.content || listData || [];

    // Hotfix 2026-05-13: Skip candidates that have already been saved to
    // the canonical model (`review_status === 'committed'`). The frontend
    // surfaces "Approve Remaining" / "Reject Remaining" in mixed-state
    // runs, and the natural expectation is that the bulk action affects
    // only the still-actionable rows. Without this filter the bulk PATCH
    // would transition committed rows back to approved/rejected, undoing
    // the persisted save-back state.
    let candidates: any[] = allCandidates.filter(
      (c: any) => c.review_status !== 'committed'
    );
    const skippedCommitted = allCandidates.length - candidates.length;

    // 2026-05-22: when caller supplies `candidate_ids`, narrow to that set.
    // Unknown ids (e.g. stale frontend cache) are silently dropped here so
    // the partial result still succeeds; the response surfaces the actioned
    // count so the caller can detect drift.
    if (Array.isArray(candidate_ids)) {
      const idSet = new Set(candidate_ids);
      candidates = candidates.filter((c: any) => idSet.has(c.id));
    }

    logger.info('Bulk review: fetched candidates', {
      requestId,
      total: allCandidates.length,
      actionable: candidates.length,
      skippedCommitted,
    });

    // Step 2: PATCH each candidate's review status (parallel batches of 20)
    let succeeded = 0;
    let failed = 0;
    const BATCH_SIZE = 20;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (c: any) => {
          const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(c.id)}/review`;
          const resp = await fetch(url, {
            method: 'PATCH',
            headers: proxyHeaders,
            body: JSON.stringify({ review_status }),
          });
          if (!resp.ok) throw new Error(`${resp.status}`);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') succeeded++;
        else failed++;
      }
    }

    logger.info('Bulk review complete', { requestId, projectId, architectureId, runId, review_status, succeeded, failed, total: candidates.length });

    return res.json({ review_status, total: candidates.length, succeeded, failed });
  } catch (error) {
    logger.error('Bulk review error', { requestId, projectId, architectureId, runId, error: error instanceof Error ? error.message : 'Unknown' });
    return res.status(500).json({ error: { code: 500, message: 'Internal server error' } });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-review-cascade
 *
 * ATOMIC cascade-aware bulk review (Spec 2 -- Cascade-aware Bulk Review +
 * Reject Suppression, 2026-06-02, Task Group 3). Forwards the snake_case
 * cascade body (`candidate_ids` + `finding_ids` + `review_status` + optional
 * `reviewer_notes`) to the AMS atomic cascade endpoint, which applies the
 * disposition across BOTH candidates and their linked findings in ONE
 * transaction (any single-entity failure rolls the whole batch back).
 *
 * Pure proxy: status + snake_case body passthrough, `requestId` logging, 503 on
 * AMS network error. NO business logic of its own -- atomicity, committed
 * gating, and scope verification all live in AMS. This REPLACES the best-effort
 * per-row `candidates/bulk-review` fan-out (above) for the cascade-apply path;
 * the `review-model` and `save-approved` proxies are UNCHANGED.
 *
 * MUST be registered BEFORE the more general
 * `/candidates/:candidateId/review` PATCH so the literal `bulk-review-cascade`
 * segment is not captured as a candidateId (it is a POST so there is no actual
 * collision, but registering here keeps the candidate-action routes together).
 *
 * Backend: POST {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates/bulk-review-cascade
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-review-cascade',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery candidate bulk review cascade',
      method: 'POST',
      amsPath: amsCandidatesPathPrefix(projectId, architectureId, runId) + '/bulk-review-cascade',
      forwardBody: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-edit
 *
 * ATOMIC bulk-candidate-EDIT (Skipped-candidate visibility + grouped bulk-fill
 * (C1) for discovery save-back, 2026-06-20, Task Group 4). Forwards the
 * snake_case patch body (`patches: [{ candidate_id, name?, candidate_type?,
 * status?, review_status?, confidence?, operation?, data? }]`) to the AMS atomic
 * bulk-edit endpoint POST .../discovery/runs/:runId/candidates/bulk-edit, passing
 * the AMS status + body through verbatim. The endpoint is ATOMIC (all-or-nothing
 * within ONE @Transactional): on a 2xx EVERY curated patch applied and the body
 * carries { applied_count, requested_count, ids, applied[] }; any single-patch
 * failure rolls the WHOLE batch back and surfaces as a non-2xx ({ error }) -- the
 * gateway adds NONE of its own business logic (a structural sibling of the
 * bulk-review-cascade proxy above).
 *
 * Registered alongside the other candidate-action proxies and BEFORE the more
 * general `/candidates/:candidateId/review` PATCH so the literal `bulk-edit`
 * segment is never captured as a candidateId (it is a POST so there is no actual
 * collision, but registering here keeps the candidate-action routes together --
 * mirrors the bulk-review-cascade note).
 *
 * Backend: POST {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates/bulk-edit
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/bulk-edit',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery candidate bulk edit',
      method: 'POST',
      amsPath: amsCandidatesPathPrefix(projectId, architectureId, runId) + '/bulk-edit',
      forwardBody: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * PATCH /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/:candidateId/review
 * Proxies candidate review action to architecture-model-service.
 *
 * Forwards the JSON body transparently (review_status, reviewed_by).
 * Returns the updated DiscoveryCandidateDto on success.
 *
 * Backend: PATCH {architectureModelServiceBaseUrl}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates/:candidateId/review
 */
discoveryRouter.patch('/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/:candidateId/review', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId, candidateId } = req.params;

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info('Processing discovery candidate review proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
      candidateId,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${architectureModelServiceBaseUrl}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/discovery/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/review`;

      const response = await fetch(url, {
        method: 'PATCH',
        headers: proxyHeaders,
        body: JSON.stringify(req.body),
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery candidate review proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        candidateId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery candidate review proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        candidateId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery candidate review proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      candidateId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});


/**
 * PATCH /projects/:projectId/architectures/:architectureId/runs/:runId/candidates/:candidateId/resolve-conflict
 *
 * Durable server-side single-attribute conflict-resolution write (Spec 3 --
 * Conversational Discovery-Review "Architect" Persona, 2026-06-02, Task Group 1
 * AMS endpoint + Group 3 gateway proxy). Forwards the snake_case body
 * (`attr` + `chosen_value` + `chosen_source` + optional `resolved_by` /
 * `resolved_at`) to the AMS @PatchMapping("/{candidateId}/resolve-conflict"),
 * which stamps `data._conflictResolutions[attr]` (camelCase keys INSIDE the
 * JSONB -- AMS does that itself), sets the canonical `data[attr]`, and clears
 * `data._conflicts[attr]` in ONE write (no full-candidate round-trip, no schema
 * change). Returns the updated DiscoveryCandidateDto on success.
 *
 * Pure passthrough: status + snake_case body, `requestId` logging, 503 on AMS
 * network error -- a structural sibling of the `/{candidateId}/review` PATCH
 * proxy above. The conversation's `resolveConflict` (the review-decision
 * orchestrator) + bulk-resolve-by-pattern call this so a conversational
 * resolution is DURABLE IMMEDIATELY (not save-back-deferred).
 *
 * Registered alongside the other candidate-action proxies. A PATCH on a distinct
 * `/resolve-conflict` sub-path so there is no collision with `/:candidateId/review`.
 *
 * Backend: PATCH {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/candidates/:candidateId/resolve-conflict
 */
discoveryRouter.patch(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/candidates/:candidateId/resolve-conflict',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, candidateId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery candidate resolve-conflict',
      method: 'PATCH',
      amsPath:
        amsCandidatesPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(candidateId)}/resolve-conflict`,
      forwardBody: true,
      logContext: { projectId, architectureId, runId, candidateId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/save-approved
 * Proxies save-approved action to MCP server's save_approved_candidates endpoint.
 *
 * Constructs the MCP request body with { sessionId, projectId, architectureId, runId }
 * and forwards to the MCP server which orchestrates the save-back of approved
 * candidates against the run's bound architecture.
 *
 * The architectureId in the URL is forwarded into the MCP body verbatim. Per
 * spec, the MCP / discovery-service code defensively cross-checks this against
 * the run's bound architectureId (Group 4 / 8) so a frontend bug cannot
 * misroute a save-back.
 *
 * Backend: POST {mcpBaseUrl}/mcp/tools/save_approved_candidates
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/save-approved', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  // Skipped-candidate visibility + grouped bulk-fill (C1), 2026-06-20, Task
  // Group 4: thread a `commit=false` DRY-RUN flag through to the MCP
  // save_approved_candidates tool so the C1 panel can PREVIEW the would-commit /
  // would-still-block projection WITHOUT persisting. Accepted as either the
  // `?commit=false` query param or a `{ commit: false }` body field; ONLY the
  // explicit string/boolean false flips it to a dry run (default = true =
  // commit), so existing callers that send neither are byte-for-byte unchanged.
  // The gateway re-implements NO resolution -- it forwards the flag verbatim.
  const rawCommit =
    (req.query as Record<string, unknown> | undefined)?.commit ??
    (req.body as Record<string, unknown> | undefined)?.commit;
  const commit = !(rawCommit === false || rawCommit === 'false');

  try {
    const { mcpBaseUrl } = getConfig();

    logger.info('Processing discovery save-approved proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${mcpBaseUrl}/mcp/tools/save_approved_candidates`;

      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify({
          sessionId: 'gateway',
          projectId,
          architectureId,
          runId,
          commit,
        }),
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery save-approved proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery save-approved proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'MCP server unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery save-approved proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

// ============================================================================
// Spec 2026-04-05: Log-based Discovery Enrichment (Increment 14)
// Task Group 6: Gateway Proxy Routes for Log Enrichment and Reprocessing
//
// POST log-enrichment route proxies to discovery-service log ingestion endpoint.
// POST reprocess route proxies to discovery-service reprocessing endpoint.
//
// Note: discovery-service downstream URLs are unchanged here -- Group 4 will
// refactor those routes to embed `:architectureId`. We forward
// `architectureId` in the request body alongside `projectId, runId` so the
// Group 4 refactor can pick it up without a further gateway change.
// ============================================================================

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-enrichment
 * Proxies log enrichment requests to the discovery-service.
 *
 * Extracts projectId, architectureId, and runId from URL params, merges them
 * into the request body, and forwards to discovery-service POST
 * /discovery/log-enrichment.
 *
 * On success, forwards the response body and status code transparently.
 * On network error, returns 503 with structured error.
 *
 * Backend: POST {discoveryServiceBaseUrl}/discovery/log-enrichment
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/log-enrichment', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('Processing discovery log-enrichment proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/log-enrichment`;

      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify({
          ...req.body,
          projectId,
          architectureId,
          runId,
        }),
      });

      // Parse response body
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery log-enrichment proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      // Forward response transparently (including error status codes like 400, 413)
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery log-enrichment proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery log-enrichment proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/reprocess
 * Proxies reprocessing requests to the discovery-service.
 *
 * Extracts projectId, architectureId, and runId from URL params and forwards
 * to discovery-service POST /discovery/reprocess (architectureId merged into
 * the body).
 *
 * On success, forwards the response body and status code transparently (expects 202 Accepted).
 * On network error, returns 503 with structured error.
 *
 * Backend: POST {discoveryServiceBaseUrl}/discovery/reprocess
 */
discoveryRouter.post('/projects/:projectId/architectures/:architectureId/runs/:runId/reprocess', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId, architectureId, runId } = req.params;

  try {
    const { discoveryServiceBaseUrl } = getConfig();

    logger.info('Processing discovery reprocess proxy request', {
      requestId,
      projectId,
      architectureId,
      runId,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/reprocess`;

      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify({
          ...req.body,
          projectId,
          architectureId,
          runId,
        }),
      });

      // Parse response body
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery reprocess proxy request completed', {
        requestId,
        projectId,
        architectureId,
        runId,
        status: response.status,
        success: response.ok,
      });

      // Forward response transparently (expects 202 Accepted, but also forwards 404, 409, etc.)
      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery reprocess proxy request failed', {
        requestId,
        projectId,
        architectureId,
        runId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery reprocess proxy error', {
      requestId,
      projectId,
      architectureId,
      runId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});


// ============================================================================
// Spec 2026-05-06: Library Discovery Integration -- Task Group 6
//
// Four new proxy routes for the library-aware discovery flow:
//   - POST .../services/:serviceId/preflight-library-scan -> discovery-service
//   - POST .../libraries/:libraryId/preflight-library-scan -> discovery-service
//   - POST .../services/:serviceId/start-library-scan -> discovery-service runs
//     endpoint with body { runMode: 'library-scoped', serviceId, includeExternal }
//   - POST .../libraries/:libraryId/start-library-scan -> discovery-service runs
//     endpoint with body { runMode: 'library-scoped', libraryId, includeExternal }
//
// Pure pass-throughs mirroring the existing startDiscoveryRun / preflight
// proxy patterns. No business logic, no header rewriting beyond the
// existing pattern.
// ============================================================================

/**
 * POST /projects/:projectId/architectures/:architectureId/services/:serviceId/preflight-library-scan
 * Service-rooted preflight library scan. Forwards body untouched to
 * discovery-service.
 *
 * Backend: POST {discoveryServiceBaseUrl}/discovery/projects/:projectId/architectures/:architectureId/services/:serviceId/preflight-library-scan
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/services/:serviceId/preflight-library-scan',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId, serviceId } = req.params;

    try {
      const { discoveryServiceBaseUrl } = getConfig();
      const body = req.body;

      logger.info('Processing library-scan preflight (service-rooted) proxy request', {
        requestId,
        projectId,
        architectureId,
        serviceId,
      });

      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      try {
        const url =
          `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}` +
          `/architectures/${encodeURIComponent(architectureId)}` +
          `/services/${encodeURIComponent(serviceId)}/preflight-library-scan`;

        const response = await fetch(url, {
          method: 'POST',
          headers: proxyHeaders,
          body: JSON.stringify(body ?? {}),
        });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info('Library-scan preflight (service-rooted) proxy completed', {
          requestId,
          projectId,
          architectureId,
          serviceId,
          status: response.status,
          success: response.ok,
        });

        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

        logger.error('Library-scan preflight (service-rooted) proxy failed', {
          requestId,
          projectId,
          architectureId,
          serviceId,
          error: errorMessage,
        });

        return res.status(503).json({
          error: { code: 503, message: 'Discovery service unavailable' },
        });
      }
    } catch (error) {
      logger.error('Library-scan preflight (service-rooted) proxy error', {
        requestId,
        projectId,
        architectureId,
        serviceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        error: { code: 500, message: 'Internal server error' },
      });
    }
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/libraries/:libraryId/preflight-library-scan
 * Library-rooted preflight library scan. Forwards body untouched to
 * discovery-service.
 *
 * Backend: POST {discoveryServiceBaseUrl}/discovery/projects/:projectId/architectures/:architectureId/libraries/:libraryId/preflight-library-scan
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/libraries/:libraryId/preflight-library-scan',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId, libraryId } = req.params;

    try {
      const { discoveryServiceBaseUrl } = getConfig();
      const body = req.body;

      logger.info('Processing library-scan preflight (library-rooted) proxy request', {
        requestId,
        projectId,
        architectureId,
        libraryId,
      });

      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      try {
        const url =
          `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}` +
          `/architectures/${encodeURIComponent(architectureId)}` +
          `/libraries/${encodeURIComponent(libraryId)}/preflight-library-scan`;

        const response = await fetch(url, {
          method: 'POST',
          headers: proxyHeaders,
          body: JSON.stringify(body ?? {}),
        });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info('Library-scan preflight (library-rooted) proxy completed', {
          requestId,
          projectId,
          architectureId,
          libraryId,
          status: response.status,
          success: response.ok,
        });

        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

        logger.error('Library-scan preflight (library-rooted) proxy failed', {
          requestId,
          projectId,
          architectureId,
          libraryId,
          error: errorMessage,
        });

        return res.status(503).json({
          error: { code: 503, message: 'Discovery service unavailable' },
        });
      }
    } catch (error) {
      logger.error('Library-scan preflight (library-rooted) proxy error', {
        requestId,
        projectId,
        architectureId,
        libraryId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        error: { code: 500, message: 'Internal server error' },
      });
    }
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/services/:serviceId/start-library-scan
 * Service-rooted library scan run. Forwards to discovery-service POST
 * .../runs with body { runMode: 'library-scoped', serviceId, includeExternal }.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/services/:serviceId/start-library-scan',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId, serviceId } = req.params;
    const includeExternal = req.body?.includeExternal !== false;

    try {
      const { discoveryServiceBaseUrl } = getConfig();

      logger.info('Processing library-scan start (service-rooted) proxy request', {
        requestId,
        projectId,
        architectureId,
        serviceId,
        includeExternal,
      });

      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      try {
        const url =
          `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}` +
          `/architectures/${encodeURIComponent(architectureId)}/runs`;

        const response = await fetch(url, {
          method: 'POST',
          headers: proxyHeaders,
          body: JSON.stringify({
            runMode: 'library-scoped',
            serviceId,
            includeExternal,
          }),
        });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info('Library-scan start (service-rooted) proxy completed', {
          requestId,
          projectId,
          architectureId,
          serviceId,
          status: response.status,
          success: response.ok,
        });

        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

        logger.error('Library-scan start (service-rooted) proxy failed', {
          requestId,
          projectId,
          architectureId,
          serviceId,
          error: errorMessage,
        });

        return res.status(503).json({
          error: { code: 503, message: 'Discovery service unavailable' },
        });
      }
    } catch (error) {
      logger.error('Library-scan start (service-rooted) proxy error', {
        requestId,
        projectId,
        architectureId,
        serviceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        error: { code: 500, message: 'Internal server error' },
      });
    }
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/libraries/:libraryId/start-library-scan
 * Library-rooted library scan run. Forwards to discovery-service POST
 * .../runs with body { runMode: 'library-scoped', libraryId, includeExternal }.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/libraries/:libraryId/start-library-scan',
  async (req: Request, res: Response) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId, libraryId } = req.params;
    const includeExternal = req.body?.includeExternal !== false;

    try {
      const { discoveryServiceBaseUrl } = getConfig();

      logger.info('Processing library-scan start (library-rooted) proxy request', {
        requestId,
        projectId,
        architectureId,
        libraryId,
        includeExternal,
      });

      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      try {
        const url =
          `${discoveryServiceBaseUrl}/discovery/projects/${encodeURIComponent(projectId)}` +
          `/architectures/${encodeURIComponent(architectureId)}/runs`;

        const response = await fetch(url, {
          method: 'POST',
          headers: proxyHeaders,
          body: JSON.stringify({
            runMode: 'library-scoped',
            libraryId,
            includeExternal,
          }),
        });

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info('Library-scan start (library-rooted) proxy completed', {
          requestId,
          projectId,
          architectureId,
          libraryId,
          status: response.status,
          success: response.ok,
        });

        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

        logger.error('Library-scan start (library-rooted) proxy failed', {
          requestId,
          projectId,
          architectureId,
          libraryId,
          error: errorMessage,
        });

        return res.status(503).json({
          error: { code: 503, message: 'Discovery service unavailable' },
        });
      }
    } catch (error) {
      logger.error('Library-scan start (library-rooted) proxy error', {
        requestId,
        projectId,
        architectureId,
        libraryId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({
        error: { code: 500, message: 'Internal server error' },
      });
    }
  }
);

// ============================================================================
// Spec 2026-05-10 Runtime Log Input at Discovery Run Start -- Task Group 2
//
// New multipart upload route lets the frontend attach optional runtime log
// files immediately AFTER a run is created. The existing run-start proxy
// (POST /projects/:projectId/architectures/:architectureId/runs above) is
// untouched; this route is fired from the frontend with the freshly returned
// runId.
//
// Discovery-service is NOT involved in this flow. The gateway writes files
// to the project folder on disk and PATCHes the architecture-model-service
// to record metadata under
// `discovery_run.config_snapshot.inputArtifacts.logFiles[]`.
// ============================================================================

const LOG_UPLOAD_ALLOWED_EXTENSIONS = ['.log', '.txt', '.jsonl', '.ndjson'];

const LOG_UPLOAD_MAX_FILE_BYTES = (() => {
  const raw = process.env.LOG_UPLOAD_MAX_FILE_BYTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 104_857_600; // 100 MB
})();

const LOG_UPLOAD_MAX_TOTAL_BYTES = (() => {
  const raw = process.env.LOG_UPLOAD_MAX_TOTAL_BYTES;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_097_152_000; // 2000 MB (2 GB)
})();

const LOG_UPLOAD_MAX_FILES = 50;

const logUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LOG_UPLOAD_MAX_FILE_BYTES,
    files: LOG_UPLOAD_MAX_FILES,
  },
});

function hasAllowedLogExtension(originalName: string): boolean {
  if (!originalName) return false;
  const lower = originalName.toLowerCase();
  return LOG_UPLOAD_ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/log-files
 *
 * Multipart upload of one-or-more runtime log files for a discovery run that
 * has already been created. Files are field-name `logFiles` (multer accepts
 * any field, but the frontend uses this name to match).
 *
 * Limits:
 *   - per-file: LOG_UPLOAD_MAX_FILE_BYTES env (default 100 MB)
 *   - total request: LOG_UPLOAD_MAX_TOTAL_BYTES env (default 2000 MB / 2 GB)
 *   - max 50 files per request
 *
 * Validation:
 *   - extension allowlist (.log, .txt, .jsonl, .ndjson, case-insensitive)
 *
 * Status codes:
 *   - 200: all files written + AMS PATCH succeeded
 *   - 400: empty files array or missing runId or sanitised name empty
 *   - 413: per-file or total-request size cap exceeded
 *   - 415: file extension not in allowlist
 *   - 500: disk write failed (PATCH NOT called) or project folder unresolved
 *   - upstream status: AMS PATCH non-2xx forwarded verbatim
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/log-files',
  (req: Request, res: Response, next) => {
    logUpload.any()(req, res, (err: unknown) => {
      if (err) {
        // multer.MulterError surfaces LIMIT_FILE_SIZE / LIMIT_FILE_COUNT etc.
        const code = (err as { code?: string }).code;
        if (code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: {
              code: 413,
              message: `One or more files exceed the per-file size limit of ${LOG_UPLOAD_MAX_FILE_BYTES} bytes`,
            },
          });
        }
        if (code === 'LIMIT_FILE_COUNT') {
          return res.status(413).json({
            error: {
              code: 413,
              message: `Too many files (limit ${LOG_UPLOAD_MAX_FILES})`,
            },
          });
        }
        logger.warn('Multer error parsing discovery-run log upload', {
          code,
          message: err instanceof Error ? err.message : String(err),
        });
        return res.status(400).json({
          error: {
            code: 400,
            message: `Multipart parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
      return next();
    });
  },
  async (req: Request, res: Response) => {
    const requestId = (req as unknown as { requestId?: string }).requestId || 'unknown';
    const { projectId, architectureId, runId } = req.params;

    if (!runId) {
      return res.status(400).json({
        error: { code: 400, message: 'runId path parameter is required' },
      });
    }

    const files = (req.files as Express.Multer.File[] | undefined) || [];

    if (files.length === 0) {
      return res.status(400).json({
        error: { code: 400, message: 'At least one log file must be uploaded' },
      });
    }

    // Server-side extension allowlist re-check (defence in depth).
    for (const f of files) {
      if (!hasAllowedLogExtension(f.originalname)) {
        return res.status(415).json({
          error: {
            code: 415,
            message: `Unsupported file extension for ${f.originalname}. Allowed: ${LOG_UPLOAD_ALLOWED_EXTENSIONS.join(', ')}`,
          },
        });
      }
    }

    // Total-request size cap (multer enforces per-file; we enforce sum here).
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > LOG_UPLOAD_MAX_TOTAL_BYTES) {
      return res.status(413).json({
        error: {
          code: 413,
          message: `Total upload size ${totalBytes} bytes exceeds the cap of ${LOG_UPLOAD_MAX_TOTAL_BYTES} bytes`,
        },
      });
    }

    const attemptedCount = files.length;

    // Spec 2026-05-11 Discovery Run Robustness -- Section 1
    //
    // Optional multipart rider field `runtimeEvidenceConfig` carrying a
    // JSON-string value `{ "maxLogPathPrefixSegments": <number> }`. When
    // present, we parse + forward the JSON object to the service layer
    // (which threads it to the AMS PATCH body). When absent we do NOT
    // synthesise a default here -- AMS will leave the existing snapshot
    // value untouched, and the discovery-service orchestrator has its
    // own defensive default at the matcher-read site.
    let runtimeEvidenceConfig: { maxLogPathPrefixSegments?: number } | undefined;
    const rawRuntimeEvidenceConfig = (req.body as Record<string, unknown> | undefined)?.[
      'runtimeEvidenceConfig'
    ];
    if (typeof rawRuntimeEvidenceConfig === 'string' && rawRuntimeEvidenceConfig.length > 0) {
      try {
        const parsed = JSON.parse(rawRuntimeEvidenceConfig);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          runtimeEvidenceConfig = parsed as { maxLogPathPrefixSegments?: number };
        } else {
          logger.warn('Ignoring non-object runtimeEvidenceConfig field on log-files upload', {
            requestId,
            projectId,
            architectureId,
            runId,
            type: typeof parsed,
          });
        }
      } catch (parseErr) {
        logger.warn('Failed to parse runtimeEvidenceConfig multipart field; ignoring', {
          requestId,
          projectId,
          architectureId,
          runId,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }
    }

    logger.info('Processing discovery-run log files upload', {
      requestId,
      projectId,
      architectureId,
      runId,
      attemptedCount,
      totalBytes,
      hasRuntimeEvidenceConfig: !!runtimeEvidenceConfig,
    });

    try {
      const result = await writeLogFilesAndPatchRun({
        projectId,
        architectureId,
        runId,
        files: files.map((f) => ({
          originalname: f.originalname,
          size: f.size,
          mimetype: f.mimetype,
          buffer: f.buffer,
        })),
        attemptedCount,
        runtimeEvidenceConfig,
      });

      return res.status(200).json(result);
    } catch (err) {
      // Map service-level errors to HTTP. Order matters: most-specific first.
      if (err instanceof InvalidFileNameError) {
        logger.warn('Discovery-run log upload rejected: invalid filename', {
          requestId,
          projectId,
          runId,
          originalFileName: err.originalFileName,
        });
        return res.status(400).json({
          error: {
            code: 400,
            message: `Invalid filename after sanitisation: ${err.originalFileName}`,
          },
        });
      }

      if (err instanceof ProjectFolderResolutionError) {
        logger.error('Discovery-run log upload failed: project folder unresolved', {
          requestId,
          projectId,
          runId,
        });
        return res.status(500).json({
          error: {
            code: 500,
            message: `Failed to resolve project folder for projectId=${err.projectId}`,
          },
        });
      }

      if (err instanceof DiskWriteError) {
        logger.error('Discovery-run log upload failed: disk write error', {
          requestId,
          projectId,
          runId,
          failedFileName: err.failedFileName,
          message: err.message,
        });
        return res.status(500).json({
          error: {
            code: 500,
            message: `Disk write failed for ${err.failedFileName}`,
            failedFileName: err.failedFileName,
          },
        });
      }

      // ArchitectureModelHttpError -> forward upstream status + body so the
      // frontend can render the warning chip / toast accurately.
      if (err instanceof ArchitectureModelHttpError) {
        logger.warn('Discovery-run log upload: AMS PATCH returned non-2xx', {
          requestId,
          projectId,
          runId,
          status: err.status,
        });
        return res.status(err.status).json({
          error: {
            code: err.status,
            message: 'Architecture model service rejected log-file metadata PATCH',
            upstream: err.body,
          },
        });
      }

      logger.error('Discovery-run log upload: unexpected error', {
        requestId,
        projectId,
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({
        error: {
          code: 500,
          message: 'Unexpected error processing discovery-run log upload',
        },
      });
    }
  }
);


// ============================================================================
// Spec 2026-05-16: Discovery Findings / Evidence as a First-Class Discovery
// Concept -- Task Group 3 (Phase 2 / Commit 2).
//
// Gateway proxy routes for the Discovery Findings + Finding-Links REST surface
// exposed by architecture-model-service under
//   /api/model/projects/:projectId/architectures/:architectureId
//      /discovery/runs/:runId/findings[...]
//
// These proxies are thin pass-throughs:
//   - URL translation only (project + architecture + run + finding + link ids
//     are URL-encoded and embedded into the downstream URL),
//   - Query string forwarded verbatim for the list endpoint (carries the
//     category / findingType / severity / status / source / createdByStage /
//     linkedTargetType / linkedTargetId filter set plus paging + text search),
//   - Request body forwarded verbatim for POST / PATCH,
//   - Downstream status code AND response body forwarded verbatim so the
//     frontend can render AMS structured error codes -- especially the
//     400 invalid_link_target body (D6 hard-reject) and the 422
//     status-transition error -- without translation.
//   - No business logic, no defaulting, no body mutation.
//
// Forgetting :architectureId in the gateway URL 404s at the Express layer
// (no fallback resolution) -- mirrors the existing discovery proxy safety
// property.
// ============================================================================

/**
 * Small forwarding helper local to the findings proxy block.
 *
 * Performs a single fetch to the architecture-model-service findings surface,
 * passes the response body through verbatim, and surfaces downstream status
 * codes. Network failures collapse to a structured 503; unexpected
 * exceptions collapse to a structured 500. Mirrors the inline pattern used
 * by the other AMS-backed discovery proxies above (e.g. the candidates
 * list, candidate-entity-mappings, and PATCH-review proxies).
 *
 * Returns a Promise<void> because it always writes to the response.
 */
async function proxyFindingsToAms(opts: {
  req: Request;
  res: Response;
  routeLabel: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  amsPath: string; // path under {architectureModelServiceBaseUrl}/api/model
  forwardQuery?: boolean;
  forwardBody?: boolean;
  logContext?: Record<string, unknown>;
}): Promise<void> {
  const requestId = (opts.req as any).requestId || 'unknown';
  const logContext = opts.logContext || {};

  try {
    const { architectureModelServiceBaseUrl } = getConfig();

    logger.info(`Processing ${opts.routeLabel} proxy request`, {
      requestId,
      method: opts.method,
      ...logContext,
    });

    let url = `${architectureModelServiceBaseUrl}${opts.amsPath}`;

    // Forward query string verbatim so all filter params survive. We use the
    // raw original querystring (everything after the first '?') so we
    // preserve ordering, repeated keys, and any future params added on the
    // AMS side without code changes here.
    if (opts.forwardQuery) {
      const qIdx = opts.req.originalUrl.indexOf('?');
      if (qIdx >= 0) {
        const qs = opts.req.originalUrl.slice(qIdx); // includes leading '?'
        url += qs;
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    let body: string | undefined;
    if (opts.forwardBody && (opts.method === 'POST' || opts.method === 'PATCH' || opts.method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.req.body ?? {});
    }

    try {
      const response = await fetch(url, {
        method: opts.method,
        headers,
        body,
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        try {
          responseBody = await response.text();
        } catch {
          responseBody = null;
        }
      }

      logger.info(`${opts.routeLabel} proxy request completed`, {
        requestId,
        status: response.status,
        success: response.ok,
        ...logContext,
      });

      opts.res.status(response.status).json(responseBody);
      return;
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      logger.error(`${opts.routeLabel} proxy request failed`, {
        requestId,
        error: errorMessage,
        ...logContext,
      });
      opts.res.status(503).json({
        error: {
          code: 503,
          message: 'Architecture model service unavailable',
        },
      });
      return;
    }
  } catch (error) {
    logger.error(`${opts.routeLabel} proxy error`, {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...logContext,
    });
    opts.res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
    return;
  }
}

/**
 * Build the AMS findings path prefix for a given (projectId, architectureId,
 * runId). All three ids are URL-encoded.
 */
function amsFindingsPathPrefix(projectId: string, architectureId: string, runId: string): string {
  return (
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/findings`
  );
}

/**
 * Build the AMS candidates path prefix for a given (projectId, architectureId,
 * runId). All three ids are URL-encoded. Mirrors {@link amsFindingsPathPrefix}.
 */
function amsCandidatesPathPrefix(projectId: string, architectureId: string, runId: string): string {
  return (
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/candidates`
  );
}

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/findings
 *
 * List findings for a discovery run. Forwards all query params verbatim
 * (category, findingType, severity, status, source, createdByStage,
 * linkedTargetType, linkedTargetId, plus paging + text search).
 *
 * Backend: GET {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/findings
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery findings list',
      method: 'GET',
      amsPath: amsFindingsPathPrefix(projectId, architectureId, runId),
      forwardQuery: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk
 *
 * Bulk-create findings (used by FindingEmitter post-merge in
 * discovery-service). MUST be registered BEFORE the /:findingId route so
 * the literal "bulk" segment is not captured as a findingId.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery findings bulk-create',
      method: 'POST',
      amsPath: amsFindingsPathPrefix(projectId, architectureId, runId) + '/bulk',
      forwardBody: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk-review
 *
 * Bulk reviewer action: AMS atomically applies a status change to a set of
 * findings (scoped by either explicit `ids` or a `filter` shape, mutually
 * exclusive). The response carries `updated_count`, `skipped_count`, an
 * optional `skipped_by_reason` breakdown, and the server-computed
 * `delta_by_from_status` map keyed by pre-mutation status.
 *
 * MUST be registered BEFORE the more general /findings/:findingId PATCH /
 * GET routes so the literal `bulk-review` segment is not captured as a
 * findingId (same constraint as the /bulk and /:findingId/review routes).
 *
 * Structural clone of the single-row /review proxy below. The gateway does
 * NOT loop or fan out per-row PATCHes here -- AMS exposes a real bulk
 * endpoint with a single transactional boundary and the gateway just
 * forwards one POST.
 *
 * Spec 2026-05-28: Bulk Findings Actions -- Task Group 2.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/bulk-review',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding bulk review',
      method: 'POST',
      amsPath: amsFindingsPathPrefix(projectId, architectureId, runId) + '/bulk-review',
      forwardBody: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);


/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings
 *
 * Single-create finding.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery findings create',
      method: 'POST',
      amsPath: amsFindingsPathPrefix(projectId, architectureId, runId),
      forwardBody: true,
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links
 *
 * List links for a finding. MUST be registered BEFORE the more general
 * /findings/:findingId route so the /links suffix is not captured as
 * part of a single-finding GET.
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding-links list',
      method: 'GET',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}/links`,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links
 *
 * Create a link from a finding to a target. AMS validates the target per
 * D6 (must exist, must belong to the same run / architecture). On
 * validation failure AMS returns 400 with an invalid_link_target code
 * which this proxy forwards verbatim.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding-link create',
      method: 'POST',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}/links`,
      forwardBody: true,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);

/**
 * DELETE /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links/:linkId
 *
 * Remove a single link from a finding.
 */
discoveryRouter.delete(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/links/:linkId',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId, linkId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding-link delete',
      method: 'DELETE',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}/links/${encodeURIComponent(linkId)}`,
      logContext: { projectId, architectureId, runId, findingId, linkId },
    });
  }
);

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/review
 *
 * Convenience setter for { status, reviewer_notes? } -- AMS also bumps
 * reviewed_at. Status transition rules are enforced server-side; invalid
 * moves surface as 422.
 *
 * MUST be registered BEFORE the more general /findings/:findingId PATCH /
 * GET routes so the /review suffix is not captured as a finding id.
 */
discoveryRouter.post(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId/review',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding review',
      method: 'POST',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}/review`,
      forwardBody: true,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId
 *
 * Fetch a single finding (AMS includes its links in the response per the
 * Group 2 mapper).
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding get',
      method: 'GET',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}`,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);

/**
 * PATCH /projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId
 *
 * Partial update of a finding. The AMS service null-guards every PATCH
 * field per the boxed-Double pitfall (project_primitive_double_dto_overwrite.md)
 * -- the gateway just forwards the body verbatim.
 *
 * Invalid status transitions (e.g. resolved -> new) surface as 422 from
 * AMS and are forwarded transparently.
 */
discoveryRouter.patch(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/findings/:findingId',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId, findingId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery finding update',
      method: 'PATCH',
      amsPath:
        amsFindingsPathPrefix(projectId, architectureId, runId) +
        `/${encodeURIComponent(findingId)}`,
      forwardBody: true,
      logContext: { projectId, architectureId, runId, findingId },
    });
  }
);


// ============================================================================
// Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines -- Task Group 5
//
// READ-ONLY gateway proxies for the synthesised `discovery_capability` records
// exposed by architecture-model-service under
//   /api/model/projects/:projectId/architectures/:architectureId
//      /discovery/[runs/:runId/]capabilities[...]
//
// Thin pass-throughs (URL translation only; downstream status + body forwarded
// verbatim), reusing the same `proxyFindingsToAms` helper as the findings
// proxies above. The D2 frontend surface is read-only (a Capabilities section
// inside the Findings review), so only the three GET reads are wired here; the
// AMS create / bulk-create / patch-review endpoints are reached directly by the
// discovery-service synthesis client (via archModelClient), NOT through these
// gateway routes.
//
// Forgetting :architectureId in the gateway URL 404s at the Express layer (no
// fallback) -- mirrors the findings proxy safety property.
// ============================================================================

/**
 * Build the AMS run-scoped capabilities path prefix for a given
 * (projectId, architectureId, runId). All three ids are URL-encoded. Mirrors
 * {@link amsFindingsPathPrefix}.
 */
function amsRunCapabilitiesPathPrefix(
  projectId: string,
  architectureId: string,
  runId: string,
): string {
  return (
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/capabilities`
  );
}

/**
 * Build the AMS project+architecture-scoped capabilities path prefix (no run
 * filter). Both ids are URL-encoded.
 */
function amsCapabilitiesPathPrefix(projectId: string, architectureId: string): string {
  return (
    `/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/capabilities`
  );
}

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/capabilities
 *
 * List the synthesised capabilities for a discovery run (members embedded).
 * The Findings Capabilities section (read-only, D2) reads this for its run.
 *
 * Backend: GET {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/runs/:runId/capabilities
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/runs/:runId/capabilities',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, runId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery capabilities list-by-run',
      method: 'GET',
      amsPath: amsRunCapabilitiesPathPrefix(projectId, architectureId, runId),
      logContext: { projectId, architectureId, runId },
    });
  }
);

/**
 * GET /projects/:projectId/architectures/:architectureId/capabilities
 *
 * List ALL synthesised capabilities for a project + architecture (no run
 * filter; members embedded). Forward seam for an Option-B cross-run view.
 *
 * Backend: GET {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/capabilities
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/capabilities',
  async (req: Request, res: Response) => {
    const { projectId, architectureId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery capabilities list-by-project-architecture',
      method: 'GET',
      amsPath: amsCapabilitiesPathPrefix(projectId, architectureId),
      logContext: { projectId, architectureId },
    });
  }
);

/**
 * GET /projects/:projectId/architectures/:architectureId/capabilities/:capabilityId
 *
 * Fetch a single capability by id (members embedded).
 *
 * Backend: GET {ams}/api/model/projects/:projectId/architectures/:architectureId/discovery/capabilities/:capabilityId
 */
discoveryRouter.get(
  '/projects/:projectId/architectures/:architectureId/capabilities/:capabilityId',
  async (req: Request, res: Response) => {
    const { projectId, architectureId, capabilityId } = req.params;
    await proxyFindingsToAms({
      req,
      res,
      routeLabel: 'discovery capability get',
      method: 'GET',
      amsPath:
        amsCapabilitiesPathPrefix(projectId, architectureId) +
        `/${encodeURIComponent(capabilityId)}`,
      logContext: { projectId, architectureId, capabilityId },
    });
  }
);


// ============================================================================
// Spec 2026-05-16: Database Discovery Packs (Sybase + PostgreSQL) -- Task Group 5
//
// Gateway proxy for the discovery-service DB connectivity probe.
// Pure pass-through (no business logic in the gateway):
//   POST /api/v1/discovery/db/test-connection
//      -> discovery-service POST /discovery/db/test-connection
//
// Request body is `DatabaseDiscoveryConfig` + { username, password }. The
// password lives in the request body only; the discovery-service holds it
// for the duration of the probe in its in-process secretsStore and purges
// it on completion. The gateway forwards the body verbatim and does NOT
// log or persist any field from it.
//
// The discovery-service surfaces 200 on success and 400 on validation /
// connection error (the engine error message is in the body). 503 is
// surfaced when the discovery-service itself is unreachable. Status code
// AND body are forwarded transparently.
//
// Run-creation for DB discovery uses the existing
// POST /projects/:projectId/architectures/:architectureId/runs proxy --
// discovery-service branches on `discovery_kind` server-side, so the
// gateway stays transparent.
// ============================================================================

/**
 * POST /db/test-connection
 *
 * Proxies the DB connectivity probe to the discovery-service. Validates
 * nothing beyond what the discovery-service already validates -- forwards
 * the JSON body verbatim and surfaces the upstream response (status + body)
 * to the caller.
 */
discoveryRouter.post('/db/test-connection', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  try {
    const { discoveryServiceBaseUrl } = getConfig();
    const body = req.body;

    // Defensive log: include the engine + host but NEVER the username /
    // password (those live in the body that we are about to forward).
    logger.info('Processing discovery DB test-connection proxy request', {
      requestId,
      engine: body?.dbEngine ?? null,
      host: body?.host ?? null,
    });

    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      const url = `${discoveryServiceBaseUrl}/discovery/db/test-connection`;
      const response = await fetch(url, {
        method: 'POST',
        headers: proxyHeaders,
        body: JSON.stringify(body),
      });

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      logger.info('Discovery DB test-connection proxy request completed', {
        requestId,
        status: response.status,
        success: response.ok,
        engine: body?.dbEngine ?? null,
      });

      return res.status(response.status).json(responseBody);
    } catch (fetchError) {
      const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

      logger.error('Discovery DB test-connection proxy request failed', {
        requestId,
        error: errorMessage,
      });

      return res.status(503).json({
        error: {
          code: 503,
          message: 'Discovery service unavailable',
        },
      });
    }
  } catch (error) {
    logger.error('Discovery DB test-connection proxy error', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Internal server error',
      },
    });
  }
});
