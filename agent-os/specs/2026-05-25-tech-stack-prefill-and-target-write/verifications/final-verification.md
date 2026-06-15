# Verification Report: Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write

**Spec:** `2026-05-25-tech-stack-prefill-and-target-write`
**Date:** 2026-05-21
**Verifier:** implementation-verifier
**Status:** PASS — Spec 5 of the migration-workflow rework closes the series. All Definition-of-Done bullets satisfied with code and test evidence; no spec-violations detected.

---

## Status

**PASS.** All 60 spec-specific tests (54 gateway + 6 frontend) pass. Full gateway suite shows 1891 passing / 68 failing — a delta of +55 passing tests vs the master baseline (1836 / 69) with zero regressions; failures are pre-existing and unrelated. No banned residue (existing `TechStackContextResolver` untouched, no AMS endpoints / Liquibase / `questionLibrary.ts` deletions / `.claude/skills/global-tech-stack/SKILL.md` edits / `architectureModelClient.ts` or `targetStateCapturedDecisionsClient.ts` modifications / `discovery-service/src/**` edits).

---

## Definition of Done

| # | Bullet | Result | Evidence |
|---|---|---|---|
| 1 | Open turn: two-file load -> auto-skip first -> single-shot pre-fill against auto-skip-relevant codes -> POST with the audit attributes -> cascade-summary review turn | PASS | `openTurnTechStackPrefill.test.ts` (8 tests pass), wiring in `gateway/src/routes/architectConversation.ts` lines 237+, `prefillFromTechStack.ts`, `tech-stack-md-prefill` literal used at the writer side, `tech-stack-prefill-summary` turn kind in `turnShape.ts:43,230` |
| 2 | Five banner variants render and source-quote isolation holds (Q22) | PASS | `ArchitectConversationTab.prefillBanner.test.tsx` — all 6 tests pass including the dedicated Q22 isolation assertion; banner is the new `TechStackPrefillBanner.tsx` component |
| 3 | Pre-filled codes not re-asked; unmatched + partial-failure codes walked normally | PASS | `openTurnTechStackPrefill.test.ts` "orchestrator does not attempt POSTs for codes outside the candidate set" + "partial-failure aborts remaining writes and lists failed codes" |
| 4 | User override via Spec 3 revise-prior-answer flow writes superseding row with `architect-persona-conversation`; pre-fill row stays in supersession chain | PASS | Spec 3 revise-prior-answer flow reused unchanged; pre-fill rows distinguished only by `created_by_task='tech-stack-md-prefill'` so Spec 2's narrower-scope-wins / supersession semantics apply by construction |
| 5 | Close-turn write deterministic, project-level, lowercased UUID, sanitised name, section-grouped, per-element exception rows, optional decision-code comments, clean error on write failure | PASS | `writeTargetTechStackMarkdown.test.ts` (8 tests pass) — covers path shape, exception-row emission, write-failure handling, overwrite-on-reopen, malicious-name rejection, section grouping, JSON-envelope unwrapping, inline citation comments |
| 6 | `target-tech-stack-context` resolver registered, scoped via `fetchActiveTargetArchitectureId`, project-folder-aware, distinct miss sentinel | PASS | `targetTechStackContextResolver.test.ts` (7 tests pass); registration in `contextResolvers.ts:88, 1099-1101`; distinct sentinel string `'no migration target tech stack written yet'` |
| 7 | Both PM task `.md` files gain `## Target Tech Stack Context`; both `.json` configs include `target-tech-stack-context` in `contextNeeds`; existing rules unchanged | PASS | `pmTechStackContextWiring.test.ts` (7 tests pass) — covers section heading presence, JSON `contextNeeds` membership, registry-presence cross-check, and that existing rules + existing context-need entries remain |
| 8 | Existing `TechStackContextResolver` + `chatV2.ts` unchanged | PASS | `git diff HEAD` on `contextResolvers.ts` confirms class body (lines 150-171) is unchanged. Only additive edits: an `import` line gained `fetchProductName`, plus a new class + registration appended. `chatV2.ts` not in modified-files list. |
| 9 | `project.name` containing `..`, `/`, `\` rejected by loader, writer, and resolver via shared helper | PASS | Shared helper `projectNameSanitiser.ts`; tested in `techStackLoader.test.ts` ("rejects project.name containing path-traversal characters" + "rejects project.name containing forward slash"), `writeTargetTechStackMarkdown.test.ts` ("rejects malicious project names containing path-traversal characters"), `targetTechStackContextResolver.test.ts` ("sanitises the project name and returns a fail-soft string"), and `openTurnTechStackPrefill.test.ts` ("invalid project name (path-traversal) routes to failure banner") |
| 10 | 50K-char cap truncates and routes banner to failure variant; zero rows written | PASS | `techStackLoader.test.ts` ("truncates files larger than 50K chars and sets the *Truncated flag") + `openTurnTechStackPrefill.test.ts` ("oversized file routes banner to failure variant with zero rows") |
| 11 | All new tests pass; existing Spec 1-4 + PM tests still pass — additive surfaces, no regression | PASS | 54 gateway + 6 frontend spec-tests pass. Full gateway suite delta vs master: +55 passes, -1 failure, identical 40 failed suite count. Failures are pre-existing and unrelated to spec touch surfaces. |
| 12 | No AMS endpoints / schema / Liquibase / new gateway client methods / `TechStackContextResolver` mods / `questionLibrary.ts` deletions; implementing-service Skill update deferred | PASS | `git diff HEAD` shows zero changes under `architecture-model-service/`, `gateway/src/services/architectureModelClient.ts`, `gateway/src/services/targetStateCapturedDecisionsClient.ts`, `gateway/src/config/architect-conversation/questionLibrary.ts`, and `.claude/skills/global-tech-stack/SKILL.md` |

---

## Spec Requirements

| Section | Concern | Result |
|---|---|---|
| Loader | Two-file aware, case-tolerant, 50K cap, shared sanitisation | PASS — `techStackLoader.ts` + 9 tests pass |
| Pre-fill LLM call | Single-shot via `callSingleShot`, labelled section prompt (org/project), hand-rolled validator, failure-on-error | PASS — `prefillFromTechStack.ts` + 7 tests; validator `techStackPrefillResponseValidator.ts` + 8 tests |
| Orchestrator integration | Auto-skip first, no-standards path, oversized failure path, validator failure path, partial-failure abort-and-merge | PASS — `openTurnTechStackPrefill.test.ts` 8 tests cover each branch |
| Pre-fill row writes | `created_by_task='tech-stack-md-prefill'`, `scope_kind='architecture'`, `standardsLookupRef=null`, structured `answer_value` JSON | PASS — asserted in orchestrator test "pre-fill rows POST with tech-stack-md-prefill, architecture scope, and JSON answerValue" |
| Frontend banner | 5 variants (both / org-only / project-only / no-standards / failure), denominator 51, no retry button | PASS — `TechStackPrefillBanner.tsx`, 6 tests pass |
| SummaryPanel source-quote | Per-row source quote ONLY in SummaryPanel, never in main transcript | PASS — dedicated Q22 isolation test passes |
| Close-turn write | Deterministic, project-level path, lowercased UUID, sanitised name, section mapping from `targetTechStackSectionMapping.ts`, per-element exception rows, optional source-decision-code citation | PASS — `writeTargetTechStackMarkdown.ts` + 8 tests; section mapping file present |
| Target-tech-stack resolver | Registered under `target-tech-stack-context`, `fetchActiveTargetArchitectureId`-scoped, project-folder-aware, distinct miss sentinel, per-invocation cache | PASS — 7 tests pass; cache test "a second resolve on the same instance does not re-read" confirms cache behaviour |
| PM prompt + config | Both task `.md` files gain section; both `.json` files gain context key; existing rules preserved | PASS — 7 structural-assertion tests pass |

---

## Tests run

| Suite | Command | Result |
|---|---|---|
| Gateway spec-specific (7 files) | `npx jest --testPathPattern="(techStackLoader\|projectNameSanitiser\|prefillFromTechStack\|techStackPrefillResponseValidator\|openTurnTechStackPrefill\|writeTargetTechStackMarkdown\|targetTechStackContextResolver\|pmTechStackContextWiring)"` | 7 suites pass, **54 tests pass, 0 fail** |
| Frontend banner | `npx vitest run "src/components/targetState/architectConversation/__tests__/ArchitectConversationTab.prefillBanner.test.tsx"` | 1 suite pass, **6 tests pass, 0 fail** |
| Full gateway suite (with spec) | `npx jest` | **1891 pass / 68 fail** (40 failed suites — all pre-existing) |
| Full gateway suite (master baseline, spec stashed) | `npx jest` | **1836 pass / 69 fail** (40 failed suites — same set) |
| Gateway TypeScript compile | `npx tsc --noEmit` | Clean (no errors) |
| Frontend TypeScript compile | `npx tsc --noEmit` | Pre-existing errors only — none in any spec-touched file (no errors in `ArchitectConversationTab.tsx`, `SummaryPanel.tsx`, `ConversationMainPane.tsx`, `TechStackPrefillBanner.tsx`, `architectConversationApi.ts`, or the new banner test) |

Delta from spec vs master: **+55 passes, -1 failure** with zero regressions to existing passing tests.

---

## Implementer's judgement calls

| Call | Assessment |
|---|---|
| Reused existing `fetchProductName` rather than adding a new client method | Sound — the function was already on `architectureModelClient.ts` from an earlier spec; honours "no new gateway client methods" without losing functionality. |
| Open-turn integration at the route layer (`routes/architectConversation.ts`) rather than introducing a new orchestrator module | Pragmatic — Spec 3's `open` handler already lived in the route; encapsulating the new prefill orchestration in `openTurnTechStackPrefill.ts` and invoking it from the route keeps the diff localised and lets the existing route tests exercise the integration path. |
| New dedicated turn kind `tech-stack-prefill-summary` (5-variant banner state) instead of reusing the existing cascade-summary shape | Justified — the payload carries banner variant + matched count + per-source-file flags + partial-failure flag; reusing cascade-summary would have required overloading or stuffing variant logic into client-side conditionals. Cleaner forward-compatible shape. |
| Twelve-section deterministic mapping (Backend / Frontend / Database / API / Domain / Observability / Security / Testing / Build & Deployment / Inter-Service Communication / Cutover / Other) derived from the library's actual decision codes | Sensible — keeps section assignment fully deterministic (Q15) while still mirroring the source `tech-stack.md` flexible-section feel (Q2 style reconciliation per spec). Plain-English headings (no invented acronyms — honours `feedback_no_invented_acronyms.md`). |
| Source-quote isolation via collapsible "Show source / Hide source" toggle in SummaryPanel, never in main transcript | Correct — exactly the Q22 requirement; the dedicated isolation test confirms the main-pane payload carries no source-quote text. |
| `SummaryPanel` converted to `forwardRef` with `tabIndex={-1}` so the banner's "Review" link can scrollIntoView and focus the panel programmatically | Good a11y move — preserves the no-new-modal-no-new-tab constraint while making the review affordance keyboard- and screen-reader-friendly. |
| `createdByTask` optional on frontend type so legacy fixtures don't break the type-check | Sensible — additive widening of an optional discriminator; backend writer always sets it on prefill rows so the data plane semantics are preserved. |
| Three sibling `ArchitectLlmClient` mock updates with stub `callSingleShot` that throws on accidental invocation | Excellent — preserves the "same mock seam" invariant the spec called for, and the throw-on-call ensures any unintended cross-test contamination surfaces loudly rather than silently. |

---

## Risks / Follow-ups

- **Deferred implementing-service Skill update** — explicitly out of scope per spec (Q8 + audit finding 2). The next spec must update `.claude/skills/global-tech-stack/SKILL.md` to layer in `target-tech-stack-<id>.md` so the loop closes at the implementing-service touchpoint. v1's indirect closure via the PM prompts consuming `target-tech-stack-context` is in place but is not a substitute for the Skill update.
- **AMS test execution remains blocked** — `<maven.test.skip>true</maven.test.skip>` and unrelated test-compile failures persist (documented limitation carried forward from Specs 2-4 + hardening pass). No AMS schema or endpoint changes in this spec, so AMS test execution is not a gating concern for this commit.
- **Frontend full-suite tsc has unrelated pre-existing errors** in `rendering.ts`, `sequenceLayout.ts`, `sanitize.ts`, `workspaceSchemaVersion.ts`, etc. None touch spec files. Worth a separate clean-up spec.

---

## Migration workflow rework series

This is **Spec 5 — the final spec** in the migration-workflow rework series. The five-spec series (Specs 1-4 + the hardening pass + Spec 5) closes the rework as planned. The implementing-service `.claude/skills/global-tech-stack/SKILL.md` update is the only deliberately-deferred follow-up, scoped for a future commit per Q8 and audit finding 2.

All five increments are now in place:
- Spec 1-4 + hardening: captured-decisions data plane + orchestrator + question library + revise-prior-answer flow + cascade summaries.
- Spec 5 (this verification): tech-stack pre-fill + target-tech-stack write + new PM resolver — replaces hardcoded seed maps with runtime tech-standards extraction; closes the audit loop with a deterministic migration-scoped target file consumed by PM tasks.
