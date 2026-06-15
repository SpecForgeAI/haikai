# Task Breakdown: Architect Conversation — Open-Ended LLM Phase (after the deterministic preset walk)

## Overview
Total Tasks: 7 task groups

This feature adds an open-ended, two-sub-phase LLM phase to the TARGET-STATE Architect
conversation that begins strictly after the deterministic ~51-question preset walk
exhausts. The preset library, the deterministic walk, the universal "Not applicable"
opt-out, and the PM backlog/spec pipeline stay UNCHANGED — the only PM-facing change is
two additive prompt-ready-output sections.

The work is layered **gateway-first, then frontend**, in strict dependency order. The
gateway turn-shape union + wire types are the foundation (the frontend mirrors them);
the grounding context + sibling LLM loop + capture path + prompt-ready sections sit on
that foundation; the frontend open-phase UI consumes the single API mirror; tests are
written per-group (2-8 focused tests each, run in isolation) with a final cross-cutting
group that adds the end-to-end HTTP flow and fills any critical gaps.

LLM is mocked at the `ArchitectLlmClient` boundary in every test (consistent with the
existing architect-conversation suites under
`gateway/src/services/architectConversation/__tests__/`).

## Task List

### Gateway — Wire Foundation

#### Task Group 1: Turn-shape union, wire types, and the `phase` signal
**Dependencies:** None

This group is the contract foundation everything else builds on: the new durable turn
kinds in the closed union, and the `phase` field on the `next-question` response. No LLM,
no persistence behaviour, no UI — just the shapes and the exhaustion signal.

- [x] 1.0 Add the open-phase turn kinds and the `phase` signal to the gateway wire contract
  - [x] 1.1 Write 2-8 focused tests for the turn union + `phase` signal
    - Add to / alongside `gateway/src/services/architectConversation/__tests__/conversationTranscript.test.ts` (or a new `openPhaseTurnShape.test.ts`)
    - Test that `assertExhaustiveTurnKind` still type-checks/throws correctly with the new kinds present (the closed-union exhaustiveness guard stays honest)
    - Test the `next-question` `phase` derivation: `phase: 'open-available'` when `selectNextQuestion` returns `null`; the in-progress phase value while a question is returned (extend `questionSequencer.test.ts` for the null/exhausted branch if the derivation lives there)
    - Limit to 2-8 highly focused tests; do NOT exhaustively test every turn payload field
  - [x] 1.2 Add the new durable turn kinds to the closed union in `gateway/src/services/architectConversation/turnShape.ts`
    - (1) open-phase prompt turn — architect "other areas?" message + suggested candidate areas payload
    - (2) user-raised-topic turn
    - (3) LLM option-proposal turn — per-topic single-select vs multi-select shape (mirror the preset `single-choice`/`multi-choice` shapes) + a "something else…" free-text escape marker
    - (4) user pick turn
    - (5) free-form-discussion turns (user + assistant) — model both speaker roles
    - Final names/payloads at implementation discretion; follow the `tier-confirmation` interactive-turn payload precedent already in this file
  - [x] 1.3 Keep `assertExhaustiveTurnKind` honest
    - Add the new kinds to the exhaustive switch so the compiler enforces handling everywhere the union is consumed
  - [x] 1.4 Add the `phase` field to the `next-question` response shape
    - Extend the next-question wire shape (`toPendingQuestionDto` path / the route response in `gateway/src/routes/architectConversation.ts` next-question endpoint) so it returns `{ question: <dto|null>, phase: <signal> }`
    - `phase: 'open-available'` strictly when `selectNextQuestion` returns `null` (walk exhausted); the in-progress value while a question is returned
    - Do NOT add a separate phase endpoint
  - [x] 1.5 Mirror ALL wire changes in the frontend `frontend/src/api/architectConversationApi.ts`
    - Add the five new turn kinds to the `ConversationTurn` union (mirror the gateway payloads exactly)
    - Add the `phase` field to `fetchNextQuestion` / `PendingQuestion` return shape
    - This is a types-only mirror in this group; the UI that consumes it is Task Group 6
  - [x] 1.6 Ensure wire-foundation tests pass
    - Run ONLY the 2-8 tests written in 1.1 (gateway Jest)
    - Verify the gateway TypeScript compiles (the exhaustiveness guard is the key check)
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- The five new turn kinds exist in the gateway closed union and are mirrored verbatim in the frontend `ConversationTurn` union
- `assertExhaustiveTurnKind` covers the new kinds (compiler-enforced)
- `next-question` returns `{ question, phase }`; `phase: 'open-available'` exactly when the walk is exhausted; no separate phase endpoint
- `fetchNextQuestion` mirrors the `phase` field

### Gateway — Grounding Context

#### Task Group 2: Open-phase LLM grounding assembly
**Dependencies:** Task Group 1

Assemble the grounding context the sibling loop will consume so its suggested areas +
proposed options are relevant to the actual system. Reuse existing context resolvers; do
not invent new data sources.

- [x] 2.0 Build the open-phase grounding context assembler
  - [x] 2.1 Write 2-8 focused tests for grounding assembly
    - Test that the assembled grounding includes: captured decisions so far (via `buildTargetStateDecisionsPromptText`), the target-model summary, and the migration goal / product summary
    - Test the discovery-findings branch: findings summary included WHEN available; clean fallback to the three remaining sources when findings are absent/empty
    - LLM not involved here — pure context assembly; mock the underlying resolvers
    - Limit to 2-8 focused tests
  - [x] 2.2 Assemble the four grounding sources
    - Captured decisions so far via `buildTargetStateDecisionsPromptText` (`gateway/src/services/contextResolvers.ts`)
    - Loaded target-model summary (reuse the existing resolver/context source)
    - Migration goal / product summary (reuse the existing resolver/context source)
    - Reuse existing context resolvers verbatim; do NOT add new AMS calls
  - [x] 2.3 Add the discovery-findings grounding with fallback
    - Include the discovery-findings summary WHEN AVAILABLE (`ctx.findingsSummary` is already available in the resolver context per the code trace)
    - Fall back to the three remaining sources when there are no findings
  - [x] 2.4 Ensure grounding tests pass
    - Run ONLY the 2-8 tests written in 2.1 (gateway Jest)
    - Verify the with-findings and no-findings paths both produce well-formed grounding
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Grounding includes captured decisions + target-model summary + migration goal/product summary
- Discovery-findings summary is included when available and cleanly omitted (three-source fallback) when not
- All grounding sources reuse existing resolvers; no new AMS DDL or data calls

### Gateway — Sibling LLM Loop

#### Task Group 3: Sibling open-phase LLM loop + tools + sub-phase handlers
**Dependencies:** Task Groups 1, 2

A NEW sibling loop alongside `runArchitectQuestionLoop` (NOT an overload — the existing
runner is entry-centric around a single `QuestionLibraryEntry`). Reuse the client, the
hard limits, abort/timeout, and the failure-to-`error`-turn behaviour. New tools drive
both sub-phases. Handlers are siblings to `answerQuestion`/`captureDeterministicAnswer`.

- [x] 3.0 Build the sibling open-phase loop, its tools, and the sub-phase handlers
  - [x] 3.1 Write 2-8 focused tests for the sibling loop + tool dispatch
    - Add alongside `gateway/src/services/architectConversation/__tests__/llmLoopRunner.test.ts` (or a new `openPhaseLoopRunner.test.ts`)
    - Mock the LLM at the `ArchitectLlmClient` boundary (the established pattern)
    - Test new-tool dispatch: `suggest-candidate-areas`, `propose-options-for-topic` (single + multi shape), `capture-user-decision`, `record-discussion-note`
    - Test the hard-limit/abort reuse: a hung/over-limit call maps to an `error` turn (reuse of `withTimeout`/abort + failure-to-`error`-turn behaviour)
    - Limit to 2-8 focused tests; do NOT re-test the preset loop's behaviour
  - [x] 3.2 Add the sibling open-phase loop runner
    - New runner alongside `runArchitectQuestionLoop` in `gateway/src/services/architectConversation/llmLoopRunner.ts` (or a sibling module); do NOT overload `runArchitectQuestionLoop`
    - REUSE `ArchitectLlmClient` via `buildArchitectLlmClient()` (verbatim), `callLlmToolLoop`, the `ArchitectToolRegistryEntry` registry pattern, `withTimeout`/abort
    - REUSE the same hard limits: 5 rounds / 30s per call / 120s wall clock (`ARCHITECT_LOOP_ROUND_LIMIT` / `ARCHITECT_LOOP_PER_CALL_TIMEOUT_MS` / `ARCHITECT_LOOP_WALL_CLOCK_MS`)
    - Build the loop's OWN prompt assembly (grounding from Task Group 2); do NOT reuse the entry-centric prompt assembly or `parseStructuredAnswer`
    - REUSE the failure-to-`error`-turn mapping
  - [x] 3.3 Implement the new tools
    - `suggest-candidate-areas` — emits the proactively-suggested grounded candidate areas (P3) for the open-phase prompt turn
    - `propose-options-for-topic` — emits concrete options for a user-raised topic, choosing single-select vs multi-select PER TOPIC + a "something else…" free-text escape; explicitly NO "Not applicable" option (P4)
    - `capture-user-decision` — signals the user's pick to be written as a first-class decision (write itself is Task Group 4)
    - `record-discussion-note` — signals the per-topic structured notes summarised at the end of sub-phase (b) (write itself is Task Group 4)
  - [x] 3.4 Add the sub-phase handlers in `architectConversationCoordinator.ts`
    - Siblings to `answerQuestion`/`captureDeterministicAnswer` in `gateway/src/services/architectConversation/architectConversationCoordinator.ts`
    - Sub-phase (a) handler: open prompt + suggested areas → user-raised topic → option proposal → user pick
    - Sub-phase (b) handler: free-form multi-turn chat → end-of-(b) per-topic note summarisation
    - The LLM NEVER infers "done"; sub-phase transitions are triggered by explicit controls only (S5) — the handlers expose explicit transition entry points, not free-text inference
  - [x] 3.5 Ensure sibling-loop tests pass
    - Run ONLY the 2-8 tests written in 3.1 (gateway Jest)
    - Verify tool dispatch and the limit/abort → `error`-turn behaviour
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- The sibling loop is separate from `runArchitectQuestionLoop` and reuses the client, the 5/30s/120s hard limits, `withTimeout`/abort, and the failure-to-`error`-turn behaviour
- All four new tools dispatch correctly; per-topic single/multi option shape works; no "Not applicable" option is emitted for user-raised topics
- Sub-phase handlers are siblings in `architectConversationCoordinator.ts`; transitions are explicit, never inferred from free text

### Gateway — Capture Path + Persistence

#### Task Group 4: Open-phase capture path, decision/note writes, durable transcript
**Dependencies:** Task Groups 1, 3

A NEW capture path (the preset `/answer`+`/capture` routes hard-404 on non-library
codes). First-class user-raised decisions as `adhoc.<slug>` rows; free-form notes as
per-note-unique `note.<slug>` rows. All new turns appended verbatim to the durable
transcript. Reuses `postCapturedDecision` and `targetStateConversationStore`; no AMS DDL.

- [x] 4.0 Build the open-phase capture path and durable-transcript appends
  - [x] 4.1 Write 2-8 focused tests for the capture path + writes
    - Add to / alongside `gateway/src/__tests__/targetStateConversationStore.test.ts` and a route-level capture test (mock `postCapturedDecision` / the AMS writer boundary)
    - Test the user-raised decision write: `adhoc.<slug>` code (slug derived from the topic label, e.g. `adhoc.batch-processing`), `scopeKind:'architecture'` with NO `scopeRefType`/`scopeRefId`, distinct `createdByTask` (e.g. `architect-adhoc-decision`)
    - Test the note write: per-note UNIQUE `note.<slug>` codes (two distinct notes do NOT supersede each other), distinct `createdByTask`
    - Test that the NEW capture path does NOT 404 on `adhoc.*`/`note.*` codes (contrast with the preset `/answer`+`/capture` hard-404 on non-library codes)
    - Limit to 2-8 focused tests
  - [x] 4.2 Add the dedicated open-phase capture path
    - New handler/route in `gateway/src/routes/architectConversation.ts` (the `/open` route is the precedent for appending non-question lifecycle turns; the new capture path lives here)
    - Writes via `postCapturedDecision` (`gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts`) — reused verbatim — for BOTH `adhoc.<slug>` decision rows and `note.<slug>` note rows
    - Do NOT route `adhoc.*`/`note.*` through the existing `/answer`+`/capture` (they `findEntry` against `QUESTION_LIBRARY` and 404)
  - [x] 4.3 Write user-raised decisions as first-class `adhoc.<slug>` rows
    - Slug derived from the topic label; `scopeKind:'architecture'`, no `scopeRefType`/`scopeRefId`; distinct `createdByTask`
    - Supersession key is `(project, target, decisionCode, scopeKind, scopeRefId)` — a repeated answer on one topic intentionally supersedes; distinct topics get distinct codes
    - `CreateCapturedDecisionRequestBody`'s `scopeKind: 'architecture' | 'element'` is adequate; NO widening, NO AMS DDL
  - [x] 4.4 Write free-form notes as per-note-unique `note.<slug>` rows
    - Each note gets a PER-NOTE UNIQUE code so notes do not supersede one another; distinct `createdByTask` from the decision rows
    - Same writer, same data plane, same durability/reopen
  - [x] 4.5 Append all new turns verbatim to the durable transcript
    - Append the five new turn kinds via `targetStateConversationStore` (`gateway/src/services/targetStateConversationStore.ts`) so they survive reopen, following the `/open` lifecycle-append precedent
  - [x] 4.6 Ensure capture/persistence tests pass
    - Run ONLY the 2-8 tests written in 4.1 (gateway Jest)
    - Verify the codes/scope/createdByTask and the no-404 behaviour of the new path
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- User-raised decisions persist as `adhoc.<slug>` architecture-scoped rows with a distinct `createdByTask`, via the new path that does NOT 404 on non-library codes
- Notes persist as per-note-unique `note.<slug>` rows with a distinct `createdByTask`; no mutual supersession
- All new turns are appended verbatim to the durable transcript and survive reopen
- No AMS DDL change; `postCapturedDecision` and `targetStateConversationStore` reused verbatim

### Gateway — Prompt-Ready Output

#### Task Group 5: Two additive prompt-ready-output sections
**Dependencies:** Task Groups 1, 4

The ONLY PM-facing change. Extend the renderer so both PM tasks pick up the new content
with NO task-config change. The resolver registration and both PM task configs stay
untouched.

- [x] 5.0 Extend `buildTargetStateDecisionsPromptText` with the two new sections
  - [x] 5.1 Write 2-8 focused tests for the new sections
    - Add to / alongside `gateway/src/__tests__/targetStateDecisionsContextResolver.test.ts`
    - Test that `### Free-form discussion notes` is rendered from the `note.<slug>` rows
    - Test that first-class user-raised (`adhoc.<slug>`) decisions are surfaced under `### Additional / user-raised decisions` (or correctly folded into the existing `### Architecture-wide` scope grouping — implementation discretion)
    - Test that the `target-state-decisions-context` resolver registration is unchanged (both PM tasks still resolve it)
    - Limit to 2-8 focused tests
  - [x] 5.2 Add the `### Free-form discussion notes` section
    - In `buildTargetStateDecisionsPromptText` (`gateway/src/services/contextResolvers.ts`), source from the `note.<slug>` rows
  - [x] 5.3 Surface first-class user-raised decisions
    - Add a `### Additional / user-raised decisions` section, OR fold `adhoc.*` rows into the existing scope grouping (architecture-scoped rows already land under `### Architecture-wide`) — implementation discretion; either way they remain citable by specs
  - [x] 5.4 Leave the resolver registration and PM task configs untouched
    - `TargetStateDecisionsContextResolver` registration under `target-state-decisions-context` is UNCHANGED
    - Do NOT edit `product-manager--migration-shape-spec-generation.json` or `product-manager--migration-delivery-plan.json`
  - [x] 5.5 Ensure prompt-ready-output tests pass
    - Run ONLY the 2-8 tests written in 5.1 (gateway Jest)
    - Verify both new sections appear and the resolver registration is intact
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- `buildTargetStateDecisionsPromptText` renders a `### Free-form discussion notes` section from `note.<slug>` rows and surfaces `adhoc.<slug>` user-raised decisions
- The resolver registration is unchanged; neither PM task config is edited; both pick up the new content with no config change

### Frontend — Open-Phase UI

#### Task Group 6: Open-phase UI over existing surfaces
**Dependencies:** Task Groups 1, 5 (consumes the API mirror from 1; SummaryPanel preview reflects 5)

Layer the open-phase UI onto the existing Architect conversation surfaces, driven by the
`phase` signal. Strictly after the preset walk exhausts. The whole phase is optional and
sub-phase (b) is skippable. Suppress the "Not applicable" opt-out on user-raised options
only. Render the new turn kinds following the `TierConfirmationView` precedent.

- [x] 6.0 Build the open-phase frontend surfaces
  - [x] 6.1 Write 2-8 focused tests for the open-phase UI
    - Add to the existing `frontend/src/components/targetState/architectConversation/__tests__/` directory (Vitest), alongside `ConversationMainPane.answerControls.test.tsx` / `ArchitectConversationTab.test.tsx`
    - Test that the open-phase surface appears post-walk driven by `phase: 'open-available'` (suggested-areas prompt + free-form chat input), and NOT mid-walk
    - Test that the "Not applicable" opt-out is SUPPRESSED for user-raised options but still present for preset questions (the universal `OPT_OUT_ANSWER_VALUE` is kept for preset)
    - Test that the new turn kinds render via the `TurnView` switch
    - Limit to 2-8 focused tests
  - [x] 6.2 Drive the open phase from the `phase` signal in `ArchitectConversationTab.tsx`
    - Read the new `phase` in `refreshNextQuestion`; on `open-available`, drive the open-phase surface
    - Enter the open phase STRICTLY after the preset walk exhausts, never mid-walk
    - Reuse `CloseConversationFlow` for the final close; keep the "Preview prompt-ready output" modal wiring
    - The whole open phase is OPTIONAL — the user may close immediately (preserve today's input-bar-hidden close state)
  - [x] 6.3 Render the open-phase prompt and free-form chat in `ConversationMainPane.tsx`
    - Render the architect's suggested-candidate-areas prompt turn
    - Render a free-form chat input post-walk (the multi-turn discussion for sub-phase (b))
    - Render the free-form-discussion user + assistant turns
  - [x] 6.4 Render the option-pick UI without the "Not applicable" opt-out
    - The option-pick turn for user-raised topics renders WITHOUT the "Not applicable to this migration" opt-out button (suppress `OPT_OUT_ANSWER_VALUE` here)
    - Keep `OPT_OUT_ANSWER_VALUE` universal for preset questions (unchanged)
    - Include the "something else…" free-text escape (captured verbatim)
  - [x] 6.5 Add the new turn renderers to the `TurnView` switch
    - Render the five new turn kinds following the `TierConfirmationView` interactive-turn precedent (turn payload + dedicated renderer)
    - Use the existing transcript-turn and chip/option styling in `ConversationMainPane.module.css` / `ArchitectConversation.module.css`
  - [x] 6.6 Add the explicit transition + close controls
    - "Done with decisions" control ends sub-phase (a) and moves to (b)
    - "Done / Close" control ends sub-phase (b) and proceeds to the existing close
    - Sub-phase (b) is SKIPPABLE; transitions are explicit user controls (never inferred)
  - [x] 6.7 Surface the two new sections in `SummaryPanel.tsx`
    - The "Preview prompt-ready output" surface automatically includes the `### Additional / user-raised decisions` and `### Free-form discussion notes` sections once they reach the prompt text (consumes the Task Group 5 output via `fetchPromptReadyOutput`)
  - [x] 6.8 Consume the single `architectConversationApi.ts` mirror
    - Use the turn-union + `phase` mirror added in Task Group 1.5 (the single frontend API surface); do not add a parallel types definition
  - [x] 6.9 Ensure open-phase UI tests pass
    - Run ONLY the 2-8 tests written in 6.1 (Vitest)
    - Verify the phase-gated surface, the suppressed N/A on user-raised options, and the new turn renderers
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- The open-phase surface appears strictly after the walk exhausts (driven by `phase`), with the suggested-areas prompt, free-form chat, and the new turn kinds rendered via `TurnView`
- User-raised option picks have NO "Not applicable" opt-out; preset questions keep the universal opt-out; a "something else…" escape exists
- Explicit "Done with decisions" and "Done / Close" controls drive the transitions; sub-phase (b) is skippable; the whole phase is optional
- `SummaryPanel.tsx` preview includes the two new sections

### Testing

#### Task Group 7: End-to-end flow + test review & gap analysis
**Dependencies:** Task Groups 1-6

Add the one required end-to-end gateway HTTP test exercising the whole open phase in a
single flow, then review the per-group tests and fill only critical gaps. LLM mocked at
the `ArchitectLlmClient` boundary throughout. Scope is THIS feature only.

- [x] 7.0 Add the end-to-end flow and fill critical gaps only
  - [x] 7.1 Review the tests from Task Groups 1-6
    - Gateway Jest: 1.1 (turn union + `phase`), 2.1 (grounding), 3.1 (sibling loop + tools), 4.1 (capture path + writes), 5.1 (prompt-ready sections)
    - Frontend Vitest: 6.1 (open-phase UI)
    - Total existing focused tests: approximately 12-48
  - [x] 7.2 Write the one end-to-end gateway HTTP test (required by S7)
    - Single flow: walk exhausts → open prompt (suggested areas) → user-raised topic → option proposal → pick → first-class `adhoc.<slug>` decision written → free-form note → notes summarised into `note.<slug>` rows → close → BOTH new prompt-ready sections present in `buildTargetStateDecisionsPromptText` output
    - LLM mocked at the `ArchitectLlmClient` boundary
    - Place as a route-level gateway test (e.g. `gateway/src/__tests__/architectConversationOpenPhaseE2E.test.ts`)
  - [x] 7.3 Analyse test coverage gaps for THIS feature only
    - Identify critical open-phase workflow gaps not covered by 1.1-6.1 + the E2E
    - Focus ONLY on this spec's requirements; do NOT assess application-wide coverage
    - Prioritise the phase signal, the no-opt-out user-raised path, the `adhoc.<slug>`/`note.<slug>` writes with correct scope/createdByTask, and the two prompt-ready sections
  - [x] 7.4 Write up to 10 additional strategic tests maximum (only if needed)
    - Fill identified critical gaps only; integration/workflow over unit edge cases
    - Do NOT write comprehensive coverage for all scenarios; skip non-critical edge/perf/a11y tests
  - [x] 7.5 Run feature-specific tests only
    - Run ONLY the tests for this feature (1.1, 2.1, 3.1, 4.1, 5.1, 6.1, the E2E from 7.2, and any from 7.4)
    - Do NOT run the entire application test suite
    - Verify the critical open-phase workflow passes end-to-end

**Acceptance Criteria:**
- All feature-specific tests pass (the per-group tests + the one end-to-end gateway HTTP test + any gap-fillers)
- The end-to-end test exercises the full open phase in one flow, ending with BOTH new prompt-ready sections present
- No more than 10 additional tests added when filling gaps
- LLM is mocked at the `ArchitectLlmClient` boundary throughout; testing is focused exclusively on this spec's feature

## Execution Order

Recommended implementation sequence (gateway-first, frontend-second, per the spec's
layering + dependency order):

1. Gateway — Turn-shape union, wire types, and the `phase` signal (Task Group 1)
2. Gateway — Open-phase LLM grounding assembly (Task Group 2)
3. Gateway — Sibling open-phase LLM loop + tools + handlers (Task Group 3)
4. Gateway — Open-phase capture path, decision/note writes, durable transcript (Task Group 4)
5. Gateway — Two additive prompt-ready-output sections (Task Group 5)
6. Frontend — Open-phase UI over existing surfaces (Task Group 6)
7. End-to-end flow + test review & gap analysis (Task Group 7)

## Invariants (do NOT change)

- The ~51-question preset library and the deterministic walk (`selectNextQuestion`) — they remain phase 1.
- The universal "Not applicable to this migration" opt-out on the preset questions (`OPT_OUT_ANSWER_VALUE`) — suppressed ONLY for user-raised options.
- The PM backlog/spec generation pipeline and both PM task configs (`product-manager--migration-shape-spec-generation.json`, `product-manager--migration-delivery-plan.json`) — fed more, never altered.
- `TargetStateDecisionsContextResolver` registration under `target-state-decisions-context`.
- The AMS data plane — no DDL change (`decision_code` has no CHECK/enum; the scope-invariant CHECK already permits `architecture`); `postCapturedDecision` and `CreateCapturedDecisionRequestBody`'s `scopeKind: 'architecture' | 'element'` reused verbatim with no widening.
- `runArchitectQuestionLoop` — the open-phase loop is a SIBLING, not an overload.
- The LLM never infers "done" — all sub-phase transitions and the close are explicit user controls.
- No separate phase endpoint — phase availability is signalled solely via the extended `next-question` `phase` field.
