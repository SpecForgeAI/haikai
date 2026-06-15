# Specification: Architect Conversation — Open-Ended LLM Phase (after the deterministic preset walk)

## Goal
Add an open-ended, LLM-driven phase to the target-state Architect conversation that begins strictly after the deterministic ~51-question preset walk exhausts, so migration-specific topics become first-class captured decisions and free-form discussion becomes structured notes — both flowing into the existing PM backlog/spec pipeline. The preset walk, its question library, and its universal "Not applicable" opt-out are unchanged.

## User Stories
- As an architect, after the standard preset decisions are covered, I want the assistant to proactively suggest migration-relevant areas and let me raise my own topics, so the topics I pick become first-class captured decisions citable by specs.
- As an architect, I want a free-form discussion at the end that the assistant summarises into per-topic notes, so valuable migration context that does not fit a decision still reaches the backlog/spec generation.
- As a product manager, I want user-raised decisions and discussion notes to appear in the prompt-ready output automatically, so my spec/backlog tasks pick them up with no configuration change.

## Specific Requirements

**Phase entry signal (extend `next-question`, no new endpoint) [S2]**
- Extend the `next-question` response with a `phase` field; do NOT add a separate phase endpoint.
- While `selectNextQuestion` returns a question, `phase` indicates the preset walk is in progress and the open phase is not yet available.
- When `selectNextQuestion` returns `null` (walk exhausted), the response is `{ question: null, phase: 'open-available' }`.
- The open phase is reachable STRICTLY after exhaustion, never mid-walk. The whole open phase is OPTIONAL — the user may close immediately, exactly as today (input-bar-hidden state is preserved).
- Mirror the `phase` field on `fetchNextQuestion` in the frontend `architectConversationApi.ts`.

**Sibling open-phase LLM loop (reuse the client + limits, not the entry-centric runner) [S3]**
- Add a SIBLING loop alongside `runArchitectQuestionLoop`; do NOT overload it (it is coupled to a single `QuestionLibraryEntry` via `buildSubmitAnswerToolDefinition`/`parseStructuredAnswer`/entry-built prompts).
- REUSE `ArchitectLlmClient` via `buildArchitectLlmClient()` (reusable verbatim), the same hard limits (5 rounds / 30s per call / 120s wall clock), the same `withTimeout`/abort handling, and the same failure-to-`error`-turn behaviour.
- New tools (final names at implementation discretion): `suggest-candidate-areas`, `propose-options-for-topic`, `capture-user-decision`, `record-discussion-note`.
- The sibling handlers are siblings to `answerQuestion`/`captureDeterministicAnswer` in `architectConversationCoordinator.ts`.

**Open-phase grounding [Q1]**
- Ground the open-phase LLM in: the discovery findings summary (current-state reality) WHEN AVAILABLE, the captured decisions so far (`buildTargetStateDecisionsPromptText`), the loaded target-model summary, and the migration goal / product summary.
- When there are no findings, fall back to the three remaining sources. Grounding drives both the suggested candidate areas and the proposed options so they are relevant to the actual system.

**Sub-phase (a): user-raised topics → first-class captured decisions**
- The architect opens with a "we've covered the standard decisions — are there other areas you'd like to decide?" prompt and PROACTIVELY SUGGESTS a few grounded candidate areas (P3), then stays open.
- The user raises a topic; the LLM proposes concrete options, choosing single-select vs multi-select PER TOPIC (mirroring the preset `single-choice`/`multi-choice` shapes), plus a "something else…" free-text escape captured verbatim. Explicitly NO "Not applicable" option (P4).
- The user's pick is written as a FIRST-CLASS captured-decision row via the NEW capture path (see below): generated `adhoc.<slug>` code (slug from the topic label, e.g. `adhoc.batch-processing`), `scopeKind:'architecture'` with no `scopeRefType`/`scopeRefId`, distinct `createdByTask` (e.g. `architect-adhoc-decision`).
- An explicit "Done with decisions" control ends sub-phase (a) and moves to (b); the LLM NEVER infers "done" from free text (S5).

**Sub-phase (b): free-flow discussion → per-topic structured notes**
- A genuine multi-turn free-form chat ("is there any other topic you'd like to discuss?"); the user types, the LLM responds.
- Sub-phase (b) is SKIPPABLE (S5).
- At the END of (b) the LLM SUMMARISES the discussion into PER-TOPIC structured notes (not a raw-transcript blob), persisted as `note.<slug>` rows via the same writer, with a distinct `createdByTask` and a PER-NOTE UNIQUE code so notes do not supersede one another.
- An explicit "Done / Close" control ends (b) and proceeds to the existing close (S5).

**New capture path (preset `/answer`+`/capture` hard-404 on non-library codes) [S1/S3]**
- The preset `/answer` and `/capture` routes call `findEntry(decisionCode)` against `QUESTION_LIBRARY` and return HTTP 404 for non-library codes, so `adhoc.*`/`note.*` codes CANNOT flow through them.
- Add a dedicated open-phase capture path that writes via `postCapturedDecision` (reused verbatim) for both the `adhoc.<slug>` decision rows and the `note.<slug>` note rows.
- Supersession key is `(project, target, decisionCode, scopeKind, scopeRefId)` — distinct topics/notes MUST get distinct codes; a repeated answer on one topic intentionally supersedes the prior one.

**No AMS DDL change [S1]**
- `decision_code` has no CHECK/enum and the scope-invariant CHECK permits `architecture`, so `adhoc.*`/`note.*` codes with architecture scope are valid with zero schema change. `CreateCapturedDecisionRequestBody`'s `scopeKind: 'architecture' | 'element'` is adequate; no widening.

**New durable turn kinds (gateway union + frontend mirror) [S6]**
- Add to the closed turn union in gateway `turnShape.ts` AND mirror in frontend `architectConversationApi.ts`: (1) open-phase prompt turn (architect "other areas?" message + suggested candidate areas), (2) user-raised-topic turn, (3) LLM option-proposal turn, (4) user pick turn, (5) free-form-discussion turns (user + assistant). Final names/payloads at implementation discretion.
- Append all verbatim via `targetStateConversationStore` so they survive reopen. Keep the `assertExhaustiveTurnKind` switch honest. The `tier-confirmation`/`TierConfirmationView` interactive-turn pattern is the precedent for the interactive prompt/option-pick turns.

**Prompt-ready output: two additive sections (the only PM-facing change) [Q2c]**
- Extend `buildTargetStateDecisionsPromptText` with a new `### Free-form discussion notes` section sourced from the `note.<slug>` rows, and surface first-class user-raised decisions under `### Additional / user-raised decisions` (or fold into the existing scope grouping — implementation discretion; today architecture-scoped rows already land under `### Architecture-wide`).
- `TargetStateDecisionsContextResolver` registration under `target-state-decisions-context` is unchanged; both PM tasks already consume it, so they pick up the new content with NO task-config change.

**Open-phase UI over existing surfaces**
- `ArchitectConversationTab.tsx`: read the new `phase` in `refreshNextQuestion`; on `open-available`, drive the open-phase surface; reuse `CloseConversationFlow` for the final close.
- `ConversationMainPane.tsx`: post-walk, render a free-form chat input, the suggested-candidate-areas prompt, and the option-pick UI WITHOUT the "Not applicable to this migration" opt-out button (suppress for user-raised options; keep `OPT_OUT_ANSWER_VALUE` universal for preset). Render the new turn kinds in the `TurnView` switch following the `TierConfirmationView` precedent.
- `SummaryPanel.tsx` "Preview prompt-ready output" automatically includes the two new sections once they reach the prompt text.

## Visual Design
No visual assets provided. `planning/visuals/` exists but is empty — this is a behavioural/conversational change layered over existing surfaces (`ArchitectConversationTab.tsx`, `ConversationMainPane.tsx`, `SummaryPanel.tsx`). Follow the existing transcript-turn and chip/option styling already in `ConversationMainPane.module.css`.

## Existing Code to Leverage

**`gateway/.../architectConversation/llmLoopRunner.ts` + `architectLlmClient.ts`**
- Reuse the hard limits (`ARCHITECT_LOOP_ROUND_LIMIT` 5 / `ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS` 30s / `ARCHITECT_LOOP_WALL_CLOCK_MS` 120s), `withTimeout`/abort, the `ArchitectToolRegistryEntry` registry pattern, and the failure-to-`error` mapping.
- The entry-centric prompt assembly + `parseStructuredAnswer` do NOT fit "propose areas/options" — build the sibling loop's own prompt; reuse only the mechanics + `ArchitectLlmClient` seam (`callLlmToolLoop`).

**`gateway/src/routes/architectConversation.ts`**
- `buildArchitectLlmClient()` bridges the architect contract to the shared `getLlmClient()` relay — reuse verbatim. Extend the `next-question` endpoint with `phase`. The `/open` route is the precedent for appending non-question lifecycle turns. Add the new capture path here (the existing `/answer`+`/capture` hard-404 on non-library codes).

**`gateway/.../targetStateCapturedDecisionsWriter.ts` (`postCapturedDecision`)**
- Reuse verbatim for both `adhoc.<slug>` decision rows and `note.<slug>` note rows (same writer, same data plane, same durability/reopen). `createdByTask` is free-form; use distinct task names per row type.

**`gateway/src/services/contextResolvers.ts` (`buildTargetStateDecisionsPromptText` + `TargetStateDecisionsContextResolver`)**
- Extend the renderer with the two additive sections; the resolver registration and both PM task configs are unchanged. `ctx.findingsSummary` is the discovery-findings grounding source already available in the resolver context.

**`turnShape.ts` `tier-confirmation` + frontend `TierConfirmationView`/`targetStateConversationStore`**
- The interactive in-transcript turn pattern (turn payload + dedicated `TurnView` renderer + verbatim append) is the precedent for the open-phase prompt/option-pick/free-form turns.

## Out of Scope
- Changing the ~51-question preset library or the deterministic walk itself (it remains phase 1).
- Changing the PM backlog/spec generation pipeline — it already consumes `target-state-decisions-context`; it is fed more, not altered.
- Any "Not applicable" opt-out on user-raised topics (the universal opt-out stays ONLY on the preset questions).
- Per-element scope / per-element exception affordance for user-raised decisions (architecture-wide only in this phase).
- Any AMS DDL change (the data plane already accepts arbitrary `decision_code` + `architecture` scope).
- The LLM inferring "I'm done" from free text — sub-phase transitions and close are explicit user controls only.
- A separate phase endpoint — phase availability is signalled solely via the extended `next-question` `phase` field.

## Test Strategy [S7]

**Gateway (Jest; LLM mocked at the `ArchitectLlmClient` boundary)**
- The sibling open-phase loop + handlers (reuse of limits/abort/error-turn behaviour; new tools dispatch).
- Phase-transition signal: `next-question` returns `phase` (`open-available` after exhaustion; in-progress while the walk returns a question).
- The no-opt-out user-raised path (no "Not applicable" option surfaced).
- The user-raised decision write: correct `adhoc.<slug>` code, `scopeKind:'architecture'` (no element ref), distinct `createdByTask`, via the new capture path; the new path does NOT 404 on non-library codes.
- Note persistence: per-topic `note.<slug>` rows with per-note unique codes (no mutual supersession), distinct `createdByTask`.
- The two new prompt-ready-output sections (`### Free-form discussion notes` + user-raised decisions) appear in `buildTargetStateDecisionsPromptText`.

**Frontend (Vitest)**
- The open-phase UI surfaces post-walk (free-form chat input; suggested-areas prompt; option-pick).
- The "Not applicable" opt-out is SUPPRESSED for user-raised options (still present for preset questions).
- The new turn kinds render via the `TurnView` switch.

**End-to-end gateway HTTP test (one flow)**
- Walk exhausts → open prompt → user-raised topic → option proposal → pick → first-class decision written → free-form note → notes summarised → close → BOTH new prompt-ready sections present.
