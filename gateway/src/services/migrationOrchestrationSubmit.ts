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
  /** The spec folder name (deterministic, or the shape-spec `folder` event). */
  specName: string;
  /** The shape-spec session id, ONLY for the orchestration handoff (CD-1). */
  sessionId?: string | null;
  /**
   * Option A deterministic materialisation (2026-07-30): the full
   * requirements markdown. IVS writes the spec folder from it before its
   * pre-check — no shaping session needed for this intent.
   */
  requirementsText?: string | null;
  /** Optional planning/initialization.md body (raw idea). */
  initializationText?: string | null;
  /**
   * Step-4 (/git-commit-preparation) control: FALSE on every non-final spec
   * of a sequential run so the ~10-minute prep turn runs once per run, on
   * the final spec (2026-07-30).
   */
  commitPreparation?: boolean;
  /** TRUE only on the FINAL spec (big-bang deploy). */
  deployOnComplete: boolean;
  /**
   * Stage-2 (2026-07-31): the operator-registered target-service serve spec
   * — mapped to the upstream `target` body field (the haibox launch spec)
   * so a service-plane deployOnComplete submit can actually deploy. TRUST
   * BOUNDARY upstream: `command` executes verbatim on the host.
   */
  targetServeSpec?: {
    command: string;
    healthPath: string;
    portEnv: string;
    readinessTimeout?: number;
    /** Optional bootstrap command run before `command` (haibox `setup`). */
    setup?: string;
    env?: Record<string, string>;
  };
  /**
   * Run-branch chaining (2026-08-06): the spec name whose
   * `feature/<baseSpec>[--<folder>]` branch(es) form the base ref for this
   * spec's worktree branch — the previous GOOD spec of the run (or the
   * cross-run `base_spec` persisted at run creation). Omitted = base off the
   * default branch (IVS fetches origin-fresh).
   */
  baseSpec?: string | null;
  /**
   * INTEGRATION base (2026-08-12, stage continuation): TRUE = IVS bases this
   * spec's worktree on the default branch PLUS every remote feature/* branch
   * for each repo target merged in — the run accumulates onto ALL prior
   * unmerged work, and a branch that never existed is simply absent rather
   * than a fail-fast (the live "base_spec resolves no branch" Stage-2 start
   * failure). Mutually exclusive with baseSpec (baseSpec wins when both set).
   */
  integrationBase?: boolean;
  /**
   * Explicit-branch base (2026-08-15): base the worktree on
   * `origin/<baseBranch>` (the DB assembly branch — "start from the open
   * Merge Request"). IVS fail-closes when the branch is absent on origin.
   */
  baseBranch?: string | null;
  /**
   * Run-branch chaining: FALSE = commit + push the spec branch but do NOT
   * open a merge request (only the stage-final branch, which carries the
   * whole chain's diff, opens the ONE MR). Omitted = IVS default (true).
   */
  openMergeRequest?: boolean;
  /** The gateway's build-results URL, sent per-request on every submit (CD-3). */
  callbackUrl: string;
  /**
   * SCL first-commit delivery (2026-08-18, spec 10): files IVS writes into the
   * prepared worktree and commits as ONE commit BEFORE any implementer work —
   * the generated behaviour suite + its scl-suite-manifest.json. Absent =
   * no-op (every non-SCL dispatch is byte-identical on the wire).
   */
  initialCommitFiles?: Array<{ path: string; content: string }>;
  /** Commit message for the initial commit (required with initialCommitFiles). */
  initialCommitMessage?: string;
}

/** One resolved spec within a batched submit. */
export interface BatchSpecIntent {
  /** The spec folder name -> SpecIntent.spec_name. */
  specName: string;
  /** The shape-spec session id for the handoff (optional). */
  sessionId?: string | null;
  /** Deterministic materialisation payload (see OrchestrationSubmitInput). */
  requirementsText?: string | null;
  /** Optional planning/initialization.md body. */
  initializationText?: string | null;
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
  /** Stage-2 (2026-07-31): serve spec for the batch deploy (see the single-spec field). */
  targetServeSpec?: OrchestrationSubmitInput['targetServeSpec'];
  /**
   * Run-branch chaining (2026-08-06): base the ONE batch branch off this
   * spec's branch(es) instead of the default branch (cross-run stage
   * continuation). Omitted = default-branch base.
   */
  baseSpec?: string | null;
  /** INTEGRATION base (2026-08-12) — see the single-spec field. */
  integrationBase?: boolean;
  /** Explicit-branch (MR) base (2026-08-15) — see the single-spec field. */
  baseBranch?: string | null;
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

/** Outcome of the IVS worktree salvage (2026-08-15 — Resume with salvage). */
export interface SalvageWorktreeResult {
  status: 'salvaged' | 'no_worktree' | 'error';
  branch?: string;
  committed?: boolean;
  summary?: string;
  message?: string;
}

/**
 * Salvage a dead run item's LOCAL worktree via IVS (2026-08-15): commit +
 * push the spec's existing worktree as its branch so Resume proceeds to the
 * NEXT spec. Never throws — failures come back as `{ status: 'error' }` so
 * the driver surfaces them verbatim.
 */
export async function salvageSpecWorktree(
  company: string,
  project: string,
  specName: string
): Promise<SalvageWorktreeResult> {
  try {
    const response = await request('/api/v2/runs/salvage-worktree', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': RIVVY_USER_AGENT,
      },
      body: { company, project, spec_name: specName },
    });
    const body = (await response.json().catch(() => null)) as SalvageWorktreeResult | null;
    if (!body || typeof body.status !== 'string') {
      return { status: 'error', message: `salvage returned HTTP ${response.status} with no body` };
    }
    return body;
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'salvage request failed',
    };
  }
}

/** One shipped-file hash reported by the IVS file-hashes endpoint. */
export interface JobFileHashEntry {
  path: string;
  /** null = the path does not exist on the branch (integrity: missing). */
  sha256: string | null;
}

/** GET /api/v2/jobs/{job_id}/file-hashes response (SCL suite integrity). */
export interface JobFileHashesResult {
  ok: boolean;
  branch?: string | null;
  hashes: JobFileHashEntry[];
  /** Raw scl-suite-manifest.json content from the branch, when present. */
  manifest: string | null;
  /** Raw scl-quarantine.json content from the branch, when present. */
  quarantine: string | null;
  error?: string | null;
}

/**
 * SCL shipped-suite integrity read (2026-08-18, spec 10): the branch's current
 * shipped-file sha256s + the SCL sidecar contents, via the IVS
 * `GET /api/v2/jobs/{job_id}/file-hashes` endpoint (hashes are computed with
 * `git show <branch>:<path>` against the live repo, so they survive worktree
 * reclamation). `paths` omitted → IVS derives the set from the branch's
 * scl-suite-manifest.json. Never throws — failures come back `{ ok: false }`
 * so the build-results door stays fail-soft.
 */
export async function fetchJobFileHashes(
  jobId: string,
  paths?: string[]
): Promise<JobFileHashesResult> {
  try {
    const query =
      paths && paths.length > 0
        ? `?${paths.map((p) => `paths=${encodeURIComponent(p)}`).join('&')}`
        : '';
    const response = await request(
      `/api/v2/jobs/${encodeURIComponent(jobId)}/file-hashes${query}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': RIVVY_USER_AGENT },
      }
    );
    const body = (await response.json().catch(() => null)) as {
      hashes?: unknown;
      manifest?: unknown;
      quarantine?: unknown;
      branch?: unknown;
      detail?: unknown;
    } | null;
    if (!response.ok || !body) {
      return {
        ok: false,
        hashes: [],
        manifest: null,
        quarantine: null,
        error: `file-hashes returned HTTP ${response.status}${
          body?.detail ? ` — ${String(body.detail)}` : ''
        }`,
      };
    }
    const hashes = Array.isArray(body.hashes)
      ? (body.hashes as Array<Record<string, unknown>>)
          .filter((h) => typeof h?.path === 'string')
          .map((h) => ({
            path: h.path as string,
            sha256: typeof h.sha256 === 'string' ? h.sha256 : null,
          }))
      : [];
    return {
      ok: true,
      branch: typeof body.branch === 'string' ? body.branch : null,
      hashes,
      manifest: typeof body.manifest === 'string' ? body.manifest : null,
      quarantine: typeof body.quarantine === 'string' ? body.quarantine : null,
    };
  } catch (error) {
    return {
      ok: false,
      hashes: [],
      manifest: null,
      quarantine: null,
      error: error instanceof Error ? error.message : 'file-hashes request failed',
    };
  }
}

/**
 * Map the operator-registered serve spec to the IVS `target` wire shape —
 * the haibox launch kwargs verbatim (command / health_type / health_path /
 * port_env / readiness_timeout / env).
 */
function toTargetWire(
  spec: NonNullable<OrchestrationSubmitInput['targetServeSpec']>
): Record<string, unknown> {
  return {
    command: spec.command,
    health_type: 'http',
    health_path: spec.healthPath,
    port_env: spec.portEnv,
    ...(spec.readinessTimeout !== undefined ? { readiness_timeout: spec.readinessTimeout } : {}),
    // haibox runs `setup` once before `command` (its serve() kwarg name).
    ...(spec.setup ? { setup: spec.setup } : {}),
    ...(spec.env ? { env: spec.env } : {}),
  };
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
        ...(input.requirementsText
          ? { requirements_text: input.requirementsText }
          : {}),
        ...(input.initializationText
          ? { initialization_text: input.initializationText }
          : {}),
      },
    ],
    context_files: [] as string[],
    // CD-3: the external round-2 service accepts callback_url on the
    // orchestration request and posts build-results to it.
    callback_url: input.callbackUrl,
    // CD-3 / big-bang: deploy once everything is implemented.
    deploy_on_complete: input.deployOnComplete,
    // Stage-2 (2026-07-31): the haibox serve spec (snake wire matches the
    // IVS/haibox launch kwargs). Only present when the operator registered
    // one at the Start-stage dialog.
    ...(input.targetServeSpec ? { target: toTargetWire(input.targetServeSpec) } : {}),
    // Step-4 once-per-run control (2026-07-30).
    ...(input.commitPreparation !== undefined
      ? { commit_preparation: input.commitPreparation }
      : {}),
    // Run-branch chaining (2026-08-06): base this spec's worktree branch off
    // the previous GOOD spec's branch; suppress the per-spec MR on non-final
    // items (the stage-final branch opens the ONE MR for the whole chain).
    ...(input.baseSpec ? { base_spec: input.baseSpec } : {}),
    ...(input.integrationBase ? { integration_base: true } : {}),
    // MR base (2026-08-15): explicit origin branch (the DB assembly branch).
    ...(input.baseBranch ? { base_branch: input.baseBranch } : {}),
    ...(input.openMergeRequest !== undefined
      ? { open_merge_request: input.openMergeRequest }
      : {}),
    // SCL first-commit delivery (2026-08-18): the generated suite files IVS
    // commits BEFORE the implementer runs. Omitted entirely when absent.
    ...(input.initialCommitFiles && input.initialCommitFiles.length > 0
      ? {
          initial_commit_files: input.initialCommitFiles.map((f) => ({
            path: f.path,
            content: f.content,
          })),
          initial_commit_message: input.initialCommitMessage ?? '',
        }
      : {}),
    options: { ...DEFAULT_OPTIONS },
  };

  return postOrchestrationJob(proxyBody, {
    company: input.company,
    project: input.project,
    specName: input.specName,
    deployOnComplete: input.deployOnComplete,
    baseSpec: input.baseSpec ?? null,
    openMergeRequest: input.openMergeRequest ?? null,
    integrationBase: input.integrationBase ?? false,
    baseBranch: input.baseBranch ?? null,
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
      ...(s.requirementsText ? { requirements_text: s.requirementsText } : {}),
      ...(s.initializationText
        ? { initialization_text: s.initializationText }
        : {}),
    })),
    context_files: [] as string[],
    // Batch mode: the upstream treats a non-empty batch_name as "one branch for
    // all N specs". The gateway route + IVS both accept this field.
    batch_name: input.batchName,
    callback_url: input.callbackUrl,
    deploy_on_complete: input.deployOnComplete,
    ...(input.targetServeSpec ? { target: toTargetWire(input.targetServeSpec) } : {}),
    // Run-branch chaining (2026-08-06): cross-run base for the batch branch.
    ...(input.baseSpec ? { base_spec: input.baseSpec } : {}),
    // INTEGRATION base (2026-08-12): default branch + remote feature/* merged.
    ...(input.integrationBase ? { integration_base: true } : {}),
    // MR base (2026-08-15): the batch branch sits on the DB assembly branch.
    ...(input.baseBranch ? { base_branch: input.baseBranch } : {}),
    options: { ...DEFAULT_OPTIONS },
  };

  return postOrchestrationJob(proxyBody, {
    company: input.company,
    project: input.project,
    specCount: input.specs.length,
    batchName: input.batchName,
    deployOnComplete: input.deployOnComplete,
    baseSpec: input.baseSpec ?? null,
    integrationBase: input.integrationBase ?? false,
    baseBranch: input.baseBranch ?? null,
  });
}
