/**
 * Driver-side, server-to-server orchestration submit (Spec 3, Task Group 2).
 *
 * The Driver submits orchestration jobs SERVER-TO-SERVER (not via the browser
 * client), POSTing to `/api/v2/jobs/orchestrations` with:
 *   - `spec_intents` (the resolved `spec_name` folder + optional `session_id`),
 *   - `context_files`, `options`,
 *   - a per-request `callback_url` (CD-3 -- the gateway's build-results URL,
 *     sent on EVERY submit), and
 *   - `deploy_on_complete` (CD-3 -- big-bang deploy).
 *
 * Two shapes:
 *   - {@link submitOrchestration} -- ONE spec per job (the sequential per-spec
 *     dispatch path).
 *   - {@link submitOrchestrationBatch} -- N specs as ONE coupled batch
 *     (`batch_name` set): the upstream accumulates them as N commits on a single
 *     `feature/<batch_name>` branch and opens ONE merge request. This is the
 *     "migrate a selected subset as one branch" path. The two share the same
 *     POST seam ({@link postOrchestrationJob}).
 *
 * This reuses the `implementationLlmProxyClient.request(...)` JSON seam with the
 * upstream Bearer auto-injected (the same seam `routes/orchestrations.ts` uses),
 * and correlates the returned `{ job_id, status, created_at }` -> the run-item.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 2; batch submit added
 * 2026-06-26 (select-a-subset -> single branch).
 */

import { request } from './implementationLlmProxyClient';
import { logger } from './logger';

/** Upstream orchestration endpoint path. */
const JOBS_ORCHESTRATIONS_API_PATH = '/api/v2/jobs/orchestrations';

/** User-Agent header value for proxy requests (matches orchestrations.ts). */
const RIVVY_USER_AGENT = 'Rivvy-Portal-UI';

/** Timeout for the orchestration submit in milliseconds (60 seconds). */
const SUBMIT_TIMEOUT_MS = 60000;

/** Default execution options shared by single + batch submits. */
const DEFAULT_OPTIONS = {
  stop_on_error: true,
  retry_on_failure: false,
  max_retries: 1,
  timeout_seconds: 0,
} as const;

/** Inputs for a single-spec orchestration submit. */
export interface OrchestrationSubmitInput {
  /** Normalised organisation. */
  company: string;
  /** Normalised product. */
  project: string;
  /** The spec folder name (the shape-spec `folder` event) -> SpecIntent.spec_name. */
  specName: string;
  /** The shape-spec session id, ONLY for the orchestration handoff (CD-1). */
  sessionId?: string | null;
  /** TRUE only on the FINAL spec (big-bang deploy). */
  deployOnComplete: boolean;
  /** The gateway's build-results URL, sent per-request on every submit (CD-3). */
  callbackUrl: string;
}

/** One resolved spec within a batched submit. */
export interface BatchSpecIntent {
  /** The spec folder name -> SpecIntent.spec_name. */
  specName: string;
  /** The shape-spec session id for the handoff (optional). */
  sessionId?: string | null;
}

/** Inputs for a batched (multi-spec, single-branch) orchestration submit. */
export interface OrchestrationBatchSubmitInput {
  /** Normalised organisation. */
  company: string;
  /** Normalised product. */
  project: string;
  /** The resolved specs to run together as one coupled batch (>=1). */
  specs: BatchSpecIntent[];
  /**
   * Non-empty batch name. The upstream runs the specs as N commits on a single
   * `feature/<batchName>` branch and opens ONE merge request.
   */
  batchName: string;
  /** TRUE -> big-bang deploy after the whole batch implements. */
  deployOnComplete: boolean;
  /** The gateway's build-results URL (one callback for the whole batch). */
  callbackUrl: string;
}

/** Result of an orchestration submit (single or batch). */
export interface OrchestrationSubmitResult {
  /** True when the upstream accepted the job. */
  ok: boolean;
  /** The correlated orchestration job id (the build-results callback key). */
  jobId: string | null;
  /** The upstream job status, when present. */
  status?: string | null;
  /** Error detail on a non-accepted submit. */
  error?: string | null;
}

/**
 * POST a built orchestration body server-to-server and correlate the returned
 * `job_id`. Never throws on an upstream error (returns `{ ok: false }` so the
 * Driver can isolate the failure). Shared by the single + batch submits.
 */
async function postOrchestrationJob(
  proxyBody: Record<string, unknown>,
  logContext: Record<string, unknown>
): Promise<OrchestrationSubmitResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const response = await request(JOBS_ORCHESTRATIONS_API_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': RIVVY_USER_AGENT,
      },
      body: proxyBody,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
    }

    if (!response.ok) {
      logger.warn('[diag-gateway] migration_execution_driver orchestration_submit_non_ok', {
        ...logContext,
        status: response.status,
      });
      return {
        ok: false,
        jobId: null,
        error: `Orchestration submit returned status ${response.status}`,
      };
    }

    const jobId =
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>).job_id as string | undefined)
        : undefined;
    const status =
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>).status as string | undefined)
        : undefined;

    if (!jobId) {
      return { ok: false, jobId: null, error: 'Orchestration submit returned no job_id' };
    }

    logger.info('[diag-gateway] migration_execution_driver orchestration_submitted', {
      ...logContext,
      jobId,
    });
    return { ok: true, jobId, status: status ?? null };
  } catch (error) {
    clearTimeout(timeoutId);
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[diag-gateway] migration_execution_driver orchestration_submit_failed', {
      ...logContext,
      error: message,
    });
    return { ok: false, jobId: null, error: message };
  }
}

/**
 * Submit ONE spec to the external orchestration endpoint server-to-server,
 * threading `callback_url` (every submit) + `deploy_on_complete` (final only).
 * Returns the correlated `job_id`; never throws on an upstream error.
 */
export async function submitOrchestration(
  input: OrchestrationSubmitInput
): Promise<OrchestrationSubmitResult> {
  const proxyBody = {
    company: input.company,
    project: input.project,
    spec_intents: [
      {
        spec_name: input.specName,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
      },
    ],
    context_files: [] as string[],
    // CD-3: the external round-2 service accepts callback_url on the
    // orchestration request and posts build-results to it.
    callback_url: input.callbackUrl,
    // CD-3 / big-bang: deploy once everything is implemented.
    deploy_on_complete: input.deployOnComplete,
    options: { ...DEFAULT_OPTIONS },
  };

  return postOrchestrationJob(proxyBody, {
    company: input.company,
    project: input.project,
    specName: input.specName,
    deployOnComplete: input.deployOnComplete,
  });
}

/**
 * Submit N specs as ONE coupled batch (`batch_name` set). The upstream runs them
 * as N commits on a single `feature/<batchName>` branch and opens ONE merge
 * request, then posts a single build-results callback for the whole batch.
 * Returns the one correlated `job_id`; never throws on an upstream error.
 */
export async function submitOrchestrationBatch(
  input: OrchestrationBatchSubmitInput
): Promise<OrchestrationSubmitResult> {
  const proxyBody = {
    company: input.company,
    project: input.project,
    spec_intents: input.specs.map((s) => ({
      spec_name: s.specName,
      ...(s.sessionId ? { session_id: s.sessionId } : {}),
    })),
    context_files: [] as string[],
    // Batch mode: the upstream treats a non-empty batch_name as "one branch for
    // all N specs". The gateway route + IVS both accept this field.
    batch_name: input.batchName,
    callback_url: input.callbackUrl,
    deploy_on_complete: input.deployOnComplete,
    options: { ...DEFAULT_OPTIONS },
  };

  return postOrchestrationJob(proxyBody, {
    company: input.company,
    project: input.project,
    specCount: input.specs.length,
    batchName: input.batchName,
    deployOnComplete: input.deployOnComplete,
  });
}
