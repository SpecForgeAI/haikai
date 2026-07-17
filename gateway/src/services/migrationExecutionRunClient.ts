/**
 * Migration Execution Run-State Client (gateway -> AMS).
 *
 * The gateway-hosted Migration Execution Driver (Spec 3, Task Groups 2/3/4) is
 * EVENT-DRIVEN over durable AMS run-state, so it survives a gateway restart.
 * This module is the thin, typed seam over the AMS run-state endpoints
 * (changeset 182 / `MigrationExecutionRunController`):
 *
 *   - POST   create-run (run header + ordered run-items, atomically)
 *   - GET    run-state (run + items, for the boot-recovery sweep + progress view)
 *   - GET    latest run for a book of work
 *   - GET    run-item by job_id (the build-results callback correlation key)
 *   - PATCH  run-item (dispatched / job_id / outcome / branch / pr_url / log)
 *   - PATCH  run (status / current position / target_base_url / decision-log)
 *
 * Wire shape is snake_case (the AMS global default). Every PATCH-mutable field
 * is OPTIONAL on the request type: an omitted field is a no-op on the AMS side
 * (the mappers null-guard each column per
 * `project_primitive_double_dto_overwrite.md`), so a PATCH that sets only
 * `outcome` never wipes `dispatched` / `job_id` / the decision log.
 *
 * These functions are the DI seam the Driver mocks in unit tests; they never
 * throw on a non-2xx beyond a typed {@link MigrationRunStateError}, so the
 * Driver can isolate a single failed item without aborting the whole run.
 *
 * Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Groups 2 + 3.
 */

import { getConfig } from '../config';
import { logger } from './logger';

// ============================================================================
// Wire types (snake_case -- mirror MigrationExecutionRunDto / *RunItemDto)
// ============================================================================

/** One dispatched spec within a run (AMS `migration_execution_run_item`). */
export interface MigrationExecutionRunItem {
  id?: string;
  run_id?: string;
  sequence_position?: number | null;
  work_item_id?: string | null;
  spec_generation_id?: string | null;
  spec_name?: string | null;
  status?: string | null;
  dispatched?: boolean | null;
  job_id?: string | null;
  branch?: string | null;
  pr_url?: string | null;
  outcome?: string | null;
  deploy_on_complete?: boolean | null;
  target_base_url?: string | null;
  error_detail?: string | null;
  auto_answer_decision_log_json?: Array<Record<string, unknown>> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** One Migration Execution Driver run over one book of work. */
export interface MigrationExecutionRun {
  id?: string;
  project_id?: string | null;
  book_of_work_id?: string | null;
  status?: string | null;
  current_sequence_position?: number | null;
  pinned_current_baseline_id?: string | null;
  target_base_url?: string | null;
  decision_log_json?: Array<Record<string, unknown>> | null;
  created_at?: string | null;
  updated_at?: string | null;
  items?: MigrationExecutionRunItem[] | null;
}

/** The create-run request body (run header + ordered items). */
export interface CreateMigrationExecutionRunRequest {
  run: MigrationExecutionRun;
  items: MigrationExecutionRunItem[];
}

/** Run-state lifecycle status values (mirror MigrationExecutionRunStatus). */
export const RUN_STATUS = {
  STARTED: 'started',
  DISPATCHING: 'dispatching',
  /**
   * Phased execution (Spec W): a plane finished build/verify/reconcile and the
   * run is PAUSED awaiting a human "approve & continue" before the next plane.
   */
  AWAITING_APPROVAL: 'awaiting_approval',
  HALTED: 'halted',
  DEPLOYED: 'deployed',
  FAILED: 'failed',
} as const;

/** Per-spec run-item status values (mirror MigrationExecutionRunItemStatus). */
export const RUN_ITEM_STATUS = {
  PENDING: 'pending',
  ANSWERING: 'answering',
  SUBMITTING: 'submitting',
  SUBMITTED: 'submitted',
  IMPLEMENTED: 'implemented',
  DEPLOYED: 'deployed',
  FAILED: 'failed',
  REJECTED: 'rejected',
} as const;

/** Terminal build-results outcome values recorded on a run-item. */
export const TERMINAL_OUTCOMES = ['implemented', 'deployed', 'failed', 'rejected'] as const;

/** Typed AMS run-state error carrying the upstream status + body. */
export class MigrationRunStateError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`AMS run-state request failed with status ${status}`);
    this.name = 'MigrationRunStateError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

function baseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * POST /api/projects/{projectId}/migration-execution-runs -- create a run AND
 * its ordered run-items atomically. AMS records the pinned baseline id + the
 * `deploy_on_complete` markers and returns the persisted run with items.
 */
export async function createMigrationExecutionRun(
  projectId: string,
  request: CreateMigrationExecutionRunRequest
): Promise<MigrationExecutionRun> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-execution-runs`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await readBody(response);
  if (!response.ok) {
    logger.warn('[diag-gateway] migration_execution_driver create_run AMS non-OK', {
      projectId,
      status: response.status,
    });
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRun;
}

/**
 * GET /api/projects/{projectId}/migration-execution-runs/{runId} -- read a run
 * + its ordered items (the boot-recovery sweep + the run-progress view).
 */
export async function getMigrationExecutionRun(
  projectId: string,
  runId: string
): Promise<MigrationExecutionRun | null> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-execution-runs/${encodeURIComponent(runId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    return null;
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRun;
}

/**
 * GET .../migration-books-of-work/{bookId}/migration-execution-run -- the most
 * recent run + items for a book of work (the dashboard's run-progress lookup).
 * Returns null when no run has been kicked off for the book yet.
 */
export async function getLatestMigrationExecutionRunForBook(
  projectId: string,
  bookId: string
): Promise<MigrationExecutionRun | null> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookId)}/migration-execution-run`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    return null;
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRun;
}

/**
 * GET .../migration-execution-run-items/by-job-id/{jobId} -- the build-results
 * callback correlation lookup (Group 3). Returns null for an unknown job_id
 * (the door maps that to its own 404).
 */
export async function findMigrationRunItemByJobId(
  projectId: string,
  jobId: string
): Promise<MigrationExecutionRunItem | null> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-execution-run-items/by-job-id/${encodeURIComponent(jobId)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    return null;
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRunItem;
}

/**
 * PATCH .../migration-execution-run-items/{runItemId} -- update a run-item
 * (dispatched / job_id / outcome / branch / pr_url / status / decision-log).
 * Omitted fields are no-ops (AMS null-guards every column).
 */
export async function patchMigrationExecutionRunItem(
  projectId: string,
  runItemId: string,
  patch: MigrationExecutionRunItem
): Promise<MigrationExecutionRunItem> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-execution-run-items/${encodeURIComponent(runItemId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRunItem;
}

/**
 * PATCH .../migration-execution-runs/{runId} -- update the run (status /
 * current position / target_base_url / decision-log). Omitted fields are
 * no-ops (AMS null-guards every column).
 */
export async function patchMigrationExecutionRun(
  projectId: string,
  runId: string,
  patch: MigrationExecutionRun
): Promise<MigrationExecutionRun> {
  const url = `${baseUrl()}/api/projects/${encodeURIComponent(projectId)}/migration-execution-runs/${encodeURIComponent(runId)}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MigrationRunStateError(response.status, body);
  }
  return body as MigrationExecutionRun;
}
