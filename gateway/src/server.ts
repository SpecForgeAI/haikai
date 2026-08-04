/**
 * Gateway Server Entry Point
 *
 * This server provides HTTP endpoints for chat orchestration between
 * the frontend and OpenAI, with tool execution via the MCP server.
 */

import express from 'express';
import { getConfig } from './config';
import { chatRouter, healthRouter, orchestrationsRouter, implementationProjectsRouter, implementConversationsRouter, implementStateRouter, organisationsRouter, shapeSpecRouter, standardsGenerateRouter, projectStandardsGenerateRouter, jiraIssuesRouter, jiraImportRouter, jiraSyncRouter, dashboardSummaryRouter, chatV2Router, architectureExplainerRouter, discoveryRouter, discoveryDecisionTasksRouter, discoveryGapFillRouter, discoveryLogRecipeRouter, discoveryBehaviourCaptureRouter, discoveryOperationalArtifactRouter, discoveryCapabilityNamingRouter, techHintsResolveRouter, discoveryPerformanceScoreRouter, pdfRouter, architecturesRouter, apiMigrationValidationRouter, migrationContextRouter, migrationBookOfWorkRouter, migrationShapeSpecGenerationRouter, migrationShapeSpecCostPreviewRouter, migrationDeliveryDashboardRouter, epicCapturedDecisionsRouter, targetArchitecturesRouter, missingInputResolutionsRouter, architectConversationRouter, discoveryReviewConversationRouter, dbMigrationPackRouter, oasExportRouter, vulnerabilitiesRouter, securityFindingsRouter, vulnerabilityReductionRouter, migrationExecutionRouter } from './routes';
// Spec 4 (LLM gap-proposal queue, 2026-08-04): own import line (not the big
// './routes' list) to keep the diff surface minimal for concurrent edits.
import { dbGapProposalsRouter } from './routes/dbGapProposals';
import {
  createCorsMiddleware,
  createRateLimitMiddleware,
  requestIdMiddleware,
  errorHandler,
} from './middleware';
import { startCleanupInterval, logger } from './services';
import { initializeRegistries } from './services/registryLoader';
import { runMigrationBootRecovery } from './services/migrationBootRecovery';
import { buildResultsCallbackUrl } from './routes/migrationExecution';
import { setTargetOsvSourceResolver } from './routes/vulnerabilityReduction';
import { DiscoveryOsvBridgeSource } from './services/vulnerabilityReduction/discoveryOsvBridgeSource';

// Initialize Express application
const app = express();

// Apply body parser -- 30 MB limit accommodates base64-encoded file attachments
// (20 MB raw files expand to ~27 MB in base64 plus JSON overhead)
app.use(express.json({ limit: '30mb' }));

// Apply middleware in order
app.use(createCorsMiddleware());
app.use(createRateLimitMiddleware());
app.use(requestIdMiddleware);

// Mount routes
app.use('/api/chat', chatRouter);
app.use('/health', healthRouter);
// Orchestrations route (Spec 2026-01-14: Stage 6b)
// Legacy mount: serves /api/orchestrations/execute
app.use('/api/orchestrations', orchestrationsRouter);
// V2 mount: serves /api/v1/orchestrations, /api/v2/jobs/orchestrations, /api/v2/jobs/:job_id
app.use('/api', orchestrationsRouter);

// Implementation-Service project init + repo CRUD proxy routes
// (Spec 2026-06-12: Implementation-Service Init and Integration Repair).
// Spec 2026-06-14 (Migration Execution Driver, Spec 3 of 4) ADDS the inbound
// build-results door here: POST /api/implementation/build-results.
app.use('/api/implementation', implementationProjectsRouter);
// Implement Conversations route (Spec 2026-01-16: Conversation Persistence and Rehydration)
app.use('/api/implement-conversations', implementConversationsRouter);
// Implement State route (Spec 2026-02-11: Persist Implementation Screen State to Disk)
app.use('/api/implement-state', implementStateRouter);
// Organisations route (Spec 2026-01-18: Organisations Iteration 1)
app.use('/api/v1/organisations', organisationsRouter);
// Shape-Spec route (Spec 2026-01-30: Centralize Bearer Authentication)
app.use('/api/v2/shape-spec', shapeSpecRouter);
// Standards Generation route (Spec 2026-01-31: Trigger Global Standards Generation)
app.use('/api/v1/standards/global', standardsGenerateRouter);
// Project Standards Generation route (Spec 2026-01-31: Project-level Standards Generation)
app.use('/api/v1/standards/product', projectStandardsGenerateRouter);
// Jira Issues route (Spec 2026-02-05: Jira Service -- GET /jira/issues)
app.use('/api/v1/jira', jiraIssuesRouter);
// Jira Import route (Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton)
app.use('/api/roadmap/jira', jiraImportRouter);
// Jira Sync route (2026-04-30: Phase B -- analysis endpoint)
app.use('/api/jira/sync', jiraSyncRouter);
// Dashboard Summary route (Spec 2026-02-18: Dashboard Increment 2)
app.use('/api/dashboard', dashboardSummaryRouter);
// Chat V2 route (Spec 2026-02-28: Unified Conversation Engine v1 Backend)
app.use('/api/chat/v2', chatV2Router);
// Architecture Explainer route (Spec 2026-03-15: Meta-Model Explainer for Implement Roles)
app.use('/api/architecture-explainer', architectureExplainerRouter);
// Discovery DecisionTask Resolution route (Spec 2026-04-05: Phase 1b Linker and DecisionTask Engine)
// Mounted BEFORE the existing discoveryRouter to avoid route collisions --
// both share /api/v1/discovery prefix; this router handles /resolve-decision-tasks
app.use('/api/v1/discovery', discoveryDecisionTasksRouter);
// Discovery V3 Gap-Fill relay route (Spec 2026-04-19: V3 Layered Prompt System)
// Mounted alongside existing discovery routers; handles /v3/gap-fill
app.use('/api/v1/discovery', discoveryGapFillRouter);
// Discovery V3 Log-Recipe relay route (Spec 2026-06-20: Runtime Log Evidence -- Format-Agnostic Extraction, Task Group 4)
// Mounted alongside existing discovery routers; handles POST /v3/log-recipe
app.use('/api/v1/discovery', discoveryLogRecipeRouter);
// Discovery Behaviour-Capture relay route (Spec 2026-05-29: Business-logic behaviour capture, Gap C)
// Mounted alongside existing discovery routers; handles /v3/behaviour-capture
app.use('/api/v1/discovery', discoveryBehaviourCaptureRouter);
// Discovery Operational-Artifact summariser relay route (Spec 2026-06-14: Generic Operational-Artifact Discovery, D1)
// Mounted alongside existing discovery routers; handles POST /v3/operational-artifact
app.use('/api/v1/discovery', discoveryOperationalArtifactRouter);
// Discovery Capability-Naming relay route (Spec 2026-06-14: D2 -- Capability Synthesis + Batch Spines, Task Group 4)
// Mounted alongside existing discovery routers; handles POST /v3/capability-naming
app.use('/api/v1/discovery', discoveryCapabilityNamingRouter);
// Discovery Tech Hints Resolve relay route (Spec 2026-04-20: Tech Hints LLM Resolution)
// Mounted alongside existing discovery routers; handles /tech-hints/resolve
app.use('/api/v1/discovery', techHintsResolveRouter);
// Discovery Performance Score relay route (Spec 2026-04-25: Discovery Performance Scoring)
// Mounted alongside existing discovery routers; handles POST /performance/score
app.use('/api/v1/discovery', discoveryPerformanceScoreRouter);
// Discovery route (Spec 2026-04-04: Legacy Discovery Capability Skeleton)
app.use('/api/v1/discovery', discoveryRouter);
// Discovery-Review Conversation routes (Spec 2026-06-02: Conversational
// Discovery-Review "Architect" Persona). Mounted on a DISTINCT base so the
// review-conversation endpoints never collide with the discoveryRouter's
// candidate/finding proxies. The LLM never writes; every mutation is
// confirmed first.
app.use('/api/v1/discovery-review', discoveryReviewConversationRouter);
// PDF Export route (Spec 2026-04-13: Save All Diagrams as PDF)
app.use('/api/pdf', pdfRouter);
// Architecture proxy routes (Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3)
// Bucket A endpoints with required :architectureId path segment + the new
// list-architectures endpoint. Mounted at /api so the router's internal paths
// resolve to /api/projects/... and /api/model/... .
app.use('/api', architecturesRouter);
// API Migration Validation routes (Spec: 2026-05-15 API Behaviour Baseline
// Capture Service - Task Group 3). Mounted at /api/v1 so the router's
// internal paths resolve to:
//   /api/v1/projects/:projectId/architectures/:architectureId/api-behaviour/...
//   /api/v1/api-migration-validation/llm-tool-loop
// Both surfaces (AMS CRUD proxies + LLM tool-call relay) live behind one
// router file so the URL safety property is enforced in one place.
app.use('/api/v1', apiMigrationValidationRouter);
// Migration Discovery Context proxy route (Spec: 2026-05-16 Migration Discovery
// Context Integration - Task Group 2). Mounted at /api/v1 so the internal path
// resolves to /api/v1/projects/:projectId/migration-discovery-context. Thin
// pass-through to the AMS POST /api/projects/{projectId}/migration-discovery-
// context aggregation endpoint for parameter-rich callers (no-parameter
// "latest relevant" view goes through the dedicated context resolver).
app.use('/api/v1', migrationContextRouter);
// Migration Book of Work routes (Spec 2026-05-17 PM Migration Delivery Plan --
// follow-up wiring). Mounted at /api/v1 so the router's internal paths resolve
// to /api/v1/projects/:projectId/migration-books-of-work/generate (POST) and
// /api/v1/projects/:projectId/migration-books-of-work/:bookId (GET).
app.use('/api/v1', migrationBookOfWorkRouter);

// DB Schema + Data Migration Pack (Spec 2026-06-11 -- Task Group 4): the
// pack generation / decisions / drift / download surface, sibling of the
// migration book-of-work routes.
app.use('/api/v1', dbMigrationPackRouter);
// DB Gap-Proposal queue (Spec 4, 2026-08-04): LLM-drafted fk/pk metadata
// proposals for pack structural findings — generate / list / review / manual.
app.use('/api/v1', dbGapProposalsRouter);
// OAS Export (direct build 2026-06-11): deterministic OpenAPI contracts for
// an architecture's interfaces — list / generate / zip download. Sibling of
// the DB migration pack surface on the Migration Delivery Plan.
app.use('/api/v1', oasExportRouter);
// Vulnerabilities route (Spec 2026-06-24 Vulnerability store + manual capture +
// current-state view, Spec 1 of 6 -- Task Group 3). Mounted at /api/v1 so the
// router's internal paths resolve to
// /api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities[/reports|/rollup].
// The POST .../reports route carries a multipart SCA-report upload (multer
// memoryStorage), runs the LLM-flexible parse + XLSX-to-rows at the gateway,
// and forwards the parsed rows to the AMS vulnerabilities ingest endpoint; the
// GET read routes are JSON pass-throughs to architecture-model-service.
app.use('/api/v1', vulnerabilitiesRouter);
// Security Findings routes (Spec 2026-07-19 Security health dashboard,
// Spec 2 of 3). Mounted at /api/v1 so the router's internal paths resolve to
// /api/v1/projects/:projectId/architectures/:architectureId/security/uploads/parse
// (multi-file wizard preview: headers + proposed mapping + distinct linking
// values), .../security/uploads/ingest (normalize + forward ONE appended
// report to the AMS security store, then fire-and-forget the OSV CVE
// enrichment kick), and /api/v1/security/enrichment/run (manual enrichment
// cycle; SECURITY_CVE_ENRICHMENT_ENABLED kill-switch). Distinct from and
// untouching the migration-workflow vulnerabilities surface above.
app.use('/api/v1', securityFindingsRouter);
// Vulnerability Reduction + Steering routes (Spec 2026-06-24 Vulnerability
// Reduction + Steering, Spec 4 of 6 -- Task Group 5). Mounted at /api/v1 so the
// router's internal paths resolve to
// /api/v1/projects/:projectId/target-architectures/:targetArchitectureId/vulnerability-reduction
// (POST compute the estimate-labelled current->target reduction roll-up +
// recommended-minimum-fixed version; the strictly-non-blocking OSV target scan),
// /api/v1/projects/.../vulnerability-reduction/use-version (POST the one-click
// "use this version" captured-decision write + recompute), and the verbatim
// round-trip proxies GET/PUT
// /api/v1/projects/:projectId/architectures/:architectureId/proceed-critical-override
// to the Task Group 4 AMS proceed-critical override audit-trio endpoint.
app.use('/api/v1', vulnerabilityReductionRouter);
// OSV gateway->discovery bridge wiring (Spec 2026-06-27 Live vuln-reduction
// recompute + OSV bridge, Task Group 2). Wire the production OSV source resolver
// ONCE here (not lazily in the route): behind the OSV_REDUCTION_BRIDGE_ENABLED
// kill-switch (default true), supply a DiscoveryOsvBridgeSource that POSTs raw
// queries to the discovery raw-query endpoint so the reduction path's
// "Newly introduced" bucket can populate. When the flag is false the resolver
// returns null and the scan degrades quietly to `no_source`
// (resolveTargetOsvSource already catches a resolver throw and degrades).
setTargetOsvSourceResolver(() =>
  getConfig().osvReductionBridgeEnabled
    ? new DiscoveryOsvBridgeSource(getConfig().discoveryServiceBaseUrl)
    : null,
);
// Migration Shape-Spec Batch Generation routes (Spec 2026-05-19 -- follow-up
// wiring). Mounted at /api/v1 so the router's internal paths resolve to
// /api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/
// {generate-batch,regenerate-single} (POST).
app.use('/api/v1', migrationShapeSpecGenerationRouter);
// Migration Execution route (Spec 2026-06-14 Migrate Button + Migration
// Execution Driver, Spec 3 of 4 -- Task Group 2). Mounted at /api/v1 so the
// router's internal paths resolve to
// /api/v1/projects/:projectId/migration-books-of-work/:bookId/migrate (POST
// the Migrate trigger) and the run-progress reads
// /api/v1/projects/:projectId/migration-execution-runs/:runId (GET) +
// /api/v1/projects/:projectId/migration-books-of-work/:bookId/migration-execution-run
// (GET latest). The inbound build-results receiver lives on
// implementationProjectsRouter (mounted /api/implementation).
app.use('/api/v1', migrationExecutionRouter);
// Migration Shape-Spec Cost-Preview route (Spec 2026-05-20 Cross-Story Context
// Injection -- Task Group 6). Mounted at /api so the router's internal path
// resolves to /api/migration-shape-spec/cost-preview (POST). BFF-style
// read-only estimate used by the Generate-all dialog before submitting a
// batch.
app.use('/api', migrationShapeSpecCostPreviewRouter);
// Migration Delivery Dashboard proxy route (Spec: 2026-05-19 Migration Delivery
// Progress and Evidence Tracking -- Task Group 6). Mounted at /api so the
// router's internal path resolves to /api/projects/:projectId/migration-books-
// of-work/:bookId/delivery-dashboard, matching the AMS path verbatim (per
// spec.md AC 19; the only new gateway endpoint introduced by the spec).
app.use('/api', migrationDeliveryDashboardRouter);
// Epic Captured Decisions proxy routes (Spec: 2026-05-20 Cross-Story Context
// Injection -- Task Group 8). Mounted at /api so the router's internal paths
// resolve to /api/projects/:projectId/epics/:epicWorkItemId/captured-decisions
// (matching the AMS paths verbatim).
app.use('/api', epicCapturedDecisionsRouter);
// Target Architectures proxy routes + mapping-suggest LLM augmentation
// (Spec: 2026-05-20 Target Architecture Authoring Flow -- Task Group 5;
// Spec: 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task
// Group 2 added the suggest-from-current proxy to this same router). Mounted
// at /api so the router's internal paths resolve verbatim to the AMS paths:
// /api/projects/:projectId/target-architectures/...,
// /api/projects/:projectId/target-architectures/suggest-from-current,
// /api/projects/:projectId/architectures/:archId/{unmapped-current-elements,
// decommissioned-in-target-annotations, mapping-suggest},
// /api/projects/:projectId/specs/mark-stale.
//
// The broken May-20 LLM Suggest stack (route file + handler + LLM task config
// + prompt + the `/api/v1` mount that fed it) was removed by spec 2026-05-24
// Task Group 2 (sub-tasks 2.2-2.5); the new deterministic Suggest endpoint
// replaces it via the proxy line below.
app.use('/api', targetArchitecturesRouter);
// Missing Input Resolutions proxy + retry-batch route (Spec 2026-05-20
// Missing Input Resolver Flow -- Task Group 5). Mounted at /api so the
// router's internal paths resolve verbatim to the AMS paths
// /api/projects/:projectId/missing-input-resolutions[/...] and
// /api/projects/:projectId/spec-generations/{ready-to-retry,retry-batch}.
// The retry-batch route INTERCEPTS the AMS 501 and runs the existing
// `runShapeSpecGenerationBatch` handler with `regenerateAll=true`.
app.use('/api', missingInputResolutionsRouter);
// Architect Conversation HTTP routes (Spec: 2026-05-24 Target State
// Architect-Persona Conversation -- patch between Commit 5 and Commit 6).
// Exposes the 8 endpoints under /api/projects/:projectId/target-architectures/
// :targetArchitectureId/architect-conversation that the frontend client in
// frontend/src/api/architectConversationApi.ts already calls. Thin
// pass-through into the Commit-3/4 coordinator + orchestrators (no business
// logic in the route handlers).
app.use('/api', architectConversationRouter);

// Apply error handler as last middleware
app.use(errorHandler);

// Start session cleanup interval (every 5 minutes)
startCleanupInterval(5);

/**
 * Enumerate the concrete routes registered on an Express router by walking its
 * layer stack, returning "METHOD /mountPath/path" strings (e.g.
 * "POST /api/v1/discovery/projects/:projectId/.../findings/bulk-review").
 *
 * This reflects what is ACTUALLY loaded in the running process -- unlike the
 * hand-maintained console banner above, which can drift. A stale gateway
 * process that predates a newly-added endpoint will visibly lack that route
 * here, turning "is the new route loaded?" into a one-glance check at startup
 * instead of a curl hunt against a 404.
 */
function listMountedRoutes(mountPath: string, router: express.Router): string[] {
  const routes: string[] = [];
  const stack: any[] = (router as unknown as { stack?: any[] }).stack ?? [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const methods = Object.keys(layer.route.methods ?? {})
      .filter((m) => layer.route.methods[m])
      .map((m) => m.toUpperCase());
    for (const method of methods) {
      routes.push(`${method} ${mountPath}${layer.route.path}`);
    }
  }
  return routes;
}

// Start server if this is the main module
if (require.main === module) {
  const config = getConfig();

  // Initialize v2 conversation engine registries
  initializeRegistries().then(() => {
    logger.info('V2 registries initialized');
  }).catch(err => {
    logger.error('Failed to initialize v2 registries', { error: err.message });
  });

  // Migration Execution Driver boot-recovery sweep (Spec 2026-06-14, CD-2):
  // reconcile in-flight run-state vs reality and re-kick any spec stuck
  // mid-segment so a long migration auto-resumes across gateway restarts.
  // Never throws -- a recovery failure must not block startup.
  runMigrationBootRecovery(
    `${config.gatewayPublicBaseUrl}/api/implementation/build-results`
  )
    .then((r) => {
      logger.info('Migration Execution Driver boot-recovery complete', {
        event: 'migration_boot_recovery',
        recovered: r.recovered,
        rekicked: r.rekicked,
      });
    })
    .catch((err) => {
      logger.error('Migration Execution Driver boot-recovery failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    });

  app.listen(config.port, () => {
    logger.info('Gateway server started', {
      event: 'server_start',
      port: config.port,
    });
    // Baseline drift scheduler (Spec 2026-07-06-i §6, Tier-1 batch): INERT
    // until a project registers a drift watch (in-memory creds, process
    // lifetime). Env knobs: DRIFT_CHECK_ENABLED / DRIFT_CHECK_INTERVAL_MS /
    // DRIFT_CHECK_MAX_AGE_DAYS. The handle is unref'd — never keeps the
    // process alive.
    try {
      // Lazy require keeps server start resilient to a scheduler import issue.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { startBaselineDriftScheduler } = require('./services/baselineDriftScheduler');
      startBaselineDriftScheduler();
    } catch (error) {
      logger.warn('Baseline drift scheduler failed to start (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Predicate-run-judging BOOT header (docs/trace-logging.md §Predicates):
    // one HAIKAI_CONFIG line per boot so the run judge can score fail-closed
    // degradations against config. No-op unless HAIKAI_TRACE is on; must
    // never affect boot.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createTracer } = require('./trace');
      const bootTrace = createTracer('gateway');
      if (bootTrace.enabled) {
        let gitSha = 'unknown';
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { execSync } = require('child_process');
          gitSha = execSync('git rev-parse --short HEAD', {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'ignore'],
          }).toString().trim() || 'unknown';
        } catch { /* not a git checkout */ }
        // Migration-pair ruleset stamp (Data-Tier Oracle Spec O): the judge
        // scores divergence handling against the pair the run declared.
        let pairInfo: Record<string, unknown> = { migration_pair: 'none' };
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { loadPairRuleset } = require('./migrationPairRules');
          const rs = loadPairRuleset();
          if (rs) {
            pairInfo = {
              migration_pair: rs.pair_id,
              ruleset_version: rs.version,
              rule_count: rs.rules.length,
            };
          }
        } catch { /* fail-soft */ }
        bootTrace.configHeader({
          git_sha: gitSha,
          drift_check_enabled: process.env.DRIFT_CHECK_ENABLED !== 'false',
          drift_check_interval_ms: Number(process.env.DRIFT_CHECK_INTERVAL_MS ?? 21600000),
          drift_check_max_age_days: Number(process.env.DRIFT_CHECK_MAX_AGE_DAYS ?? 14),
          plan_llm_concurrency: Number(process.env.MIGRATION_PLAN_LLM_CONCURRENCY ?? 4),
          db_cluster_max_tables: Number(process.env.MIGRATION_PLAN_DB_CLUSTER_MAX_TABLES ?? 25),
          api_cluster_max_endpoints: Number(process.env.MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS ?? 15),
          ...pairInfo,
        });
      }
    } catch { /* tracing must never affect boot */ }
    console.log(`[Gateway] Started on port ${config.port}`);
    console.log(`[Gateway] Health check: http://localhost:${config.port}/health`);
    console.log(`[Gateway] Chat endpoint: http://localhost:${config.port}/api/chat`);
    console.log(`[Gateway] Stream endpoint: http://localhost:${config.port}/api/chat/stream`);
    console.log(`[Gateway] Chat V2 endpoint: http://localhost:${config.port}/api/chat/v2`);
    console.log(`[Gateway] Orchestrations endpoint: http://localhost:${config.port}/api/orchestrations`);
    console.log(`[Gateway] Implement Conversations endpoint: http://localhost:${config.port}/api/implement-conversations`);
    console.log(`[Gateway] Implement State endpoint: http://localhost:${config.port}/api/implement-state`);
    console.log(`[Gateway] Organisations endpoint: http://localhost:${config.port}/api/v1/organisations`);
    console.log(`[Gateway] Shape-Spec endpoint: http://localhost:${config.port}/api/v2/shape-spec/stream`);
    console.log(`[Gateway] Standards Generation endpoint: http://localhost:${config.port}/api/v1/standards/global/generate`);
    console.log(`[Gateway] Project Standards Generation endpoint: http://localhost:${config.port}/api/v1/standards/product/generate`);
    console.log(`[Gateway] Jira Issues endpoint: http://localhost:${config.port}/api/v1/jira/issues`);
    console.log(`[Gateway] Jira Import endpoint: http://localhost:${config.port}/api/roadmap/jira/import`);
    console.log(`[Gateway] Dashboard Summary endpoint: http://localhost:${config.port}/api/dashboard/summary`);
    console.log(`[Gateway] Discovery endpoint: http://localhost:${config.port}/api/v1/discovery`);
    console.log(`[Gateway] Discovery DecisionTask Resolution endpoint: http://localhost:${config.port}/api/v1/discovery/resolve-decision-tasks`);
    console.log(`[Gateway] Discovery V3 Gap-Fill endpoint: http://localhost:${config.port}/api/v1/discovery/v3/gap-fill`);
    console.log(`[Gateway] Discovery V3 Log-Recipe endpoint: http://localhost:${config.port}/api/v1/discovery/v3/log-recipe`);
    console.log(`[Gateway] Discovery Tech Hints Resolve endpoint: http://localhost:${config.port}/api/v1/discovery/tech-hints/resolve`);
    console.log(`[Gateway] API Migration Validation LLM relay: http://localhost:${config.port}/api/v1/api-migration-validation/llm-tool-loop`);
    console.log(`[Gateway] API Behaviour CRUD proxies: http://localhost:${config.port}/api/v1/projects/:projectId/architectures/:architectureId/api-behaviour/...`);
    console.log(`[Gateway] Vulnerabilities upload+proxy: http://localhost:${config.port}/api/v1/projects/:projectId/architectures/:architectureId/vulnerabilities`);
    console.log(`[Gateway] Vulnerability Reduction compute: http://localhost:${config.port}/api/v1/projects/:projectId/target-architectures/:targetArchitectureId/vulnerability-reduction`);
    console.log(`[Gateway] Migration Discovery Context proxy: http://localhost:${config.port}/api/v1/projects/:projectId/migration-discovery-context`);
    console.log(`[Gateway] Migration Book of Work generate: http://localhost:${config.port}/api/v1/projects/:projectId/migration-books-of-work/generate`);
    console.log(`[Gateway] Migration Book of Work read: http://localhost:${config.port}/api/v1/projects/:projectId/migration-books-of-work/:bookId`);
    console.log(`[Gateway] Spec-generation generate-batch: http://localhost:${config.port}/api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/generate-batch`);
    console.log(`[Gateway] Spec-generation regenerate-single: http://localhost:${config.port}/api/v1/projects/:projectId/migration-books-of-work/:bookId/spec-generations/regenerate-single`);
    console.log(`[Gateway] Spec-generation cost-preview: http://localhost:${config.port}/api/migration-shape-spec/cost-preview`);
    console.log(`[Gateway] Migration Delivery Dashboard proxy: http://localhost:${config.port}/api/projects/:projectId/migration-books-of-work/:bookId/delivery-dashboard`);
    console.log(`[Gateway] Migration Execution Migrate trigger: http://localhost:${config.port}/api/v1/projects/:projectId/migration-books-of-work/:bookId/migrate`);
    console.log(`[Gateway] Migration Execution run-state read: http://localhost:${config.port}/api/v1/projects/:projectId/migration-execution-runs/:runId`);
    console.log(`[Gateway] Build-results inbound door: http://localhost:${config.port}/api/implementation/build-results`);
    console.log(`[Gateway] Epic Captured Decisions proxy: http://localhost:${config.port}/api/projects/:projectId/epics/:epicWorkItemId/captured-decisions`);
    console.log(`[Gateway] Missing Input Resolutions proxy: http://localhost:${config.port}/api/projects/:projectId/missing-input-resolutions`);
    console.log(`[Gateway] Spec-generation retry-batch: http://localhost:${config.port}/api/projects/:projectId/spec-generations/retry-batch`);

    // Inventory of the discovery routes ACTUALLY registered in this process.
    // All five discovery routers share the /api/v1/discovery prefix; this walks
    // their real layer stacks (not a static list) so a stale process is
    // obvious -- if a freshly-added endpoint is missing here, the running
    // gateway predates it and needs a restart/rebuild.
    const discoveryRoutes = [
      ...listMountedRoutes('/api/v1/discovery', discoveryDecisionTasksRouter),
      ...listMountedRoutes('/api/v1/discovery', discoveryGapFillRouter),
      ...listMountedRoutes('/api/v1/discovery', discoveryLogRecipeRouter),
      ...listMountedRoutes('/api/v1/discovery', discoveryOperationalArtifactRouter),
      ...listMountedRoutes('/api/v1/discovery', techHintsResolveRouter),
      ...listMountedRoutes('/api/v1/discovery', discoveryPerformanceScoreRouter),
      ...listMountedRoutes('/api/v1/discovery', discoveryRouter),
    ].sort();
    logger.info('Discovery routes mounted', {
      event: 'discovery_routes_mounted',
      count: discoveryRoutes.length,
      routes: discoveryRoutes,
    });
    console.log(`[Gateway] Discovery routes mounted (${discoveryRoutes.length}):`);
    for (const route of discoveryRoutes) {
      console.log(`[Gateway]   ${route}`);
    }
  });
}

// Export app for testing
export { app };
