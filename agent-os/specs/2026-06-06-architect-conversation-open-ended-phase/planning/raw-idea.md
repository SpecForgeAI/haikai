# Target-State Architect Conversation — open-ended LLM phase after the deterministic preset walk

## Context
The TARGET-STATE "Architect" conversation (target architecture decisions — NOT the Discovery Review Room) is currently 100% DETERMINISTIC: a fixed library of ~51 preset questions (tech/framework/library/target-state decisions) walked via `selectNextQuestion` (tier-gated A–J groups), each a static template with canned choices + a UNIVERSAL "Not applicable to this migration" opt-out. When the walk exhausts (`selectNextQuestion` → null) the input bar disappears and the user can close. A read-only trace is complete (file:line seams below). A real LLM relay is ALREADY wired into this conversation (`ArchitectLlmClient` → the shared gateway `getLlmClient()` relay) — used today ONLY to (a) parse a user's free-text answer into a structured value (`runArchitectQuestionLoop`/`callLlmToolLoop`) and (b) tech-stack pre-fill (`callSingleShot`); NOT to generate questions/options. The preset walk stays deterministic; the new phase sits AFTER it.

## Problem
The preset 51-question list will NOT be good enough for all migrations — there are migration-specific areas (e.g. batch processing, observability, caching, security, data migration) the architect should still help decide, plus free-form context valuable for backlog/spec creation that has nowhere to go today.

## The new phase
An open-ended, LLM-driven phase that begins once the deterministic preset walk is exhausted (before close), in TWO DISTINCT SUB-PHASES.

### Sub-phase (a) — user-raised topics → LLM-proposed options → FIRST-CLASS captured decisions (EXTENDS the preset decision list)
- The architect (real LLM, grounded in the loaded target model + the decisions captured so far + the migration goal) asks "we've covered the standard decisions — are there other areas you'd like to decide?" and PROACTIVELY SUGGESTS a few likely-relevant candidate areas (e.g. batch processing, observability, caching, security, data migration), then stays open.
- The user raises a topic ("I have a requirement for batches"). The LLM proposes concrete OPTIONS ([choice 1][choice 2]…) to pick from. NO "Not applicable" opt-out here — the user just raised it (the universal opt-out stays ONLY on the preset questions). The user picks an option (with a possible "something else"/free-text escape, but NOT N/A).
- The pick is captured as a FIRST-CLASS captured decision on the SAME data plane as the preset ones (flows into the PM backlog/spec generation that already consumes captured decisions), flagged as user-raised/ad-hoc with a generated decision code (not a library code).

### Sub-phase (b) — free-flow discussion → NOTES for migration planning
- The architect asks "is there any other topic you'd like to discuss?" → a genuine free-form chat (user types, LLM responds, multi-turn).
- The content is captured as NOTES (NOT first-class decisions) that ride into the prompt-ready output the backlog/spec generation consumes — potentially very valuable for migration planning.

## Confirmed product decisions (do NOT re-ask)
1. TWO distinct sub-phases (a) and (b), kept separate. (a) extends the preset decision list (user-raised topic + chosen LLM option = a first-class captured decision); (b) is free-flow → notes.
2. (a) = FIRST-CLASS captured decisions (citable by specs, same plane as preset); (b) = notes/context.
3. The architect PROACTIVELY SUGGESTS a few candidate areas (grounded in the migration) at the "other areas?" prompt, then stays open.
4. NO "Not applicable" opt-out for user-raised topics (sub-phase a). The universal opt-out stays ONLY on the preset questions.

## Technical seams (from the completed read-only trace — for the spec to verify + detail)
- Gateway `gateway/src/`:
  - `services/architectConversation/questionSequencer.ts` — `selectNextQuestion` (~67-86) returns null when the preset walk exhausts → the trigger for entering the new phase.
  - `routes/architectConversation.ts` — next-question endpoint (~487-527); `buildArchitectLlmClient` (~198-273) adapting the architect contract to the shared `getLlmClient()` relay; `/answer` (LLM loop) + `/capture` (deterministic) endpoints; prompt-ready-output endpoint (~539-559).
  - `services/architectConversation/architectLlmClient.ts` — `ArchitectLlmClient` interface (`callLlmToolLoop` + `callSingleShot`, ~157-163) — the LLM seam to REUSE for generating candidate areas / topic-options / the discussion.
  - `services/architectConversation/architectConversationCoordinator.ts` — `answerQuestion` (LLM loop per question, ~227-372) + `captureDeterministicAnswer` (~401-480) — the orchestration seam the new sub-phase handlers extend.
  - `services/architectConversation/llmLoopRunner.ts` — `runArchitectQuestionLoop` — a sibling open-ended loop pattern.
  - `services/architectConversation/turnShape.ts` — the closed turn union (15 kinds, ~28-329) — ADD new turn kinds for the open phase (open-discussion prompt, user-raised-topic, llm-option-proposal, free-form-discussion). Mirror in the frontend.
  - `services/targetStateConversationStore.ts` — appends turns verbatim (extensible transcript persistence).
  - `services/architectConversation/targetStateCapturedDecisionsWriter.ts` (`postCapturedDecision`, ~107-142) — capture user-raised decisions (first-class) with a generated decision code/scope.
  - `services/contextResolvers.ts` — `buildTargetStateDecisionsPromptText` (~841-895) — ADD an "additional / user-raised decisions" section + a "free-form discussion notes" section so the PM backlog/spec generation (`migrationShapeSpecGenerationHandler.ts`) picks them up.
  - Opt-out: `services/architectConversation/relevanceEvaluator.ts:93` (`NOT_APPLICABLE_ANSWER_VALUE`) — keep universal for preset, SUPPRESS for user-raised.
- Frontend `frontend/src/`:
  - `components/targetState/architectConversation/ArchitectConversationTab.tsx` + `ConversationMainPane.tsx` — the walk + end-of-walk (input bar hides at null); ADD the open-phase UI: a free-form chat input post-walk, render the LLM candidate-area prompt + the pickable options WITHOUT the opt-out, and the free-form discussion.
  - `api/architectConversationApi.ts` — `ConversationTurn` union + `PendingQuestion` + `captureAnswer`/`fetchNextQuestion` — mirror the new turn kinds + new-phase endpoints; `OPT_OUT_ANSWER_VALUE` ('(not used)') rendered universally in ConversationMainPane (~350) — suppress for user-raised.
  - `SummaryPanel.tsx` — "Preview prompt-ready output" now includes the user-raised + notes sections.

## Likely out of scope
Changing the preset 51-question library or the deterministic walk itself (it stays as phase 1); the PM backlog/spec generation pipeline (it already consumes the prompt-ready output — we only feed it more).

## Open design questions for the shaper to surface (genuinely open after reading the code)
- How user-raised decisions are coded/scoped so they're first-class + spec-citable.
- Whether the open phase starts strictly after the preset walk fully exhausts vs can be entered anytime.
- The LLM grounding/context for proposing RELEVANT candidate areas + options (model + captured decisions + migration goal).
- How free-form notes are structured for the prompt-ready output (per-topic vs one notes blob).
- How the user signals "done" with the open phase → close.
- Whether user-raised options support multi-select / a "something else" free-text escape.
- LLM cost/turn limits + failure handling consistent with the existing loop runner.
