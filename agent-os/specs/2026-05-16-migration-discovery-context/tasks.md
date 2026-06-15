# Task Breakdown: Migration Discovery Context Integration

## Overview
Total Tasks: 6 task groups

Aggregation-only spec spanning four services: architecture-model-service (new aggregation endpoint + readiness rules + DTOs), gateway (no-parameter context resolver + parameter-rich proxy route), api-migration-validation-service (AMS client method + fetch-at-/start + prompt injection + fail-soft), frontend (capture wizard discovery-context section + capture-review annotations), plus a cross-stack gap-review pass. No new Liquibase changesets, no `discovery-service/src/**` edits, no AppShell cache invalidation.

## Standing Constraints

- **No new Liquibase changesets.** Aggregation is read-only orchestration over existing repositories; tail must stay at 137.
- **Do not touch the pre-existing failing tests listed in CLAUDE.md memory.** That list includes `bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts`.
- **No `discovery-service/src/**` edits.** Per `feedback_no_src_edits_during_run.md`; all discovery state already lives in AMS and this spec aggregates from there.
- **Existing API Behaviour Baseline capture flow must continue working without discovery context.** Fail-soft is mandatory; a missing/failed AMS aggregation call must surface a `context_unavailable` warning on the 202 response and let the orchestrator spawn unchanged.
- **Existing discovery flows must be unaffected.** This spec only reads from discovery repositories; no writes, no schema changes.
- **AppShell model cache: no invalidation required.** Read-only aggregation; no entity writes.
- **Count-based bounds v1:** `maxFindings: 100`, `maxEvidenceItems: 100`, priority-ordered before truncation (critical/high severity, needs_review, accepted, migration_risk, data_quality, business_logic, runtime_usage, reconciliation, testability, sample_data). Token-budget-aware trimming is deferred to v2.
- **Generic resolver key is `migration-discovery-context`** (not API-scoped). The same key serves future migration-planning workflows; `api-migration-validation-service` consumes a filtered/prioritized view via the dedicated proxy route.
- **Read-only aggregation, so the primitive-DTO-overwrite hazard does not apply.** However, any future DTO fields participating in PATCH semantics must still be boxed (Double/Long/Boolean) per `project_primitive_double_dto_overwrite.md`.
- **AMS test compile errors flagged in predecessor specs may block a full `mvn test`.** If so, fall back to standalone JUnit invocations of only the newly written test classes, as previous specs in this area have done.
- **Run ONLY the tests written in each group's x.1 sub-task at the end of that group.** Do NOT run the full project test suite at any stage prior to Group 6.

## Task List

### Architecture Model Service

#### Task Group 1: AMS aggregation endpoint, DTOs, and deterministic readiness rules
**Dependencies:** None

- [x] 1.0 Complete AMS migration-discovery-context aggregation layer
  - [x] 1.1 Write 8-12 focused tests for `MigrationDiscoveryContextService` and readiness rules
    - 8-12 tests maximum, covering only critical behaviours:
      - Latest-run resolution when `discoveryRunIds` is omitted (mirrors `DiscoverySummaryService` precedent)
      - Findings prioritization order (critical/high severity, needs_review, accepted, migration_risk, data_quality, business_logic, runtime_usage, reconciliation, testability, sample_data)
      - `maxFindings`/`maxEvidenceItems` truncation applied AFTER priority sort
      - Readiness rule deterministic outputs for `apiReadiness` (sufficient with OAS+baseline; partial with OAS only; insufficient otherwise)
      - Gap codes emitted from the fixed set (`no_api_behaviour_baseline`, `unresolved_discovery_decisions`, `missing_current_to_target_mappings`, `no_database_discovery_findings`, `high_severity_unreviewed_findings`, `missing_oas_for_in_scope_interface`, `insufficient_runtime_evidence`, `no_sample_data_hints`)
      - `overallStatus` rollup: `sufficient` only when core selected streams are sufficient, `partial` when prerequisite work could resolve gaps, `insufficient` when critical inputs missing
      - Architecture/project mismatch rejection (404/400 via `GlobalExceptionHandler`)
    - Skip exhaustive coverage of every field, every repository call, every edge case
  - [x] 1.2 Create request/response DTOs
    - `MigrationDiscoveryContextRequestDto`: `currentArchitectureId` (required), `targetArchitectureId` (optional), `discoveryRunIds[]`, `apiBehaviourBaselineIds[]`, include flags (`includeFindings`, `includeEvidence`, `includeRuntimeEvidence`, `includeDbFindings`, `includeMappings` — all default true), `maxFindings` (default 100), `maxEvidenceItems` (default 100)
    - `MigrationDiscoveryContextDto`: identifiers + summary blocks (`summary`, `currentArchitectureSummary`, `targetArchitectureSummary` nullable, `discoveryRunsSummary`, `findingsSummary`, `highPriorityFindings[]`, `findingsByCategory`, `evidenceHighlights[]`, `candidateSummary`, `unresolvedDecisionTasks[]`, `runtimeUsageSummary`, `databaseDiscoverySummary`, `apiBehaviourBaselineSummary`, `architectureMappingsSummary`, `readinessAssessment`, `contextWarnings[]`, `generatedAt`)
    - `ReadinessAssessmentDto`: per-stream status (`apiReadiness`, `dataReadiness`, `infrastructureReadiness`, `discoveryReadiness`, `mappingReadiness`, `baselineReadiness`), `overallStatus`, `gaps[]`
    - Each summary block must include durable IDs/references so downstream consumers can cite or re-fetch
  - [x] 1.3 Create `MigrationDiscoveryContextService`
    - Orchestrate over existing repositories: `DiscoveryRunRepository`, `DiscoveryFindingRepository`, `DiscoveryFindingLinkRepository`, `DiscoveryCandidateRepository`, `DiscoveryEvidenceRepository`, `DiscoveryDecisionTaskRepository`, `ApiBehaviourBaselineRepository`, `ApiBehaviourBaselineItemRepository`, `ArchitectureElementMappingRepository`, `MetaModelSummaryService`
    - When `discoveryRunIds` is omitted, resolve latest completed runs for the current architecture (reuse pattern from `DiscoverySummaryService`)
    - Reject if `currentArchitectureId` does not belong to `projectId`
    - Apply count-based bounds only; priority-order findings then truncate
    - No response caching in v1; every call recomputes
  - [x] 1.4 Create deterministic readiness rules helper
    - Inline within or alongside `MigrationDiscoveryContextService` per shaping decision D2 (no separate readiness microservice)
    - Implement per raw-idea Part 6 rules
  - [x] 1.5 Create `MigrationDiscoveryContextController`
    - `POST /api/projects/{projectId}/migration-discovery-context`
    - Validation + error mapping through existing `GlobalExceptionHandler`
  - [x] 1.6 Ensure AMS aggregation tests pass
    - Run ONLY the 8-12 tests written in 1.1
    - If pre-existing AMS test compile errors block `mvn test`, fall back to standalone JUnit invocation of only the new test class
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 8-12 tests written in 1.1 pass.
- DTO shape matches spec section "MigrationDiscoveryContextDto shape".
- Latest-run resolution mirrors `DiscoverySummaryService` precedent.
- Count-based bounds (100/100) applied after priority sort.
- Readiness statuses and gap codes match the fixed enum-like set.
- Project/architecture mismatch returns 404/400.
- No new Liquibase changeset created.

### Gateway

#### Task Group 2: Gateway resolver registration + parameter-rich proxy route
**Dependencies:** Task Group 1

- [x] 2.0 Wire the gateway surfaces
  - [x] 2.1 Write 4-6 focused tests for resolver + proxy route
    - 4-6 tests maximum:
      - Resolver registered at key `migration-discovery-context` and listed in `KNOWN_CONTEXT_KEYS`
      - Resolver resolves active architecture via `resolveDefaultArchitectureId(projectId)` and calls AMS with default include flags + limits
      - Resolver bounded-text output cites durable IDs and surfaces insufficient context as explicit gap entries (no invented details)
      - Proxy route `POST /api/v1/projects/:projectId/migration-discovery-context` forwards body verbatim to AMS
      - Proxy route propagates AMS status/error semantics on failure
    - Skip exhaustive route registration testing
  - [x] 2.2 Create `MigrationDiscoveryContextResolver` in `gateway/src/services/contextResolvers.ts`
    - Follow the `MetaModelSummaryContextResolver` precedent for shape and architecture resolution
    - Register in `initializeContextResolverRegistry()`
    - Add `migration-discovery-context` to `KNOWN_CONTEXT_KEYS`
    - Transform AMS response into prompt-ready bounded text with citations to durable IDs
  - [x] 2.3 Create proxy route `POST /api/v1/projects/:projectId/migration-discovery-context`
    - Thin pass-through to AMS endpoint; forward body verbatim; propagate status codes
    - Register alongside existing architectures routes in `gateway/src/routes/index.ts`
    - Mirror the existing AMS proxy patterns under `gateway/src/services/architectureModelClient.ts` / `gateway/src/routes/architectures.ts`
  - [x] 2.4 Ensure gateway tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Do NOT run the entire gateway Jest suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass.
- Resolver registered under `migration-discovery-context` and reachable via the registry.
- Proxy route forwards body verbatim and propagates AMS errors.
- Insufficient context surfaces as explicit gap entries, never invented detail.

### API Migration Validation Service

#### Task Group 3: AMS client method, fetch-at-/start fail-soft, and prompt injection
**Dependencies:** Task Group 2 (proxy route is the chosen call path for parameter-rich requests; if `archModelClient` calls AMS directly per existing convention, verify and adjust during 3.2)

- [x] 3.0 Wire migration discovery context into the API Behaviour Baseline capture flow
  - [x] 3.1 Write 8-10 focused tests for client, /start integration, and prompt injection
    - 8-10 tests maximum:
      - `archModelClient.getMigrationDiscoveryContext(projectId, params)` issues the expected URL + body shape
      - `POST /capture-sessions/{sessionId}/start` fetches context BEFORE orchestrator spawn
      - Successful fetch passes context into orchestrator via new optional param
      - `buildScenarioPrompt()` reads `baseContext.discoveryContextSummary` and injects per-scenario relevant slice (endpoint candidates, runtime usage, missing contract detail, hardcoded URLs, raw SQL tied to endpoint code, DB sample-data hints, decision tasks affecting the API)
      - Prompt explicitly states discovery findings are supporting evidence (do not invent behaviour beyond OAS / API response evidence)
      - Fail-soft on AMS unreachable: 202 response includes `context_unavailable` in `warnings[]`; orchestrator spawn proceeds unchanged
      - Fail-soft on empty response: same warning path
      - Context-free capture (no discovery findings selected) still works end-to-end
    - Skip exhaustive prompt-content assertions and unrelated orchestrator paths
  - [x] 3.2 Add `getMigrationDiscoveryContext(projectId, params)` to `services/archModelClient.ts`
    - Match existing client conventions (base URL, error handling, request shaping)
    - Confirm whether the client calls AMS directly or through the gateway proxy per existing patterns; if direct, the Group 2 proxy is still required for future callers but not blocking Group 3
  - [x] 3.3 Wire pre-loop fetch into `routes/captureSessionActions.ts::POST /capture-sessions/{sessionId}/start`
    - Call the new client method synchronously BEFORE `orchestrateCaptureSession` spawn
    - Use the session's `projectId`/`architectureId` plus any `discoveryRunIds` and `includeDiscoveryContext` flag from the request body
    - On failure (HTTP error, AMS unreachable, empty response): log warning, append `context_unavailable` to the 202 `warnings[]` array, continue with orchestrator spawn unchanged
    - Do NOT block the start; do NOT persist context to the capture session row (deferred per shaping note)
  - [x] 3.4 Extend `orchestrateCaptureSession` + `buildScenarioPrompt()` for once-per-session injection
    - Add optional context param to `orchestrateCaptureSession`
    - Store on `baseContext.discoveryContextSummary` once per session before the operation loop
    - `buildScenarioPrompt()` (lines 68-96 in `services/captureSessionOrchestrator.ts`) injects only the operation-relevant slice per scenario
    - Bounded summaries only; no raw secrets; no unbounded evidence payloads
  - [x] 3.5 Ensure api-migration-validation-service tests pass
    - Run ONLY the 8-10 tests written in 3.1
    - Do NOT run the entire api-migration-validation-service test suite at this stage

**Acceptance Criteria:**
- The 8-10 tests written in 3.1 pass.
- `/start` fetches discovery context before orchestrator spawn.
- Fail-soft path emits `context_unavailable` in `warnings[]` and continues normally.
- Prompt builder injects only operation-relevant context slice once per session.
- Existing capture flow without discovery context still works.

### Frontend

#### Task Group 4: Capture wizard discovery-context section + capture-review annotations
**Dependencies:** Task Group 2 (wizard pre-fetch hits the proxy route)

- [x] 4.0 Surface discovery context in the capture wizard and capture-review surfaces
  - [x] 4.1 Write 6-10 focused tests for wizard section + capture-review annotations
    - 6-10 tests maximum:
      - Wizard discovery-context section default-open when findings exist for the active architecture
      - Default collapsed when no findings exist; warning banner rendered
      - `includeDiscoveryContext` checkbox state submits with `start` request
      - Discovery run selector lists latest completed runs for the current architecture
      - Per-selection finding summary renders counts (severity/category/decision tasks/sample hints/API/runtime/DB)
      - Submission payload includes `discoveryRunIds[]` and `includeDiscoveryContext` boolean
      - Capture-review badge: scenario generated from DB sample-data hint
      - Capture-review badge: endpoint prioritised by runtime usage
      - Capture-review warning: endpoint with missing contract detail finding / unresolved decision task / no discovery evidence linked
    - Skip exhaustive form-state and styling assertions
  - [x] 4.2 Add collapsed Discovery Context section to Step 1 of `frontend/src/components/ApiBehaviour/StartCaptureSessionWizard.tsx`
    - Default open when findings exist; collapsed otherwise (per D5; not a new step)
    - Fetch summary on wizard open via the gateway proxy route from Task Group 2
    - Render: `includeDiscoveryContext` checkbox, run selector, per-selection summary, no-findings warning banner
    - Submit `discoveryRunIds[]` and `includeDiscoveryContext` with start request
    - Default behaviour: include latest relevant discovery context if available
  - [x] 4.3 Add discovery-supported annotations to `CaptureReviewPanel.tsx` and `CaptureSessionDetailView.tsx`
    - Badges: scenario from DB sample-data hint; endpoint prioritised by runtime usage
    - Warnings: missing contract detail finding; unresolved decision task affecting endpoint; no discovery evidence linked to endpoint
    - Derive from data already on the capture session response; no new persistence
  - [x] 4.4 Ensure frontend tests pass
    - Run ONLY the 6-10 tests written in 4.1
    - Do NOT run the entire frontend Vitest suite at this stage

**Acceptance Criteria:**
- The 6-10 tests written in 4.1 pass.
- Wizard section behaves per D5 (default-open vs collapsed by findings availability).
- Submission payload carries `discoveryRunIds[]` and `includeDiscoveryContext`.
- Capture-review surfaces show all five annotation types from raw-idea Part 5B.

### Gateway

#### Task Group 5: Generic resolver scope verification (no-parameter default path)
**Dependencies:** Task Groups 1-2

- [x] 5.0 Verify the no-parameter `migration-discovery-context` resolver path end-to-end
  - [x] 5.1 Write 2-3 focused tests for the no-parameter resolution flow
    - 2-3 tests maximum:
      - Resolver called with no parameters returns a sensible default (latest completed run for the project's default architecture)
      - Resolver output is bounded text suitable for direct prompt injection
      - Resolver does not invent missing details: insufficient context surfaces as explicit gap entries
    - Skip duplicate coverage of resolver registration (already in Group 2)
    - **Outcome:** Group 2's 7 tests already cover all three verification points (registration: test 1; default-architecture POST with bounded text: tests 2-3; fail-soft fallback: test 4). Added 1 targeted reinforcement test in `migrationDiscoveryContext.resolverScope.test.ts` that drives the live registry instance and combines "no discoveryRunIds in request body" (latest-run delegation to AMS) + "insufficient readiness emits explicit gap codes" (no invented detail).
  - [x] 5.2 Confirm resolver hands off to AMS with default include flags and v1 limits (100/100)
    - No new code expected here unless Group 2 left a gap; this group is primarily verification + a tightly-focused safety net
    - **Outcome:** Verified -- resolver sends `currentArchitectureId` only; AMS applies documented defaults (include flags = true, 100/100 caps, latest completed runs). Group 2 test 2 + Group 5 reinforcement test both pin this contract.
  - [x] 5.3 Ensure resolver verification tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Do NOT run the entire gateway suite at this stage
    - **Result:** 1 new gateway test passing (`migrationDiscoveryContext.resolverScope.test.ts`).

**Acceptance Criteria:**
- The 2-3 tests written in 5.1 pass.
- No-parameter resolver flow proven end-to-end through to AMS.
- Insufficient context paths surface as explicit gaps (no invented detail).

### Cross-Stack

#### Task Group 6: Cross-stack gap review and integration tests
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Group 1: 8-12 AMS tests; Group 2: 4-6 gateway tests; Group 3: 8-10 api-migration-validation-service tests; Group 4: 6-10 frontend tests; Group 5: 2-3 resolver-flow tests
    - Total existing tests: approximately 28-41
    - **Reviewed counts:** AMS 12 service tests + Gateway 7 resolver/proxy tests + api-migration-validation-service 11 capture/orchestrator tests (incl. 1 sanity) + Frontend 11 tests (2 api + 5 wizard + 4 review) + Group 5 reinforcement 1 test = 42 feature-specific tests passing pre-Group 6.
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows missing coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration points over unit-level gaps
    - **Identified gaps (kept):**
      - End-to-end body shape: wizard-style payload (run IDs, baseline IDs, include flags, count caps) preserved verbatim through gateway proxy to AMS. Each layer is unit-tested individually but no test wires the wizard payload shape across the gateway boundary.
      - AMS-emitted `contextWarnings` propagation: existing Group 3 tests cover local fail-soft (`context_unavailable`) but never assert that AMS-side warning codes (e.g. `high_severity_unreviewed_findings`, `no_database_discovery_findings`) reach the 202 `warnings[]` array.
      - Persistence deferral guard: shaping note explicitly defers `discoveryContextSummary` persistence; no existing test confirms the PATCH body on /start carries only status fields.
      - End-to-end count-bound forwarding: `maxFindings`/`maxEvidenceItems` from /start body to AMS request body verbatim (no clamping).
    - **Gaps explicitly skipped (already covered):**
      - Frontend wizard fail-soft surfacing -- covered by Group 4 wizard tests.
      - Generic resolver end-to-end -- covered by Group 2 + Group 5.
      - Aggregation contract holds across streams -- covered by AMS Group 1 service tests.
      - Project/architecture mismatch propagation -- Gateway test 6 already pins the 404 round-trip.
  - [x] 6.3 Write up to 10 additional strategic tests maximum to fill identified critical gaps
    - Candidate end-to-end / integration scenarios (pick the most valuable, capped at 10 total):
      - Frontend submits with `discoveryRunIds` -> gateway proxies -> AMS aggregates -> api-migration-validation-service receives -> prompt contains the relevant fields
      - Fail-soft end-to-end: AMS down -> 202 with `context_unavailable` warning -> wizard surfaces degradation
      - Readiness gap surfaces in wizard summary (no API Behaviour Baseline; unresolved decision tasks; missing current->target mappings)
      - High-severity unresolved finding yields `partial` or `insufficient` readiness
      - No-findings architecture returns explicit gap and the wizard section defaults collapsed
      - Mappings + baselines + findings all flow into one response (proves the aggregation contract holds across streams)
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, accessibility tests unless business-critical
    - **Added 4 strategic tests (under cap of 10):**
      - Gateway `migrationDiscoveryContext.crossStack.test.ts` (1 test): wizard-style payload preserved byte-for-byte from gateway proxy to AMS.
      - api-migration-validation-service `migrationDiscoveryContext.crossStack.test.ts` (3 tests): (a) AMS-emitted `contextWarnings` propagate into 202 `warnings[]`; (b) PATCH to capture session row contains no discovery-context payload (persistence deferral); (c) `maxFindings`/`maxEvidenceItems` from /start forwarded verbatim to AMS.
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests written in 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3
    - Expected total: approximately 38-51 tests
    - Do NOT run the entire application test suite
    - Do NOT re-run or "fix" the pre-existing failing tests in CLAUDE.md memory
    - Verify critical workflows pass
    - **Result:** 46 feature-specific tests passing across 4 stacks (AMS 12 + Gateway 9 + api-migration-validation-service 14 + Frontend 11). All new tests in 5.x + 6.x pass; tsc clean on gateway, api-migration-validation-service, and (no new errors on) frontend.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 38-51 total).
- Critical end-to-end and fail-soft workflows for this feature are covered.
- No more than 10 additional tests added when filling testing gaps.
- Testing focused exclusively on this spec's feature requirements.

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 — AMS aggregation endpoint + DTOs + readiness rules.** Foundation; everything else reads from this endpoint.
2. **Task Group 2 — Gateway resolver + parameter-rich proxy route.** Depends on Group 1 being callable; unblocks both Groups 3 and 4.
3. **Task Group 3 — api-migration-validation-service AMS client + /start fetch + prompt injection.** Depends on the call path verified in Group 2 (and, if the client calls AMS directly per existing convention, still benefits from Group 2 for future callers).
4. **Task Group 4 — Frontend wizard discovery-context section + capture-review annotations.** Depends on the proxy route from Group 2 for the wizard's pre-fetch.
5. **Task Group 5 — Generic resolver scope verification.** Depends on Groups 1 and 2; small dedicated verification group to prove the no-parameter resolver path resolves to a sensible default end-to-end.
6. **Task Group 6 — Cross-stack gap review and integration tests.** Depends on Groups 1-5; closes critical end-to-end and fail-soft gaps with up to 10 additional tests.
