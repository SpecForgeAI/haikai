/**
 * Orchestrations routes for the Gateway API
 *
 * Provides the v2 job-based orchestration proxy endpoints for the external
 * implementation/verification service ("Standards Extractor API",
 * contract: openapi.json at repo root).
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * - Added POST /v2/jobs/orchestrations proxy route for job creation
 * - Added GET /v2/jobs/:job_id proxy route for job status polling
 * - Job routes use implementationLlmProxyClient for upstream auth
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * - RETIRED POST /execute (sent `feature_descriptions`, a field that no
 *   longer exists upstream, and hardcoded company "Global") together with
 *   its orchestrationClient.executeOrchestration service.
 * - RETIRED the string-based POST /v1/orchestrations proxy (the upstream
 *   contract now requires `spec_intents` as objects).
 * - POST /v2/jobs/orchestrations enforces one-spec-per-job UNLESS a
 *   non-empty `batch_name` is supplied, in which case N spec_intents run
 *   as one coupled batch (N commits on a single `feature/<batch_name>`
 *   branch, opened as ONE merge request). Multi-spec WITHOUT batch_name
 *   still gets a clear 400.
 * - GET /v2/jobs/:job_id forwards the full JobDetailResponse transparently
 *   (status / progress / result / logs_url / started_at / completed_at /
 *   error) -- see the JobDetailResponse type below.
 * - Removed 'pending' from the job status types: the upstream JobStatus
 *   enum is queued | running | completed | failed | cancelled.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../services';
import { request } from '../services/implementationLlmProxyClient';

const JOBS_ORCHESTRATIONS_API_PATH = '/api/v2/jobs/orchestrations';

/** User-Agent header value for proxy requests */
const RIVVY_USER_AGENT = 'Rivvy-Portal-UI';

/** Timeout for proxy requests in milliseconds (60 seconds) */
const PROXY_TIMEOUT_MS = 60000;

/**
 * Standard error envelope returned by the orchestration proxy routes.
 *
 * (Previously named after the retired /execute route; retained as the
 * error-shape contract for the v2 job routes.)
 */
export interface ExecuteOrchestrationResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: number;
    message: string;
    details?: unknown;
  };
}

/**
 * Options object for orchestration requests.
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 */
export interface OrchestrationOptions {
  /** Stop execution on first error (default: true) */
  stop_on_error: boolean;
  /** Retry failed operations (default: true) */
  retry_on_failure: boolean;
  /** Maximum number of retries (default: 1) */
  max_retries: number;
  /** Timeout in seconds (0 = no timeout) */
  timeout_seconds: number;
}

// ============================================================================
// Spec 2026-02-06: Job-Based Orchestration Types
// (upgraded 2026-06-12 to the new upstream JobDetailResponse contract)
// ============================================================================

/**
 * A single spec intent object pairing a spec folder name with its session ID.
 *
 * `spec_name` is the SPEC FOLDER NAME (e.g.
 * '2026-02-20-scenarios-service-scaffold'), never a composed payload string.
 */
export interface SpecIntentObject {
  /** The spec folder name from the shape-spec stream */
  spec_name: string;
  /** The session ID from the shape-spec stream (optional — stripped when empty) */
  session_id?: string;
}

/**
 * Request body for creating an orchestration job.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Spec 2026-06-12: one spec per job by default.
 * Batch mode: when a non-empty `batch_name` is set, spec_intents MAY contain
 * more than one element -- the upstream service runs them as one coupled batch
 * (N commits on a single `feature/<batch_name>` branch, opened as one MR).
 * Multi-spec WITHOUT batch_name is rejected with a clear 400.
 */
export interface CreateJobRequest {
  /** Organisation/company name */
  company: string;
  /** Project name */
  project: string;
  /**
   * Spec intent objects (spec_name + optional session_id). Exactly one element
   * unless `batch_name` is set, in which case multiple are allowed.
   */
  spec_intents: SpecIntentObject[];
  /** Optional array of context file paths */
  context_files?: string[];
  /**
   * Optional batch name. Non-empty => batch mode: spec_intents may hold N
   * elements that accumulate as N commits on one `feature/<batch_name>`
   * branch and open a SINGLE merge request. Absent/empty => one-spec-per-job.
   */
  batch_name?: string;
  /** Orchestration options (optional) */
  options?: OrchestrationOptions;
}

/**
 * Job execution status enum from the upstream contract.
 *
 * Spec 2026-06-12: 'pending' no longer exists upstream -- 'queued' is the
 * pre-running state.
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Response from creating an orchestration job.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Spec 2026-06-12: initial status is 'queued' (the upstream JobStatus enum
 * has no 'pending' value).
 */
export interface CreateJobResponse {
  /** Unique job identifier */
  job_id: string;
  /** Initial job status ('queued' on creation) */
  status: JobStatus;
}

/**
 * Progress information for a running job (upstream JobProgress).
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 */
export interface JobProgress {
  current_step: number;
  total_steps: number;
  step_description: string;
  percentage: number;
}

/**
 * Detailed job status from GET /api/v2/jobs/{job_id} (upstream
 * JobDetailResponse). Forwarded TRANSPARENTLY by the gateway -- every field
 * below passes through untouched.
 *
 * NOTE: `result` is intentionally `unknown` -- the upstream contract marks it
 * `additionalProperties: true` and the branch/PR key names are undocumented.
 * The frontend renders it defensively.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 */
export interface JobDetailResponse {
  job_id: string;
  type: string;
  status: JobStatus;
  company: string;
  project: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  progress: JobProgress | null;
  /** Untyped upstream result object (additionalProperties: true) -- passed through verbatim. */
  result: unknown;
  error: string | null;
  logs_url: string | null;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates the job creation request body.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Spec 2026-06-12: one spec per job by default. Batch mode (a non-empty
 * `batch_name`) allows multiple spec_intents in a single job.
 *
 * Exported for unit testing.
 */
export function validateCreateJobRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const req = body as CreateJobRequest;

  // Validate company
  if (!req.company || typeof req.company !== "string") {
    return "company is required";
  }
  if (req.company.trim() === "") {
    return "company cannot be empty";
  }

  // Validate project
  if (!req.project || typeof req.project !== "string") {
    return "project is required";
  }
  if (req.project.trim() === "") {
    return "project cannot be empty";
  }

  // Validate batch_name (optional). A non-empty value switches on batch mode,
  // which is what permits more than one spec_intent below.
  if (req.batch_name !== undefined && req.batch_name !== null && typeof req.batch_name !== "string") {
    return "batch_name must be a string when provided";
  }
  const batchName = typeof req.batch_name === "string" ? req.batch_name.trim() : "";

  // Validate spec_intents (array of objects with spec_name and session_id)
  if (!req.spec_intents || !Array.isArray(req.spec_intents)) {
    return "spec_intents array is required";
  }
  if (req.spec_intents.length < 1) {
    return "spec_intents must contain at least one element";
  }
  // One spec per job UNLESS batch mode is on. With a non-empty batch_name the
  // upstream service accumulates the N specs as N commits on a single
  // `feature/<batch_name>` branch and opens one MR. Multi-spec without a
  // batch_name is rejected (the legacy per-spec-branch path is intentionally
  // not exposed through the gateway).
  if (req.spec_intents.length > 1 && batchName === "") {
    return "spec_intents must contain exactly one element unless batch_name is set: provide a non-empty batch_name to run multiple specs as one coupled batch (single branch + merge request).";
  }
  for (let i = 0; i < req.spec_intents.length; i++) {
    const intent = req.spec_intents[i];
    if (!intent || typeof intent !== "object") {
      return `spec_intents[${i}] must be an object with spec_name`;
    }
    if (typeof intent.spec_name !== "string" || intent.spec_name.trim() === "") {
      return `spec_intents[${i}].spec_name is required and must be a non-empty string`;
    }
    // session_id is optional — only validate type if present
    if (intent.session_id !== undefined && typeof intent.session_id !== "string") {
      return `spec_intents[${i}].session_id must be a string when provided`;
    }
  }

  return null;
}

// ============================================================================
// Router
// ============================================================================

export const orchestrationsRouter = Router();

// ============================================================================
// Spec 2026-02-06: Job-Based Orchestration Routes
// ============================================================================

/**
 * POST /v2/jobs/orchestrations - Create an orchestration job
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 2: Gateway Job Proxy Routes
 *
 * This route proxies job creation requests to the upstream Orchestrations Service.
 * It's used for the part-based sequential execution workflow where each part
 * creates a separate job that is polled until completion.
 *
 * Features:
 * - Server-side Bearer token injected via implementationLlmProxyClient
 * - Request validation for company, project, spec_intent (one spec per job,
 *   or N specs when a non-empty batch_name enables batch mode -- Spec
 *   2026-06-12 + batch)
 * - Opaque 502 for upstream auth failures (401/403)
 * - 503 for network errors
 * - Logging for job creation operations
 */
orchestrationsRouter.post(
  "/v2/jobs/orchestrations",
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || "unknown";

    try {
      // Validate request body
      const validationError = validateCreateJobRequest(req.body);
      if (validationError) {
        logger.warn("Job creation request validation failed", {
          requestId,
          error: validationError,
        });
        return res.status(400).json({
          success: false,
          error: {
            code: 400,
            message: validationError,
          },
        } as ExecuteOrchestrationResponse);
      }

      const body = req.body as CreateJobRequest;

      logger.info("Processing job creation request", {
        requestId,
        company: body.company,
        project: body.project,
        specIntentsCount: body.spec_intents.length,
      });

      // Build headers - implementationLlmProxyClient handles Authorization
      const proxyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': RIVVY_USER_AGENT,
      };

      // Build request body for upstream — strip empty session_id to avoid upstream validation errors
      const cleanedIntents = body.spec_intents.map(({ spec_name, session_id }) => ({
        spec_name,
        ...(session_id ? { session_id } : {}),
      }));
      // Forward batch_name only when non-empty (the upstream treats its
      // presence as "batch mode"). Trim so whitespace can't accidentally
      // trigger it.
      const batchName = typeof body.batch_name === "string" ? body.batch_name.trim() : "";
      const proxyBody = {
        company: body.company,
        project: body.project,
        spec_intents: cleanedIntents,
        context_files: body.context_files || [],
        ...(batchName ? { batch_name: batchName } : {}),
        options: body.options || {
          stop_on_error: true,
          retry_on_failure: false,
          max_retries: 1,
          timeout_seconds: 0,
        },
      };

      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

      try {
        const response = await request(JOBS_ORCHESTRATIONS_API_PATH, {
          method: 'POST',
          headers: proxyHeaders,
          body: proxyBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle upstream auth failures with opaque error
        if (response.status === 401 || response.status === 403) {
          logger.error('Upstream authentication failed for job creation', {
            requestId,
            company: body.company,
            project: body.project,
            status: response.status,
          });
          return res.status(502).json({ error: 'Upstream authentication failed' });
        }

        // Parse response body
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info("Job creation request completed", {
          requestId,
          company: body.company,
          project: body.project,
          status: response.status,
          success: response.ok,
          jobId: response.ok && typeof responseBody === 'object' && responseBody !== null
            ? (responseBody as Record<string, unknown>).job_id
            : undefined,
        });

        // Return response transparently
        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        clearTimeout(timeoutId);

        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        if (errorMessage.includes('Implementation LLM Service Bearer token is not configured')) {
          logger.error('Job creation failed: token not configured', {
            requestId,
            company: body.company,
            project: body.project,
          });
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          logger.error("Job creation request timed out", {
            requestId,
            company: body.company,
            project: body.project,
            timeoutMs: PROXY_TIMEOUT_MS,
          });
        } else {
          logger.error("Job creation request failed", {
            requestId,
            company: body.company,
            project: body.project,
            error: errorMessage,
          });
        }

        return res.status(503).json({
          success: false,
          error: {
            code: 503,
            message: 'Job orchestration service unavailable',
          },
        } as ExecuteOrchestrationResponse);
      }
    } catch (error) {
      logger.error("Job creation error", {
        requestId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * GET /v2/jobs/:job_id - Poll job status
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 2: Gateway Job Proxy Routes
 *
 * This route proxies job status polling requests to the upstream Orchestrations Service.
 * Used by the frontend to poll for job completion during part-based workflow execution.
 *
 * The full upstream {@link JobDetailResponse} is forwarded TRANSPARENTLY:
 * status (queued|running|completed|failed|cancelled), progress
 * {current_step, total_steps, step_description, percentage}, result (untyped
 * -- passed through verbatim), logs_url, started_at, completed_at, and error
 * all reach the frontend untouched. (Spec 2026-06-12)
 *
 * Features:
 * - Server-side Bearer token injected via implementationLlmProxyClient
 * - Job ID extracted from URL params
 * - Opaque 502 for upstream auth failures (401/403)
 * - 503 for network errors
 * - Transparent forwarding of 404 when job not found
 * - Logging for job poll operations
 */
orchestrationsRouter.get(
  "/v2/jobs/:job_id",
  async (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.requestId || "unknown";
    const jobId = req.params.job_id;

    try {
      logger.info("Processing job status poll request", {
        requestId,
        jobId,
      });

      // Build headers - implementationLlmProxyClient handles Authorization
      const proxyHeaders: Record<string, string> = {
        'Accept': 'application/json',
        'User-Agent': RIVVY_USER_AGENT,
      };

      // Create AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

      try {
        const response = await request(`/api/v2/jobs/${jobId}`, {
          method: 'GET',
          headers: proxyHeaders,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle upstream auth failures with opaque error
        if (response.status === 401 || response.status === 403) {
          logger.error('Upstream authentication failed for job status poll', {
            requestId,
            jobId,
            status: response.status,
          });
          return res.status(502).json({ error: 'Upstream authentication failed' });
        }

        // Parse response body
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        logger.info("Job status poll completed", {
          requestId,
          jobId,
          status: response.status,
          jobStatus: response.ok && typeof responseBody === 'object' && responseBody !== null
            ? (responseBody as Record<string, unknown>).status
            : undefined,
        });

        // Return response transparently (including 404 for job not found).
        // The body is the full JobDetailResponse -- progress, result,
        // logs_url, started_at, completed_at and error pass through verbatim.
        return res.status(response.status).json(responseBody);
      } catch (fetchError) {
        clearTimeout(timeoutId);

        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';
        if (errorMessage.includes('Implementation LLM Service Bearer token is not configured')) {
          logger.error('Job status poll failed: token not configured', {
            requestId,
            jobId,
          });
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          logger.error("Job status poll request timed out", {
            requestId,
            jobId,
            timeoutMs: PROXY_TIMEOUT_MS,
          });
        } else {
          logger.error("Job status poll request failed", {
            requestId,
            jobId,
            error: errorMessage,
          });
        }

        return res.status(503).json({
          success: false,
          error: {
            code: 503,
            message: 'Job orchestration service unavailable',
          },
        } as ExecuteOrchestrationResponse);
      }
    } catch (error) {
      logger.error("Job status poll error", {
        requestId,
        jobId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);
