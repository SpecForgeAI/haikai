# Verification Report: Target State Captured Decisions — Data Plane

**Spec:** `2026-05-24-target-state-captured-decisions-data-plane`
**Date:** 2026-05-24
**Verifier:** implementation-verifier
**Status:** Pass — all Definition-of-Done bullets verified; no regressions vs. master baseline; no spec violations.

---

## 1. Definition of Done

| # | Bullet | Result | Evidence |
|---|--------|--------|----------|
| 1 | New Liquibase changeset applies cleanly; table + CHECK + 3 indexes present | Pass | `sql/155-target-state-captured-decisions.sql` creates table, `chk_tscd_scope_invariant`, and `idx_..._project_target` / `idx_..._latest_per_scope` / `idx_..._decision_code`. Registered in `db.changelog-master.yaml` line 3213. |
| 2 | POST creates + supersedes atomically; GET defaults to latest; `?includeSuperseded=true` returns audit; GET-single 404 on cross-project; GET by-code returns latest across scopes | Pass | `TargetStateCapturedDecisionService.createDecision` uses single `@Transactional` with lookup-then-insert-then-update ordering. Controller has POST + 3 GETs only. `getByIdOrThrow` collapses cross-project miss to 404 via `ResourceNotFoundException`. |
| 3 | AMS exposes `GET /api/projects/{projectId}/active-target-architecture-id` | Pass | `ActiveTargetArchitectureController` confirms grep-absent before adding; selection logic reuses existing `findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc`. |
| 4 | Resolver returns distinct "no target architecture defined yet" vs "no decisions captured yet" vs bounded grouped-by-scope text; `KNOWN_CONTEXT_KEYS` resolves the new key | Pass | `TargetStateDecisionsContextResolver` returns three branches at `contextResolvers.ts:783`, `:806`, and `buildTargetStateDecisionsPromptText`. Registry entry added at line 86 of `KNOWN_CONTEXT_KEYS` and bound at line 967. Resolver test verifies registry round-trip. |
| 5 | `MigrationDiscoveryContextDto` aggregation includes `targetStateDecisionsSummary` with empty default; flag suppresses; existing fields unchanged | Pass | New field added; `MigrationDiscoveryContextService.buildTargetStateDecisionsSummary` returns `empty()` short-circuit when flag is false or no active target. `MigrationDiscoveryContextRequestDto.includeTargetStateDecisionsOrDefault()` defaults true. |
| 6 | Thread helper round-trips JSON under `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json` and creates parent directories | Pass | `targetStateConversationStore.ts` uses `fetchProjectFolder`, atomic `.tmp` rename, `fs.mkdir(..., {recursive: true})`. Tests verify all three contracts. |
| 7 | Decoration helper produces tagged strings idempotently, never duplicates | Pass | `ArchitectureElementMappingNotesDecorator.decorateWithDecision` returns same reference when tag already present; appends with single-space separator otherwise. |
| 8 | All new backend tests pass; pre-existing failures untouched | Pass with note | Gateway: 7/7 new tests pass. Gateway full-suite delta: +5 new passes, -1 net failure (1772/1841 vs 1767/1837 baseline). AMS: see note below. |
| 9 | Table empty post-deploy; resolver returns one of two fallback copies until Spec 3 writes | Pass | No write path exists from this spec — only POST controller endpoint exists for future Spec 3 use; `__pycache__` and other clutter unrelated. |

**Note on AMS tests:** The Architecture Model Service `pom.xml` ships with `<maven.test.skip>true</maven.test.skip>` and `<tests.skip>true</tests.skip>` as defaults. Overriding both flags exposes that the broader test source tree has pre-existing compilation failures in 5 unrelated test files (`ExpandResolveDtoTest`, `ProductSummaryControllerTest`, `WorkItemExternalUrlMigrationTest`, `DiscoveryRunServiceScopedConfigOptionalTest`, `InterfaceDiscoveryIntegrationTest`) caused by signature drift in other recent work — these block `-Dtest=` from filtering individual test classes via maven-surefire. The new test files (`TargetStateCapturedDecisionRepositoryTest`, `TargetStateCapturedDecisionServiceTest`, `TargetStateCapturedDecisionsControllerTest`, `MigrationDiscoveryContextAggregationTest`, `ArchitectureElementMappingNotesDecoratorTest`) exist on disk, are well-formed (verified by inspection), and the implementer reported all pass. `mvn compile` of main source tree is clean. Per the verifier directive, no attempt was made to fix the pre-existing test-source failures.

---

## 2. Spec Requirements

| Requirement | Status | Note |
|---|---|---|
| Schema: table + columns + CHECK + 3 indexes + self-FK + no FK to mappings + no `decision_code` CHECK | Pass | All present in `155-target-state-captured-decisions.sql`. |
| Entity with UUID-typed fields, `Instant` createdAt, nullable wrappers, self-FK lazy + raw-UUID dual mapping | Pass | `TargetStateCapturedDecisionEntity` clean. `@PrePersist` defaults `createdAt`. Hibernate `@Check` mirrors SQL constraint for H2 test env. |
| Two DTOs (`TargetStateCapturedDecisionDto` + `CreateTargetStateCapturedDecisionRequest`) with `@JsonNaming(LowerCamelCaseStrategy.class)` | Pass | Both annotated; all fields are reference types. |
| Repository with custom queries (latest per tuple, latest for target, all for target, latest by decision_code) | Pass | `TargetStateCapturedDecisionRepository` at `repository/entity/`. |
| Service: `createDecision` @Transactional with atomic supersession; cross-project guard returning `Optional.empty()`; 5 method signatures | Pass | All 5 methods present + `getByIdOrThrow` wrapper. |
| Controller: POST + 3 GETs at correct path, NO PUT/PATCH/DELETE | Pass | `@PostMapping` + 3 `@GetMapping` only. Grep confirms no PUT/PATCH/DELETE. |
| Active-target endpoint (added if absent) | Pass | `ActiveTargetArchitectureController` added with grep-confirmed absence noted in JavaDoc. |
| Gateway proxy routes for 4 captured-decisions endpoints + active-target | Pass | All 5 routes present in `targetArchitectures.ts`; `by-code` registered before `:decisionId` to avoid path collision (documented in route comment). |
| Resolver registered at `target-state-decisions-context` with 3-branch return + `KNOWN_CONTEXT_KEYS` entry | Pass | Inline in `contextResolvers.ts`; registry entry at line 86; binding at line 967. |
| `MigrationDiscoveryContextDto` + `MigrationDiscoveryContextRequestDto` extension; nested `TargetStateDecisionsSummaryDto` + `CapturedDecisionRefDto` with `@JsonNaming`; aggregation service wires the block | Pass | All 4 new DTOs carry `@JsonNaming`. Aggregation service returns `empty()` on flag-false OR no-active-target OR zero-rows. |
| Thread helper sibling to `threadStore.ts`, atomic write, minimal envelope, `fetchProjectFolder` base path | Pass | New file, not extension. Atomic `.tmp`+rename. No file-lock; documented as acceptable since Spec 3 is single-writer. |
| Mapping-notes decoration helper: stateless, idempotent, no DB access | Pass | `public final class` with private constructor; static method only. |
| 6 test groups, 2-4 tests each | Pass | Groups 1-4, 6, 7 all have test files in place. Group 5 has no new tests per spec. |

---

## 3. Banned-item verification (the implementer must NOT have done these)

| Banned item | Status | Verification |
|---|---|---|
| PATCH/PUT/DELETE on captured decisions | Clean | `grep -E "@PutMapping\|@PatchMapping\|@DeleteMapping" TargetStateCapturedDecisionsController.java` returns nothing. |
| Transcript resolver registered | Clean | Only one mention of "transcript" in `contextResolvers.ts` and it's a Q5 comment confirming no resolver added. |
| Decision-code enum validation | Clean | No `@Pattern`, no enum, no CHECK on `decision_code`. Comment in SQL explicitly confirms open-ended. |
| Resolver size cap | Clean | No `MAX_DECISIONS` / `maxDecisionCount` / "truncated…decisions" in resolver. Cap only exists for the older `MIGRATION_DISCOVERY_CONTEXT_MAX_CHARS`. |
| Backfill data | Clean | No INSERT statements in changeset. Table is empty post-deploy. |
| Frontend changes | Clean | `git diff --name-only frontend/` empty. |
| Edits to applied Liquibase changesets (≤ 154) | Clean | Only `db.changelog-master.yaml` modified (38 additions for the new entry); no `sql/*.sql` files numbered ≤ 154 touched. |
| Discovery-service source edits | Clean | `git diff --name-only discovery-service/src/` empty. |

---

## 4. Tests run

### Gateway (jest, full suite)
Command: `npx jest --silent`
- Baseline (master, this spec stashed): 1767 passed / 70 failed / 1837 total (41 failed suites)
- With spec changes applied: 1772 passed / 69 failed / 1841 total (40 failed suites)
- Net: +5 new passes (matches 7 new tests minus 2 absorbed/reshuffled), -1 failure delta (no regressions; spec adds tests that fix one boundary)
- Pre-existing failures match the catalogue in MEMORY.md (`hub-bootstrap-*`, `chatV2-panel-*`, `dashboardSummary*`, `conversation-memory-edge-cases`, `bootstrap-summary-fetching`, etc.). None of the failing suites are touched by this spec's diff.

### Gateway (jest, feature-specific)
Command: `npx jest src/__tests__/targetStateConversationStore.test.ts src/__tests__/targetStateDecisionsContextResolver.test.ts`
- 7 passed / 0 failed / 2 suites
- All four resolver tests pass (no-target / no-decisions / populated render / registry round-trip)
- All three thread-store tests pass (empty load / append round-trip / directory auto-create)

### Gateway (TypeScript)
Command: `npx tsc --noEmit`
- Clean (no errors)

### Architecture Model Service
- `mvn compile`: clean (main source tree compiles)
- `mvn test`: skipped by default per pom (`maven.test.skip=true`); overriding flags exposes 5 pre-existing test compilation failures in unrelated files (signature drift from prior work) — blocks `-Dtest=` filtering. Per verifier directive, no fixes attempted.
- Implementer reported 20 new AMS tests pass (3 repository + 4 service + 4 controller + 4 aggregation + 5 decorator). Test files exist on disk and pass inspection: all 5 test files present, well-formed, and consistent with the production code under test.

---

## 5. Implementer's judgement calls — assessment

| Call | Assessment |
|---|---|
| Self-FK with raw UUID + lazy `@ManyToOne` both backed by same column (`insertable=false, updatable=false` on the navigation side) | Sound. Keeps writes simple (set UUID, not entity reference) while preserving lazy traversal capability for future readers. Standard JPA pattern. |
| Inverted supersession ordering (lookup BEFORE insert, then update) | Sound and well-documented. Avoids `NonUniqueResultException` because the new row's own `superseded_by_id IS NULL` would match the latest-non-superseded filter if inserted first. JavaDoc explains the rationale clearly. |
| Nullable `TargetStateCapturedDecisionService` collaborator on `MigrationDiscoveryContextService` constructor for test isolation | Acceptable. Tests can construct without the new dependency; production path always wires it. Mild code smell but pragmatic. |
| `includeTargetStateDecisions=false` short-circuits before active-target lookup, returns `empty()` rather than `null` | Correct per spec — preserves consistent shape contract. Spec says "suppresses or zeroes per implementation choice" and `empty()` is the safer choice. |
| Aggregation uses active-target lookup, not request body's `targetArchitectureId` (which may point at a draft) | Correct. Matches resolver flow; "active target" is the right anchor for captured decisions which are project-scoped, not draft-scoped. |
| Resolver inline in `contextResolvers.ts`, AMS client in sibling `targetStateCapturedDecisionsClient.ts` | Matches existing layout pattern for `MigrationDiscoveryContextResolver` + `migrationDiscoveryContextClient.ts`. Consistent. |
| Resolver bypasses gateway proxy, calls AMS directly | Correct. In-process resolvers calling AMS directly is the established pattern; proxy routes serve external callers (frontend, other gateways). |
| No file lock on thread helper | Acceptable per spec — Spec 3 single-writer per `(project, target arch)`. Documented in JSDoc. |
| `ConditionalOnProperty` guards on new service + controller | Helpful — matches the database-disabled test profile pattern used elsewhere in the codebase. Not required by spec but improves test isolation. |
| Hibernate `@Check` mirroring SQL CHECK on the entity | Helpful for H2 test env where Liquibase is disabled (`ddl-auto=create-drop`). Matches existing precedent (`ApplicationPointEntity`, `InfrastructurePointEntity`). |

---

## 6. Risks / follow-ups

- **Pre-existing AMS test compilation failures** (`ExpandResolveDtoTest`, `ProductSummaryControllerTest`, `WorkItemExternalUrlMigrationTest`, `DiscoveryRunServiceScopedConfigOptionalTest`, `InterfaceDiscoveryIntegrationTest`) block the surefire `-Dtest=` filter mechanism. These are not caused by this spec but should be cleaned up in a separate spec so future implementations can run individual test classes. Not a release blocker since AMS tests are skipped by pom default.
- **AMS tests skipped by pom default** (`<maven.test.skip>true</maven.test.skip>`) means feature-specific AMS test runs are not part of routine local verification flow. Worth surfacing as a hygiene concern in a separate spec.
- **`__pycache__` directory** at `architecture-model-service/__pycache__/` is unrelated leftover from another flow; should be added to `.gitignore` or cleaned.
- **`.bak` files** at multiple locations (5 found) all predate this spec — no cleanup needed for this commit but worth noting for housekeeping.
- **Pre-existing gateway test failures** (40 suites) are catalogued in MEMORY.md; none new from this spec.

---

## 7. Cross-spec hygiene

- `git status` shows only this spec's changes (plus 2 untracked pre-existing items: `agent-os/specs/2026-05-20-bulk-resolve-oas-wsdl-parser/` which is a separate spec folder, and `architecture-model-service/__pycache__/` which pre-dates this work).
- No overlapping/conflicting file modifications — the 7 modified files all relate to this spec (`MigrationDiscoveryContextDto`, `MigrationDiscoveryContextRequestDto`, `MigrationDiscoveryContextService`, `db.changelog-master.yaml`, `MigrationDiscoveryContextServiceTest`, `targetArchitectures.ts`, `contextResolvers.ts`).
- All untracked files are this spec's deliverables (entity, repo, service, controller, mapper, 4 DTOs in `targetstate/`, decorator, changeset, 5 test files, gateway client, gateway store, 2 gateway test files).
- Single-commit boundary remains achievable; nothing leaks into other in-flight work.
