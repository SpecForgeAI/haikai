import { Router, Request, Response } from 'express';
import { archModelClient } from '../services/archModelClient';
import { startRun, resumeRun, VALID_STEPS } from '../services/runManager';
import { scoreRun } from '../services/performancePostRun';
import { computeTier } from '../services/extensionPackRegistry';
import { tierToMode, tierToWarnings } from '../utils/tierCopy';
import type { TechHints } from '../services/extensionPacks/packTypes';
import type { DiscoveryConfigPayload } from '../types/projectContext';
// Spec 1 — Deterministic Review Model + Cascade/Dependency Graph + Aggregation
// Backbone. The review-model read endpoint computes the model live on read.
import { buildReviewModel } from '../services/reviewModel/buildReviewModel';
import type { ScanKind, ScanRunInput } from '../services/reviewModel/types';

/**
 * Maps the two resolved-column values (`core_tech_language_pack` + `core_tech_framework_packs`)
 * straight to a V3 tier without reconstructing a hint array.
 *
 * Contract matches `computeTier` from `extensionPackRegistry`:
 *   - `'A'` — languagePack non-null AND frameworkPacks non-empty.
 *   - `'B'` — languagePack non-null, frameworkPacks empty.
 *   - `'C'` — languagePack null (frameworkPacks ignored: the registry contract
 *     requires a LanguagePack match before any FrameworkPack can apply).
 *
 * Used on the service-scoped `POST /discovery/runs` path after Task Group 4
 * of the 2026-04-20 Tech Hints LLM Resolution spec. Project-scoped runs still
 * go through `computeTier(techHints)` — only the service-scoped path reads
 * the resolved columns.
 */
function computeTierFromResolvedColumns(
  languagePack: string | null,
  frameworkPacks: string[] | null,
): 'A' | 'B' | 'C' {
  const hasLang = typeof languagePack === 'string' && languagePack.length > 0;
  const hasFw = Array.isArray(frameworkPacks) && frameworkPacks.length > 0;
  if (hasLang && hasFw) return 'A';
  if (hasLang) return 'B';
  return 'C';
}

/**
 * Asserts the URL `architectureId` matches the run's stored `architectureId`
 * for run-scoped routes, returning 409 Conflict on mismatch. This is the
 * "mismatch-409" defence described in spec #4 Task Group 4 and is a defence
 * in depth — the frontend should never get this wrong, but if it does we
 * fail fast with a clear message rather than silently writing to the wrong
 * architecture.
 *
 * Returns `true` when the mismatch was detected and a 409 has already been
 * sent on `res`; the caller MUST then return without further action. Returns
 * `false` when the architectureId matches (or when the run does not exist;
 * a separate 404 is the caller's responsibility in that case).
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) —
 * Task Group 4.
 */
async function assertArchitectureMatchesRun(
  res: Response,
  projectId: string,
  runId: string,
  urlArchitectureId: string,
): Promise<{ matched: true; run: any } | { matched: false }> {
  // Pass the URL architectureId explicitly so the architecture-model-service
  // controller filters by it. Mismatch surfaces as a 404 from the controller
  // (cross-architecture leakage prevention); we then map that to either 404
  // ("run not found") or 409 ("URL arch differs from run's bound arch") below.
  const run = await archModelClient.getDiscoveryRun(projectId, runId, urlArchitectureId);
  if (!run) {
    res.status(404).json({
      error: { code: 404, message: 'Discovery run not found' },
    });
    return { matched: false };
  }
  // The run row carries an `architecture_id` after Spec #4 Group 1 changeset
  // 095 (NOT NULL FK). Older code paths may still reference `architectureId`
  // (camelCase) — accept both shapes defensively.
  const runArchitectureId =
    (run as unknown as Record<string, unknown>).architecture_id ??
    (run as unknown as Record<string, unknown>).architectureId;
  if (
    typeof runArchitectureId === 'string' &&
    runArchitectureId.length > 0 &&
    runArchitectureId !== urlArchitectureId
  ) {
    res.status(409).json({
      error: {
        code: 409,
        message:
          `URL architectureId (${urlArchitectureId}) does not match the run's ` +
          `bound architectureId (${runArchitectureId}). Discovery runs are ` +
          `bound to one architecture for life.`,
      },
    });
    return { matched: false };
  }
  return { matched: true, run };
}

/**
 * Runs Route Handler
 *
 * Provides endpoints for creating and retrieving discovery runs, all bound
 * to an explicit `architectureId` per spec #4.
 *
 * URL shape (hard cutover by Spec #4 Group 4):
 *   POST   /projects/:projectId/architectures/:architectureId/runs
 *   GET    /projects/:projectId/architectures/:architectureId/runs/:runId
 *   GET    /projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics
 *   POST   /projects/:projectId/architectures/:architectureId/runs/:runId/resume
 *   POST   /projects/:projectId/architectures/:architectureId/runs/:runId/rescore
 *
 * Forgetting `:architectureId` produces a 404 at the Express layer (no
 * fallback / no silent default-resolution). Mirrors the architecture-model
 * service backend's path-segment safety property (b).
 *
 * Run-scoped sub-routes (those with `:runId`) defensively cross-check that
 * the URL `:architectureId` matches the architecture stored on the run row;
 * mismatch returns 409 Conflict.
 *
 * Earlier specs whose contracts this file still implements:
 *   - Spec 2026-04-04 (Discovery Run Model and Orchestration)
 *   - Spec 2026-04-06 Increment 16, Task Group 6 (Diagnostics endpoint)
 *   - Spec 2026-04-16 (Service-Scoped Discovery, TG6)
 *   - Spec 2026-04-20 V3 Tier UX (Task Groups 3, 4, 5)
 */
const runsRouter = Router({ mergeParams: true });

/**
 * POST /projects/:projectId/architectures/:architectureId/runs
 *
 * Creates a new discovery run for the given project + architecture.
 *
 * Accepts { serviceId?: string, confirmLlmSolo?: boolean } in the request
 * body. `projectId` and `architectureId` are sourced from the URL path —
 * they MUST NOT be passed in the body (the URL is the source of truth).
 *
 * The new run is bound to `:architectureId` for life. The bound id is:
 *   - persisted on the discovery_runs row by architecture-model-service
 *     (Spec #4 Group 2).
 *   - registered in the in-process runArchitectureRegistry by runManager
 *     so every entity-fetch and save-back during the run reads the bound
 *     value rather than re-resolving the project default.
 *
 * Validation:
 * - serviceId: if present, must be a non-empty string.
 * - confirmLlmSolo: if present, must be a strict boolean (truthy strings
 *   like `"true"` are rejected 400 — the opt-in must be explicit).
 *
 * Flow (preserved from Spec 2026-04-20 Task Group 4):
 * 1. Synthesize techHints from either `getService(serviceId).core_tech` or
 *    `getDiscoveryConfig(projectId).config_payload.techHints`.
 * 2. Call `computeTier(techHints)` to derive the A/B/C tier.
 * 3. Map tier → mode + warnings.
 * 4. If tier === 'C' AND `confirmLlmSolo !== true`: return 409 with
 *    `LLM_SOLO_CONFIRMATION_REQUIRED`. NO archmodel call is made.
 * 5. Otherwise, create the run via archmodel with the tier metadata baked
 *    in, then kick off `startRun` asynchronously with the pre-computed
 *    tier so `runDiscoveryV3` reuses it verbatim.
 *
 * Response body additively includes `mode`, `tier`, and `warnings` on
 * successful creation.
 */
runsRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, architectureId } = req.params as {
    projectId: string;
    architectureId: string;
  };
  const { serviceId, confirmLlmSolo, doPerformanceRun } = req.body;
  const runMode: string | undefined = req.body?.runMode;
  const includeExternal: boolean = req.body?.includeExternal === true;
  const libraryId: string | undefined = req.body?.libraryId;
  // Spec 2026-05-16 Database Discovery Packs -- D3 + route wiring follow-up.
  // The frontend Source toggle posts `discovery_kind = 'database'` for DB
  // discovery runs, plus a `database_config` blob and `database_credentials`
  // bundle. The credentials are NEVER persisted to AMS -- runManager hands
  // them to `secretsStore` for the lifetime of the run only.
  const discoveryKind: 'code' | 'database' | 'combined' | undefined =
    req.body?.discovery_kind;
  const databaseConfig = req.body?.database_config as
    | import('../services/databasePacks/types').DatabaseDiscoveryConfig
    | undefined;
  const databaseCredentials = req.body?.database_credentials as
    | import('../services/databasePacks/types').DatabaseDiscoveryCredentials
    | undefined;

  // -----------------------------------------------------------------------
  // Spec 2026-05-21 Library-Scoped Unification.
  //
  // "Start Discovery Run" (with libraries) was previously a separate flow
  // that skipped the tier gate, identity snapshot, and confirmLlmSolo
  // check — producing Tier-C LLM-solo runs when the user expected Tier-A
  // parity with the no-libraries flow. The two flows are now ONE: the
  // default branch below handles both modes, and `runMode === 'library-
  // scoped'` is just a flag (`includeLibraries: true`) that the
  // orchestrator uses to expand the code-base set via sibling-folder
  // dependency resolution before scanning.
  //
  // Library-scoped requests still require a serviceId (libraryId-only
  // entry points are out of scope until that user-facing flow is
  // re-shaped to match this unification).
  // -----------------------------------------------------------------------
  const includeLibraries: boolean =
    runMode === 'library-scoped' || req.body?.includeLibraries === true;
  if (includeLibraries && !serviceId) {
    res.status(400).json({
      error: {
        code: 400,
        message:
          'library-scoped runs require serviceId (libraryId-only entry is not supported in v1)',
      },
    });
    return;
  }
  // `libraryId` and `includeExternal` are accepted for backwards compatibility
  // but ignored in the unified flow. v1 always walks internal deps, never
  // externals; library-rooted runs (no serviceId) are out of scope.
  void libraryId;
  void includeExternal;

  // -----------------------------------------------------------------------
  // Spec 2026-05-16 Database Discovery Packs -- D3 + route wiring follow-up.
  // Database-kind run: skip V3 tier gate, skip discovery_config fetch, skip
  // service identity snapshot. AMS persists the run with
  // `discovery_kind='database'`; runManager.startRun dispatches into
  // startDatabaseRun based on options.discoveryKind. Credentials live in
  // discovery-service in-process memory only -- NEVER persisted to AMS.
  //
  // Spec 2026-06-06 fix: pass the request's `serviceId` through to
  // createDiscoveryRun (it was hardcoded `undefined` here). Without it the run
  // is persisted with NULL `service_id`, so the Review Room's per-service
  // grouping (keys on `run.service_id`) drops a Persistence-Tier database scan
  // into the "Unassigned scans" bucket instead of under its service name. The
  // code-scoped branch below already passes `serviceId || undefined`.
  // -----------------------------------------------------------------------
  if (discoveryKind === 'database') {
    console.log(
      `[diag-runs] route=/runs branch=database kind_received=database ` +
        `has_config=${Boolean(databaseConfig)} has_creds=${Boolean(databaseCredentials)}`,
    );
    if (!databaseConfig || !databaseCredentials) {
      console.warn(
        `[diag-runs] route=/runs branch=database reject=${!databaseConfig ? 'missing_config' : 'missing_credentials'}`,
      );
      res.status(400).json({
        error: {
          code: 400,
          message:
            'discovery_kind=database requires both database_config and database_credentials in the request body',
        },
      });
      return;
    }
    try {
      const run = await archModelClient.createDiscoveryRun(
        projectId,
        architectureId,
        serviceId || undefined,
        { discoveryKind: 'database' },
      );
      startRun(projectId, run.id, architectureId, serviceId || undefined, {
        discoveryKind: 'database',
        databaseConfig,
        databaseCredentials,
      }).catch((err) => {
        console.error(
          `[RunManager] Error executing database run ${run.id} for project ${projectId} (architecture ${architectureId}):`,
          err,
        );
      });
      res.json({ ...run, discovery_kind: 'database' });
    } catch (error: any) {
      console.error('[runs] Error creating database discovery run:', error?.message || error);
      const statusCode = error?.response?.status || 500;
      res.status(statusCode).json({
        error: {
          code: statusCode,
          message:
            error?.response?.data?.message ||
            error?.message ||
            'Failed to create database discovery run',
        },
      });
    }
    return;
  }


  // Validate serviceId when present: must be a non-empty string
  if (serviceId !== undefined && serviceId !== null) {
    if (typeof serviceId !== 'string' || serviceId.trim() === '') {
      res.status(400).json({
        error: {
          code: 400,
          message: 'serviceId must be a non-empty string when provided',
        },
      });
      return;
    }
  }

  // Strict validation: confirmLlmSolo must be a real boolean when present.
  // We do NOT coerce truthy strings like "true" — the opt-in must be
  // explicit per spec (Task Group 4 notes).
  if (confirmLlmSolo !== undefined && confirmLlmSolo !== null) {
    if (typeof confirmLlmSolo !== 'boolean') {
      res.status(400).json({
        error: {
          code: 400,
          message: 'confirmLlmSolo must be a boolean when provided',
        },
      });
      return;
    }
  }

  try {
    // -----------------------------------------------------------------------
    // Step 1: Compute tier.
    //   - Service-scoped: read the resolved columns directly. Pass the URL's
    //     architectureId straight through to `getService` — this is the
    //     authoritative architecture for the run-to-be.
    //   - Project-scoped: unchanged — synthesize techHints from the
    //     discovery config and run `computeTier`.
    // -----------------------------------------------------------------------
    let tier: 'A' | 'B' | 'C';
    // Service identity snapshot for orphan-run UI. Populated only on the
    // service-scoped branch where we already fetch the service entity for
    // tier computation. Library-scoped and project-scoped (no serviceId)
    // runs skip the snapshot entirely. Spec: 2026-05-11 Discovery Run
    // Robustness -- Section 2.
    let serviceIdentitySnapshot:
      | {
          serviceId: string;
          serviceName: string;
          serviceType: string | null;
          applicationId: string | null;
          repoLocation: string | null;
          repoSubfolder: string | null;
        }
      | undefined = undefined;

    if (serviceId) {
      const service = await archModelClient.getService(projectId, architectureId, serviceId);
      if (!service) {
        res.status(404).json({
          error: {
            code: 404,
            message: `Service ${serviceId} not found in project ${projectId} (architecture ${architectureId})`,
          },
        });
        return;
      }

      // Tech Hints LLM Resolution gate: `coreTechResolved` NULL means the
      // service has never been resolved (pre-migration or new row that was
      // saved without a resolve completing). Reject with a user-directing
      // 409 so the UX can deep-link to the row for resolution.
      if (service.core_tech_resolved === null || service.core_tech_resolved === undefined) {
        res.status(409).json({
          error: {
            code: 'TECH_HINTS_UNRESOLVED',
            message: 'Resolve tech hints before starting discovery.',
          },
        });
        return;
      }

      tier = computeTierFromResolvedColumns(
        service.core_tech_language_pack ?? null,
        service.core_tech_framework_packs ?? null,
      );

      // Build the snapshot from the same service fetch -- atomic with run
      // creation, so the snapshot is in the DB before any async startRun
      // work begins. Six identifier-ish fields only; we deliberately skip
      // description, tags, and resolved-tech columns (Spec 2026-05-11 § 2.4).
      serviceIdentitySnapshot = {
        serviceId: service.id,
        serviceName: service.name,
        serviceType: service.service_type ?? null,
        applicationId: service.application_id ?? null,
        repoLocation: service.repo_location ?? null,
        repoSubfolder: service.repo_subfolder ?? null,
      };
    } else {
      // Project-scoped path: pass the URL `architectureId` through to the
      // architecture-model-service so the architecture-scoped controller can
      // serve the request. Spec #4 Group 2 reshaped DiscoveryConfigController
      // under `/api/model/projects/{projectId}/architectures/{architectureId}`.
      const config = await archModelClient.getDiscoveryConfig(projectId, architectureId);
      if (!config) {
        res.status(400).json({
          error: {
            code: 400,
            message: `No discovery config found for project ${projectId}. Complete framing config before creating a run.`,
          },
        });
        return;
      }
      const payload = config.config_payload as DiscoveryConfigPayload | undefined;
      const techHints: TechHints = (payload?.techHints as TechHints | undefined) ?? {};
      tier = computeTier(techHints);
    }

    // -----------------------------------------------------------------------
    // Step 2: Derive mode + build warnings from the computed tier.
    // -----------------------------------------------------------------------
    const mode = tierToMode(tier);
    const warnings = tierToWarnings(tier);

    // -----------------------------------------------------------------------
    // Step 3: Tier C gate — reject with 409 BEFORE any archmodel call when
    // the operator has not explicitly opted in via `confirmLlmSolo: true`.
    // -----------------------------------------------------------------------
    if (tier === 'C' && confirmLlmSolo !== true) {
      res.status(409).json({
        error: {
          code: 'LLM_SOLO_CONFIRMATION_REQUIRED',
          message:
            'Tier C (LLM-only) runs require explicit opt-in. Resubmit with confirmLlmSolo: true to proceed.',
          tier,
          mode,
          warnings,
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Step 4: Create run with tier metadata. `confirmedLlmSolo` is TRUE only
    // when tier C proceeded via the opt-in; FALSE for every other tier.
    // -----------------------------------------------------------------------
    const confirmedLlmSolo = tier === 'C' && confirmLlmSolo === true;
    const run = await archModelClient.createDiscoveryRun(
      projectId,
      architectureId,
      serviceId || undefined,
      {
        mode: tier,
        warnings,
        confirmedLlmSolo,
        // Forward the snapshot only on the service-scoped branch (otherwise
        // undefined and the field is omitted from the POST body shape).
        serviceIdentitySnapshot,
      },
    );

    // -----------------------------------------------------------------------
    // Step 5: Kick off run execution asynchronously. Pass the pre-computed
    // tier so `runDiscoveryV3` uses it verbatim and does NOT re-derive via
    // `computeTier` (Task Group 3 contract). The run is bound to
    // `architectureId` for life by the runManager.
    // -----------------------------------------------------------------------
    let doPerformanceRunOpt: boolean | undefined = undefined;
    if (doPerformanceRun !== undefined && doPerformanceRun !== null) {
      if (typeof doPerformanceRun !== 'boolean') {
        res.status(400).json({
          error: { code: 400, message: 'doPerformanceRun must be a boolean when provided' },
        });
        return;
      }
      doPerformanceRunOpt = doPerformanceRun;
    }

    startRun(projectId, run.id, architectureId, serviceId || undefined, { tier, doPerformanceRun: doPerformanceRunOpt, includeLibraries }).catch((err) => {
      console.error(
        `[RunManager] Error executing run ${run.id} for project ${projectId} (architecture ${architectureId})` +
          `${serviceId ? ` (service: ${serviceId})` : ''}:`,
        err,
      );
    });

    // -----------------------------------------------------------------------
    // Step 6: Enriched response body (additive fields only).
    // -----------------------------------------------------------------------
    res.json({
      ...run,
      mode,
      tier,
      warnings,
    });
  } catch (error: any) {
    console.error('[runs] Error creating discovery run:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to create discovery run',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/resume
 *
 * Resumes a FAILED discovery run from a specific step. Validates that the
 * URL `:architectureId` matches the run's stored architecture id (mismatch
 * returns 409). Accepts { fromStep: string } in the request body.
 *
 * NOTE: This route MUST be registered before /:runId to avoid
 * "resume" being captured as a runId parameter.
 */
runsRouter.post('/:runId/resume', async (req: Request, res: Response) => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };
  const { fromStep } = req.body;

  if (!fromStep || typeof fromStep !== 'string' || fromStep.trim() === '') {
    res.status(400).json({
      error: {
        code: 400,
        message: 'fromStep is required',
      },
    });
    return;
  }

  if (!VALID_STEPS.includes(fromStep as typeof VALID_STEPS[number])) {
    res.status(400).json({
      error: {
        code: 400,
        message: `Invalid fromStep: ${fromStep}. Valid steps: ${VALID_STEPS.join(', ')}`,
      },
    });
    return;
  }

  try {
    // Defence in depth: check the URL architectureId matches the run's stored id
    // before any further work.
    const matchResult = await assertArchitectureMatchesRun(res, projectId, runId, architectureId);
    if (!matchResult.matched) {
      // assertArchitectureMatchesRun has already responded with 404 or 409.
      return;
    }
    const run = matchResult.run;

    if (run.status !== 'FAILED') {
      res.status(409).json({
        error: {
          code: 409,
          message: `Cannot resume run: status is ${run.status}, expected FAILED`,
        },
      });
      return;
    }

    // Fire-and-forget: kick off resume execution asynchronously
    resumeRun(projectId, runId, architectureId, fromStep).catch((err) => {
      console.error(`[RunManager] Error resuming run ${runId} from step ${fromStep}:`, err);
    });

    res.json(run);
  } catch (error: any) {
    console.error('[runs] Error resuming discovery run:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to resume discovery run',
      },
    });
  }
});

/**
 * POST /projects/:projectId/architectures/:architectureId/runs/:runId/rescore
 *
 * Re-runs the performance scorer against an existing COMPLETED run
 * without re-running discovery. Useful when:
 *   - A previous scoring attempt failed (LLM hiccup, parse error)
 *   - The rubric changed and you want to re-grade an existing run
 *   - A pack code change has landed and you want to compare scores
 *     against the same candidate set
 *
 * Synchronous: blocks until scoring completes and returns the result.
 * Validates that the run exists, is COMPLETED, and the URL `:architectureId`
 * matches the run's stored id (mismatch 409).
 *
 * NOTE: must be registered before the catch-all `/:runId` GET.
 */
runsRouter.post('/:runId/rescore', async (req: Request, res: Response) => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };

  try {
    const matchResult = await assertArchitectureMatchesRun(res, projectId, runId, architectureId);
    if (!matchResult.matched) {
      return;
    }
    const run = matchResult.run;
    if (run.status !== 'COMPLETED') {
      res.status(409).json({
        error: {
          code: 409,
          message: `Cannot rescore run: status is ${run.status}, expected COMPLETED`,
        },
      });
      return;
    }

    const result = await scoreRun({ projectId, runId });
    res.json(result);
  } catch (error: any) {
    console.error('[runs] Error rescoring discovery run:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to rescore discovery run',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/diagnostics
 *
 * Returns the run's steps_payload enriched with any timing data and
 * evidence/relationship/cluster/candidate counts already embedded in
 * stepsPayload. Validates URL architectureId matches the run's stored id.
 *
 * NOTE: This route MUST be registered before /:runId to avoid
 * "diagnostics" being captured as a runId parameter.
 */
runsRouter.get('/:runId/diagnostics', async (req: Request, res: Response) => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };

  try {
    const matchResult = await assertArchitectureMatchesRun(res, projectId, runId, architectureId);
    if (!matchResult.matched) {
      return;
    }
    const run = matchResult.run;

    // Return the steps_payload directly -- it already contains timing data
    // (stepStartedAt, stepCompletedAt, durationMs) and per-step counts
    // (atomCounts, relationshipCount, clusterCount, candidateCount, etc.)
    // persisted by the instrumented startRun function.
    const stepsPayload = run.steps_payload || {};

    res.json({
      runId: run.id,
      projectId: run.project_id,
      status: run.status,
      stepsPayload,
    });
  } catch (error: any) {
    console.error('[runs] Error fetching diagnostics:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to fetch diagnostics',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId/review-model
 *       [?secondRunId=<run-id>]
 *
 * Spec 1 — Deterministic Review Model + Cascade/Dependency Graph + Aggregation
 * Backbone. Computes the deterministic review model LIVE on read for a scan
 * selection of up to two runs (≤1 code-kind + ≤1 database-kind) and returns it.
 *
 * READ-ONLY: the endpoint NEVER writes `review_status` / `_conflictResolutions`
 * back to AMS and makes NO AMS schema change. It only READS candidates +
 * findings (via `getCandidatesByRun` / `listDiscoveryFindings`) and the run
 * rows (via `getDiscoveryRun`, for `discovery_kind` classification), then
 * assembles the model in memory via the pure Groups 1-3 builder.
 *
 * Scan selection (per-service scan selection,
 * `2026-06-05-per-service-scan-selection`):
 *   - the path `:runId` is the PRIMARY run (the thread/path anchor);
 *   - the FULL additional-run-id set rides as repeated `secondRunId` query
 *     params (0..N), so a 2-code + 1-DB (UI + Service + DB) selection is valid.
 * There is NO run-count cap and NO same-kind rejection -- the review-model
 * builder already unions an ARRAY of N runs. The surviving guards reject a
 * MISSING run (404), an architecture mismatch (409), and a duplicate / self-
 * referencing additional run id (no additional id may equal the primary).
 *
 * NOTE: must be registered BEFORE the catch-all `/:runId` GET so `review-model`
 * is never captured as a runId.
 *
 * snake_case on the wire (the model interfaces are authored snake_case and
 * serialize verbatim).
 */
runsRouter.get('/:runId/review-model', async (req: Request, res: Response) => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };

  // --- Normalize the scan selection (primary + the FULL additional set) -----
  // Per-service scan selection (`2026-06-05-per-service-scan-selection`): the
  // path `:runId` is the PRIMARY anchor; the additional runs ride as repeated
  // `secondRunId` query params (0..N). There is NO run-count cap and NO
  // same-kind rejection -- the builder unions an ARRAY of N runs -- so a
  // 2-code + 1-DB selection is valid. The additional ids are de-duped and must
  // each differ from the primary (the only surviving self-reference guard).
  const rawSecond = req.query.secondRunId;
  const rawSecondList: string[] = Array.isArray(rawSecond)
    ? rawSecond.map((v) => String(v))
    : typeof rawSecond === 'string'
      ? [rawSecond]
      : [];
  const additionalRunIds: string[] = [];
  const seenAdditional = new Set<string>([runId]);
  for (const raw of rawSecondList) {
    const id = raw.trim();
    if (id === '') continue;
    if (id === runId) {
      res.status(400).json({
        error: {
          code: 400,
          message: 'Invalid scan selection: an additional secondRunId must differ from the primary runId.',
        },
      });
      return;
    }
    if (seenAdditional.has(id)) continue; // de-dupe a run id repeated in the set
    seenAdditional.add(id);
    additionalRunIds.push(id);
  }

  const selectedRunIds = [runId, ...additionalRunIds];

  try {
    // --- Pass 1: fetch + classify each selected run, VALIDATING the whole ----
    // selection BEFORE any candidate/finding fetch. An invalid selection (a
    // missing run or an arch mismatch) is rejected without any wasted candidate
    // fetch. Multiple runs of the SAME kind (e.g. a UI + a Service code scan)
    // are now VALID (per-service scan selection) -- the builder unions them.
    const classified: Array<{ id: string; scanKind: ScanKind }> = [];
    for (const id of selectedRunIds) {
      const run = await archModelClient.getDiscoveryRun(projectId, id, architectureId);
      if (!run) {
        res.status(404).json({
          error: { code: 404, message: `Discovery run not found: ${id}` },
        });
        return;
      }
      const runArchitectureId =
        (run as unknown as Record<string, unknown>).architecture_id ??
        (run as unknown as Record<string, unknown>).architectureId;
      if (
        typeof runArchitectureId === 'string' &&
        runArchitectureId.length > 0 &&
        runArchitectureId !== architectureId
      ) {
        res.status(409).json({
          error: {
            code: 409,
            message:
              `URL architectureId (${architectureId}) does not match run ${id}'s ` +
              `bound architectureId (${runArchitectureId}).`,
          },
        });
        return;
      }

      // Classify run kind. `combined` is never produced (runs are code XOR
      // database); treat anything non-database as code (the AMS default). NOTE:
      // same-kind runs are intentionally permitted now (a 2-code + 1-DB set is
      // valid) -- the builder unions the ARRAY regardless of kind multiplicity.
      const scanKind: ScanKind = run.discovery_kind === 'database' ? 'database' : 'code';
      classified.push({ id, scanKind });
    }

    // --- Pass 2: fetch candidates + findings for the validated selection -----
    // (READ-only — no write-back of review_status / _conflictResolutions).
    // Pass the URL `architectureId` VERBATIM to both reads. This is a READ with no
    // in-flight run binding, so letting the client re-resolve would fall back to the
    // project's DEFAULT architecture and a run bound to a non-default architecture
    // would 404 via the AMS run guard (the Pass-1 `getDiscoveryRun` already passes it).
    const runInputs: ScanRunInput[] = [];
    for (const { id, scanKind } of classified) {
      const candidates = await archModelClient.getCandidatesByRun(
        projectId, id, undefined, undefined, architectureId,
      );
      const findingsResponse = await archModelClient.listDiscoveryFindings(
        projectId, id, undefined, architectureId,
      );
      runInputs.push({
        run_id: id,
        scan_kind: scanKind,
        candidates,
        findings: findingsResponse.items,
      });
    }

    // --- Assemble the deterministic model (pure, in-memory) ----------------
    const model = buildReviewModel(runInputs);
    res.json(model);
  } catch (error: any) {
    console.error('[runs] Error computing review model:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message:
          error?.response?.data?.message || error?.message || 'Failed to compute review model',
      },
    });
  }
});

/**
 * GET /projects/:projectId/architectures/:architectureId/runs/:runId
 *
 * Retrieves a discovery run by ID. Validates URL architectureId matches the
 * run's stored id. Returns the run DTO or 404 if not found.
 */
runsRouter.get('/:runId', async (req: Request, res: Response) => {
  const { projectId, architectureId, runId } = req.params as {
    projectId: string;
    architectureId: string;
    runId: string;
  };

  try {
    const matchResult = await assertArchitectureMatchesRun(res, projectId, runId, architectureId);
    if (!matchResult.matched) {
      return;
    }
    res.json(matchResult.run);
  } catch (error: any) {
    console.error('[runs] Error fetching discovery run:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to fetch discovery run',
      },
    });
  }
});

export { runsRouter };
