import { Router } from 'express';
import { phase0Router } from './phase0';
import { phase1Router } from './phase1';
import { runsRouter } from './runs';
import { sourceRouter } from './source';
import { logEnrichmentRouter, reprocessRouter } from './logEnrichment';
import { hypothesisQaRouter } from './hypothesisQa';
import { packsRouter } from './packs';
import { techHintsResolveRouter } from './techHintsResolve';
import { preflightLibraryScanRouter } from './preflightLibraryScan';
import { databaseRouter } from './database';

/**
 * Discovery Routes Barrel
 *
 * A single Express Router that mounts the Phase 0, Phase 1, Runs,
 * Log Enrichment, Reprocess, Hypothesis Q&A, Tech-Hints Resolve, and
 * Preflight Library Scan (Spec 2026-05-06) route handlers. Mounted at
 * `/discovery` in the Express app entry point.
 *
 * Spec: 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) —
 * Task Group 4. The runs router is mounted under
 * `/projects/:projectId/architectures/:architectureId/runs` (hard cutover
 * from the previous bare `/runs` shape). Forgetting `:architectureId`
 * produces a 404 at the Express layer (no fallback / no silent
 * default-resolution) — mirrors the architecture-model-service backend's
 * path-segment safety property (b).
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 5: the
 * preflight library-scan router is mounted at the discovery root (its
 * handlers carry the full `/projects/:p/architectures/:a/...` path
 * because the two endpoint shapes differ at the segment level).
 *
 * Spec 2026-05-16 Database Discovery Packs -- Task Group 3: the new
 * `databaseRouter` is mounted at `/db` for the test-connection probe.
 * Full DB run-create wiring lands in Group 5 (gateway proxy + frontend
 * connection form).
 *
 * Spec 2026-05-17 SOAP LLM Extraction and Payload Enrichment (Phase 2) --
 * Task Group 1: the new `sourceRouter` is mounted at the SAME
 * architecture-scoped prefix as the runs router so its handlers inherit
 * the identical auth posture / middleware chain (W-13: no new auth
 * surface introduced). It serves the new
 * `GET /runs/:runId/source/*` endpoint that returns repo-relative
 * source files from the run's cached clone for downstream LLM tools.
 *
 * The other sibling routes (phase0, phase1, packs, log-enrichment,
 * reprocess, hypothesis-qa, tech-hints) remain at their existing mount
 * points for now — they are project-scoped utility endpoints rather than
 * run-binding lifecycle events. Their forwarded-from-gateway requests
 * carry `projectId` and (now also) `architectureId` in body / query so
 * they can be threaded through to archModelClient calls without a URL
 * shape change.
 */
const discoveryRouter = Router({ mergeParams: true });

discoveryRouter.use('/phase0', phase0Router);
discoveryRouter.use('/phase1', phase1Router);
// Architecture-scoped runs router — the canonical mount for spec #4.
// `mergeParams: true` on `runsRouter` propagates :projectId + :architectureId
// from this mount path into the router's route handlers.
discoveryRouter.use(
  '/projects/:projectId/architectures/:architectureId/runs',
  runsRouter,
);
// Spec 2026-05-17 Phase 2 (Group 1). Mounted under the SAME architecture-
// scoped prefix as runsRouter so the source endpoint sits as a sibling
// of the other run-scoped routes and inherits their middleware chain.
discoveryRouter.use(
  '/projects/:projectId/architectures/:architectureId/runs',
  sourceRouter,
);
// Spec 2026-05-06 — Library Discovery Integration. The preflight handlers
// are explicit-path so they sit alongside the runs router at the discovery
// root. No `discovery_runs` row is ever created by these endpoints.
discoveryRouter.use('/', preflightLibraryScanRouter);
discoveryRouter.use('/packs', packsRouter);

// Spec 2026-04-05: Log-based Discovery Enrichment (Increment 14)
discoveryRouter.use('/log-enrichment', logEnrichmentRouter);
discoveryRouter.use('/reprocess', reprocessRouter);

// Spec 2026-04-06: Hypothesis-First Discovery Q&A (Increment 15)
discoveryRouter.use('/hypothesis-qa', hypothesisQaRouter);

// Spec 2026-04-20: Tech Hints LLM Resolution
discoveryRouter.use('/tech-hints', techHintsResolveRouter);

// Spec 2026-05-16: Database Discovery Packs -- Group 3 test-connection probe.
discoveryRouter.use('/db', databaseRouter);

export { discoveryRouter };
