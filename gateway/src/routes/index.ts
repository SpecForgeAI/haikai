/**
 * Central export for all routes
 */

export { chatRouter, healthRouter } from './chat';

// Orchestrations route (Spec 2026-02-06 v2 jobs; legacy /execute and
// /v1/orchestrations retired by Spec 2026-06-12)
export { orchestrationsRouter } from './orchestrations';
export type { ExecuteOrchestrationResponse } from './orchestrations';

// Implementation-Service project init + repo CRUD proxy routes
// (Spec 2026-06-12: Implementation-Service Init and Integration Repair).
// Spec 2026-06-14 (Migration Execution Driver, Spec 3 of 4) ADDS the inbound
// build-results door (POST /api/implementation/build-results) to this router.
export { implementationProjectsRouter } from './implementationProjects';

// Implement Conversations route (Spec 2026-01-16: Conversation Persistence and Rehydration)
export { implementConversationsRouter } from './implementConversations';

// Organisations route (Spec 2026-01-18: Organisations Iteration 1)
export { organisationsRouter } from './organisations';

// Shape-Spec route (Spec 2026-01-30: Centralize Bearer Authentication)
export { shapeSpecRouter } from './shapeSpec';

// Standards Generation route (Spec 2026-01-31: Trigger Global Standards Generation)
export { standardsGenerateRouter } from './standardsGenerate';
export type { StandardsGenerateRequest } from './standardsGenerate';

// Project Standards Generation route (Spec 2026-01-31: Project-level Standards Generation)
export { projectStandardsGenerateRouter } from './projectStandardsGenerate';
export type { ProjectStandardsGenerateRequest } from './projectStandardsGenerate';

// Jira Issues route (Spec 2026-02-05: Jira Service -- GET /jira/issues)
export { jiraIssuesRouter } from './jiraIssues';

// Implement State route (Spec 2026-02-11: Persist Implementation Screen State to Disk)
export { implementStateRouter } from './implementState';

// Jira Import route (Spec 2026-02-15: RM Increment 4 -- Jira Import for Roadmap Skeleton)
export { jiraImportRouter } from './jiraImport';

// Jira Sync route (2026-04-30: Phase B -- POST /api/jira/sync/analyze)
export { jiraSyncRouter } from './jiraSync';

// Dashboard Summary route (Spec 2026-02-18: Dashboard Increment 2)
export { dashboardSummaryRouter } from './dashboardSummary';

// Chat V2 route (Spec 2026-02-28: Unified Conversation Engine v1 Backend)
export { chatV2Router } from './chatV2';

// Architecture Explainer route (Spec 2026-03-15: Meta-Model Explainer for Implement Roles)
export { architectureExplainerRouter } from './architectureExplainer';

// Discovery route (Spec 2026-04-04: Legacy Discovery Capability Skeleton)
export { discoveryRouter } from './discovery';

// Discovery DecisionTask Resolution route (Spec 2026-04-05: Phase 1b Linker and DecisionTask Engine)
export { discoveryDecisionTasksRouter } from './discoveryDecisionTasks';

// Discovery V3 Gap-Fill relay route (Spec 2026-04-19: V3 Layered Prompt System)
export { discoveryGapFillRouter } from './discoveryGapFill';

// Discovery Behaviour-Capture relay route (Spec 2026-05-29: Business-logic
// behaviour capture for discovery, Gap C). Sibling of the gap-fill relay.
export { discoveryBehaviourCaptureRouter } from './discoveryBehaviourCapture';

// Discovery Operational-Artifact summariser relay route (Spec 2026-06-14:
// Generic Operational-Artifact Discovery, D1). Sibling of the gap-fill relay --
// stateless per-file summariser relay (temperature 0, no tools) for the
// always-on operational-artifact scan pass; clean prompt/model/cache separation.
export { discoveryOperationalArtifactRouter } from './discoveryOperationalArtifact';

// Discovery Capability-Naming relay route (Spec 2026-06-14: D2 -- Capability
// Synthesis + Batch Spines, Task Group 4). Sibling of the gap-fill / OA relays
// -- stateless per-seed naming relay (temperature 0, no tools) for the
// NAMING-ONLY LLM call in capability synthesis (membership is deterministic);
// clean prompt/model/cache separation.
export { discoveryCapabilityNamingRouter } from './discoveryCapabilityNaming';

// Discovery Tech Hints Resolve relay route (Spec 2026-04-20: Tech Hints LLM Resolution)
export { techHintsResolveRouter } from './techHintsResolve';

// Discovery Performance Score relay route (Spec 2026-04-25: Discovery Performance Scoring)
export { discoveryPerformanceScoreRouter } from './discoveryPerformanceScore';

// PDF Export route (Spec 2026-04-13: Save All Diagrams as PDF)
export { pdfRouter } from './pdf';
// Architecture Routes (Spec: 2026-05-01 Multi-Architecture Plumbing - Task Group 3)
export { architecturesRouter } from './architectures';

// API Migration Validation routes (Spec: 2026-05-15 API Behaviour Baseline Capture Service - Task Group 3)
// Provides AMS-direct CRUD proxies for the seven api_behaviour_* resources plus
// the LLM tool-call relay endpoint that the new api-migration-validation-service
// (port 8092) calls once per scenario round-trip.
export { apiMigrationValidationRouter } from './apiMigrationValidation';

// Migration Discovery Context proxy route (Spec: 2026-05-16 Migration Discovery
// Context Integration - Task Group 2). Parameter-rich pass-through proxy for the
// AMS POST /api/projects/{projectId}/migration-discovery-context aggregation
// endpoint. The no-parameter "latest relevant" view goes through the dedicated
// MigrationDiscoveryContextResolver in services/contextResolvers.ts.
export { migrationContextRouter } from './migrationContext';

// Missing Input Resolutions proxy + retry-batch route
// (Spec: 2026-05-20 Missing Input Resolver Flow -- Task Group 5). Five thin
// pass-through proxies to AMS (single-create, bulk, delete, list,
// ready-to-retry) plus a retry-batch route that INTERCEPTS the AMS 501 and
// runs the existing `runShapeSpecGenerationBatch` handler with the
// `targetWorkItemIds = body.workItemIds, regenerateAll = true` contract.
export { missingInputResolutionsRouter } from './missingInputResolutions';

// Migration Book of Work + Shape-Spec Generation pipeline routers.
// All seven were already imported in `server.ts` but were never re-exported
// from this barrel file, causing `Router.use()` to receive `undefined` and
// crash on startup. Bug-fix list (2026-05-21) -- table item "7 router files
// existed but were never exported from the barrel".
export { migrationBookOfWorkRouter } from './migrationBookOfWork';
export { migrationShapeSpecGenerationRouter } from './migrationShapeSpecGeneration';
export { migrationShapeSpecCostPreviewRouter } from './migrationShapeSpecCostPreview';
export { migrationDeliveryDashboardRouter } from './migrationDeliveryDashboard';
export { epicCapturedDecisionsRouter } from './epicCapturedDecisions';
export { targetArchitecturesRouter } from './targetArchitectures';

// Migration Execution route (Spec: 2026-06-14 Migrate Button + Migration
// Execution Driver, Spec 3 of 4 -- Task Group 2). The Migrate trigger
// (POST .../migrate) + the run-progress reads (GET run-state / latest run for a
// book). The gateway-hosted Driver's HTTP surface; the inbound build-results
// receiver lives on `implementationProjectsRouter`.
export { migrationExecutionRouter } from './migrationExecution';

// Architect Conversation HTTP routes (Spec: 2026-05-24 Target State
// Architect-Persona Conversation -- patch between Commit 5 and Commit 6).
// Exposes the 8 endpoints the frontend client in
// `frontend/src/api/architectConversationApi.ts` already calls -- thin
// pass-through into the Commit-3/4 coordinator + orchestrators.
export { architectConversationRouter } from './architectConversation';

// Discovery-Review Conversation HTTP routes (Spec: 2026-06-02 Conversational
// Discovery-Review "Architect" Persona). The conversational review engine --
// thin pass-through into the discovery-review coordinator + orchestrator. The
// LLM never writes; every mutation is gated behind an explicit confirm.
export { discoveryReviewConversationRouter } from './discoveryReviewConversation';

// DB Schema + Data Migration Pack routes (Spec: 2026-06-11 Source-Grade DB
// Schema + Data Migration Pack -- Task Group 4). Deterministic generation,
// pack/files/manifest reads with staleness, decision queue proxies, drift
// history, on-demand zip download, and the two credentialed live-DB actions
// (refresh-seeds, verify).
export { dbMigrationPackRouter } from './dbMigrationPack';

// OAS Export routes (direct build 2026-06-11, oracle weaknesses #5).
// Deterministic OpenAPI 3.0 contracts assembled from the architecture model
// via the existing mcp gap engine; read-only, download = regeneration.
export { oasExportRouter } from './oasExport';
