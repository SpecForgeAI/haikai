# Spec Requirements: Architect Conversation — Open-Ended LLM Phase (after the deterministic preset walk)

> Status: AUTHORITATIVE / BUILD-READY. Every open design point from the code trace
> has been resolved and user-approved. The four original product decisions (P1–P4),
> the settled implementation decisions (S1–S7), and the two user-answered design
> decisions (Q1, Q2) are baked in below as settled. Do NOT re-ask. The code trace in
> the "Code Trace" section is verified and unchanged.

## Initial Description
See `planning/raw-idea.md` (comprehensive). Summary: add an open-ended, LLM-driven
phase to the TARGET-STATE "Architect" conversation (the target-architecture decisions
conversation — NOT the Discovery Review Room) that begins once the deterministic
51-question preset walk is exhausted, in TWO DISTINCT sub-phases:

- **(a) user-raised topics → LLM proposes concrete options → the pick becomes a
  FIRST-CLASS captured decision** on the same data plane as the preset ones (flows
  into the PM backlog/spec generation that already consumes captured decisions),
  flagged user-raised/ad-hoc with a generated code. NO "Not applicable" opt-out here
  (the universal opt-out stays ONLY on the preset questions).
- **(b) free-flow discussion → NOTES** (not first-class decisions) that ride into the
  prompt-ready output the backlog/spec generation consumes.

The deterministic preset walk + its ~51-question library + its universal
"Not applicable to this migration" opt-out are UNCHANGED. The new phase sits strictly
AFTER the walk exhausts.

## Settled Decisions (baked in — not re-asked)

### Four original product decisions
- **P1 — Two distinct sub-phases (a) and (b), kept separate.** (a) = user-raised
  topics → LLM-proposed options → FIRST-CLASS captured decisions that EXTEND the
  preset decision list. (b) = free-flow discussion → NOTES for migration planning.
- **P2 — (a) are first-class captured decisions** (citable by specs, same data plane
  as the preset ones); **(b) are notes/context.**
- **P3 — The architect PROACTIVELY SUGGESTS a few candidate areas** (grounded in the
  migration) at the "other areas?" prompt, then stays open.
- **P4 — NO "Not applicable" opt-out for user-raised topics (sub-phase a).** The
  universal opt-out stays ONLY on the preset questions. The deterministic preset walk
  + the 51-question library are UNCHANGED (they remain "phase 1"); the new phase sits
  strictly AFTER it.

### Settled implementation / process decisions
- **S1 — User-raised decision coding & scope.** Each user-raised decision is written
  with a generated `adhoc.<slug>` decision code (slug derived from the topic label,
  e.g. `adhoc.batch-processing`) and a distinct `createdByTask` (e.g.
  `architect-adhoc-decision`) so it is clearly separable from preset rows. Scope is
  architecture-wide: `scopeKind:'architecture'`, no `scopeRefType`, no `scopeRefId`
  (no per-element exception affordance in this phase). The AMS captured-decisions
  plane already accepts an arbitrary `decision_code` and `architecture` scope with NO
  DDL change (verified: `155-target-state-captured-decisions.sql` — `decision_code`
  has no CHECK/enum; the scope-invariant CHECK permits `architecture`).
- **S2 — Reaching the phase.** The open phase is reachable STRICTLY after the preset
  walk exhausts (`selectNextQuestion` → null), never mid-walk. It is signalled by
  EXTENDING the existing `next-question` response with a `phase` field (e.g.
  `{ question: null, phase: 'open-available' }`) rather than introducing a separate
  phase endpoint. While `selectNextQuestion` still returns a question, the phase field
  indicates the preset walk is in progress and the open phase is not yet available.
- **S3 — The LLM loop.** A SIBLING open-phase loop (NOT an overload of
  `runArchitectQuestionLoop`, which is entry-centric around a single
  `QuestionLibraryEntry`). It REUSES the same `ArchitectLlmClient`
  (`buildArchitectLlmClient` → the shared `getLlmClient()` relay), the same hard
  limits (5 rounds / 30s per call / 120s wall clock), the same `withTimeout`/abort
  handling, and the same failure-to-`error`-turn behaviour as the preset loop. It
  carries NEW tools: `suggest-candidate-areas`, `propose-options-for-topic`,
  `capture-user-decision`, `record-discussion-note` (final tool names at the spec's
  discretion). It needs its OWN capture path because the preset `/answer` + `/capture`
  routes hard-404 on non-library decision codes (verified: both call
  `findEntry(decisionCode)` against `QUESTION_LIBRARY` and return 404 when not found).
- **S4 — Option shape.** The LLM chooses single-select vs multi-select PER TOPIC,
  mirroring the preset library's `single-choice` / `multi-choice` shapes, plus a
  "something else…" free-text escape captured verbatim as the decision answer.
  Explicitly NO "Not applicable" option on user-raised topics.
- **S5 — Flow + skippability (explicit user controls; never inferred from free text).**
  A "Done with decisions" control ends sub-phase (a) and moves to sub-phase (b). A
  "Done / Close" control ends sub-phase (b) and proceeds to the existing close. The
  LLM does NOT infer "I'm done" from free text. Sub-phase (b) is SKIPPABLE. The WHOLE
  open phase is OPTIONAL — the user can close immediately after the preset walk,
  exactly as today.
- **S6 — New turn kinds (appended verbatim to the durable transcript so they survive
  reopen).** Add to the closed turn union in gateway `turnShape.ts` AND mirror in the
  frontend `architectConversationApi.ts`:
  1. an open-phase prompt turn (the architect's "other areas?" message + the suggested
     candidate areas),
  2. a user-raised-topic turn,
  3. an LLM option-proposal turn,
  4. the user's pick turn,
  5. free-form-discussion turns (user + assistant).
  Final names/payloads are at the spec's discretion. All are appended to the durable
  transcript via `targetStateConversationStore` so they survive reopen.
- **S7 — Tests.**
  - Gateway Jest: the new sibling loop + handlers; the phase-transition signal
    (`next-question` returns `phase`); the no-opt-out user-raised path; the user-raised
    decision write (correct `adhoc.<slug>` code / `architecture` scope / distinct
    `createdByTask`); the new prompt-ready-output sections (user-raised decisions +
    free-form notes).
  - Frontend Vitest: the open-phase UI; the suppressed "Not applicable" on user-raised
    options; the free-form chat.
  - LLM mocked at the `ArchitectLlmClient` boundary (consistent with the existing
    suites).
  - PLUS one end-to-end gateway HTTP test exercising the whole open phase in one flow
    (walk-exhausts → open prompt → user-raised topic → option proposal → pick →
    first-class decision written → free-form note → notes summarised → close → both new
    prompt-ready sections present).

### User-answered design decisions (both approved as recommended)
- **Q1 — Grounding.** YES — the open-phase LLM is ALSO grounded in the DISCOVERY
  FINDINGS summary (the current-state reality) when available, ALONGSIDE: the captured
  decisions so far (`buildTargetStateDecisionsPromptText`), the loaded target-model
  summary, and the migration goal / product summary. This makes its suggested candidate
  areas + options genuinely relevant to the actual current system. When there are no
  findings, it falls back to the three sources (captured decisions + target-model
  summary + migration goal / product summary).
- **Q2 — Free-form notes (sub-phase b).**
  - **(a) Structured, not raw.** At the END of sub-phase (b), the LLM SUMMARISES the
    discussion into PER-TOPIC STRUCTURED NOTES (NOT a raw-transcript blob).
  - **(b) Persistence on the existing captured-decisions plane.** Notes are persisted
    as special rows under a distinct `note.<slug>` namespace with a distinct
    `createdByTask`, reusing the captured-decisions plane's durability + reopen + PM
    rendering for free. Each note gets a per-note UNIQUE code so notes do NOT supersede
    each other (the supersession key is `(project, target, decisionCode, scopeKind,
    scopeRefId)`).
  - **(c) Surfacing.** Notes are surfaced in `buildTargetStateDecisionsPromptText` as a
    NEW "### Free-form discussion notes" section so BOTH PM tasks pick them up with NO
    task-config change. First-class user-raised decisions (S1) get their own
    "### Additional / user-raised decisions" section (or fold into the existing scope
    grouping — spec's discretion) so they remain citable by specs.

## Requirements Discussion

### First Round Questions

> The four product decisions (P1–P4) were CONFIRMED in the raw idea and not re-asked.
> The code trace (below) surfaced the genuinely-open design points; the user then
> approved every recommendation. The two design decisions the user explicitly answered:

**Q1:** Should the open-phase LLM also be grounded in the discovery findings summary
(the current-state reality), alongside the captured decisions so far, the loaded
target-model summary, and the migration goal / product summary — so its suggested
candidate areas and proposed options are genuinely relevant?
**Answer:** Yes (approved as recommended). Use the discovery findings summary when
available; fall back to the three sources (captured decisions + target-model summary +
migration goal / product summary) when there are no findings. See Q1 above.

**Q2:** For sub-phase (b) free-form notes: should the LLM summarise the discussion into
per-topic structured notes (vs a raw-transcript blob); should those notes be persisted
on the existing captured-decisions plane under a `note.<slug>` namespace (reusing
durability + reopen + PM rendering); and should they be surfaced via a new "Free-form
discussion notes" section in `buildTargetStateDecisionsPromptText` so both PM tasks
pick them up with no task-config change?
**Answer:** Yes to all three (approved as recommended). Per-topic structured notes;
persist under `note.<slug>` with a distinct `createdByTask` and per-note unique codes
(so they do not supersede each other); surface via a new "### Free-form discussion
notes" section; first-class user-raised decisions get their own "### Additional /
user-raised decisions" section (or scope-group fold, spec's discretion). See Q2 above.

### Existing Code to Reference

The implementation extends an existing, well-factored subsystem. All references are
verified in the Code Trace section. Primary references for the spec-writer:

**Gateway — open-phase orchestration siblings:**
- `gateway/src/services/architectConversation/architectConversationCoordinator.ts` —
  `answerQuestion` (LLM loop per question) + `captureDeterministicAnswer` (no LLM);
  both entry-centric; the new sub-phase handlers are siblings here.
- `gateway/src/services/architectConversation/llmLoopRunner.ts` —
  `runArchitectQuestionLoop` + the hard limits (5 rounds / 30s per call / 120s wall) +
  the `ArchitectToolRegistryEntry` tool-registry pattern + `withTimeout`/abort. The
  sibling open-phase loop reuses the limits/mechanics but NOT the entry-centric prompt
  assembly/parser.
- `gateway/src/services/architectConversation/architectLlmClient.ts` —
  `ArchitectLlmClient` (`callLlmToolLoop` + `callSingleShot`). The LLM seam to reuse.
- `gateway/src/routes/architectConversation.ts` — `buildArchitectLlmClient` (bridges
  the architect contract to the shared `getLlmClient()` relay; reusable verbatim);
  `next-question` endpoint (to EXTEND with the `phase` field); `/answer` + `/capture`
  (hard-404 on non-library codes → the new path is required); `prompt-ready-output`
  endpoint; `/open` (precedent for appending non-question lifecycle turns).

**Capture + context:**
- `gateway/src/services/architectConversation/targetStateCapturedDecisionsWriter.ts` —
  `postCapturedDecision`. NOTE: its `CreateCapturedDecisionRequestBody` types
  `scopeKind` as `'architecture' | 'element'` only — adequate for the architecture-wide
  user-raised + note rows; no widening needed.
- `gateway/src/services/contextResolvers.ts` —
  `buildTargetStateDecisionsPromptText` (groups decisions by `scopeKind`; extend with
  the two new sections) + `TargetStateDecisionsContextResolver` (registered under
  `'target-state-decisions-context'`; the resolver BOTH PM tasks consume).

**Turn shape:**
- `gateway/src/services/architectConversation/turnShape.ts` — the closed turn union;
  the `tier-confirmation` interactive in-transcript turn is the precedent pattern for
  the interactive open-phase prompt/option-pick turns. Add the new kinds here.
- `gateway/src/services/targetStateConversationStore.ts` — appends turns verbatim
  (the durable, extensible transcript persistence).

**Frontend:**
- `frontend/src/api/architectConversationApi.ts` — the `ConversationTurn` union (mirror
  the new turn kinds); `PendingQuestion`; `fetchNextQuestion`;
  `captureAnswer`/`answerQuestion`; `OPT_OUT_ANSWER_VALUE = '(not used)'` (suppress for
  user-raised options).
- `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` —
  input-bar gating (renders only when `pendingQuestion && !pendingCascadeSummary`); the
  always-rendered opt-out button (to SUPPRESS for user-raised options); the `TurnView`
  switch + the `TierConfirmationView` interactive-turn pattern (precedent for the
  open-phase prompt/option-pick/free-form turns).
- `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx` —
  lifecycle owner; `refreshNextQuestion` (drives the walk; reads the new `phase`);
  `handleCaptureAnswer`; `CloseConversationFlow` (the close affordance); the
  "Preview prompt-ready output" modal.
- `frontend/src/components/targetState/architectConversation/SummaryPanel.tsx` —
  the "Preview prompt-ready output" surface (will include the two new sections once they
  reach the prompt text).

**PM consumers — do NOT change (fed more, not altered):**
- `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
- `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
  Both list `target-state-decisions-context` in `contextNeeds` and treat captured
  decisions as evidence the spec must cite via `evidenceRefs[]`. First-class user-raised
  decisions are consumed the moment they are written; notes are consumed via the new
  prompt-text section with no task-config change.

**AMS data plane — no DDL change:**
- `architecture-model-service/.../db/changelog/sql/155-target-state-captured-decisions.sql`
  (`decision_code` has no CHECK/enum; scope-invariant CHECK permits `architecture`).
- `TargetStateCapturedDecisionService.createDecision` (atomic supersession on
  `(project, target, decisionCode, scopeKind, scopeRefId)` — makes the coding scheme
  load-bearing; distinct topics/notes MUST get distinct codes).
- `CreateTargetStateCapturedDecisionRequest` (camelCase wire; gateway is the single
  writer; no validation beyond the DB).

### Follow-up Questions
None. All design points are resolved and approved (see Settled Decisions).

## Visual Assets

### Files Provided:
No visual assets provided. `planning/visuals/` exists but is empty (verified via
directory listing — no `.png/.jpg/.jpeg/.gif/.svg/.pdf` files). This is a
behavioural/conversational change layered over existing surfaces.

### Visual Insights:
N/A.

## Requirements Summary

### Functional Requirements

**Phase entry (S2):**
- After the preset walk exhausts (`selectNextQuestion` → null), the `next-question`
  response carries a `phase` field (e.g. `{ question: null, phase: 'open-available' }`)
  signalling the open phase is available. While the walk is still in progress, the
  phase field indicates the preset walk is not yet exhausted. No separate phase
  endpoint.
- The whole open phase is OPTIONAL — the user can close immediately after the preset
  walk exactly as today.

**Sub-phase (a) — user-raised topics → first-class captured decisions:**
- The architect (real LLM via the sibling open-phase loop, grounded per Q1 in the
  discovery findings summary when available + captured decisions so far + target-model
  summary + migration goal/product summary) opens with "we've covered the standard
  decisions — are there other areas you'd like to decide?" and PROACTIVELY SUGGESTS a
  few likely-relevant candidate areas (P3), then stays open.
- The user raises a topic. The LLM proposes concrete options for it, choosing
  single-select vs multi-select per topic (S4), plus a "something else…" free-text
  escape captured verbatim. NO "Not applicable" option (P4).
- The user's pick is written as a FIRST-CLASS captured-decision row (S1): generated
  `adhoc.<slug>` code, `scopeKind:'architecture'` (no element ref), distinct
  `createdByTask` (e.g. `architect-adhoc-decision`), via the new capture path (NOT the
  hard-404-on-non-library `/answer`+`/capture` routes).
- A "Done with decisions" control (explicit, never inferred — S5) ends sub-phase (a)
  and moves to sub-phase (b).

**Sub-phase (b) — free-form discussion → notes:**
- The architect asks "is there any other topic you'd like to discuss?" → a genuine
  multi-turn free-form chat (user types, LLM responds).
- Sub-phase (b) is SKIPPABLE (S5).
- At the END of sub-phase (b), the LLM SUMMARISES the discussion into per-topic
  structured notes (Q2a), persisted as `note.<slug>` rows on the captured-decisions
  plane with a distinct `createdByTask` and per-note unique codes (Q2b).
- A "Done / Close" control (explicit — S5) ends sub-phase (b) and proceeds to the
  existing close.

**Transcript durability (S6):**
- New turn kinds (open-phase prompt + suggested areas; user-raised-topic; LLM
  option-proposal; user pick; free-form-discussion user+assistant) are added to the
  gateway closed turn union and mirrored in the frontend, appended verbatim to the
  durable transcript so they survive reopen.

**Prompt-ready output (Q2c) — the ONLY change to the PM-facing surface:**
- `buildTargetStateDecisionsPromptText` gains a "### Free-form discussion notes"
  section (sourced from the `note.<slug>` rows) and surfaces first-class user-raised
  decisions in an "### Additional / user-raised decisions" section (or folds them into
  the existing scope grouping — spec's discretion). Both PM tasks pick these up with NO
  task-config change.

**Unchanged:**
- The deterministic preset walk, the ~51-question library, and the universal
  "Not applicable to this migration" opt-out on the preset questions.
- The PM backlog/spec generation pipeline (it is fed more, not altered).

### Reusability Opportunities
- Reuse `buildArchitectLlmClient` / `ArchitectLlmClient` and the loop limits + tool-call
  mechanics + `withTimeout`/abort from `llmLoopRunner.ts` (sibling loop, not overload).
- Reuse `postCapturedDecision` for both the first-class `adhoc.<slug>` decision rows and
  the `note.<slug>` note rows (same writer, same data plane, same durability/reopen).
- Reuse `buildTargetStateDecisionsPromptText` (extend with the two new sections) +
  `TargetStateDecisionsContextResolver` (unchanged registration; both PM tasks already
  consume it).
- Reuse the `tier-confirmation` / `TierConfirmationView` interactive in-transcript turn
  pattern for the open-phase prompt + option-pick turns.
- Reuse `targetStateConversationStore` verbatim-append for the new turn kinds.

### Scope Boundaries
**In Scope:**
- The two-sub-phase open LLM phase after the preset walk, with the sibling open-phase
  loop (new tools), grounded per Q1.
- Phase-entry signalling via the extended `next-question` `phase` field (S2).
- New turn kinds in the gateway union + frontend mirror, durable across reopen (S6).
- Capture of user-raised first-class decisions (`adhoc.<slug>`, architecture scope,
  distinct `createdByTask`) via a NEW capture path (S1, S3).
- Per-topic structured notes summarised by the LLM and persisted as `note.<slug>` rows
  with per-note unique codes (Q2a/b).
- The additive "### Free-form discussion notes" + "### Additional / user-raised
  decisions" sections in `buildTargetStateDecisionsPromptText` (Q2c).
- Open-phase UI: free-form chat; pickable options WITHOUT the "Not applicable" opt-out;
  explicit "Done with decisions" and "Done / Close" controls (P4, S4, S5).
- Tests (S7): gateway Jest, frontend Vitest, LLM mocked at the `ArchitectLlmClient`
  boundary, plus one end-to-end gateway HTTP test.

**Out of Scope:**
- Changing the ~51-question preset library or the deterministic walk itself (stays as
  phase 1).
- Changing the PM backlog/spec generation pipeline (it already consumes the prompt-ready
  output — we only feed it more).
- Any "Not applicable" opt-out on user-raised topics (P4) — the universal opt-out stays
  ONLY on the preset questions.
- Per-element scope / per-element exception affordance for user-raised decisions
  (architecture-wide only in this phase — S1).
- Any AMS DDL change (the data plane already accepts arbitrary `decision_code` +
  `architecture` scope).
- LLM inferring "I'm done" from free text (the transitions are explicit controls — S5).

### Technical Considerations
- **Data plane is open-ended:** `decision_code` has no CHECK/enum and `architecture`
  scope is permitted, so `adhoc.<slug>` decision rows and `note.<slug>` note rows are
  valid with NO DDL change.
- **Supersession is load-bearing:** the key is
  `(project, target, decisionCode, scopeKind, scopeRefId)`. Distinct topics/notes MUST
  get distinct codes (the `adhoc.<slug>` / `note.<slug>` slug schemes), or a repeated
  answer on one topic intentionally supersedes the prior one.
- **The preset `/answer` + `/capture` routes hard-404 on non-library codes**, so
  user-raised + note captures require their OWN capture path (S3).
- **Grounding sources (Q1):** discovery findings summary (when available) + captured
  decisions so far (`buildTargetStateDecisionsPromptText`) + loaded target-model summary
  + migration goal/product summary; the three-source fallback when there are no
  findings.
- **Loop safety reuse:** the sibling loop reuses the preset loop's hard limits
  (5 rounds / 30s per call / 120s wall), `withTimeout`/abort, and failure-to-`error`-turn
  behaviour (S3).
- **PM consumption is automatic:** both PM tasks already list
  `target-state-decisions-context` in `contextNeeds`; first-class user-raised decisions
  are consumed the moment they are written, and notes via the new prompt-text section —
  no task-config change.

## Code Trace — verification of the raw idea's file:line seams

All seams in the raw idea were verified against the actual code and are accurate.
Retained verbatim from the prior spec-shaper pass for the spec-writer's reference.

### Gateway
- `services/architectConversation/questionSequencer.ts` — `selectNextQuestion`
  (lines 67-86) returns `null` when the walk exhausts. `toPendingQuestionDto`
  (139-154) is the next-question wire shape. CONFIRMED: there is no phase/state
  field today — the endpoint returns `{ question: null }` and the frontend simply
  hides the input bar. (Resolved by S2: extend with a `phase` field.)
- `routes/architectConversation.ts`:
  - `next-question` endpoint (487-527) returns `{ question: next ? dto : null }`.
    Three tier query-params gate the walk. No phase signal exists. (Resolved by S2.)
  - `buildArchitectLlmClient()` (198-273) bridges `ArchitectChatMessage` ⇄ the
    gateway-wide `getLlmClient().sendChatRequest`; forwards `tools` + `toolChoice`.
    REUSABLE verbatim for a new open-phase loop.
  - `/answer` (852-903) and `/capture` (917-981) BOTH call `findEntry(decisionCode)`
    against `QUESTION_LIBRARY` and **return HTTP 404 when the code is not found**
    (870-876, 950-957). => a user-raised `adhoc.*` / `note.*` code CANNOT flow through
    the existing answer/capture routes unchanged. A new handler/endpoint is required.
    (Resolved by S3: own capture path.)
  - `prompt-ready-output` endpoint (539-559) → `buildTargetStateDecisionsPromptText`.
  - `/open` (635-759) already appends a non-question opening turn
    (`tier-confirmation`) after `open` and runs tech-stack pre-fill — precedent for
    appending new turn kinds at lifecycle points.
- `services/architectConversation/architectLlmClient.ts` — `ArchitectLlmClient`
  (`callLlmToolLoop` + `callSingleShot`, 157-163). The LLM seam to reuse.
- `services/architectConversation/llmLoopRunner.ts` — `runArchitectQuestionLoop`
  is tightly coupled to a single `QuestionLibraryEntry` (`buildSubmitAnswerToolDefinition`,
  `parseStructuredAnswer(rawValue, entry)`, `defaultsWhenUnchanged` short-circuit,
  system/user prompt built around `entry.code`/`entry.expectedAnswerShape`/`entry.choices`).
  Hard limits: 5 rounds / 30s per call / 120s wall clock (59-65). The tool-registry
  pattern (`ArchitectToolRegistryEntry`, reserved `submit_structured_answer`) is
  reusable, but the entry-centric prompt assembly + parser are NOT a clean fit for
  "propose candidate areas" / "propose options for a free-form topic" — a SIBLING
  loop (sharing the limits + tool-call mechanics + `withTimeout`/abort handling) is the
  approach. (Resolved by S3: sibling loop.)
- `services/architectConversation/architectConversationCoordinator.ts` —
  `answerQuestion` (227-372, LLM loop) + `captureDeterministicAnswer` (401-480,
  no LLM). Both are entry-centric (take a `QuestionLibraryEntry`). New sub-phase
  handlers are siblings here.
- `services/architectConversation/targetStateCapturedDecisionsWriter.ts` —
  `postCapturedDecision` (107-142). Body type `CreateCapturedDecisionRequestBody`
  (56-67) types `scopeKind` as `'architecture' | 'element'` only — adequate for the
  architecture-wide user-raised + note rows (no widening needed). `createdByTask` is
  free-form; preset rows use `architect-persona-conversation`, pre-fill uses
  `tech-stack-md-prefill`. User-raised rows use a new `createdByTask` (e.g.
  `architect-adhoc-decision`); note rows use a distinct one. (Resolved by S1 / Q2b.)
- `services/contextResolvers.ts`:
  - `buildTargetStateDecisionsPromptText` (841-895) groups by `scopeKind`
    (architecture / service / interface / element) and renders each decision as
    `` `<decisionCode>` = <answerSummary|answerValue> ``. A user-raised
    architecture-scoped decision lands in "### Architecture-wide" automatically with its
    `adhoc.*` code cited verbatim. (Resolved by Q2c: add an explicit "### Additional /
    user-raised decisions" section — or fold into scope grouping — plus a new
    "### Free-form discussion notes" section sourced from the `note.*` rows.)
  - `TargetStateDecisionsContextResolver` (763+) registered under
    `'target-state-decisions-context'` (86, 1094-1095). This is the resolver both
    PM tasks consume.
  - For sub-phase (b) NOTES: resolved by Q2b — notes ARE captured-decision rows under
    `note.<slug>`, so they DO appear via the captured-decisions plane; the new
    "### Free-form discussion notes" prompt-text section renders them. (This closes the
    "notes have no persistence home" gap.)
- `relevanceEvaluator.ts:93` — `NOT_APPLICABLE_ANSWER_VALUE = 'not_applicable'`
  (auto-skip rows). Separate from the UI opt-out sentinel. Keep universal for preset;
  suppress for user-raised (P4).

### PM consumption (confirms "feed it more, don't change the pipeline")
- `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
  and `...migration-delivery-plan.json` both list `target-state-decisions-context`
  in `contextNeeds` (and treat captured decisions as evidence the spec must cite via
  `evidenceRefs[]`). So first-class user-raised decisions are consumed the moment they
  are written; notes are consumed via the new prompt-text section with no config change.

### Frontend
- `api/architectConversationApi.ts` — `ConversationTurn` union (296-311) mirrors the
  gateway; `PendingQuestion` (487-498); `fetchNextQuestion` (510-532) returns
  `PendingQuestion | null`; `captureAnswer`/`answerQuestion`; `OPT_OUT_ANSWER_VALUE`
  = `'(not used)'` (664). New open-phase turn kinds + the phase field mirror here;
  suppress the opt-out for user-raised options.
- `components/.../ConversationMainPane.tsx` — input bar renders ONLY when
  `pendingQuestion && !pendingCascadeSummary` (227). At walk end `pendingQuestion`
  is null → input bar disappears (the current "you can close" state). The opt-out
  button ("Not applicable to this migration") is ALWAYS rendered for preset questions
  (350-358) — to be SUPPRESSED for user-raised options. `TurnView` switch (456-676)
  is where new turn kinds render (precedent: `tier-confirmation` is an interactive
  in-transcript turn, 659-671 + `TierConfirmationView` 714-805 — the pattern for the
  open-phase prompt/option-pick turn).
- `components/.../ArchitectConversationTab.tsx` — owns lifecycle; `refreshNextQuestion`
  (264-291) drives the walk (reads the new `phase`); `handleCaptureAnswer` (436-478)
  is the capture path; `CloseConversationFlow` (921-927) is the close affordance;
  "Preview prompt-ready output" modal (951-1020) already shows `fetchPromptReadyOutput`.
- `SummaryPanel.tsx` — "Preview prompt-ready output" surface (will include the new
  user-raised + notes sections once they reach the prompt text).

### AMS data plane (the decisive constraint for "how user-raised decisions are coded")
- `db/changelog/sql/155-target-state-captured-decisions.sql`:
  - `decision_code VARCHAR(255) NOT NULL` with **NO CHECK constraint / NO enum**
    (lines 36-38, 119-120) — open-ended by design so the question library can grow
    without DDL changes. => an `adhoc.*` / `note.*` code is VALID at the data plane
    with zero schema change.
  - `scope_kind VARCHAR(32) NOT NULL`, CHECK `chk_tscd_scope_invariant` allows
    `architecture / service / interface / element` (91-101). An architecture-scoped
    user-raised decision (or note) = `scopeKind:'architecture'`, no `scopeRefType`, no
    `scopeRefId` — fully valid.
- `service/TargetStateCapturedDecisionService.createDecision` (96-167) performs
  atomic supersession on `(project, target, decisionCode, scopeKind, scopeRefId)`.
  => two rows on the SAME generated code supersede each other. This makes the CODING
  scheme load-bearing: distinct topics/notes MUST get distinct codes (the
  `adhoc.<slug>` / per-note `note.<slug>` schemes), or repeated answers on one topic
  intentionally supersede.
- `CreateTargetStateCapturedDecisionRequest` (camelCase wire) — no validation beyond
  the DB; gateway is the single writer.
