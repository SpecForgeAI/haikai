# Specification: Conversational Discovery-Review "Architect" Persona (Spec 3 — capstone)

## Goal
Add a conversational "Architect" review persona — a thin, hybrid, LLM-enhanced layer over the already-built deterministic discovery-review backbone (Specs 0-2) — that walks the reviewer through a deterministically-ordered agenda of merged candidates and findings, where the LLM only NARRATES facts and PROPOSES structured intents while deterministic code owns every count, cascade, conflict, and write, and every mutation is gated behind an explicit confirm. It augments (never replaces) the existing grid and degrades in place to a deterministic click-to-answer agenda if the LLM is unavailable.

## User Stories
- As a migration architect, I want to open a "Discovery Review Room" from a run and be walked chunk-by-chunk through conflicts-first, then high-impact candidates, then the rest by type, then findings by severity, then cross-scan links — so I review the FULL truth in a sane order instead of a firehose grid.
- As a reviewer, I want to say "approve all of those" or "use the JAX-RS source for every framework conflict" in plain language and always see the exact deterministic preview counts before confirming — so I trust that nothing is hidden or fabricated and no write fires without my explicit yes.
- As a power user (or whenever the LLM is down), I want the conversation to fall back to deterministic click-to-answer over the same agenda and stay in sync with the grid — so review is never blocked.

## Specific Requirements

**Review coordinator + review-decision orchestrator (parallel to the chassis; Decision 1)**
- Build a NEW discovery-review coordinator + a NEW review-decision orchestrator under `gateway/src/services/discoveryReviewConversation/`; do NOT add a "review mode" to the target-state coordinator/orchestrator (those are hardwired to the question library + captured-decisions data plane).
- Reuse the domain-agnostic chassis primitives verbatim: `llmLoopRunner.ts` (pluggable `tools` registry + reserved `submit_structured_answer` terminal-tool), `architectLlmClient.ts` (the mocked LLM boundary), and the "loop returns a validated intent → orchestrator is the SOLE writer" seam modeled on `decisionCaptureOrchestrator.ts`.
- The coordinator owns: appending transcript turns, driving the agenda sequencer, running the LLM loop for narration + intent-proposal, surfacing the pending-confirmation turn, and — only on explicit confirm — invoking the orchestrator to write.
- The orchestrator is the ONLY thing that mutates state; it POSTs the Spec 2 endpoints (apply/save), the NEW resolve-conflict write, and bulk-resolve-by-pattern, and appends the matching transcript turn after each write. The LLM loop NEVER writes.
- Expose both an LLM path and a deterministic NO-LLM `captureDeterministicAnswer`-style path returning ONE shared `applied | error | skipped` union (mirror `architectConversationCoordinator.ts`).

**Deterministically-ordered chunked agenda sequencer (replaces `questionSequencer`; Decision 2)**
- A NEW pure agenda/chunk sequencer (the swappable driver) computes the agenda order and segmentation from Spec 1's review model; the LLM NEVER orders or segments — it only narrates the chunk it is handed.
- Order: (1) live conflicts, (2) high-blast-radius interfaces/services, (3) remaining candidates by type, (4) findings by severity, (5) cross-scan logical↔physical links — scoped per scan (code run first, then DB run, then cross-scan bridges last).
- Chunk size ~10-20 items; `getReviewChunk(agendaCursor)` returns the next chunk plus a cursor; never the firehose.
- "Live conflict" reuses Spec 1's precomputed `conflict_state.has_live_conflict` (a `_conflicts[attr]` with no matching `_conflictResolutions[attr]`); "high blast radius" reuses per-candidate `blast_radius`; severity/type buckets reuse the Spec 1 `aggregations`. No new computation.
- The sequencer is pure (no fetch/LLM/clock) so its ordering is unit-testable in isolation.

**Bounded tool surface + HARD confirmation gate (the oracle-safety heart; Decision 3)**
- Read-only tools the LLM may call freely within budget: `selectScans`, `getReviewChunk(agendaCursor)`, `preview(seedIds, action)` (wraps the pure `gateway/src/services/discovery/resolveBulkActionSet.ts` directly), `getConflictSet(candidateId)`, `getSimilarConflicts(candidateId, attr)`.
- Mutating actions the LLM may NEVER fire directly: `applyDecision`, `resolveConflict`, `resolveConflictsByPattern`, `save`.
- The LLM's terminal call only PROPOSES a structured mutation intent (modeled on `submit_structured_answer`); the coordinator then surfaces a PENDING-CONFIRMATION turn carrying the deterministic preview counts (from `preview` / the new conflict reads — never an LLM-asserted number).
- Only an explicit user confirm triggers the orchestrator's real write: a natural-language "yes" that is RE-VALIDATED against the still-pending intent, OR the deterministic click-to-confirm button on the pending turn. Reuse the validated-intent→writer seam so the LLM structurally CANNOT mutate state or fabricate a count.
- EVERY mutation is gated (proportionate: trivial for a clean single Approve, fuller for a cascade); there is NO low-stakes fast path that skips confirmation.

**Durable server-side conflict-resolution write + gateway proxy (Decision 4 / Housekeeping A)**
- Add a NEW focused `@PatchMapping("/{candidateId}/resolve-conflict")` on `architecture-model-service/.../controller/DiscoveryCandidateController.java`, mirroring the existing `@PatchMapping("/{candidateId}/review")` (~line 202) — NOT round-tripping the whole candidate via `@PutMapping("/{candidateId}")` (~line 179).
- It stamps `data._conflictResolutions[attr] = { chosen_value, chosen_source, resolved_by, resolved_at }`, sets the canonical slot `data[attr] = chosen_value`, and clears `data._conflicts[attr]` — JSONB passthrough on candidate `data`, NO schema/Liquibase change.
- The write shape MUST match the grid's `handleResolveConflicts` (`frontend/.../DiscoveryCandidateTable.tsx` ~line 960: `chosenValue`/`chosenSource`/`resolvedBy`/`resolvedAt`) so a future grid refactor can reuse the endpoint; AMS wire is snake_case per the global default (`chosen_value`, `chosen_source`, `resolved_by`, `resolved_at`).
- Add a gateway proxy mirroring the existing per-candidate proxy at `gateway/src/routes/discovery.ts` (~line 1542, the `/{candidateId}/review` PATCH). The orchestrator's `resolveConflict` calls it so a conversational resolution is DURABLE IMMEDIATELY (not save-back-deferred).

**Bulk-resolve-by-pattern over Spec 0's similarity class (Decision 5)**
- Offer the bulk prompt ONLY when the similarity class (same attribute + same competing source-set) has ≥2 members; below 2, resolve singly.
- ALWAYS surface the exact count + the attribute + the competing sources before applying (e.g. "45 `framework` conflicts compete between JAX-RS and Spring MVC — resolve all to JAX-RS?").
- Map "resolve all" to a single deterministic resolve-by-SAME-SOURCE across the class (choose a source, applied per member via the Decision-4 write) — NEVER a per-item LLM loop, NEVER same-literal-value.
- The class membership comes from the deterministic `getSimilarConflicts(candidateId, attr)` read; the LLM only narrates the offer.

**Discovery-review thread store + new turn union (Decision 7)**
- New thread store at `{projectParentFolder}/threads/discovery-review/{runId}/thread.json`, mirroring `gateway/src/services/targetStateConversationStore.ts` (projectId NOT in path; resolved via `fetchProjectFolder`; atomic .tmp+rename; opaque `unknown[]` turns; default-envelope on ENOENT).
- Keyed by the PRIMARY run id (the code run when both selected, else whichever single run); the DB-run pairing is recorded IN-SESSION on the open turn, not in the path. Single-writer per run (no locking).
- A NEW review-flavoured closed turn union (modeled on `turnShape.ts`): at least `open` (with the selected scan pair), `chunk-summary`, `preview`, `pending-confirmation`, `decision-applied`, `conflict-resolved`, `bulk-pattern-resolved`, `saved`, `error`, plus the deterministic click-to-answer turns. The frontend renders per-kind.

**Discovery Review Room UI + scan-selection opener (Decision 8 / Housekeeping B)**
- Launch from a button on `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx` (route `/projects/:p/architectures/:a/discovery/runs/:runId`), reusing `frontend/src/components/common/RightHandPanelShell.tsx` verbatim (`personaId="architect"` — the existing `architect` in `personaConfig.ts`; `roomName` = the run/service name).
- Re-skin (do NOT rebuild) the per-kind transcript renderer from `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx` and its click-to-answer input bar; net-new UI is only the chunk/agenda renderer + the pending-confirmation surface (with the click-to-confirm button and the deterministic counts).
- The scan-selection ("which code and/or DB scan?") runs as the OPENING TURN inside the room: list the project/architecture's runs by `discovery_kind` (code XOR database) for the user to pick a ≤1-code + ≤1-DB pair, defaulting to the current run. No dedicated sibling-run helper exists, so add a thin run-listing read if the existing listing is insufficient; no automatic pairing.
- On both selected, the room consumes the two-run union by requesting `getReviewModel(... , secondRunId)`; the grid stays single-run.

**Conversation ↔ grid sync via re-read-after-write (Decision 6)**
- Both surfaces re-read the Spec 1 review model after each write (shared SERVER source of truth); the conversation keeps an optimistic local snapshot for instant transcript feedback (as the target-state tab does), then a lightweight refetch after each apply keeps counts authoritative.
- NO shared cross-page React store; no native dual-run grid.

**LLM relay reuse + degrade-in-place (Decision 9)**
- Reuse the existing relay wiring as-is: `buildArchitectLlmClient()` bridging to the gateway-default `getLlmClient()` (READ the configured model — GPT 5.x is intent; do NOT hard-code it). Honor the chassis hard limits (5 rounds/intent, 30s/call, 120s wall-clock).
- On ANY LLM failure (timeout, budget/round/wall-clock exhaustion, relay down), degrade IN PLACE to the deterministic click-to-answer agenda (the no-LLM `/capture`-style path the chassis already ships). Review is never blocked and the user is NOT bounced out to the grid.

**Architect review persona prompt**
- A NEW system prompt for the review persona instructing the LLM to: narrate the deterministic chunk/conflict/preview facts it is handed WITHOUT inventing or recomputing counts/cascades; parse the user's intent into a structured proposal via the reserved terminal tool; and use the read-only tools to fetch context within budget. The prompt MUST state that the LLM cannot apply changes — only propose them for explicit confirmation.
- Reuse the prompt-assembly + tool-definition pattern from `llmLoopRunner.ts`; the prompt is forwarded verbatim (never paraphrased).

## Existing Code to Leverage

**Architect Conversation chassis (`gateway/src/services/architectConversation/*` + `frontend/src/components/targetState/architectConversation/*`)**
- `llmLoopRunner.ts`: reuse the pluggable `tools` registry + reserved `submit_structured_answer` terminal-tool + the 5-round/30s/120s limits + tool-error-fed-back-to-LLM recovery; it NEVER writes — perfect for read-only tools + the propose-intent terminal call.
- `architectConversationCoordinator.ts`: re-skin the "append turns → run loop → orchestrator writes → return shared union" pattern and its deterministic NO-LLM `captureDeterministicAnswer` twin (the degradation path).
- `decisionCaptureOrchestrator.ts`: the sole-writer seam — the orchestrator validates the proposed intent, POSTs the deterministic endpoint, and appends the turn; replicate this for review decisions.
- `architectLlmClient.ts` + `buildArchitectLlmClient()` in `gateway/src/routes/architectConversation.ts`: reuse the mocked LLM boundary and the `getLlmClient()` relay bridge verbatim.

**Deterministic Spec 0-2 surfaces to wrap as tools/writes (LLM calls; never computes)**
- `gateway/src/services/discovery/resolveBulkActionSet.ts`: the canonical PURE resolver — the `preview` tool imports it directly (docstring already names "Spec 3's coordinator imports it directly"); returns the full touched set + net counts.
- `gateway/src/routes/discovery.ts`: `bulk-review-cascade` POST (~1518 → AMS `@PostMapping("/bulk-review-cascade")` line 150) = `applyDecision`; `save-approved` POST (~1641) = `save`; `findings/bulk-review` POST (~2842) = findings apply; `review-model` GET with `secondRunId` (~572) = `getReviewChunk` source. The new `resolve-conflict` proxy mirrors the `/{candidateId}/review` PATCH (~1542).
- Spec 1 review model (`discovery-service/src/services/reviewModel/{buildReviewModel,scanSelection}.ts`): the shared snake_case backbone (nodes + `conflict_state` + `blast_radius` + `aggregations`); `scanSelection.ts` already supports the ≤1-code + ≤1-DB union the room consumes.
- Spec 0 conflict model: `frontend/.../ConflictResolutionModal.tsx` (`onResolve(selections)` UI) + `DiscoveryCandidateTable.handleResolveConflicts` (~960) define the exact `_conflicts`/`_conflictResolutions` payload the new write must match.

**Persistence + shell + persona primitives**
- `gateway/src/services/targetStateConversationStore.ts`: the mirror for the new `threads/discovery-review/{runId}/thread.json` store (sub-id sub-folder precedent, atomic write, opaque turns).
- `frontend/src/components/common/RightHandPanelShell.tsx`: the RHS room chrome reused verbatim; the `architect` persona already exists in `frontend/src/config/personaConfig.ts`.
- `gateway/src/services/architectConversation/turnShape.ts`: the closed-union turn-shape pattern the new review turn union mirrors.

## Test Plan

**Deterministic agenda ordering (pure)**
- Given a fixture review model, assert the sequencer emits chunks in the exact order: live conflicts → high-blast-radius interfaces/services → remaining by type → findings by severity → cross-scan links, scoped code-run → DB-run → cross-scan bridges last, with chunk size ~10-20 and a correct cursor. Assert the LLM is NOT consulted for ordering.

**Read-only vs proposed-mutating tools + the confirmation gate (oracle-safety heart)**
- Reuse the chassis test pattern mocking `architectLlmClient`: prove `selectScans`/`getReviewChunk`/`preview`/`getConflictSet`/`getSimilarConflicts` are callable freely within budget and never write.
- Prove the LLM cannot write: a mocked LLM that proposes an `applyDecision` intent produces ONLY a pending-confirmation turn (with deterministic preview counts from `resolveBulkActionSet`), and NO mutation endpoint is called until an explicit confirm.
- Prove confirm paths: a re-validated NL "yes" AND the click-to-confirm button each trigger exactly one orchestrator write; a "no"/changed-intent cancels with no write. Assert preview counts come from the deterministic resolver, not the LLM.

**Durable resolve-conflict write matching the grid payload**
- AMS test (`DiscoveryCandidateControllerTest` / a focused service test): `PATCH /{candidateId}/resolve-conflict` stamps `data._conflictResolutions[attr]` (snake_case `chosen_value`/`chosen_source`/`resolved_by`/`resolved_at`), sets `data[attr]`, clears `data._conflicts[attr]`, and persists immediately (no full-candidate round-trip). Assert the payload shape matches the grid's `handleResolveConflicts`.
- Gateway proxy test (mirror `discovery-findings-bulk-review-proxy.test.ts`): the new proxy forwards to the correct AMS path and round-trips the snake_case body.

**Bulk-resolve-by-pattern (≥2 / same-source)**
- A similarity class with ≥2 members offers the bulk prompt with the exact count + attribute + competing sources; "resolve all" issues one resolve-by-SAME-SOURCE per member via the Decision-4 write (never per-item LLM, never same-literal). A class of 1 does NOT offer the bulk prompt.

**Thread persistence**
- The discovery-review store writes/reads `threads/discovery-review/{runId}/thread.json` keyed by the primary run id; ENOENT returns the default envelope; atomic write succeeds; the in-session DB-run pairing is recorded on the open turn, not the path. Include `beforeEach` cleanup of the shared `threads/` dir.

**Degradation to click-to-answer**
- With a mocked LLM that times out / exhausts the round budget / fails, the coordinator degrades IN PLACE to the deterministic agenda (NO-LLM capture path), still surfaces the chunk + the confirmation gate, applies via the same orchestrator, and never bounces to the grid.

**Re-read-after-write sync**
- After an `applyDecision`/`resolveConflict`/`save` confirm, the conversation refetches the review model (optimistic snapshot first, then authoritative refetch); assert the post-write counts reflect the server, with no shared cross-page store.

## Out of Scope
- Refactoring the grid to a shared live in-memory store (re-read-after-write suffices).
- Making `DiscoveryRunDetailView` natively dual-run (the room handles the two-run union; the grid stays single-run).
- ANY new aggregation / cascade / conflict COMPUTATION — all reused from Specs 0-2; the LLM never computes.
- LLM ownership of any count, cascade, or decision (the LLM only narrates + proposes; deterministic code owns all writes/counts).
- Multi-user / locking on the review thread (single-writer per run, matching the target-state thread).
- Cross-scan / cross-run preference memory.
- A low-stakes fast path that skips the confirmation gate for any mutation.
- A grid refactor to consume the new `resolve-conflict` endpoint (the endpoint is built to be reusable, but rewiring the grid is not this spec).
- Editing `discovery-service/src/**` during an active discovery run (implementer note; this spec mostly touches gateway/AMS/frontend).
- Any AMS schema / Liquibase changeset change (the conflict write is JSONB passthrough on existing `data`).
