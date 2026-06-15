# Verification Report: PM Tasks Captured Decisions Integration + Delivery Sequencing

**Spec:** `2026-05-25-pm-tasks-captured-decisions-integration`
**Date:** 2026-05-21
**Verifier:** implementation-verifier
**Status:** Pass — green end-to-end. Spec 4 of the four-spec migration-workflow rework ships clean.

---

## Status

PASS. All 10 Definition-of-Done bullets satisfied with code + test evidence. All 29 new tests + 77 adjacent PM-task tests pass. Full gateway suite shows fewer failures with this spec applied than on master baseline (1836/1904 vs 1824/1896) — no regressions introduced; pre-existing failures remain pre-existing.

---

## Definition of Done

| # | Bullet | Status | Evidence |
|---|---|---|---|
| 1 | delivery-plan prompt section + decision-code references | Pass | `product-manager.migration-delivery-plan.task.md` lines 26-38; structural-assertion tests in `migrationPmTaskPromptAndConfigUpdates.test.ts` |
| 2 | shape-spec-generation `evidenceRefs[]` object shape with snake_case `captured_decision` | Pass | `product-manager.migration-shape-spec-generation.task.md` lines 54-66 + grep sweep confirming snake_case usage throughout |
| 3 | Validator extension appends warning + downgrades one notch; no change when no decisions / when story has citation | Pass | `specGenerationResponseValidator.ts` `computeMissingCitationWarning` (lines 540-573); 8 tests in `specGenerationResponseValidatorDecisionCitation.test.ts` |
| 4 | New sequencing task surfaces via task-config rendering, runs single-turn, validates, POSTs with specified attributes, returns `{sequenceId, summary}` | Pass | Handler lines 549-580 build body with `decisionCode='delivery.sequencing'`, `scopeKind='architecture'`, `createdByTask=TASK_ID`, `conversationThreadId=null`, `conversationTurnRef=null`, `answerValue=JSON.stringify(...)`; happy-path test asserts each attribute |
| 5 | No-active-target returns `insufficient_context` + "Define a target architecture first" | Pass | Handler lines 396-407; test `returns insufficient_context with "Define a target architecture first"` |
| 6 | No-decisions returns `insufficient_context` + "Run the architect conversation first" | Pass | Handler lines 426-438; test `returns insufficient_context with "Run the architect conversation first"` |
| 7 | Re-run path: second POST does not carry `previousDecisionId` | Pass | Handler `body` shape has no `previousDecisionId` field; test `re-run path -- second POST does NOT carry a previousDecisionId parameter` |
| 8 | Token-budget cascade: decisions block post-cascade, never truncated, overflow throws `TokenBudgetOverflowError` | Pass | Handler lines 444-466 compute `combinedTokens` after cascade, throw `TokenBudgetOverflowError` on overflow; test `throws TokenBudgetOverflowError when the combined cascade + decisions block exceeds the soft cap` |
| 9 | All new backend tests pass; existing PM-task tests still pass | Pass | 29/29 new tests pass; 106/106 adjacent PM-task tests pass (`migrationShapeSpec*`, `specGenerationResponseValidator*`, `migrationBookOfWork*`, `migrationPmTaskPrompt*`, `migrationDeliverySequencing*`) |
| 10 | No frontend, no new AMS endpoints, no new gateway client methods, no Liquibase changesets | Pass | `git status` shows only gateway changes; `grep -rn fetchLatestCapturedDecisionsStructured gateway/` returns nothing; no files modified under `architecture-model-service/` or `frontend/`; no Liquibase changesets |

---

## Spec Requirements

All requirement subsections satisfied:

- **Prompt update: delivery-plan** — section + 4 rules + anti-rule added; 8 existing rules preserved.
- **Config update: delivery-plan** — `target-state-decisions-context` appended to `contextNeeds`; no other top-level keys touched.
- **Prompt update: shape-spec-generation** — section + 4 rules + 2 anti-rules added; 8 existing rules preserved.
- **Config update: shape-spec-generation** — `target-state-decisions-context` appended to `contextNeeds`.
- **New PM task** — config + prompt + handler + validator all created with correct attributes.
- **Sequencing structured response + hard validator checks** — all 4 hard-fail rules + warning-only cycle detection implemented and tested.
- **Sequencing decision-capture write attributes** — exact write shape per Q15 verified by handler happy-path test.
- **Shape-spec validator extension** — `computeMissingCitationWarning` pure function added, wired in handler between parse and R-7 downgrade, decisions loaded once per batch with fail-soft.
- **Token-budget cascade** — decisions block appended post-cascade in all three PM tasks; overflow throws `TokenBudgetOverflowError`.
- **`evidenceRefs[]` object shape** — snake_case `captured_decision` confirmed via grep across prompts + validator + tests.

---

## Tests run

| Command | Result |
|---|---|
| `npx jest src/__tests__/migrationPmTaskPromptAndConfigUpdates.test.ts src/__tests__/migrationDeliverySequencingHandler.test.ts src/__tests__/migrationDeliverySequencingResponseValidator.test.ts src/__tests__/specGenerationResponseValidatorDecisionCitation.test.ts` | **4 suites pass; 29/29 tests pass** (6 prompt+config + 8 handler + 7 validator + 8 shape-spec extension) |
| `npx jest --testPathPattern="(migrationShapeSpec\|specGenerationResponseValidator\|migrationBookOfWork\|migrationPmTaskPrompt\|migrationDeliverySequencing)"` | **15 suites pass; 106/106 tests pass** — no regressions in adjacent PM-task surface |
| `npx tsc --noEmit` (gateway) | **Clean** — zero TypeScript errors |
| `npx jest` (full gateway suite, this spec applied) | 219 suites pass / 40 fail; 1836 tests pass / 68 fail |
| `npx jest` (full gateway suite, master baseline — stashed) | 217 suites pass / 42 fail; 1824 tests pass / 72 fail |

**Net regression delta: zero** — the spec actually shifts the baseline by +12 passing tests / -4 failing suites (likely the additive `target-state-decisions-context` in `contextNeeds` resolved some peripheral assertions, or some long-running suites are flaky). All 40 failing suites match the project-memory pre-existing list (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`, plus broader pre-existing TS Config mismatch from the discovery-service / api-migration-validation-service additions in commits e9e286e + 51e46b0).

---

## Implementer's judgement calls — assessment

1. **Sequencing prompt body wording** — single question + 3 explicit response variants + inline `[decision:<code>]` guidance. **Sound.** Mirrors the existing shape-spec prompt structure; gives the LLM a tight target.
2. **Runtime gating order (target-arch first, then decisions)** — **Correct.** When both missing, the user gets the upstream-most actionable next step ("Define a target architecture first"), avoiding a wild-goose chase through architect-conversation prerequisites.
3. **Validator extension composition (missing-citation BEFORE R-7 downgrade)** — **Defensible.** The two downgrades fire for orthogonal reasons (missing citation vs missing mapping/baseline signals), so stacking is non-double-counting; the handler logs both originals separately for diagnosis. The choice of ordering does not change the final clamp at `low`.
4. **Per-batch decisions load (once at top of `runSinglePassBatch`, fail-soft to `[]`)** — **Correct.** Project-level decisions don't change mid-batch; per-story load would be N redundant AMS round-trips. Fail-soft is the right call — a transient AMS error should not paint the entire batch with `missing_decision_citation` warnings when the LLM may have cited decisions correctly.
5. **Cycle detection (DFS, dedup by sorted node-set, rendered `A -> B -> A`)** — **Reasonable.** Output format is readable, dedup prevents N reports of the same cycle starting at different nodes. Warning-only per Q13.
6. **`MIGRATION_BOOK_OF_WORK_TOKEN_SOFT_CAP` reuse** — Handler imports + reuses the existing soft cap from `migrationBookOfWorkHandler.ts`. Pragmatic; means future cap tuning happens in one place.
7. **`MigrationDeliverySequencingSchemaError` class exported but not thrown in production** — Implementer documented this as "useful for explicit-failure tests" but production maps validator failure to `status='failed'` result. Reasonable forward-compat hook; zero behaviour impact.

---

## Risks / follow-ups

None blocking. Minor:

- **`fetchActiveTargetArchitectureId` is called twice in the shape-spec handler path** — once by the validator-extension's captured-decisions fetcher and once by any existing call sites. Each call is cheap and fail-soft, but a future spec could memoise per-request if AMS load becomes a concern.
- **Cycle warnings carry sorted-node-set dedup but the rendered string is the DFS-discovery order** — two cycles `A->B->A` and `B->A->B` would dedup to one entry, which is the correct behaviour, but the rendered detail string is whichever DFS encountered first. Cosmetic.
- **The sequencing prompt's "VALID INITIATIVE IDS" block enumerates every initiative id inline** — fine for the bounded book-of-work sizes in play (handful to dozens of initiatives). If a future spec generates much larger books of work, this block would need a cascade-aware variant.

None of the above warrants a follow-up spec.

---

## Cross-spec hygiene

- `git status` shows only this spec's changes + the spec docs themselves (planning/spec/tasks).
- No leftover `.bak` / `.disabled` / `__moved` / `.orig` files anywhere.
- Stale `architecture-model-service/__pycache__/` is an unrelated existing untracked artefact (matches the conversation-start git status; not from this spec).
- Specs 1-3 of the four-spec series are already committed (last commit `f709282 A number of new specs to improve the 'functionality like-for-like migration workflow'` is the spec docs; the actual code commits are 6e2dad0 Spec 3, plus the earlier Spec 1 + 2 commits referenced by the file `git log` on `targetStateCapturedDecisionsWriter.ts`).
- This spec is ready to commit as a single atomic change.

---

## Four-spec series complete?

**Yes — green end-to-end.** This is Spec 4 of the four-spec migration-workflow rework:

- Spec 1: Target State sub-tab + deterministic Suggest — committed.
- Spec 2: Captured Decisions data plane — committed.
- Spec 3: Architect-persona conversation — committed.
- Spec 4 (this): PM tasks consume captured decisions + new delivery-sequencing task — verified PASS, ready to commit.

After this spec commits, the full Suggest -> Architect Conversation -> Book of Work -> Shape-Specs -> Sequencing flow produces artefacts that all cite the same captured-decision codes, with the sequencing answer itself persisted as a captured decision (superseding cleanly on re-run via the Spec 2 data plane).
