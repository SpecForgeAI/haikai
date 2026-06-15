# Shaping Notes — Migration Discovery Context Integration

Date: 2026-05-16
Spec folder: `agent-os/specs/2026-05-16-migration-discovery-context/`
Status: **Shaping complete** — all product decisions resolved; ready for spec authoring.

---

## Final Summary

### Scope (v1)

Build a shared **Migration Discovery Context** aggregation layer that exposes Current State Architecture, Discovery Findings/Evidence, Discovery Candidates, Discovery Relationships, Decision Tasks, runtime/log evidence, DB discovery findings, API Behaviour Baselines, current→target architecture mappings, and target architecture meta-model behind a single aggregation endpoint. The context is consumed by (a) future migration-planning LLM prompts via the gateway context resolver registry and (b) `api-migration-validation-service` during API Behaviour Baseline capture, where it improves request generation, DB sampling hints, scenario selection, and coverage warnings. Frontend gains a collapsed discovery-context section on the capture wizard and discovery-supported annotations on capture-review surfaces.

This spec does **not** generate the migration roadmap/backlog, shape-specs, or any migration test harness — it builds only the shared substrate those future features need.

### Final Resolved Decisions

- **D1 — Aggregation endpoint shape:** Single monolithic AMS endpoint `POST /api/projects/{projectId}/migration-discovery-context`. POST (not GET) to accept a request body of filters/limits.
- **D2 — Readiness rules location:** Deterministic readiness rules live in AMS, computed inline during aggregation and returned as part of the response payload. No separate readiness service.
- **D3 — Context fetch lifecycle in `api-migration-validation-service`:** Fetch happens at `POST /start`, **before** orchestrator spawn, **fail-soft**. If the AMS aggregation call fails or returns no usable context, the orchestrator continues without it and the 202 response surfaces a `context_unavailable` warning so the UI can flag the degradation.
- **D4 — Readiness panel:** Standalone readiness panel **deferred from v1**. Readiness indicators are surfaced inside the API Behaviour Baseline capture wizard and capture-review surfaces only. A dedicated Migration Prep page can land in a follow-up when that area of the app exists.
- **D5 — Wizard placement:** Discovery context appears as a **collapsed section on Step 1** of `StartCaptureSessionWizard.tsx`. Defaults to **open** when findings exist for the active architecture; **collapsed** when none. Not a new step.
- **D6 — Gateway surfaces (both):**
  - **No-parameter resolver** registered at key `migration-discovery-context` in `gateway/src/services/contextResolvers.ts`. Pulls "latest relevant" data from AMS using the active project/architecture — matches the existing resolver pattern (`MetaModelSummaryContextResolver`).
  - **Dedicated proxy route** `POST /api/projects/:projectId/migration-discovery-context` for parameter-rich callers (specifically `api-migration-validation-service`) that need to pass filters, limits, run IDs, baseline IDs, etc.
- **D7 — Bounds v1 (count-based):** Hard caps of `maxFindings: 100` and `maxEvidenceItems: 100`, priority-ordered (highest-priority findings/evidence first). Token-budget-aware trimming is a v2 enhancement and is **not** implemented in v1.
- **D8 — Resolver scope:** The gateway resolver is a single generic `migration-discovery-context` resolver. `api-migration-validation-service` does **not** get its own context key; it consumes a filtered/prioritized view of the same generic context via the dedicated proxy route (D6).

### Services Touched

- **architecture-model-service** — new aggregation endpoint, `MigrationDiscoveryContextDto`, readiness rules, thin orchestration over existing services/repositories. No new tables, no new Liquibase changesets.
- **gateway** — new `MigrationDiscoveryContextResolver` registered in the context resolver registry; new proxy route `POST /api/projects/:projectId/migration-discovery-context`.
- **api-migration-validation-service** — new `archModelClient.getMigrationDiscoveryContext()` method; context fetch wired into `routes/captureSessionActions.ts::POST /start` before orchestrator spawn; `services/captureSessionOrchestrator.ts::buildScenarioPrompt()` injection (once-per-session via `baseContext`); `context_unavailable` warning surfaced in 202 response.
- **frontend** — collapsed discovery-context section on Step 1 of `StartCaptureSessionWizard.tsx`; discovery-supported annotations on `CaptureReviewPanel.tsx` and `CaptureSessionDetailView.tsx`.
- **discovery-service** — **no changes**. All discovery state already lives in AMS.

### Explicitly Out of Scope (v1)

In addition to the raw-idea exclusions (no roadmap/backlog generation, no shape-specs, no migration test harness, no full PM "Create Migration Delivery Plan", no new DB discovery pack, no new capture persistence schema), the following are also deferred:

- **Standalone Migration Prep readiness panel** — deferred per D4. Readiness signals live in the capture wizard + capture-review only.
- **Aggregation response caching** — every call recomputes from source repositories. Caching can be added later if profiling demands it.
- **`discoveryContextSummary` persistence on the capture session row** — context is fetched and injected at runtime; it is not persisted alongside the capture session record. If audit/reproducibility later requires it, a follow-up spec can add a JSONB column.
- **Token-budget-aware trimming** — v1 is count-based only (D7). Token-budget logic is v2.

### Visuals

**No visuals required** — backend-heavy with additive frontend additions in the capture wizard and capture-review surfaces. Nothing is being designed from scratch; UI additions slot into existing components.

---

## Codebase Reality Check (preserved)

### AMS — data + services this spec aggregates

All data the new aggregation endpoint needs already exists and is queryable via JPA repositories:

- **Discovery durable data (run-owned, architecture-scoped)**
  - `repository/entity/DiscoveryRunRepository.java`
  - `repository/entity/DiscoveryCandidateRepository.java`
  - `repository/entity/DiscoveryEvidenceRepository.java`
  - `repository/entity/DiscoveryRelationshipRepository.java`
  - `repository/entity/DiscoveryClusterRepository.java`
  - `repository/entity/DiscoveryDecisionTaskRepository.java`
  - Existing services: `DiscoveryRunService`, `DiscoveryCandidateService`, `DiscoveryEvidenceService`, `DiscoveryDecisionTaskService`, **`DiscoverySummaryService`** (already does latest-run + GROUP BY status aggregates — useful precedent for the aggregation pattern)

- **Discovery findings (Liquibase 135-136 from predecessor spec)**
  - `repository/discovery/DiscoveryFindingRepository.java`
  - `repository/discovery/DiscoveryFindingLinkRepository.java`
  - `service/discovery/DiscoveryFindingService.java`

- **API Behaviour Baselines (Liquibase 128-134)**
  - `repository/apibehaviour/{ApiBehaviourBaselineRepository, ApiBehaviourBaselineItemRepository, ApiBehaviourCaptureSessionRepository, ApiBehaviourCaptureRepository, ApiBehaviourScenarioRepository, ApiBehaviourOperationRepository, ApiBehaviourDiagnosticRepository}.java`
  - Services in `service/apibehaviour/`

- **Architecture mappings (current → target)**
  - `repository/entity/ArchitectureElementMappingRepository.java`
  - `service/ArchitectureElementMappingService.java` — list method supports filtering by source/target architecture, type, status

- **Architecture meta-model (current & target architectures)**
  - `MetaModelSummaryService` already produces a JSON summary the gateway resolver consumes today

**Conclusion:** the aggregation endpoint is a thin orchestration layer over existing services/repositories. **No new tables required — no new Liquibase changeset** (current tail is 137).

### Gateway — context resolver pattern

`gateway/src/services/contextResolvers.ts` defines:
- `ContextResolver` interface: `resolve(projectId, threadKey): Promise<string>`
- Registry populated in `initializeContextResolverRegistry()`
- `KNOWN_CONTEXT_KEYS` array
- Existing live resolvers: mission, tech-stack, test-strategy, meta-model-summary, product-summary, roadmap-summary
- Stub resolver fallback

`MigrationDiscoveryContextResolver` follows the existing shape (resolves active architecture via `resolveDefaultArchitectureId(projectId)` the same way `MetaModelSummaryContextResolver` does). The resolver pulls a "latest relevant" view without parameters. Parameter-rich callers use the dedicated gateway proxy route instead (D6).

### api-migration-validation-service — prompt injection point

- `services/captureSessionOrchestrator.ts::buildScenarioPrompt()` (lines 68–96) is the per-scenario prompt builder. Currently minimal: system prompt + user JSON with sessionId/envName/operationId/scenarioName.
- **Injection strategy (chosen):** Once-per-session inside `orchestrateCaptureSession`, before the operation loop, via the orchestrator's `baseContext`. `buildScenarioPrompt` reads the pre-injected `discoveryContextSummary` from baseContext per scenario. Avoids duplicate fetches and keeps the LLM's working set stable across operations.
- `services/archModelClient.ts` is where the new `getMigrationDiscoveryContext(projectId, params)` method lives.
- `routes/captureSessionActions.ts::POST /start` is the lifecycle gate. Context fetch happens here, synchronously, **before** orchestrator spawn so the 202 response can surface a `context_unavailable` warning (D3).

### Frontend — wizard structure

- `components/ApiBehaviour/StartCaptureSessionWizard.tsx` — 952 lines, 5 steps (OAS source, env config, DB sampling, endpoint inclusion, start summary). Per D5, discovery context is a **collapsed section on Step 1** (not a new step), default-open when findings exist.
- `components/DashboardView/CaptureReviewPanel.tsx` and `CaptureSessionDetailView.tsx` — review surfaces gain discovery-supported annotations (which findings/evidence informed which scenarios).
- **No "Migration Prep" page exists today.** App routes under `/projects/:projectId/architectures/:architectureId/` include `dashboard`, `metamodel`, `diagrams`, `product` (with `mission`/`roadmap`/`backlog`/`implement` sub-tabs). Standalone readiness panel is deferred (D4).

### Project memory constraints

- `feedback_liquibase_immutable_changesets.md` — no new changeset needed (confirmed; aggregation only).
- `project_appshell_model_cache.md` — read-only aggregation; cache is irrelevant.
- `feedback_no_src_edits_during_run.md` — applies to any discovery-service edits (none planned, but flagged for implementation phase).
- `project_primitive_double_dto_overwrite.md` — aggregation endpoint is POST-and-return (no PATCH semantics), so the primitive-overwrite hazard doesn't apply.
- `feedback_curate_subagent_output.md` — applied: low-stakes items resolved here; only real product calls reached the user (and all 8 were confirmed).

---

## Recommended Commit/Group Split

1. AMS aggregation endpoint + `MigrationDiscoveryContextDto` + deterministic readiness rules (D1, D2, D7).
2. Gateway resolver registration + dedicated proxy route + tests (D6, D8).
3. `api-migration-validation-service` AMS client method + `/start` fetch + once-per-session prompt injection + `context_unavailable` warning surfacing (D3).
4. Frontend: collapsed discovery-context section on Step 1 of capture wizard + capture-review annotations (D5).
5. Cross-stack integration tests proving discovery findings flow into the capture LLM prompt and degraded-mode handling works.

(No standalone readiness panel group — deferred per D4.)
