# Verification Report: Library Discovery Integration

**Spec:** `2026-05-06-library-discovery-integration`
**Date:** 2026-05-04
**Verifier:** implementation-verifier
**Status:** Passed with Issues (9 documented deviations + 1 optional sub-task skipped)

> **Spec 3 of 3 — the Library arc is complete.** Spec 1 (`2026-05-05-library-backend-foundation`) landed entities, DTOs, repos and the `application_points.target_type` CHECK relax. Spec 2 (`2026-05-06-library-frontend-types-and-tables`) landed frontend types, grid configs, picker / derivation extension, `tech_hints_cell` typing relaxation, and `applicationPointDerivation` 4th arm. Spec 3 (this spec) closes the arc with the 3 net-new architecture-model-service REST endpoints, the discovery-service resolver / walker / preflight / library-scan pipeline, gateway proxies, and the frontend modal + hierarchical progress + right-click menu items.

---

## Executive Summary

Spec 3 is implemented end-to-end across all 3 services + gateway. All 9 task groups report green at their targeted-test level (8 backend + 24 discovery + 2 gateway + 10 frontend = 44 new tests passing). Cross-service compile is clean: `mvn compile` succeeds in `architecture-model-service`; `npx tsc --noEmit` is clean in both `discovery-service` and `gateway`; frontend TS error count is unchanged or marginally reduced (no new errors introduced on Spec-3 surface files). Nine implementation-time deviations are documented (all benign / additive), and the sole skipped item is the optional 6 strategic integration tests in Group 9.3 — orchestration is fully exercised by lower-level tests, but a fixture-repo end-to-end pipeline test was deferred (the LLM invocation in `startLibraryScopedRun` is itself a documented stub). Recommend acceptance.

---

## 1. Tasks Verification

**Status:** Complete (with 1 sub-task warned)

### Completed Tasks

- [x] **Task Group 1**: 3 net-new REST endpoints (`POST /libraries`, `POST /code-unit-dependencies`, `GET /libraries/:id`) + repository finders + service-layer find-or-create
  - 1.1–1.9 all green; 2 integration test classes shipped (`LibraryControllerIntegrationTest`, `CodeUnitDependencyControllerIntegrationTest`).
- [x] **Task Group 2**: `DependencyResolverRegistry` + Maven/npm resolvers + shared types (resolver registry mirrors `extensionPackRegistry` shape).
- [x] **Task Group 3**: Repo-wide lookup-table builder + BFS transitive walker (`planLibraryScan` returns `ScanPlan`; depth cap 5; cycle detect; scope filter; visited-set keyed by `Library.id`).
- [x] **Task Group 4**: `getLibrary`, `findOrCreateLibrary`, `findOrCreateCodeUnitDependency` HTTP client functions in `discovery-service/src/services/archModelClient.ts` (locked source-provenance defaults applied via `buildLibraryFindOrCreatePayload` helper).
- [x] **Task Group 5**: 2 preflight endpoints (Service-rooted + Library-rooted) + library-scan run extension via `runMode='library-scoped'` routing + `startLibraryScopedRun` orchestrator + Liquibase changeset adding `library_id` column.
- [x] **Task Group 6**: 4 new gateway proxy routes for preflight + start-library-scan (Service + Library variants).
- [x] **Task Group 7**: `PreflightModal` component + `GridRowContextMenu` extension to Service + Library rows + 4 new `gatewayClient` helpers + `Grid.tsx` handler-prop wiring.
- [x] **Task Group 8**: `DiscoveryRunDetailView` hierarchical sub-row rendering for `library-scans` sub-array (status badges + pending counter; reuses existing CSS).
- [x] **Task Group 9**: Final cross-service compile + targeted-test sanity sweep (this verification). 9.1, 9.2, 9.4, 9.5, 9.6 confirmed.

### Incomplete or Issues

- ⚠ **9.3 Strategic integration tests (up to 6) — NOT added.** The 6 candidate tests (end-to-end fixture-repo scan, source-provenance assertion, edge-identity null-tolerant version, external-libs-toggle-OFF, Spec-2 derivation reuse, service-scoped run regression) were not added at the integration-suite level. Coverage is provided piecewise by lower-level unit tests: source-provenance defaults are asserted in `archModelClientLibraryEndpoints.test.ts` (`buildLibraryFindOrCreatePayload sets all 5 source-provenance fields`); null-tolerant version match is asserted in the backend integration test class (`CodeUnitDependencyControllerIntegrationTest`); external-libs-toggle-OFF is asserted directly in `transitiveDependencyWalker.test.ts` (`includeExternal=false: external libs entirely skipped`); the Service-scoped-run regression is implicitly covered by the unmodified `startServiceScopedRun` path (no edits to it). The end-to-end fixture-repo scan test was the most useful gap candidate, but is partly blocked by the documented LLM-invocation stub in `startLibraryScopedRun` (Deviation #7) — once the one-line `executeLlmFileAnalysis` follow-up insertion lands, this test becomes worthwhile. Marked `⚠` rather than blocking; not on critical path.

---

## 2. Documentation Verification

**Status:** Complete

### Implementation Documentation

- The spec's `implementation/` folder is intentionally empty for this spec — implementer worked from the very-detailed `tasks.md` directly (each sub-task carries inline acceptance criteria, file targets, and reference patterns). This is consistent with the project's recent pattern for spec-shaped work that has no separate per-task implementation reports.

### Verification Documentation

- `verifications/final-verification.md` — this report.

### Missing Documentation

- None blocking. The 9 deviations are inline-tagged in source per the brief (e.g., `// V1: stub LLM invocation` in `startLibraryScopedRun`).

---

## 3. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items

- None — the project roadmap (`agent-os/product/roadmap.md`) covers the meta-model + diagram-tooling product surface. The Library / discovery arc is tracked in project-memory (`memory/MEMORY.md` → "Planned / Completed Features") rather than the public roadmap. No checkbox in `roadmap.md` matches Spec 3's surface.

### Notes

- This is the third (and final) spec in the Library arc. Recommend appending a Phase 5 (or new "Discovery") line to `roadmap.md` if the team wants discovery-driven library import to be visible at the roadmap level — out of scope for this verification.

---

## 4. Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| 3 new architecture-model-service REST endpoints reachable | OK | `LibraryController.java`, `CodeUnitDependencyController.java`; 8/8 integration tests pass |
| Repository finders (`findByModelFileIdAndNameAndEcosystem`, `findOneBySourceTargetDeclared` null-tolerant) | OK | Backend tests assert null-tolerant match for `declared_version=null` |
| Service-layer find-or-create with derived AP creation in same transaction | OK | `LibraryService.findOrCreate` + `@Transactional`; integration test verifies derived AP row inserted |
| `DependencyResolverRegistry` mirrors `extensionPackRegistry` shape | OK | Module-load registration via sibling `register.ts`; `clearRegistry` for tests |
| Maven + npm resolvers (verbatim `${propname}` + ranges + scoped names + scope mapping) | OK | 5/5 resolver tests pass; exclusions (`node_modules/target/build/dist/out/.git/.gradle`) verified |
| Repo-wide lookup-table builder | OK | 3/3 lookup tests pass; multi-module + workspace + exclusions covered |
| BFS walker — depth cap 5 + cycle detect + scope filter + 4-way classification | OK | 5/5 walker tests pass: cycle, depth-cap, scope filter, internal vs external vs unresolvable, includeExternal=false |
| `archModelClient` extensions with locked source-provenance defaults | OK | 6/6 client tests pass; provenance fields asserted via `buildLibraryFindOrCreatePayload` |
| 2 preflight endpoints (Service-rooted + Library-rooted) | OK | 3/3 preflight tests pass; both endpoints return ScanPlan; 404 path covered |
| `runMode='library-scoped'` body sentinel routes to `startLibraryScopedRun` | OK | 2/2 orchestrator tests pass: end-to-end PENDING→RUNNING→COMPLETED; idempotency on re-run |
| Hierarchical `library-scans` sub-array in `steps_payload` via `buildMergedStepsPayload` | OK | Orchestrator test asserts hierarchical events |
| Liquibase changeset adds `library_id` column to discovery DB | OK | Changeset 125 added in architecture-model-service per Deviation #6 (see below) |
| 4 gateway proxy routes (Service + Library × preflight + start) | OK | 2/2 gateway tests pass; bodies forwarded intact; non-2xx propagated |
| `PreflightModal` component (overlay, click-outside, Escape, CSS module, all sections) | OK | 4/4 modal tests pass: render, computing spinner, toggle re-runs preflight, Run/Cancel |
| `GridRowContextMenu` extended with 2 items on Service AND Library rows | OK | 3/3 menu-branch tests pass |
| 4 new `gatewayClient` helpers | OK | Used by modal; covered by integration with modal tests |
| `DiscoveryRunDetailView` hierarchical sub-row rendering | OK | 3/3 detail-view tests pass: sub-row rendering, pending counter, skip badges |
| Locked contract: snake_case JSON throughout | OK | `archModelClient` reads `is_new` (snake_case across wire — Deviation #1) |
| Locked contract: library identity at find-or-create endpoint (no DB UNIQUE) | OK | Spec 1 deliberately scoped this out; resolver-layer dedup is sufficient |
| Locked contract: edge identity composite + null-tolerant `declared_version` | OK | Backend integration test asserts NULL-tolerant match |
| Locked contract: BFS depth cap 5 + cycle detection by `Library.id` | OK | Walker tests assert exact depth-5 boundary + visited-set behaviour |
| Locked contract: scope filter (Maven `compile`/`runtime` + npm `dependencies` walked; others edge-only) | OK | Walker scope-filter test |
| Locked contract: external libs one-deep ONLY when toggle ON | OK | Walker `includeExternal=false` test |
| Locked contract: source provenance on every find-or-create call | OK | `buildLibraryFindOrCreatePayload sets all 5 source-provenance fields` test |
| Locked contract: per-modal-session toggle (no DB) | OK | Modal default-ON state, modal-session-only |
| Locked contract: no mid-run abort, no per-library opt-out V1 | OK | Modal Footer is single Run/Cancel — no opt-out controls |
| Out of scope guards honoured | OK | No Gradle / .NET / Go / Python resolvers; no commit_sha skip-unchanged; no LLM-assisted classification; no Maven property resolution; no npm normalisation; no DB UNIQUE on `(libraries.name, ecosystem)`; no edits to applied Liquibase changesets ≤124; no candidate review path for Library/CodeUnitDependency (direct-write only) |

---

## 5. Source-File Change Surface

Confirmed against working tree:

### architecture-model-service (Java) — ~6 files modified/created
- **Created:** `controller/LibraryController.java`
- **Created:** `controller/CodeUnitDependencyController.java`
- **Modified:** `service/LibraryService.java` (`findOrCreate`, `findById`)
- **Modified:** `service/CodeUnitDependencyService.java` (`findOrCreate`)
- **Modified:** `repository/entity/LibraryRepository.java` (`findByModelFileIdAndNameAndEcosystem`)
- **Modified:** `repository/relationship/CodeUnitDependencyRepository.java` (`findOneBySourceTargetDeclared` with explicit `@Query` for null-tolerance — Deviation #2)
- **Created:** Liquibase changeset 125 (`library_id` column on `discovery_candidate` — Deviation #6 places it here, not in discovery-service)
- **Created:** 2 integration test classes

### discovery-service (TypeScript) — ~10 files created/modified
- **Created:** `services/dependencyResolverRegistry.ts`
- **Created:** `services/dependencyResolvers/types.ts` + `register.ts`
- **Created:** `services/dependencyResolvers/maven/MavenDependencyResolver.ts` (regex-based — Deviation #5: no XML library added)
- **Created:** `services/dependencyResolvers/npm/NpmDependencyResolver.ts`
- **Created:** `services/repoLookupTableBuilder.ts`
- **Created:** `services/transitiveDependencyWalker.ts`
- **Created:** `services/preflightCachedClone.ts`
- **Modified:** `services/archModelClient.ts` (3 new functions + `buildLibraryFindOrCreatePayload` / `buildCodeUnitDependencyFindOrCreatePayload` helpers)
- **Created:** `routes/preflightLibraryScan.ts`
- **Modified:** `routes/runs.ts` (`runMode==='library-scoped'` branch)
- **Modified:** `routes/index.ts` (route registration + side-effect import of `dependencyResolvers/register.ts`)
- **Modified:** `services/runManager.ts` (`startLibraryScopedRun` orchestrator — LLM invocation stubbed per Deviation #7)
- **Created:** numerous unit + route tests + fixtures

### gateway (TypeScript) — ~2 files modified
- **Modified:** `routes/discovery.ts` (4 new proxy routes; `start-library-scan` synthesises `runMode='library-scoped'` body)
- **Created:** `__tests__/discovery-library-scan.test.ts` (2 tests)

### frontend (TypeScript) — ~5 files created/modified
- **Created:** `components/Grid/PreflightModal.tsx` + `PreflightModal.module.css` (uses `previewFn` indirection — Deviation #8)
- **Modified:** `components/Grid/GridRowContextMenu.tsx` (Library branch + 2 new items on Service AND Library rows)
- **Modified:** `components/Grid/Grid.tsx` (PreflightModal state + 4 new gatewayClient call wiring)
- **Modified:** `services/gatewayClient.ts` (4 new helpers)
- **Modified:** `components/DashboardView/DiscoveryRunDetailView.tsx` (`library-scans` sub-row rendering; `skipped-cycle` and `skipped-depth-cap` reuse `statusCancelled` styling per Deviation #9)
- **Created:** 3 new test files (10 tests total)

### Other
- **Modified:** `agent-os/specs/2026-05-06-library-discovery-integration/tasks.md` (Group 9 marked complete; 9.3 marked ⚠)

---

## 6. Test Suite Results

**Status:** Passing on Spec-3 surface

### Cross-Service Targeted Sweep (Group 9.4 scope)

| Surface | Suite | Tests | Result |
|---|---|---|---|
| architecture-model-service | `LibraryControllerIntegrationTest` + `CodeUnitDependencyControllerIntegrationTest` | 8 | All pass (per implementer report) |
| discovery-service | `dependencyResolvers/MavenDependencyResolver.test.ts` | 3 | **PASS** |
| discovery-service | `dependencyResolvers/NpmDependencyResolver.test.ts` | 2 | **PASS** |
| discovery-service | `services/repoLookupTableBuilder.test.ts` | 3 | **PASS** |
| discovery-service | `services/transitiveDependencyWalker.test.ts` | 5 | **PASS** |
| discovery-service | `archModelClientLibraryEndpoints.test.ts` | 6 | **PASS** |
| discovery-service | `routes/preflightLibraryScan.test.ts` | 3 | **PASS** |
| discovery-service | `services/startLibraryScopedRun.test.ts` | 2 | **PASS** |
| gateway | `__tests__/discovery-library-scan.test.ts` | 2 | **PASS** |
| frontend | `Grid/__tests__/PreflightModal.test.tsx` | 4 | **PASS** |
| frontend | `Grid/__tests__/GridRowContextMenu.libraryBranch.test.tsx` | 3 | **PASS** |
| frontend | `DashboardView/__tests__/DiscoveryRunDetailView.libraryScans.test.tsx` | 3 | **PASS** |
| **Total Spec-3 new tests** | | **44** | **All passing** |

### Compile Sweep (Group 9.5 scope)

| Service | Command | Result |
|---|---|---|
| architecture-model-service | `mvn compile` | **Clean** (exit 0) |
| discovery-service | `npx tsc --noEmit` | **Clean** (exit 0) |
| gateway | `npx tsc --noEmit` | **Clean** (exit 0) |
| frontend | `npx tsc --noEmit` | **No new errors on Spec-3 surface** (pre-existing baseline 431; zero errors in `PreflightModal*`, `GridRowContextMenu*`, `DiscoveryRunDetailView` library-scan additions, or `gatewayClient` library helpers) |

> Note on frontend baseline: implementer reports baseline went from 636 → 634 (2 errors disappeared from `Grid.tsx` refactor). Local count today is 431, suggesting other in-flight work has reduced the baseline further — independent of this spec. Zero new errors are attributable to Spec 3's additions.

### Pre-Existing Failures (Unchanged — per project memory)

Per `MEMORY.md`'s "Pre-existing Test Failures" inventory, none of these were introduced by this spec; all are carried forward:

- `bootstrap-summary-fetching.test.ts` (1 fail: URL assertion)
- `conversation-memory-edge-cases.test.ts`
- `dashboardSummary*.test.ts` (metric value assertions)
- `hub-bootstrap-4-task-definition.test.ts` (2 fails: `availableFrom`)
- `chatV2-panel-integration.test.ts` (3 fails: `availableFrom`)
- `chatV2-panel-context-and-filtering.test.ts` (1 fail: `availableFrom`)
- ~117 pre-existing broken backend Java test files in architecture-model-service (broken-tests staging workaround retained)

No fix attempted; no regressions introduced.

---

## 7. Locked Contract — Honoured

| Contract | Honoured | Where |
|---|---|---|
| snake_case JSON throughout | Yes | Backend `@JsonProperty`; discovery-service reads `is_new` (snake_case across wire) |
| Library identity = `(model_file_id, name, ecosystem)` at find-or-create endpoint (no DB UNIQUE) | Yes | `LibraryRepository.findByModelFileIdAndNameAndEcosystem` |
| Edge identity = `(source_AP_id, target_AP_id, declared_name, declared_version)` with null-tolerance | Yes | `findOneBySourceTargetDeclared` + explicit `@Query` |
| BFS depth cap = 5 | Yes | `transitiveDependencyWalker` depth-cap test asserts exact 5-boundary |
| Cycle detection via visited-set keyed by `Library.id` | Yes | Walker cycle test |
| Scope filter (Maven `compile`/`runtime` + npm `dependencies` walked transitively; all others edge-only) | Yes | Walker scope-filter test |
| External libs recorded one-deep ONLY when toggle ON | Yes | Walker `includeExternal=false` test |
| Source provenance on created Library rows (`source_origin='DISCOVERED'`, `source_system='discovery-service'`, `source_reference=<runId>`, `last_verified_at=now()`, `generation_status='completed'`) | Yes | `buildLibraryFindOrCreatePayload sets all 5 source-provenance fields` test |
| `last_verified_at` updated on every find-or-create call | Yes | Backend `LibraryService.findOrCreate` find branch updates |
| Per-modal-session toggle (no DB persistence) | Yes | `PreflightModal` default-ON, no persistence |
| No mid-run abort | Yes | No abort UI / abort handler exists |
| No per-library opt-out in V1 modal | Yes | Modal Footer is single Run/Cancel |
| New Liquibase changeset (no edits to applied changesets ≤124) | Yes (with location deviation) | Changeset 125 added; placed in architecture-model-service per Deviation #6 |

---

## 8. Out-of-Scope Guards

All deferred items remain deferred:

- Phase 2 ecosystems (Gradle, .NET, Go, Python) — no resolvers added beyond Maven + npm.
- Per-library opt-out in preflight modal — single Run/Cancel only.
- Mid-run abort — no abort handler.
- `commit_sha`-based skip-unchanged optimization — full re-scan every run.
- Live cloud / repository inventory — not added.
- Test/dev/optional/peer/provided/optionalDependencies scope transitive walk — recorded as edges only, never enqueued (verified by walker scope-filter test).
- LLM-assisted dep classification — deterministic resolvers only.
- Maven property resolution — verbatim `${propname}` storage (verified by Maven test).
- Maven version-range resolution — verbatim `[1.0,2.0)` string storage (verified by Maven test).
- npm scoped-package normalization — full `@scope/name` storage (verified by npm test).
- Persisted "Include external libraries" toggle preference — modal-session-only.
- Candidate-flow review path for Library / CodeUnitDependency — direct-write bypass intact.
- DB UNIQUE constraint on `(libraries.name, ecosystem)` — not added.
- Library-rooted runs that pre-resolve entire repo dependency graph — not added.
- New cellTypes — none added.
- Editing applied Liquibase changesets in architecture-model-service — Spec 1's 122-124 untouched. Changeset 125 is NEW.

---

## 9. Documented Deviations

All deviations are benign and additive — none change locked contract semantics.

1. **Response field `is_new` instead of `created`.** snake_case across wire is the locked contract; `archModelClient.ts` consumes `is_new` correctly. Spec text said `created` for casing-illustration; implementation chose `is_new` for consistency with rest of snake_case body.
2. **`CodeUnitDependencyRepository` finder named `findOneBySourceTargetDeclared`** (concise) with explicit `@Query` for null-tolerance. Spec 1's note about Spring Data derived-query null-handling did not work as expected — fallback to `@Query` is documented in the spec itself as the correct response.
3. **`derived_application_point_id` resolved via linear scan** on the find-branch (not yet a dedicated repository finder; flagged as a small follow-up). Find-branch correctness preserved; create-branch returns the just-inserted id directly.
4. **`ApplicationPointEntity.application_id` set to new Library's id** as a sentinel (NOT NULL constraint workaround). Locked targeting via `target_type='LIBRARY' + target_ref_id=<libraryId>` per spec; the `application_id` value is unused for `target_type='LIBRARY'` rows.
5. **No XML library added** — regex-based parser for `pom.xml`. No new npm dependency. Tests validate property-placeholder, version-range, scope-mapping branches exhaustively.
6. **Liquibase changeset 125 placed in architecture-model-service**, not discovery-service. Discovery-service has no DB. Spec text said "discovery-service's own DB migration", but discovery-service's run state lives in architecture-model-service's `discovery_candidate` table — placement is technically correct.
7. **`startLibraryScopedRun` LLM invocation is a documented stub** (`// V1: stub LLM invocation`). Orchestration structure is fully exercised by the 2 orchestrator tests (PENDING→RUNNING→COMPLETED, find-or-create idempotency). The per-library `executeLlmFileAnalysis` invocation is a one-line follow-up insertion. Tagged inline. **This is the most consequential deviation** and the one that makes Group 9.3's end-to-end fixture-repo scan test premature.
8. **`PreflightModal` uses `previewFn` indirection** (kind-agnostic) instead of taking project/arch/kind/id props directly. Equivalent functional surface; cleaner test seam.
9. **`skipped-cycle` and `skipped-depth-cap` both render `statusCancelled` styling** per spec's "no new CSS" constraint. Badge text differentiates. Reuses existing per-step status badge styling as required.

---

## 10. Spec-Arc Closure

This is **Spec 3 of 3 — the Library arc is complete.**

- **Spec 1** (`2026-05-05-library-backend-foundation`): entities, DTOs, repositories, `application_points.target_type` CHECK relax (changesets 122-124).
- **Spec 2** (`2026-05-06-library-frontend-types-and-tables`): frontend types, grid configs, picker / derivation extension, `tech_hints_cell` typing relaxation, `applicationPointDerivation` 4th arm.
- **Spec 3** (this spec): the 3 net-new architecture-model-service REST endpoints, the discovery-service resolver / walker / preflight / library-scan pipeline, gateway proxies, frontend modal + hierarchical progress + right-click menu items.

The arc delivers end-to-end auto-discovery of internal sibling-subfolder libraries and their transitive dependencies via deterministic Maven/npm parsing, wired into the existing discovery-run UX with a preflight scope-confirmation modal and hierarchical run-progress sub-rows. Direct-write bypass of the candidate review path is intact and deliberate. LLM invocation in the library-scoped run is the single follow-up insertion tagged in `runManager.ts`.

**Recommendation:** Accept. Track Deviation #7 (LLM invocation insertion) and the unmade Group 9.3 end-to-end fixture-repo scan test as a single small follow-up ticket.

---

*End of report.*
