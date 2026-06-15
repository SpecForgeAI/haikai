# Specification: Migration Discovery Context Integration

## Goal
Build a shared aggregation layer that exposes Current/Target State Architecture, Discovery Findings/Evidence, Decision Tasks, API Behaviour Baselines, and current-to-target mappings as a single bounded, LLM-ready DTO; consume it during API Behaviour Baseline capture and register it as a gateway context resolver for future migration-planning workflows.

## User Stories
- As an engineer running an API Behaviour Baseline capture, I want the capture LLM to receive relevant discovery findings and runtime evidence so that scenarios, request bodies, and warnings reflect what was actually discovered in the current system.
- As a migration planner, I want a single gateway context resolver that assembles all migration-relevant discovery context so that future migration-planning LLM prompts can consume a consistent, bounded view of the system.
- As a user starting a capture session, I want to see a readiness summary of available discovery findings for my architecture so that I can decide whether to include discovery context and understand any gaps before capturing.

## Specific Requirements

**AMS monolithic aggregation endpoint (D1)**
- New endpoint `POST /api/projects/{projectId}/migration-discovery-context` returning `MigrationDiscoveryContextDto`.
- Request body fields: `currentArchitectureId` (required), `targetArchitectureId` (optional), `discoveryRunIds[]` (optional), `apiBehaviourBaselineIds[]` (optional), include flags `includeFindings`/`includeEvidence`/`includeRuntimeEvidence`/`includeDbFindings`/`includeMappings` (all default true), `maxFindings` (default 100), `maxEvidenceItems` (default 100).
- When `discoveryRunIds` is omitted, resolve latest completed runs for the current architecture (precedent: `DiscoverySummaryService`).
- Reject requests where `currentArchitectureId` does not belong to `projectId` (404/400 via existing `GlobalExceptionHandler` patterns).
- Aggregation is read-only orchestration over existing repositories; no new tables, no new Liquibase changesets (tail remains 137).
- Apply count-based bounds only; priority-order findings (critical/high severity, needs_review, accepted, migration_risk, data_quality, business_logic, runtime_usage, reconciliation, testability, sample_data) then truncate.
- No response caching in v1; every call recomputes.

**MigrationDiscoveryContextDto shape**
- Top-level identifiers: `projectId`, `currentArchitectureId`, `targetArchitectureId` (nullable), `discoveryRunIds[]`, `apiBehaviourBaselineIds[]`, `generatedAt`.
- Summary blocks: `summary`, `currentArchitectureSummary`, `targetArchitectureSummary` (nullable), `discoveryRunsSummary`, `findingsSummary`, `highPriorityFindings[]`, `findingsByCategory`, `evidenceHighlights[]`, `candidateSummary`, `unresolvedDecisionTasks[]`, `runtimeUsageSummary`, `databaseDiscoverySummary`, `apiBehaviourBaselineSummary`, `architectureMappingsSummary`.
- `readinessAssessment: ReadinessAssessmentDto` and `contextWarnings[]`.
- Each block includes durable IDs/references so downstream consumers can cite or re-fetch.
- Bounded summaries only; no raw evidence payloads; no secrets.

**Readiness rules service in AMS (D2)**
- Java service method takes the loaded aggregates and returns `ReadinessAssessmentDto` with per-stream status (`sufficient` | `partial` | `insufficient`) for: `apiReadiness`, `dataReadiness`, `infrastructureReadiness`, `discoveryReadiness`, `mappingReadiness`, `baselineReadiness`, plus `overallStatus` and a `gaps[]` array.
- Deterministic rules per raw-idea Part 6 (e.g., API: sufficient if OAS+baseline; partial if OAS only; insufficient otherwise).
- Gap codes from a fixed enum-like set: `no_api_behaviour_baseline`, `unresolved_discovery_decisions`, `missing_current_to_target_mappings`, `no_database_discovery_findings`, `high_severity_unreviewed_findings`, `missing_oas_for_in_scope_interface`, `insufficient_runtime_evidence`, `no_sample_data_hints`.
- Overall status is `sufficient` only when core selected streams are sufficient; `partial` when prerequisite work could resolve gaps; `insufficient` when critical inputs are missing.

**Gateway resolver - latest relevant (D6, D8)**
- New `MigrationDiscoveryContextResolver` registered at key `migration-discovery-context` in `gateway/src/services/contextResolvers.ts`.
- No parameters; resolves active architecture via `resolveDefaultArchitectureId(projectId)` like `MetaModelSummaryContextResolver`.
- Calls AMS endpoint with default include flags and limits; transforms response into prompt-ready bounded text with citations to durable IDs.
- Add `migration-discovery-context` to `KNOWN_CONTEXT_KEYS`.
- Resolver must not invent missing details; insufficient context surfaces as explicit gap entries in the prompt-ready output.

**Gateway proxy route - parameter-rich (D6)**
- New `POST /api/v1/projects/:projectId/migration-discovery-context` route in `gateway/src/routes/`.
- Thin pass-through to the AMS endpoint; forwards request body verbatim and propagates status/error semantics.
- Intended for `api-migration-validation-service` and any caller that needs to pass `discoveryRunIds`, `apiBehaviourBaselineIds`, or override limits.
- Registered alongside existing architectures routes in `gateway/src/routes/index.ts`.

**api-migration-validation-service fetch at /start, fail-soft (D3)**
- New `getMigrationDiscoveryContext(projectId, params)` method on `services/archModelClient.ts` (calls AMS via gateway or direct base URL per existing client conventions).
- Inside `routes/captureSessionActions.ts::POST /capture-sessions/{sessionId}/start`, BEFORE `orchestrateCaptureSession` spawn, call the new client method using the session's `projectId`/`architectureId` plus any `discoveryRunIds` from request body.
- On success: pass the context into the orchestrator as a new optional param; `services/captureSessionOrchestrator.ts::buildScenarioPrompt()` (lines 68-96) injects relevant filtered context via `baseContext` once-per-session.
- On failure (HTTP error, AMS unreachable, empty response): log warning, append `context_unavailable` to the 202 response `warnings[]` array, continue with orchestrator spawn unchanged.
- Do NOT block start; do NOT persist context to the capture session row (deferred per shaping note).

**Prompt injection contract**
- Orchestrator stores the fetched context on `baseContext.discoveryContextSummary` once per session before the operation loop.
- `buildScenarioPrompt()` includes, per scenario, only the operation-relevant slice: endpoint candidates, runtime usage findings, missing contract detail findings, hardcoded URL findings, raw SQL findings tied to endpoint code, DB sample-data hints, decision tasks affecting the API.
- Prompt must explicitly state: discovery findings are supporting evidence; do not invent behaviour beyond OAS/API response evidence; use DB sample hints where available; record a note/warning when discovery indicates uncertainty.
- Bounded summaries only; no raw secrets; no unbounded evidence payloads.

**Frontend wizard discovery-context section (D5, Part 5A)**
- Add a collapsed section to Step 1 of `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`.
- Default open when findings exist for the current architecture; collapsed otherwise.
- Section content: `includeDiscoveryContext` checkbox; discovery run selector listing latest completed runs for the current architecture; per-selection finding summary (counts by severity/category, unresolved decision task count, sample-data hint count, API/runtime/DB finding counts); warning banner when no discovery findings are available.
- Submitted with `start` request as `discoveryRunIds[]` and `includeDiscoveryContext` boolean.
- Default behaviour: include latest relevant discovery context if available.

**Frontend capture-review discovery-supported annotations (Part 5B)**
- Add badges/notes on `CaptureReviewPanel.tsx` and `CaptureSessionDetailView.tsx`:
  - Badge: scenario generated from DB sample-data hint.
  - Badge: endpoint prioritised by runtime usage.
  - Warning: endpoint has missing contract detail finding.
  - Warning: unresolved decision task affects this endpoint.
  - Warning: no discovery evidence linked to this endpoint.
- Annotations are derived from data already present on the capture session response; no new persistence required.

**Cross-stack test coverage**
- AMS service-layer tests cover the 14 AMS test cases from raw-idea Part 7 (latest-run resolution, prioritisation, limit application, readiness gaps, architecture/project mismatch rejection).
- Gateway tests cover resolver registration, AMS call, bounded output, insufficient-context marking, and ID/reference inclusion.
- api-migration-validation-service tests cover request acceptance, pre-loop fetch, prompt injection, bounded payload, fail-soft (`context_unavailable` warning), priority/warning annotations, DB sample hint plumbing.
- Frontend tests cover wizard selector, run selection, finding summary render, review annotations.
- Integration test proves findings/baselines/mappings flow end-to-end into one response; no-findings response includes explicit gap; high-severity unresolved finding yields partial/insufficient readiness.

## Existing Code to Leverage

**`DiscoverySummaryService` (AMS)**
- Precedent for latest-run resolution + GROUP BY status aggregation pattern.
- Re-use its strategy for selecting "latest completed run for architecture" when `discoveryRunIds` is omitted from the request.
- New aggregation service should sit alongside it and reuse its run-selection helpers where shape matches.

**`gateway/src/services/contextResolvers.ts`**
- Defines `ContextResolver` interface, `KNOWN_CONTEXT_KEYS`, registry initialisation, and stub-fallback pattern.
- `MetaModelSummaryContextResolver` is the closest precedent: resolves active architecture via `resolveDefaultArchitectureId(projectId)` and pulls a bounded summary from AMS.
- New `MigrationDiscoveryContextResolver` follows the same shape and registers alongside existing resolvers.

**`api-migration-validation-service/src/services/captureSessionOrchestrator.ts::buildScenarioPrompt()` (lines 68-96)**
- Current minimal prompt builder (system + user JSON with sessionId/envName/operationId/scenarioName).
- Injection point for per-scenario discovery context slice read from `baseContext.discoveryContextSummary`.
- Once-per-session injection avoids duplicate AMS fetches and keeps the LLM's working set stable across operations.

**`api-migration-validation-service/src/routes/captureSessionActions.ts::POST /start`**
- Lifecycle gate where the discovery-context fetch is wired synchronously before orchestrator spawn.
- Existing 202 response shape is extended with `warnings[]` to surface `context_unavailable` on fail-soft.
- `archModelClient` injection pattern already exists for other AMS calls; mirror it for the new method.

**AMS repositories and services**
- Discovery: `DiscoveryRunRepository`, `DiscoveryCandidateRepository`, `DiscoveryEvidenceRepository`, `DiscoveryRelationshipRepository`, `DiscoveryClusterRepository`, `DiscoveryDecisionTaskRepository`, `DiscoveryFindingRepository`, `DiscoveryFindingLinkRepository` and their services.
- API Behaviour: `ApiBehaviourBaselineRepository`, `ApiBehaviourBaselineItemRepository`, `ApiBehaviourCaptureSessionRepository` and siblings under `service/apibehaviour/`.
- Mappings: `ArchitectureElementMappingRepository` + `ArchitectureElementMappingService` (already supports filtering by source/target architecture, type, status).
- Meta-model: `MetaModelSummaryService` (already produces the JSON summary the existing resolver consumes).

## Out of Scope
- Standalone Migration Prep / readiness panel page (deferred per D4; acceptance criterion 7 satisfied via wizard + capture-review).
- Aggregation response caching (every call recomputes in v1).
- `discoveryContextSummary` persistence on the capture session row (runtime-only in v1).
- Token-budget-aware truncation (count-based only in v1 per D7; v2 enhancement).
- Final Migration Delivery Plan generation (the Product Manager workflow).
- Roadmap, backlog, or work-item generation.
- shape-spec generation.
- Target API reconciliation.
- Database reconciliation.
- Actual migration test harness execution.
- Any `discovery-service/src/**` edits (per `feedback_no_src_edits_during_run.md`; all discovery state already lives in AMS).
- Any new Liquibase changeset (read-only aggregation; tail stays at 137).
