/**
 * Orchestration API Client
 *
 * API client for Gateway orchestration endpoints.
 *
 * Spec 2026-01-14: Implement Assistant Stage 6b - Execute Handoff Orchestration API
 * Spec 2026-01-15: Added projectParentFolder for transcript persistence
 * Spec 2026-01-30: Normalize API Identifiers, Sanitize Newlines, Fix Streaming
 *   - Import normalizeIdentifier and apply to company/project before API calls
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 *   - startOrchestrationJob and pollJobStatus functions
 *   - JobStatus type for job polling
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 *   - Retired executeOrchestration (legacy POST /execute gateway route deleted;
 *     the v2 jobs path startOrchestrationJob + pollJobStatus is the surviving
 *     mechanism)
 *   - Widened pollJobStatus to pass through the full JobDetailResponse
 *     (progress, result, logs_url, started_at, completed_at)
 */

import { normalizeIdentifier } from '../utils/normalizeIdentifier';
import type { JobStatus } from '../types/part';

/**
 * Gateway API base URL from environment variable.
 * Defaults to empty string (same origin) for Vite proxy in development.
 */
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

// ============================================================================
// Orchestration Job Types
// ============================================================================

/**
 * Options object for orchestration requests.
 */
export interface OrchestrationOptions {
  /** Stop execution on first error (default: true) */
  stop_on_error: boolean;
  /** Retry failed operations (default: false) */
  retry_on_failure: boolean;
  /** Maximum number of retries (default: 1) */
  max_retries: number;
  /** Timeout in seconds (0 = no timeout) */
  timeout_seconds: number;
}

/**
 * Response from creating an orchestration job.
 * Matches POST /api/v2/jobs/orchestrations response contract.
 *
 * Spec 2026-06-12: status enum is queued|running|completed|failed|cancelled
 * ('pending' was removed upstream); newly created jobs report "queued".
 */
export interface CreateJobResponse {
  /** Unique job identifier */
  job_id: string;
  /** Job status (newly created jobs report "queued") */
  status: string;
  /** ISO timestamp of job creation */
  created_at: string;
}

/**
 * A single spec intent for orchestration, pairing a spec folder name
 * with the session ID from the shape-spec stream that produced it.
 */
export interface SpecIntent {
  /** The spec folder name from the shape-spec stream */
  spec_name: string;
  /** The session ID from the shape-spec stream (optional — not yet emitted by upstream) */
  session_id?: string;
}

// ============================================================================
// Orchestration Job API
// ============================================================================

/**
 * Creates an orchestration job via POST /api/v2/jobs/orchestrations.
 *
 * One spec per job by default. To run MULTIPLE specs as one coupled batch
 * (N commits on a single `feature/<batchName>` branch, opened as ONE merge
 * request), pass a non-empty `batchName`; the gateway then accepts >1
 * spec_intents. Without it the gateway still rejects multi-spec with a 400.
 * Returns a job ID for polling via pollJobStatus.
 *
 * @param company - Organisation/company name
 * @param project - Project name
 * @param specIntents - Array of spec intent objects with spec_name and session_id
 * @param contextFiles - Optional array of context file paths
 * @param batchName - Optional batch name. Non-empty => batch mode (multiple
 *   spec_intents allowed; single MR). snake_cased to `batch_name` on the wire.
 * @returns Promise resolving to { jobId: string }
 * @throws Error if the request fails
 */
export async function startOrchestrationJob(
  company: string,
  project: string,
  specIntents: SpecIntent[],
  contextFiles: string[] = [],
  batchName?: string,
): Promise<{ jobId: string }> {
  const normalizedCompany = normalizeIdentifier(company);
  const normalizedProject = normalizeIdentifier(project);

  // Strip session_id from intents if empty/undefined — upstream rejects empty values
  const cleanedIntents = specIntents.map(({ spec_name, session_id }) => ({
    spec_name,
    ...(session_id ? { session_id } : {}),
  }));

  // Include batch_name only when non-empty — its presence is what enables
  // batch mode upstream (snake_case per the AMS wire convention).
  const trimmedBatchName = batchName?.trim() ?? '';

  const body = {
    company: normalizedCompany,
    project: normalizedProject,
    spec_intents: cleanedIntents,
    context_files: contextFiles,
    ...(trimmedBatchName ? { batch_name: trimmedBatchName } : {}),
    options: {
      stop_on_error: true,
      retry_on_failure: false,
      max_retries: 1,
      timeout_seconds: 0,
    },
  };

  const res = await fetch(`${GATEWAY_BASE}/api/v2/jobs/orchestrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Failed to start orchestration job: ${res.status}`);
  }

  const responseBody: CreateJobResponse = await res.json();
  return { jobId: responseBody.job_id };
}

/**
 * Polls the status of an orchestration job.
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Spec 2026-06-12: Pass through the full JobDetailResponse — progress,
 * result, logs_url, started_at, completed_at in addition to status/error.
 * `result` is untyped upstream (additionalProperties: true) and must be
 * consumed defensively (see utils/extractGitOutcome).
 *
 * @param jobId - The job ID to poll
 * @returns Promise resolving to the full JobStatus
 * @throws Error if the request fails
 */
export async function pollJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${GATEWAY_BASE}/api/v2/jobs/${jobId}`);

  if (!res.ok) {
    throw new Error(`Failed to poll job status: ${res.status}`);
  }

  const responseBody = await res.json();
  return {
    status: responseBody.status,
    error: responseBody.error,
    progress: responseBody.progress,
    result: responseBody.result,
    logs_url: responseBody.logs_url,
    started_at: responseBody.started_at,
    completed_at: responseBody.completed_at,
  };
}

// Re-export JobStatus type for convenience
export type { JobStatus };
