/**
 * Sybase schema harvest — one-shot structural-finding closure (Spec 3,
 * 2026-08-04).
 *
 * WHY this module exists: the DB migration pack generator emits
 * `structural_findings` (e.g. `no_primary_keys`, `no_fk_metadata`) whenever
 * the committed AMS model is missing catalog facts the original code-tier
 * discovery could not see. The TRUTH for those facts lives in the source
 * Sybase catalog (sysobjects/syscolumns/sysindexes/sysreferences), and the
 * repo already has every piece needed to fetch it — a metadata-only database
 * discovery run, candidate review, the MCP save-back (additive backfill of
 * `constraints_metadata`, `fk_columns` and the six attribute-fidelity slots),
 * and pack regeneration. What was missing is ONE orchestrated action; this
 * module chains the pieces so the UI can offer "harvest from source" as a
 * single button instead of a five-screen manual tour.
 *
 * The chain (each stage a named [diag-gateway] marker):
 *
 *   1. create_run   — POST {discovery}/discovery/projects/:pid/architectures/
 *                     :aid/runs with `discovery_kind: 'database'` and
 *                     `profilingMode: 'none'` (introspection-only catalog
 *                     walk — the orchestrator skips profiling entirely for
 *                     'none', so no data is read, only metadata).
 *   2. poll         — GET .../runs/:runId until COMPLETED | FAILED, bounded
 *                     by a total timeout (env-tunable, default 10 min).
 *   3. approve      — approve every still-actionable candidate from THIS run.
 *                     Auto-approval is the designed behaviour here (not a
 *                     shortcut): the harvested candidates are deterministic
 *                     catalog facts from the customer's own source DB, and
 *                     the save-back is ADDITIVE — it never overwrites
 *                     populated model fields — so there is nothing for a
 *                     human to adjudicate. There is no bulk-approve endpoint
 *                     in AMS (the gateway's own bulk-review route fans out
 *                     per-candidate PATCHes), so we do the same fan-out.
 *   4. save_back    — POST {mcp}/mcp/tools/save_approved_candidates with
 *                     `commit: true`. We call the MCP server DIRECTLY (the
 *                     same upstream the gateway's /save-approved proxy hits)
 *                     rather than HTTP-looping through our own route — the
 *                     proxy adds only trace scoring, no business logic.
 *   5. regenerate   — `generateDbMigrationPack` IN-PROCESS (the exact
 *                     function the /generate route calls) so the refreshed
 *                     pack reads the just-backfilled model.
 *   6. findings     — join the REGENERATED manifest's structural_findings
 *                     with the project's persisted AMS dispositions via the
 *                     shared `resolveStructuralFindingStates`, so the caller
 *                     sees exactly which findings the harvest cleared.
 *
 * CREDENTIALS: per-request ONLY. The password travels in the create-run
 * request body to discovery-service (which holds it in its in-memory
 * `secretsStore`, purged at terminal run status) and NOWHERE else — it is
 * never persisted, never logged, and never interpolated into error messages
 * (all errors here are built from HTTP status + upstream response text).
 * This mirrors the `test-connection` / `verify` credential conventions.
 *
 * Failure semantics are HONEST, not exception-shaped: the orchestration
 * returns a structured result whose `stage` field says how far it got
 * ('completed' | 'scan_failed' | 'save_failed' | 'regenerate_failed') with
 * a human `error` string. The route maps ALL of these to HTTP 200 — a failed
 * scan is a legitimate outcome the UI must render, not a transport error.
 */
import { getConfig } from '../config';
import { logger } from './logger';
import {
  generateDbMigrationPack,
  GenerateDbMigrationPackResult,
} from './dbMigrationPackHandler';
import {
  resolveStructuralFindingStates,
  StructuralDispositionRow,
  StructuralFindingState,
} from './migrationStructuralFindings';
import {
  SUPPORTED_DB_ENGINES,
  type SupportedDbEngine,
} from './dbMigrationPack/dbCredentialBlock';

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** Per-request source-DB connection details. NEVER persisted or logged. */
export interface HarvestConnection {
  host: string;
  port: number;
  databaseName: string;
  username: string;
  /** Request-lifetime only — see module doc comment. */
  password: string;
  /**
   * Source engine key. When absent the harvest reads it from the project's
   * DB migration pack manifest (`source_engine`) — the pack IS the context
   * that knows which engine this project migrates from — and only then falls
   * back to 'sybase' (Spec 5.7, 2026-09-11). Hard-defaulting to Sybase would
   * run ASE catalog SQL against a SQL Server and report the empty result as
   * though the database had no tables.
   */
  dbEngine?: SupportedDbEngine;
  /** Sybase driver selection; discovery-service defaults 'auto'. Ignored by other engines. */
  sybaseDriver?: string;
  /**
   * SQL-Server-only connection extras, forwarded verbatim to the
   * discovery-service `DatabaseDiscoveryConfig.mssqlAuth`. Ignored by every
   * other engine; never persisted (the run's secrets live in-memory).
   */
  mssqlAuth?: Record<string, unknown>;
  /** Optional schema include filter for the catalog walk. */
  includeSchemas?: string[] | null;
}

export interface RunStructuralHarvestArgs {
  projectId: string;
  architectureId: string;
  /** Decision-binding target for pack regeneration (absent → active-target fallback). */
  targetArchitectureId?: string | null;
  /** Groups the run under its service in the Review Room (else "Unassigned scans"). */
  serviceId?: string | null;
  connection: HarvestConnection;
  /** Test/tuning overrides; default from config (env) — see getPollSettings. */
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

/** Discovery run row subset we rely on (snake_case AMS row via discovery-service). */
export interface DiscoveryRunRow {
  id: string;
  status: string;
  [key: string]: unknown;
}

/** MCP save_approved_candidates response subset. */
export interface HarvestSaveBackSummary {
  entitiesCreated: number;
  entitiesSkipped: number;
  candidatesCommitted: number;
}

export type HarvestStage =
  | 'completed'
  | 'scan_failed'
  | 'save_failed'
  | 'regenerate_failed';

export interface StructuralHarvestResult {
  /** Null when run creation itself failed. */
  runId: string | null;
  /** Last observed run status (RUNNING on poll timeout). */
  runStatus: string | null;
  savedBack: HarvestSaveBackSummary | null;
  packRegenerated: boolean;
  /**
   * Refreshed finding states from the REGENERATED pack manifest joined with
   * AMS dispositions. Empty until the regenerate stage succeeds.
   */
  findings: StructuralFindingState[];
  stage: HarvestStage;
  error?: string;
}

// ---------------------------------------------------------------------------
// Injectable deps (codebase convention — see dbMigrationPackDrift.ts)
// ---------------------------------------------------------------------------

export interface HarvestDeps {
  /**
   * Step 0 — resolve the project's SOURCE engine when the caller supplies
   * none (Spec 5.7): the DB migration pack manifest's `source_engine` is the
   * project's own record of which engine it migrates from. Returns null when
   * there is no pack yet (the caller then keeps the historical default).
   */
  resolveSourceEngine?: (projectId: string) => Promise<SupportedDbEngine | null>;
  /** Step 1 — create the metadata-only database discovery run. */
  createRun?: (args: RunStructuralHarvestArgs) => Promise<DiscoveryRunRow>;
  /** Step 2 — read the run row (status polling). */
  getRun?: (
    projectId: string,
    architectureId: string,
    runId: string
  ) => Promise<DiscoveryRunRow>;
  /** Step 3a — list the run's candidates (AMS, page-capped like bulk-review). */
  listCandidates?: (
    projectId: string,
    architectureId: string,
    runId: string
  ) => Promise<Array<{ id: string; review_status?: string }>>;
  /** Step 3b — PATCH one candidate to review_status=approved. */
  approveCandidate?: (
    projectId: string,
    architectureId: string,
    runId: string,
    candidateId: string
  ) => Promise<void>;
  /** Step 4 — MCP save_approved_candidates (commit=true). */
  saveApproved?: (
    projectId: string,
    architectureId: string,
    runId: string
  ) => Promise<HarvestSaveBackSummary>;
  /** Step 5 — in-process pack regeneration. */
  regeneratePack?: (request: {
    projectId: string;
    architectureId: string;
    targetArchitectureId?: string | null;
  }) => Promise<GenerateDbMigrationPackResult>;
  /** Step 6 — project dispositions for the findings join. */
  fetchDispositions?: (projectId: string) => Promise<StructuralDispositionRow[]>;
  /** Poll sleeper (tests inject an immediate resolve). */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Default deps — real HTTP / in-process calls
// ---------------------------------------------------------------------------

/**
 * Read `manifest.json`'s `source_engine` from the project's most recent DB
 * migration pack. Fail-soft in every direction: no pack, no manifest, an
 * unparseable manifest or an unsupported engine key all return null, and the
 * caller keeps the historical Sybase default rather than failing a harvest.
 */
const defaultResolveSourceEngine: NonNullable<HarvestDeps['resolveSourceEngine']> = async (
  projectId,
) => {
  const base = getConfig().architectureModelServiceBaseUrl;
  try {
    const packsResponse = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/db-migration-packs`,
      { headers: { Accept: 'application/json' } },
    );
    if (!packsResponse.ok) return null;
    const packs = (await packsResponse.json()) as Array<{ id?: string }>;
    const packId = Array.isArray(packs) && packs.length > 0 ? packs[0]?.id : null;
    if (!packId) return null;
    const filesResponse = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}` +
        `/db-migration-packs/${encodeURIComponent(packId)}/files`,
      { headers: { Accept: 'application/json' } },
    );
    if (!filesResponse.ok) return null;
    const files = (await filesResponse.json()) as Array<{
      file_path?: string;
      content?: string;
    }>;
    const manifest = (Array.isArray(files) ? files : []).find(
      (f) => f.file_path === 'manifest.json',
    );
    if (!manifest?.content) return null;
    const parsed = JSON.parse(manifest.content.replace(/^﻿/, '')) as {
      source_engine?: unknown;
    };
    const engine =
      typeof parsed.source_engine === 'string' ? parsed.source_engine.trim().toLowerCase() : '';
    return SUPPORTED_DB_ENGINES.includes(engine as SupportedDbEngine)
      ? (engine as SupportedDbEngine)
      : null;
  } catch {
    return null;
  }
};

const defaultCreateRun: NonNullable<HarvestDeps['createRun']> = async (args) => {
  const base = getConfig().discoveryServiceBaseUrl;
  const url =
    `${base}/discovery/projects/${encodeURIComponent(args.projectId)}` +
    `/architectures/${encodeURIComponent(args.architectureId)}/runs`;
  const { connection } = args;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      discovery_kind: 'database',
      // Field names are the discovery-service DatabaseDiscoveryConfig shape
      // (camelCase — NOT the AMS snake_case wire; runs.ts consumes it as-is).
      database_config: {
        dbEngine: connection.dbEngine ?? 'sybase',
        host: connection.host,
        port: connection.port,
        databaseName: connection.databaseName,
        includeSchemas: connection.includeSchemas ?? undefined,
        ...((connection.dbEngine ?? 'sybase') === 'mssql' && connection.mssqlAuth
          ? { mssqlAuth: connection.mssqlAuth }
          : {}),
        // Metadata-only: the orchestrator skips the profiling stage entirely
        // for 'none' (databasePackOrchestrator checks profilingMode !== 'none'),
        // so this run reads ONLY catalog tables, never row data.
        profilingMode: 'none',
        queryTimeoutSeconds: 30,
        readOnlyConfirmed: true,
        ...((connection.dbEngine ?? 'sybase') === 'sybase'
          ? { sybaseDriver: connection.sybaseDriver ?? 'auto' }
          : {}),
      },
      // The password lives in this request body ONLY; discovery-service stores
      // it in its in-memory secretsStore for the run's lifetime, never in AMS.
      database_credentials: {
        username: connection.username,
        password: connection.password,
      },
      serviceId: args.serviceId ?? undefined,
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    // The upstream error text never echoes credentials (discovery-service
    // validation errors name fields, not values) — safe to surface.
    throw new Error(`Discovery run creation failed: HTTP ${response.status} ${text}`);
  }
  return JSON.parse(text) as DiscoveryRunRow;
};

const defaultGetRun: NonNullable<HarvestDeps['getRun']> = async (
  projectId,
  architectureId,
  runId
) => {
  const base = getConfig().discoveryServiceBaseUrl;
  const url =
    `${base}/discovery/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}/runs/${encodeURIComponent(runId)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Discovery run read failed: HTTP ${response.status} ${text}`);
  }
  return JSON.parse(text) as DiscoveryRunRow;
};

const defaultListCandidates: NonNullable<HarvestDeps['listCandidates']> = async (
  projectId,
  architectureId,
  runId
) => {
  const base = getConfig().architectureModelServiceBaseUrl;
  // Same AMS path + size cap the gateway's own candidates/bulk-review route
  // uses; a metadata-only DB run stays far below 5000 candidates.
  const url =
    `${base}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}/candidates?page=0&size=5000`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Candidate list failed: HTTP ${response.status} ${text}`);
  }
  const parsed = JSON.parse(text) as
    | { content?: Array<{ id: string; review_status?: string }> }
    | Array<{ id: string; review_status?: string }>;
  return Array.isArray(parsed) ? parsed : parsed.content ?? [];
};

const defaultApproveCandidate: NonNullable<HarvestDeps['approveCandidate']> = async (
  projectId,
  architectureId,
  runId,
  candidateId
) => {
  const base = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${base}/api/model/projects/${encodeURIComponent(projectId)}` +
    `/architectures/${encodeURIComponent(architectureId)}` +
    `/discovery/runs/${encodeURIComponent(runId)}` +
    `/candidates/${encodeURIComponent(candidateId)}/review`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ review_status: 'approved' }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Candidate approve failed (${candidateId}): HTTP ${response.status} ${text}`
    );
  }
};

const defaultSaveApproved: NonNullable<HarvestDeps['saveApproved']> = async (
  projectId,
  architectureId,
  runId
) => {
  const base = getConfig().mcpBaseUrl;
  // Direct MCP call — identical body to the gateway's /save-approved proxy
  // (discovery.ts), minus the trace scoring that proxy layers on top.
  const url = `${base}/mcp/tools/save_approved_candidates`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sessionId: 'gateway',
      projectId,
      architectureId,
      runId,
      commit: true,
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`save_approved_candidates failed: HTTP ${response.status} ${text}`);
  }
  const parsed = JSON.parse(text) as Partial<HarvestSaveBackSummary>;
  return {
    entitiesCreated: parsed.entitiesCreated ?? 0,
    entitiesSkipped: parsed.entitiesSkipped ?? 0,
    candidatesCommitted: parsed.candidatesCommitted ?? 0,
  };
};

const defaultFetchDispositions: NonNullable<HarvestDeps['fetchDispositions']> = async (
  projectId
) => {
  const base = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${base}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-structural-finding-dispositions`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`Disposition read failed: HTTP ${response.status} ${text}`);
  }
  return JSON.parse(text) as StructuralDispositionRow[];
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Poll settings — env-tunable via config-style env vars. Read lazily (not via
// the Config object) so existing config mocks in tests keep working without
// declaring the new fields; the parse rules match config.ts parseIntEnv.
// ---------------------------------------------------------------------------

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

/** Defaults: poll every 5s, give up after 10 min (a catalog-only walk is fast). */
export function getPollSettings(): { intervalMs: number; timeoutMs: number } {
  return {
    intervalMs: intEnv('DB_HARVEST_POLL_INTERVAL_MS', 5_000),
    timeoutMs: intEnv('DB_HARVEST_POLL_TIMEOUT_MS', 600_000),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED']);

function diag(stage: string, extra: string): void {
  // [diag-gateway] stage markers (house style — grep-able across services).
  console.log(`[diag-gateway] db_structural_harvest stage=${stage} ${extra}`);
}

/** Message extraction that NEVER stringifies non-Error objects (a request
 * body accidentally attached to a rejection must not leak into results). */
function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Run the full six-stage harvest. Never throws for chain failures — the
 * returned `stage` + `error` carry the outcome; only programming errors
 * (e.g. bad deps wiring) escape as exceptions.
 */
export async function runStructuralHarvest(
  args: RunStructuralHarvestArgs,
  deps: HarvestDeps = {}
): Promise<StructuralHarvestResult> {
  const createRun = deps.createRun ?? defaultCreateRun;
  const getRun = deps.getRun ?? defaultGetRun;
  const listCandidates = deps.listCandidates ?? defaultListCandidates;
  const approveCandidate = deps.approveCandidate ?? defaultApproveCandidate;
  const saveApproved = deps.saveApproved ?? defaultSaveApproved;
  const regeneratePack = deps.regeneratePack ?? generateDbMigrationPack;
  const fetchDispositions = deps.fetchDispositions ?? defaultFetchDispositions;
  const sleep = deps.sleep ?? defaultSleep;
  const resolveSourceEngine = deps.resolveSourceEngine ?? defaultResolveSourceEngine;

  const settings = getPollSettings();
  const intervalMs = args.pollIntervalMs ?? settings.intervalMs;
  const timeoutMs = args.pollTimeoutMs ?? settings.timeoutMs;
  const { projectId, architectureId } = args;

  // The harvest reads the SOURCE catalog, so it must run the SOURCE engine's
  // catalog SQL. With no engine on the request the project's own pack
  // manifest is the context that knows which one this project migrates from
  // (Spec 5.7); Sybase remains the last-resort default for a project with no
  // pack yet, which is the historical behaviour.
  const harvestArgs: RunStructuralHarvestArgs =
    args.connection.dbEngine !== undefined
      ? args
      : {
          ...args,
          connection: {
            ...args.connection,
            dbEngine: (await resolveSourceEngine(projectId)) ?? undefined,
          },
        };

  // -------------------------------------------------------------------------
  // Stage 1 — create the metadata-only run.
  // -------------------------------------------------------------------------
  diag(
    'create_run',
    `projectId=${projectId} architectureId=${architectureId} ` +
      `engine=${harvestArgs.connection.dbEngine ?? 'sybase'}`
  );
  let runId: string;
  let runStatus: string;
  try {
    const run = await createRun(harvestArgs);
    runId = run.id;
    runStatus = run.status ?? 'RUNNING';
  } catch (error) {
    const message = safeMessage(error);
    logger.warn('db_structural_harvest: run creation failed', { projectId, architectureId });
    return {
      runId: null,
      runStatus: null,
      savedBack: null,
      packRegenerated: false,
      findings: [],
      stage: 'scan_failed',
      error: `Run creation failed: ${message}`,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 2 — poll to a terminal status, bounded by the total timeout. The
  // deadline uses wall-clock so a slow getRun call counts against the budget
  // too (an unresponsive discovery-service must not extend the wait).
  // -------------------------------------------------------------------------
  diag('poll', `runId=${runId} intervalMs=${intervalMs} timeoutMs=${timeoutMs}`);
  const deadline = Date.now() + timeoutMs;
  while (!TERMINAL_STATUSES.has(runStatus)) {
    if (Date.now() >= deadline) {
      return {
        runId,
        runStatus,
        savedBack: null,
        packRegenerated: false,
        findings: [],
        stage: 'scan_failed',
        error:
          `Discovery run ${runId} did not reach a terminal status within ` +
          `${Math.round(timeoutMs / 1000)}s (last status: ${runStatus}).`,
      };
    }
    await sleep(intervalMs);
    try {
      const run = await getRun(projectId, architectureId, runId);
      runStatus = run.status ?? runStatus;
    } catch (error) {
      // Transient poll-read failures are tolerated until the deadline — the
      // run keeps executing server-side regardless of our read.
      logger.warn('db_structural_harvest: poll read failed (will retry)', {
        projectId,
        runId,
        error: safeMessage(error),
      });
    }
  }

  if (runStatus === 'FAILED') {
    diag('poll', `runId=${runId} outcome=FAILED`);
    return {
      runId,
      runStatus,
      savedBack: null,
      packRegenerated: false,
      findings: [],
      stage: 'scan_failed',
      error: `Discovery run ${runId} FAILED — check the run diagnostics for the engine error.`,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 3 — approve the run's candidates (deterministic catalog facts; see
  // module doc for why auto-approval is correct here). Committed rows are
  // skipped (same guard as the bulk-review route); already-approved rows need
  // no PATCH. Any single approve failure aborts — a partial approval would
  // make the save-back silently incomplete.
  // -------------------------------------------------------------------------
  let savedBack: HarvestSaveBackSummary;
  try {
    const candidates = await listCandidates(projectId, architectureId, runId);
    const actionable = candidates.filter(
      (c) => c.review_status !== 'committed' && c.review_status !== 'approved'
    );
    diag(
      'approve',
      `runId=${runId} candidates=${candidates.length} actionable=${actionable.length}`
    );
    // Parallel batches of 20 — mirrors the bulk-review route's fan-out shape
    // (AMS handles per-row PATCHes; batching bounds concurrent sockets).
    const BATCH_SIZE = 20;
    for (let i = 0; i < actionable.length; i += BATCH_SIZE) {
      const batch = actionable.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((c) => approveCandidate(projectId, architectureId, runId, c.id))
      );
      const firstFailure = results.find((r) => r.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
      if (firstFailure) {
        throw firstFailure.reason instanceof Error
          ? firstFailure.reason
          : new Error('Candidate approval failed');
      }
    }

    // -----------------------------------------------------------------------
    // Stage 4 — additive save-back via MCP (commit=true).
    // -----------------------------------------------------------------------
    diag('save_back', `runId=${runId}`);
    savedBack = await saveApproved(projectId, architectureId, runId);
    diag(
      'save_back',
      `runId=${runId} entitiesCreated=${savedBack.entitiesCreated} ` +
        `entitiesSkipped=${savedBack.entitiesSkipped} ` +
        `candidatesCommitted=${savedBack.candidatesCommitted}`
    );
  } catch (error) {
    const message = safeMessage(error);
    logger.warn('db_structural_harvest: approve/save-back failed', { projectId, runId });
    return {
      runId,
      runStatus,
      savedBack: null,
      packRegenerated: false,
      findings: [],
      stage: 'save_failed',
      error: `Save-back failed: ${message}`,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 5 — regenerate the pack in-process against the backfilled model.
  // -------------------------------------------------------------------------
  diag('regenerate', `projectId=${projectId} architectureId=${architectureId}`);
  let generation: GenerateDbMigrationPackResult;
  try {
    generation = await regeneratePack({
      projectId,
      architectureId,
      targetArchitectureId: args.targetArchitectureId ?? null,
    });
  } catch (error) {
    const message = safeMessage(error);
    logger.warn('db_structural_harvest: pack regeneration failed', { projectId, runId });
    return {
      runId,
      runStatus,
      savedBack,
      packRegenerated: false,
      findings: [],
      stage: 'regenerate_failed',
      error: `Pack regeneration failed: ${message}`,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 6 — refreshed finding states. A disposition-read failure degrades
  // to "all findings undispositioned" (same tolerance as the
  // structural-findings GET route) rather than failing the whole harvest.
  // -------------------------------------------------------------------------
  let dispositions: StructuralDispositionRow[] = [];
  try {
    dispositions = await fetchDispositions(projectId);
  } catch (error) {
    logger.warn('db_structural_harvest: dispositions read failed (degrading)', {
      projectId,
      error: safeMessage(error),
    });
  }
  const manifest = (generation.pack.manifest_json ?? {}) as {
    structural_findings?: Array<{ kind: string; subject: string; message: string }>;
    structural_warnings?: string[];
  };
  const findings = resolveStructuralFindingStates(manifest, dispositions);
  diag(
    'completed',
    `runId=${runId} findings=${findings.length} open=${findings.filter((f) => f.open).length}`
  );

  return {
    runId,
    runStatus,
    savedBack,
    packRegenerated: true,
    findings,
    stage: 'completed',
  };
}
