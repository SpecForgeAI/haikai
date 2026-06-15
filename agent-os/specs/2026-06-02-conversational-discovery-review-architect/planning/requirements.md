# Spec Requirements: Conversational Discovery-Review "Architect" Persona (Spec 3 — capstone)

## Initial Description

Spec 3 is the FINAL + capstone spec of the discovery-review-unification program
(F → 0 → 1 → 2 → 3). Specs F, 0, 1, 2 are all BUILT + verified. Spec 3 adds the
conversational "Architect" review persona — the ONLY spec that uses the LLM. It
is a thin hybrid layer over the deterministic mechanisms already built: the LLM
(a) NARRATES facts it is handed (chunk summary, blast-radius, conflict set) and
(b) MAPS the user's natural-language intent into CONFIRMED deterministic tool
calls. Deterministic code owns ALL counts/cascades/conflicts/actions. The
conversation AUGMENTS the existing candidate/findings grid (shared decision
store, same Spec 2 write mechanisms; grid = power-user + no-LLM fallback). The
LLM is an ENHANCEMENT — Specs 0-2 work fully without it; Spec 3 degrades to the
grid if the LLM is unavailable. See `planning/raw-idea.md` for the full program
context + locked cross-cutting decisions + open questions.

## Codebase Investigation Findings (grounding for requirements)

### (A) Target-state "Architect Conversation" CHASSIS — the thing to reuse

**Verdict from reading: the chassis is cleanly reusable; only the DRIVER differs.**
Target-state is QUESTION-LIBRARY-driven (a fixed `questionSequencer`); Spec 3 is
REVIEW-AGENDA-driven (chunks of merged candidates/findings). Everything BELOW the
driver is domain-agnostic.

Frontend (`frontend/src/components/targetState/architectConversation/`):
- `ArchitectConversationTab.tsx` — the state hub. Loads a conversation envelope
  (`{ threadId, turns, currentSession, capturedDecisions }`), drives a
  next-question fetch, owns per-action busy/error state, and mirrors every write
  into a local snapshot so the side panel reflects writes WITHOUT reload. This is
  the orchestration pattern Spec 3 re-skins.
- `ConversationMainPane.tsx` — the chat-style transcript pane. Renders a closed
  turn union per-kind (`TurnView` switch), plus a deterministic CLICK-TO-ANSWER
  input bar (choice chips / multi-choice / custom text / opt-out / "Advanced"
  exception) — the NO-LLM capture path. This is the deterministic fallback UX
  baked into the chassis already.
- `CascadeSummaryControls.tsx`, `ExceptionSubDialog.tsx`, `RevisePriorAnswer.tsx`,
  `SummaryPanel.tsx`, `CloseConversationFlow.tsx` — supporting surfaces.
- `RightHandPanelShell` (`frontend/src/components/common/RightHandPanelShell.tsx`)
  — the RHS "room" chrome (persona+room header, collapse-to-tab, drag-resize,
  per-panel localStorage width). Mounted in `TargetArchitectureWorkspace.tsx`
  (lines ~957-975) behind a simple `conversationOpen` boolean toggle, with
  `personaId="architect"`, `roomName` + `collapsedLabel` as props, hosting
  `<ArchitectConversationTab/>` as children. Generic — re-usable verbatim.
- The `architect` persona ALREADY EXISTS in `frontend/src/config/personaConfig.ts`:
  `{ id: 'architect', displayName: 'Architect', color: '#7B1FA2', initials: 'AR' }`.

Gateway (`gateway/src/services/architectConversation/`):
- `architectConversationCoordinator.ts` — the per-question entry point. Two paths:
  `answerQuestion` (LLM loop) and `captureDeterministicAnswer` (NO-LLM). BOTH:
  append question+answer turns, call the orchestrator to WRITE, then return one
  shared `captured | error | skipped` union. The "LLM proposes, orchestrator
  writes" wiring lives here — the loop NEVER writes; the orchestrator does.
- `decisionCaptureOrchestrator.ts` — the ONLY writer. Owns
  capturePrimaryAnswer / acceptCascadeBatch / overrideCascade / revisePriorAnswer
  / pinException / maybeAutoSkip. Every method POSTs the deterministic data-plane
  endpoint + appends the matching transcript turn. Cascades are computed
  DETERMINISTICALLY from library data; the LLM only "proposes" them as a payload
  the orchestrator validates. **This is the exact safety property Spec 3 needs.**
- `llmLoopRunner.ts` — stateless per-question LLM driver. Reserved terminal tool
  `submit_structured_answer` + a PLUGGABLE tool registry (`tools?:
  ArchitectToolRegistryEntry[]`). Hard limits: 5 rounds/question, 30s/call,
  120s wall-clock. Tool-runtime errors are fed back to the LLM as tool results so
  it can recover in-budget. Returns a typed `LoopResult`; NEVER writes. **The
  pluggable tool registry is the seam for Spec 3's read-only tools (getReviewChunk,
  preview); the existing reserved-tool / structured-answer pattern is the model
  for confirmed mutating tools.**
- `architectLlmClient.ts` — the typed LLM boundary (`callLlmToolLoop` +
  `callSingleShot`); mocked in every test. The OpenAI/Azure tool-call wire shape.
- `questionSequencer.ts` — the SWAPPABLE driver (pure; `selectNextQuestion`
  walks the question library in group order). Spec 3 replaces THIS with an
  agenda/chunk sequencer; everything else stays.
- Routes (`gateway/src/routes/architectConversation.ts`) — thin pass-throughs.
  Includes the deterministic `/capture` (no-LLM) route and `buildArchitectLlmClient()`
  which bridges the architect LLM boundary to the gateway-default `getLlmClient()`
  (the production LLM relay). Model is whatever `getLlmClient()` resolves.

Transcript persistence (`gateway/src/services/targetStateConversationStore.ts`):
- Path: `{projectParentFolder}/threads/target-state-conversation/{targetArchitectureId}/thread.json`
  (projectId NOT in path; resolved via `fetchProjectFolder(projectId)`). Atomic
  write (.tmp + rename). Envelope `{ schemaVersion, threadId, turns }`; turns are
  opaque `unknown[]` (the turn shape is owned elsewhere). **Precedent: it scopes
  by a sub-id (targetArchitectureId) sub-folder — so a discovery-run-scoped
  variant (`threads/discovery-review/{runId}/thread.json`) is the natural mirror.**
- Turn shape (`turnShape.ts`) — a closed typed union the frontend renders per-kind.
  Spec 3 needs a NEW review-flavoured turn union (chunk-summary, preview, decision-
  applied, conflict-resolved, etc.).

### (B) Deterministic Spec 0-2 surfaces to WRAP as tools (LLM calls; never computes/mutates)

Spec 1 — review model:
- `discovery-service/src/services/reviewModel/{types.ts,buildReviewModel.ts,
  computeBlastRadiusAndAggregations.ts,scanSelection.ts}`. Pure, computed live on
  read, never persisted. `types.ts` EXPLICITLY names Spec 3 as the consumer of
  "the unified node/finding set + aggregations as its shared backbone". Rich,
  snake_case wire: nodes (with conflict_state + provenance + merge_group_key),
  typed edges, finding nodes, per-candidate `blast_radius`, full `aggregations`
  (by_candidate_type / by_review_status / by_conflict_state / by_merge_group /
  by_scan_kind + node_metrics + convenience scalars).
- Dual-run union: `scanSelection.ts` supports ≤1 code + ≤1 DB run, INCLUDING
  cross-scan logical↔physical edges, computed only when both present.
- Endpoint `GET .../runs/:runId/review-model?secondRunId=<id>` — the gateway proxy
  (`gateway/src/routes/discovery.ts` ~line 572) FORWARDS `secondRunId` (and rejects
  >2). Frontend `getReviewModel(projectId, architectureId, runId)` exists but the
  GRID deliberately omits secondRunId (single-run). **Spec 3 IS the consumer that
  uses the two-run union (the "which code and/or DB scan?" opener).**

Spec 2 — atomic cascade bulk apply + the headless resolver:
- `gateway/src/services/discovery/resolveBulkActionSet.ts` — the CANONICAL pure
  resolver. Signature: `resolveBulkActionSet(input: { seedCandidateIds, action },
  reviewModel: ReviewModelWire): ResolvedBulkActionSet`. NO fetch, NO React, NO
  I/O. Returns the full touched set (seed + cascaded candidates with edge
  provenance + linked findings) + net counts. Docstring states it was built
  headless precisely so "Spec 3's coordinator imports it directly". The frontend
  grid keeps a byte-for-byte MIRROR (`frontend/src/components/Discovery/
  resolveBulkActionSet.ts`), parity held by a contract test. **Spec 3's `preview`
  tool = this exact function.**
- Atomic apply: `POST .../runs/:runId/candidates/bulk-review-cascade` (gateway
  proxy `discovery.ts` ~line 1518 → AMS `DiscoveryCandidateController.java`).
  Request DTO `BulkReviewCascadeRequest(candidateIds: List<UUID>, findingIds:
  List<UUID>, reviewStatus: String, reviewerNotes: String)`; wire is snake_case
  (`candidate_ids`/`finding_ids`/`review_status`/`reviewer_notes`). Single
  `@Transactional` — rolls back atomically. `reviewStatus` ∈ approved/rejected/
  deferred. **Spec 3's `applyDecision` tool = this endpoint (the orchestrator
  posts it; committed rows are skipped server-side).**
- Save path: `POST .../runs/:runId/save-approved` (gateway proxy ~line 1641).
  **Spec 3's `save` tool = this existing path verbatim.**
- Findings bulk: `POST .../runs/:runId/findings/bulk-review` (AMS
  `DiscoveryFindingController.java` ~line 155; `BulkReviewDiscoveryFindingsRequest`).
  Findings share the Approve/Reject/Defer vocabulary (Spec F).

Spec 0 — conflict/provenance model + the similarity class:
- Conflict data lives in candidate `data` (JSONB): `data._conflicts[attr] = {
  value, source }[]`; `data._conflictResolutions[attr] = { chosenValue,
  chosenSource, resolvedBy, resolvedAt }`. A "live" conflict = a `_conflicts[attr]`
  with no matching `_conflictResolutions[attr]`. The review model precomputes
  `conflict_state.has_live_conflict` from the SAME predicate.
- Single-conflict resolution today: `ConflictResolutionModal.tsx` is pure UI +
  `onResolve(selections)`; the parent (`DiscoveryCandidateTable.handleResolveConflicts`)
  owns the mutation. **CRITICAL: resolution is CLIENT-SIDE-ONLY — it mutates
  `data` via `onCandidatesChange` and persists only when the candidate is later
  SAVED-BACK. NO direct AMS write fires on resolve.** This is a wiring decision
  Spec 3 must settle (mirror the client-side-then-save pattern server-side, OR
  introduce a server-side conflict-write path that does not exist today).
- The "similarity class" for bulk-resolve-by-pattern (same attribute + same
  competing source-set) is DEFINED in Spec 0 but the BULK UX ("you chose JAX-RS;
  45 similar — resolve all?") was explicitly DEFERRED to Spec 3.

The grid the conversation must stay in sync with
(`frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`): fetches the
review model on mount (`getReviewModel`), previews via the mirrored
`resolveBulkActionSet`, applies via `bulkReviewCascade`, reads aggregations for
its header counts, resolves conflicts client-side. It is embedded by
`DiscoveryRunDetailView.tsx` (the run-detail page, route
`/projects/:p/architectures/:a/discovery/runs/:runId`) alongside `<FindingsTab/>`
— **SINGLE-run scoped today** (one `runId`); the review model can span two but the
detail page does not.

## Requirements Discussion

### First Round Questions
The clarifying-question round is COMPLETE. The user accepted ALL 10 recommendations (including Q4 — the durable server-side conflict-resolution write) on 2026-06-02. The confirmed decisions are recorded authoritatively in the **## Resolved Decisions (user-confirmed 2026-06-02)** section below.

### Existing Code to Reference

**Similar features identified (reuse targets):**
- Chassis to re-skin: `frontend/src/components/targetState/architectConversation/*`
  + `frontend/src/components/common/RightHandPanelShell.tsx` +
  `gateway/src/services/architectConversation/*` +
  `gateway/src/routes/architectConversation.ts`.
- Deterministic tools to wrap: `gateway/src/services/discovery/resolveBulkActionSet.ts`
  (preview); `bulk-review-cascade` + `save-approved` + `findings/bulk-review`
  endpoints (apply/save); `GET .../review-model?secondRunId=` (getReviewChunk source);
  Spec 0 `_conflicts`/`_conflictResolutions` + `ConflictResolutionModal.tsx` +
  `DiscoveryCandidateTable.handleResolveConflicts` (resolveConflict).
- Persistence pattern: `gateway/src/services/targetStateConversationStore.ts`.

### Follow-up Questions
(none yet)

## Visual Assets

### Files Provided
No visual assets provided. (`planning/visuals/` exists but is empty — verified via
directory listing.)

## Resolved Decisions (user-confirmed 2026-06-02)

Deterministic backbone (Specs 0-2) is BUILT; Spec 3 is the thin conversational layer over it. Overriding directive: **ALWAYS hold the oracle standard** — completeness over convenience; the Architect surfaces the FULL truth (conflicts, cascades, the complete touched set), never a summary that hides richness.

1. **Parallel coordinator reusing the chassis primitives.** Build a NEW discovery-review-driven coordinator + orchestrator that REUSE the domain-agnostic primitives — `llmLoopRunner` (with its pluggable tool registry + reserved `submit_structured_answer` terminal-tool pattern), the `architectLlmClient` boundary, `RightHandPanelShell`, the per-kind transcript-turn renderer, and the "loop returns a validated intent → orchestrator is the sole writer" seam. Do NOT add a "review mode" to the target-state coordinator (hardwired to the question library + captured-decisions data plane + cascade/standards seed-maps). Same chassis, NEW driver (review-agenda sequencer replacing `questionSequencer`) + NEW writer (the review-decision orchestrator).

2. **Deterministically-ordered chunked agenda** (the agenda order/segmentation is computed by deterministic code from the Spec 1 review model, NEVER by the LLM; the LLM only NARRATES each chunk). Order: (1) live conflicts, (2) high-blast-radius interfaces/services, (3) remaining candidates by type, (4) findings by severity, (5) cross-scan logical↔physical links — scoped per scan (code run, then DB run, then cross-scan bridges last). Chunk size ~10-20 items. Never the firehose.

3. **Bounded tool surface + a HARD confirmation gate** (the oracle-safety heart). Read-only tools the LLM may call freely within budget: `selectScans`, `getReviewChunk(agendaCursor)`, `preview(seedIds, action)` (wraps the pure `resolveBulkActionSet`), `getConflictSet(candidateId)`, `getSimilarConflicts(candidateId, attr)`. Mutating actions NEVER fired by the LLM: `applyDecision`, `resolveConflict`, `resolveConflictsByPattern`, `save`. The LLM's terminal call only PROPOSES a structured mutation intent (modeled on the existing `submit_structured_answer`); the coordinator surfaces a PENDING-CONFIRMATION turn with the deterministic preview counts attached; only an explicit user confirm (natural-language "yes" re-validated, OR the deterministic click-to-confirm button) triggers the orchestrator's real write — reusing the chassis's validated-intent→writer seam so the LLM structurally CANNOT mutate state or fabricate a count. EVERY mutation is gated behind an explicit confirm turn (proportionate — trivial for a clean single Approve, fuller for a cascade); NO low-stakes fast path.

4. **Durable server-side conflict-resolution write (the wiring-gap fix).** Today conflict resolution is CLIENT-SIDE-ONLY (the grid's `handleResolveConflicts` mutates `data._conflictResolutions` in React state and persists only on save-back; no server write exists). Spec 3 adds a THIN DETERMINISTIC server-side write — a NEW focused `@PatchMapping("/{candidateId}/resolve-conflict")` on `DiscoveryCandidateController` (mirroring the existing `@PatchMapping("/{candidateId}/review")` reviewCandidate at line ~202; NOT round-tripping the whole candidate via the existing `@PutMapping("/{candidateId}")` at ~179) + its gateway proxy — that stamps `_conflictResolutions[attr]` + the canonical attribute slot + clears `_conflicts[attr]` on the candidate `data` (JSONB passthrough, NO schema change). The conversation's `resolveConflict` calls it so a conversational resolution is DURABLE IMMEDIATELY (not save-back-deferred), matching how every other conversational action persists atomically. The exact write shape MUST match the grid's `handleResolveConflicts` payload so a future grid refactor can reuse the endpoint (that grid refactor is OUT of scope here).

5. **Bulk-resolve-by-pattern** (Spec 0's deferred Q5). Offer the bulk prompt only when the similarity class (same attribute + same competing source-set) has **≥2** members; ALWAYS show the exact count + the attribute + the competing sources before applying; map "resolve all" to a single deterministic **resolve-by-SAME-SOURCE** across the class (e.g. "use the JAX-RS source for all 45 `framework` conflicts") via the Decision-4 write applied per class member — never a per-item LLM loop, never same-literal-value.

6. **Conversation ↔ grid sync = re-read-after-write.** Both surfaces re-read the Spec 1 review model after each write (shared SERVER source of truth via the Spec 2 endpoints); the conversation keeps an optimistic local snapshot for instant transcript feedback (as the target-state tab does); a lightweight refetch after each apply keeps counts authoritative. NO shared cross-page React store.

7. **Transcript persistence**: a NEW discovery-review thread store at `{projectParentFolder}/threads/discovery-review/{runId}/thread.json` (mirroring `targetStateConversationStore.ts`; projectId NOT in path; atomic .tmp+rename), keyed by the PRIMARY run id (the code run when both are selected, else whichever single run); the DB-run pairing recorded IN-SESSION (the open turn), not in the path. A NEW review-flavoured turn union (chunk-summary, preview, decision-applied, conflict-resolved, …).

8. **"Discovery Review Room"** launched from a button on the run-detail page (`DiscoveryRunDetailView`, route `/projects/:p/architectures/:a/discovery/runs/:runId`), reusing `RightHandPanelShell` verbatim (persona = the existing `architect` from `personaConfig.ts`; `roomName` = the run/service name). The scan-selection ("which code and/or DB scan?") runs as the OPENING TURN inside the room (defaulting to the current run + offering its sibling run if one exists — see housekeeping B). Net-new UI = the chunk/agenda renderer + the pending-confirm-turn surface; the shell, transcript chrome, and click-to-answer fallback are re-skinned, not rebuilt.

9. **LLM relay + degradation**: reuse the existing gateway conversation relay/model wiring as-is — `buildArchitectLlmClient()` bridging to the gateway-default `getLlmClient()` (READ the configured model; GPT 5.x is the program intent, do NOT hard-code it). On ANY LLM failure (timeout, the chassis's 5-round/30s-per-call/120s-wall limits, budget, relay down), degrade IN PLACE to the deterministic click-to-answer agenda (the no-LLM `/capture`-style path the chassis already ships) — review is never blocked and the user is NOT bounced out to the grid.

10. **Out of scope**: refactoring the grid to a shared live in-memory store (re-read-after-write suffices); making `DiscoveryRunDetailView` natively dual-run (the room handles the two-run union; the grid stays single-run); ANY new aggregation/cascade/conflict COMPUTATION (all reused from Specs 0-2 — the LLM never computes); multi-user/locking on the review thread (single-writer per run, matching the target-state thread); cross-scan/cross-run preference memory; LLM ownership of any count/cascade/decision.

### Housekeeping findings
- **(A) Conflict-write home:** `DiscoveryCandidateController` already exposes `@PatchMapping("/{candidateId}/review")` (reviewCandidate, ~line 202) and `@PutMapping("/{candidateId}")` (updateCandidate, ~line 179). Recommendation: a NEW focused `@PatchMapping("/{candidateId}/resolve-conflict")` mirroring `/review` (deterministic, single-concern) over the existing PUT — consistent with the codebase + cheaper than a full-candidate round-trip. Gateway proxy mirrors the existing per-candidate proxies in `discovery.ts`.
- **(B) Sibling-run helper:** none dedicated exists; `discovery-service` `runManager.ts`/`runs.ts` carry each run's `discovery_kind` (code XOR database). The scan-selection opener lists the project/architecture's runs by `discovery_kind` for the user to pick the code/DB pair (a thin run-listing read; add one if the existing listing is insufficient). No automatic pairing is assumed.

## Requirements Summary

Spec 3 delivers a conversational "Architect" persona for discovery review as a thin, hybrid, LLM-enhanced layer over the already-built deterministic backbone (Specs 0-2), reusing the target-state Architect Conversation chassis (a NEW review-agenda driver + a NEW review-decision orchestrator over the same `llmLoopRunner` / `architectLlmClient` / `RightHandPanelShell` / transcript primitives). The LLM ONLY narrates deterministic facts and proposes structured intents; deterministic code owns every count, cascade, conflict, and write, and every mutation is gated behind an explicit confirm turn. It opens by selecting ≤1 code + ≤1 DB run, walks a deterministically-ordered chunked agenda (conflicts-first → impact → by type → findings by severity → cross-scan links), and applies confirmed decisions through the Spec 2 atomic `bulk-review-cascade` + `save-approved` endpoints, a NEW durable `resolve-conflict` write (with bulk-resolve-by-pattern over Spec 0's similarity class), keeping the grid in sync via re-read-after-write. It augments the grid (shared decision store + write mechanisms; grid stays the power-user + no-LLM fallback) and degrades in place to the deterministic click-to-answer agenda if the LLM is unavailable. The single net-new persisted artifact is the discovery-review transcript thread; the single net-new write endpoint is `resolve-conflict`; everything else wraps existing deterministic surfaces. Honors snake_case wire + the meta-model + the oracle standard throughout.
