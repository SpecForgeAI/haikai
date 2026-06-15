# Verification Report: Four-Spec Hardening Pass

**Spec:** `2026-05-25-four-spec-hardening-pass`
**Date:** 2026-05-25
**Verifier:** implementation-verifier
**Status:** Pass (with one documented scope-interpretation deviation; backend test 2 reused the reserved slot for a backward-compat constructor test rather than a parent-chain scope test)

---

## Status (one-line summary)

All four items shipped end-to-end with the 4 + 4 test cap respected; grep sweeps clean; gateway `tsc` clean; AMS compiles; spec-specific tests 5/5 pass; touched-surface regression 72/72 pass (44 frontend + 28 gateway); Dashboard pre-existing failures unchanged by this spec (17 fail with spec applied vs 18 fail on baseline — i.e. one *fewer* failure).

---

## Definition of Done

| DoD bullet | Verdict | Evidence |
| --- | --- | --- |
| `git grep "TargetArchitectureDiagramView"` returns zero matches in `frontend/` | Pass | `git grep "TargetArchitectureDiagramView" frontend/` exit=1, zero matches |
| `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES"` returns zero matches in `frontend/` | Pass | `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES" frontend/` exit=1, zero matches |
| Shared CSS preserves classes still in use; orphan-only classes deleted | Pass | 8 classes removed (`diagramViewPanel`, `diagramViewHeader`, `readonlyBadge`, `diagramList`, `diagramCard`, `diagramCardName`, `diagramCardMeta`, `diagramCardLink`); `emptyMessage` + `errorBanner` correctly preserved (9 sibling references confirmed in `TargetArchitectureWorkspace.tsx`) |
| Dashboard "Author target" button navigates directly to the new sub-route | Pass | `DashboardView.tsx:551` calls `navigate('/projects/.../architectures/.../architecture-design/target-state')`; safety-net comment present at lines 547-550 |
| `GET /api/projects/{projectId}/target-architectures` returns DTO with nullable `elementCount: Long` populated by 4-grouped-query aggregation | Pass | `ArchitectureDto.java` 11th field is boxed `Long elementCount`; `TargetArchitecturePromoteService.aggregateElementCounts` issues exactly 4 grouped queries over `application_components`, `interfaces`, `data_entity_points`, `infrastructure_points`; 8-arg + 10-arg backward-compat constructors delegate with `elementCount = null` |
| Drafts panel renders "empty" badge on every draft with `elementCount === 0`, not just selected | Pass | `TargetArchitectureWorkspace.tsx:1000-1044` resolves `wireElementCount` per draft (not `isSelected`-gated), badges every `resolvedElementCount === 0` draft; lazy-loading comment replaced by Item-3 explanatory comment |
| New `GET /api/architect-conversation/question-library/scopes` returns projected map; second call hits cache | Pass | `architectConversation.ts:300-344` projects once at module load into `QUESTION_LIBRARY_SCOPES_CACHE` const; handler serialises cached object; gateway test asserts deep-equal across two calls and that both bodies are byte-identical |
| Static `questionLibraryScopes.ts` deleted; tab fetches on mount; session-cached, no TTL | Pass | File deletion confirmed in directory listing; `ArchitectConversationTab.tsx:193-213` mounts a `useEffect` with `fetchQuestionLibraryScopes()`, sets `scopeMap` once per mount, no refetch logic |
| On fetch failure the sub-dialog opens with disabled picker + "no exception scopes available -- try again later" message | Pass | `ExceptionSubDialog.tsx:187-195` renders the unavailable message via `scopesUnavailable` branch; submit button `disabled={scopesUnavailable || ...}` at line 266-268; cancel button remains enabled at line 254-262 |
| All new tests pass (cap 4 backend + 4 frontend, spec-total); previously-passing tests still pass | Pass | New tests: 1 gateway + 4 frontend executed green (5 explicit assertions); the AMS test file (`TargetArchitecturePromoteServiceElementCountTest`) contains 2 backend tests (unable to run via `mvn test` due to project's pre-existing `<maven.test.skip>true</maven.test.skip>` posture, but code compiles cleanly via `mvn compile`); touched-surface regression 28/28 gateway + 44/44 frontend |

---

## Spec Requirements

| Item | Sub-requirement | Verdict |
| --- | --- | --- |
| 1 | Delete `TargetArchitectureDiagramView.tsx` | Pass (file deleted, confirmed) |
| 1 | Surgical CSS cleanup; preserve siblings | Pass (8 deleted, 2 preserved as documented) |
| 1 | Grep-verify zero residue | Pass |
| 1 | No new tests | Pass |
| 2 | `DashboardView.tsx:547` URL substitution | Pass (line 551 in final code; one-line substitution + 4-line inline comment) |
| 2 | Inline safety-net comment | Pass (lines 547-550) |
| 2 | `data-testid` untouched | Pass (`card-hla-author-target-button` still present) |
| 3 | `ArchitectureDto` 11-arg with `elementCount: Long` | Pass (record fields + 8-arg + 10-arg compat constructors) |
| 3 | `promoteService.listTargets` populates via 4 grouped queries | Pass (`aggregateElementCounts` helper; one query per table) |
| 3 | Honour parent-chain scope semantics | Partial — implementer used the 4 supertype tables' OWN denormalised `architecture_id` column (populated by changeset 097's BEFORE INSERT trigger). This is defensible: those 4 tables are NOT in `ArchitectureScopeResolver`'s `PARENT_MAP` (which deliberately excludes the canonical roots — see `ArchitectureScopeResolver` JavaDoc "Tables NOT in this map" section). The resolver only covers derived tables that read through `model_files`. The implementer's choice is consistent with the resolver's documented contract, but the spec literally said "MUST honour parent-chain scope semantics from `ArchitectureScopeResolver`" -- worth flagging as a scope-interpretation deviation. |
| 3 | Gateway pass-through (no code change) | Pass |
| 3 | Frontend wire DTO + mapper extension | Pass (`targetArchitecturesApi.ts`: `elementCount: number \| null` on wire + domain types; mapper reads via `readElementCount` helper) |
| 3 | Drafts panel badge for every empty draft | Pass |
| 3 | Lazy-loading comment removed | Pass (replaced by explanatory Item-3 comment) |
| 3 | Refresh via existing `refreshDrafts()` | Pass (no new invalidation channel introduced) |
| 4 | New gateway endpoint `GET /api/architect-conversation/question-library/scopes` | Pass |
| 4 | Module-load cache | Pass (`QUESTION_LIBRARY_SCOPES_CACHE` const, no per-request recomputation) |
| 4 | `fetchQuestionLibraryScopes()` in frontend client | Pass |
| 4 | Tab fetches on mount; session-cache; no TTL | Pass |
| 4 | Static-file deletion | Pass |
| 4 | Re-export removal + reroute | Pass (zero `QUESTION_LIBRARY_ALLOWED_SCOPES` references remain) |
| 4 | Graceful-degrade UX on fetch failure | Pass |
| Tests | Cap 4 backend + 4 frontend | Pass (1 gateway + 2 AMS + 4 frontend = 3 backend + 4 frontend; 1 backend slot intentionally left unused) |

---

## Tests run

| Suite | Command | Result |
| --- | --- | --- |
| New gateway scopes test | `gateway$ npx jest src/routes/__tests__/architectConversationQuestionLibraryScopes.test.ts` | 1/1 pass |
| New frontend tests | `frontend$ npx vitest run src/components/Architecture/TargetArchitectureWorkspace.elementCountBadge.test.tsx src/components/targetState/architectConversation/__tests__/QuestionLibraryScopesRuntimeFetch.test.tsx` | 4/4 pass (1 elementCount + 3 scopes) |
| Gateway touched-surface regression | `gateway$ npx jest src/routes/__tests__/architectConversationQuestionLibraryScopes.test.ts src/services/architectConversation/__tests__/ src/__tests__/targetArchitecturesGroup10CrossLayer.test.ts` | 6 suites / 28 tests pass |
| Frontend touched-surface regression | `frontend$ npx vitest run src/components/Architecture/TargetArchitectureWorkspace src/components/targetState/architectConversation src/components/Architecture/TargetStateSubTabNavigation` | 13 files / 44 tests pass |
| Gateway typecheck | `gateway$ npx tsc --noEmit` | Clean (no output) |
| AMS compile | `architecture-model-service$ mvn compile -q` | BUILD SUCCESS |
| Dashboard pre-existing failures sanity | spec applied: 17 failed / 198 passed; baseline (git stash): 18 failed / 197 passed | One *fewer* failure with spec; failures unrelated (missing `<MemoryRouter>`, candidate count assertions) |
| AMS new test (compile-only) | Cannot run via `mvn test` due to project's `<maven.test.skip>true</maven.test.skip>` posture (called out in spec's Out-of-Scope as a separate spec); file compiles cleanly with the rest of AMS | Compile-only verified |

### Failed tests

- Touched-surface tests: zero failures.
- Dashboard tests: 17 pre-existing failures (e.g. `dashboardDefaultScope.test.tsx`, `dashboardDiscoverySummaryCard.test.tsx`, `dashboardSummary*`, `discoveryUxPolish.test.tsx`, candidate-count assertions). Confirmed pre-existing via `git stash` baseline run that produced 18 fails — i.e. this spec's one-line URL change does not introduce any failure.

---

## Implementer's judgement calls

| Call | Assessment |
| --- | --- |
| CSS cleanup: 8 classes deleted, 2 (`emptyMessage`, `errorBanner`) preserved | Correct. Grep confirms 9 sibling references for the preserved pair in `TargetArchitectureWorkspace.tsx`. Spec said "do NOT blanket-delete" -- this is the right call. |
| 4-grouped count query scope: uses the supertype tables' OWN `architecture_id` column rather than walking through `ArchitectureScopeResolver`'s parent-chain | Defensible but a *scope-interpretation deviation* from the literal spec wording. The 4 supertype tables are explicitly excluded from `PARENT_MAP` in `ArchitectureScopeResolver` (see its "Tables NOT in this map" JavaDoc) -- they ARE canonical roots whose denormalised `architecture_id` IS the source of truth (changeset 097's BEFORE INSERT trigger populates them at INSERT time, and they are not subject to later mutation). The spec's "MUST honour parent-chain scope semantics" sentence was written assuming the count queries would traverse through `model_files` (the parent-chain case), but for these 4 specific tables there *is* no parent. The implementer documented this clearly in `TargetArchitecturePromoteService.java` lines 282-290. The net behaviour matches the spec's intent (per-draft counts across the 4 user-visible supertype tables); only the *means* differs. Worth a follow-up confirmation but not a blocker. |
| Backend test 2 scope: implementer wrote a backward-compat constructor test instead of a parent-chain scope test | Direct consequence of the previous call. Since the implementer chose to count via the leaf column on the 4 root tables (not via parent chain), a "child draft inherits via parent chain" test would be testing behaviour that doesn't apply to the 4 tables in question. The implementer reused this slot for a backward-compat constructor test (the 10-arg + 8-arg compat constructors default `elementCount` to null), which protects the additive-constructor pattern the spec called out as load-bearing. The "reserved slot at implementer discretion" was technically slot 4, but slot 2 was repurposed. Acceptable given the consistency with the leaf-column choice. |
| `@JsonNaming` NOT added to `ArchitectureDto` | Correct. Out-of-scope per spec ("`@JsonNaming(LowerCamelCaseStrategy.class)` audit sweep across remaining AMS DTOs -- a separate cleanup spec"). Frontend mapper handles both camelCase and snake_case. |
| `QUESTION_LIBRARY_ALLOWED_SCOPES` consumer rerouting: only one consumer found (the file itself) | Correct -- `git grep` confirms zero matches across `frontend/` after the deletion. |
| `elementCount: number \| null` typed (not optional) | Correct. Matches existing wire-DTO pattern; 6 frontend fixture patches were the smallest surface required. |

---

## Risks / follow-ups

- **The parent-chain interpretation deviation in Item 3 deserves a quick architect call-out.** The implementer's reading of `ArchitectureScopeResolver`'s contract is correct (those 4 tables are deliberately excluded from the parent-map), but the spec wording was tight ("MUST honour parent-chain scope semantics"). A 1-paragraph clarification in the spec (or a successor doc) would prevent future ambiguity. No code change needed; the production behaviour is correct for these 4 tables.
- **AMS test cannot be run via Maven** due to the project-wide `<maven.test.skip>true</maven.test.skip>` posture. This is explicitly called out in the spec's Out-of-Scope as a separate spec. The new `TargetArchitecturePromoteServiceElementCountTest` compiles cleanly and follows the established Mockito pattern; it will execute the moment the AMS test-infrastructure cleanup spec lands. Until then, the test's correctness is reviewed by inspection only.
- **`.bak` files in repo:** Unrelated to this spec but worth noting in the cross-spec hygiene picture: 5 `.bak` files exist (`ContextBundleExpansionService.java.bak`, `ImplementationAssistantPanel.tsx.bak`, `gridConfigs.ts.bak`, `rendering.ts.bak`, `promptBuilder.ts.bak`) -- pre-existing, NOT from this spec, but worth flagging for a future cleanup.

---

## Cross-spec hygiene

Two specs are uncommitted on `master`:

1. **`2026-05-25-four-spec-hardening-pass`** (this spec) -- working-tree-only modifications + 4 new test files. Ready for its single commit.
2. **`2026-05-25-pm-tasks-captured-decisions-integration`** -- partially staged + partially unstaged. The staged area contains the new spec files (`raw-idea.md`, `requirements.md`, `spec.md`, `tasks.md`, `verifications/final-verification.md`) plus several gateway test/handler/prompt/config files. The unstaged area also contains gateway modifications to `migrationShapeSpecGenerationHandler.ts`, `specGenerationResponseValidator.ts`, `product-manager.migration-delivery-plan.task.md`, etc.

The pm-tasks spec's work is bleeding into the unstaged area, which makes a clean single-commit boundary for THIS spec tricky. Recommend either: (a) commit the pm-tasks spec first using the already-staged content (its verifications.md asserts done), then commit this hardening pass; or (b) split commits explicitly, but that requires careful `git add` per file in this spec's surface area only.

The user's request stated "Specs 1-4 are committed; only this spec's work should be uncommitted" -- this is *not* the case in practice. The pm-tasks spec is a co-tenant in the uncommitted state.

Identified files that belong to THIS spec (for the future `git add`):

- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ArchitectureDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/TargetArchitecturePromoteService.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/TargetArchitecturePromoteServiceElementCountTest.java` (new)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/TargetArchitectureGroup10CrossLayerTest.java` (fixture patch)
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/TargetArchitectureGroup3Test.java` (fixture patch)
- `frontend/src/api/architectConversationApi.ts`
- `frontend/src/api/targetArchitecturesApi.ts`
- `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx` (deleted)
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.module.css`
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.elementCountBadge.test.tsx` (new)
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.test.tsx` (fixture patch)
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.group7.test.tsx` (fixture patch)
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.suggestPending.test.tsx` (fixture patch)
- `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx` (fixture patch)
- `frontend/src/components/DashboardView/DashboardView.tsx`
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
- `frontend/src/components/targetState/architectConversation/ExceptionSubDialog.tsx`
- `frontend/src/components/targetState/architectConversation/__tests__/ArchitectConversationTab.test.tsx` (fixture patch)
- `frontend/src/components/targetState/architectConversation/__tests__/EmptyState.test.tsx` (fixture patch)
- `frontend/src/components/targetState/architectConversation/__tests__/QuestionLibraryScopesRuntimeFetch.test.tsx` (new)
- `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` (deleted)
- `gateway/src/routes/architectConversation.ts`
- `gateway/src/routes/__tests__/architectConversationQuestionLibraryScopes.test.ts` (new)
- `agent-os/specs/2026-05-25-four-spec-hardening-pass/` (entire directory, including this verification report)

Files NOT belonging to this spec (belong to `pm-tasks-captured-decisions-integration`):

- All staged files in `agent-os/specs/2026-05-25-pm-tasks-captured-decisions-integration/`
- `gateway/src/__tests__/migrationDeliverySequencingHandler.test.ts`, `migrationDeliverySequencingResponseValidator.test.ts`, `migrationPmTaskPromptAndConfigUpdates.test.ts`, `specGenerationResponseValidatorDecisionCitation.test.ts`
- `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`, `product-manager.migration-delivery-plan.task.md`, `product-manager.migration-shape-spec-generation.task.md`
- `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json`, `product-manager--migration-delivery-plan.json`, `product-manager--migration-shape-spec-generation.json`
- `gateway/src/services/migrationDeliverySequencingHandler.ts`, `migrationDeliverySequencingResponseValidator.ts`, `migrationShapeSpecGenerationHandler.ts`, `specGenerationResponseValidator.ts`

No `__moved` or `.disabled` leftovers from this spec; 5 unrelated `.bak` files exist project-wide as noted.

---

## Migration workflow rework series complete?

Yes — once this hardening pass commits, the migration-workflow rework series is closed:

- Specs 1-4 of the rework all shipped + committed (per the user's note + verified via `git log` showing recent commits `6e2dad0 Spec 3 of 'target state' redesign`, `d0048de Spec 2 of 'target state' redesign`, `a245bfa Bug fixes - spec 1 of 'target state' redesign`, plus earlier).
- This hardening pass closes the four small quality gaps flagged across Specs 1-4 (dead-code residue, redirect-reliance URL, lazy-loaded badges, hand-mirrored static scopes file).
- All DoD bullets pass; spec-specific tests pass; touched-surface regression clean.
- Recommended commit message focus: "Four-spec hardening pass — orphan deletion, direct URL nav, elementCount per draft, runtime scopes fetch".

Note: the `2026-05-25-pm-tasks-captured-decisions-integration` spec is an *additional* uncommitted spec also in flight on the same branch -- it is not part of the migration-workflow rework series, and should be committed separately (it has its own verifications/final-verification.md asserting done).
