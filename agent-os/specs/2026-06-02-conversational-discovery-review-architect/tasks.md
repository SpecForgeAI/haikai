# Task Breakdown: Conversational Discovery-Review "Architect" Persona (Spec 3 — capstone)

## Overview
Total Tasks: 5 task groups

Spec 3 is the FINAL/capstone spec of the discovery-review-unification program. It adds the
conversational "Architect" review persona — a thin HYBRID, LLM-enhanced layer that WRAPS the
already-built deterministic backbone (Specs 0-2) and NEVER re-computes it. It is the ONLY spec
that uses the LLM.

### OVERRIDING DIRECTIVE — the oracle standard (read before every task)
Deterministic code owns ALL counts, cascades, conflicts, and writes. The LLM ONLY narrates the
facts it is handed and PROPOSES structured intents. EVERY mutation is gated behind an explicit
confirm turn. The LLM (mocked `architectLlmClient`) MUST be structurally incapable of:
- causing any state mutation without an explicit user confirm, and
- asserting/fabricating any count or cascade (all counts come from the deterministic backbone).
This is the highest-stakes safety property of the whole spec — its proof tests are non-negotiable
and NO stubs are permitted on the gate path.

### CRITICAL cautions (embed in every relevant task)
- **Confirmation gate / oracle standard**: tests must PROVE the mocked LLM can never write without
  an explicit confirm, and never supplies a count/cascade. Preview counts always come from the
  deterministic resolver (`resolveBulkActionSet.ts`) or the deterministic conflict reads.
- **NEVER edit an applied Liquibase changeset; NO schema change at all.** The conflict-resolution
  write is a JSONB mutation on the EXISTING candidate `data` column (passthrough only). If a new
  changeset ever seems needed, STOP — it is out of scope (`feedback_liquibase_immutable_changesets`).
- **No git operations** — stop at code + verification. The user owns all commits/branches/pushes
  (`feedback_no_git_operations`).
- **REUSE the chassis primitives; do NOT rebuild them.** Reuse verbatim: `llmLoopRunner.ts` (with
  its pluggable tool registry + reserved `submit_structured_answer`), `architectLlmClient.ts` +
  `buildArchitectLlmClient()` -> `getLlmClient()`, the "append -> loop -> sole-writer orchestrator"
  seam from `decisionCaptureOrchestrator.ts`, `RightHandPanelShell.tsx`, the per-kind transcript
  renderer in `ConversationMainPane.tsx`, the `targetStateConversationStore.ts` thread-store
  pattern, the `turnShape.ts` closed-union pattern, and the existing `architect` persona in
  `personaConfig.ts`. Build a PARALLEL review coordinator/orchestrator/sequencer under a NEW
  `gateway/src/services/discoveryReviewConversation/` directory — NOT a "review mode" inside the
  target-state coordinator (it is hardwired to the question library + captured-decisions data plane).
- **AMS speaks snake_case at the wire by default** (global `SNAKE_CASE` Jackson strategy) — so the
  `resolve-conflict` REQUEST/RESPONSE DTO top-level fields are snake_case. **CRITICAL EXCEPTION:** the
  keys stamped INSIDE the candidate `data` JSONB at `_conflictResolutions[attr]` MUST stay **camelCase**
  (`chosenValue` / `chosenSource` / `resolvedBy` / `resolvedAt`) to match Spec 0 + the frontend reader
  (`DiscoveryCandidateTable.tsx:995-997` `handleResolveConflicts` + the conflicts-test fixtures). `data`
  is a JSONB passthrough MAP — Jackson does NOT snake_case map keys — so snake_case there would SILENTLY
  break the grid/conversation conflict reader. Honor the meta-model: `*_points` polymorphic wrappers are
  backend auto-managed and are NEVER user-acted.
- **(Minor)** this spec mostly touches gateway/AMS/frontend. If ANY `discovery-service/src/**` edit
  arises, confirm no active discovery run first (`feedback_no_src_edits_during_run`).

### Confirmed code anchors (verified against the working tree)
- AMS candidate controller: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryCandidateController.java`
  (class at line 41; class-level `@RequestMapping(".../discovery/runs/{runId}/candidates")` at line 38).
  NOTE: it lives directly under `controller/`, NOT under a `controller/discovery/` subpackage.
  - `@PatchMapping("/{candidateId}/review")` -> `reviewCandidate(...)` at lines 202-216 (the focused mirror target).
  - `@PutMapping("/{candidateId}")` -> `updateCandidate(...)` at lines 179-190 (the full round-trip to AVOID).
- AMS candidate service: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateService.java`
  (`reviewCandidateInArchitecture(...)` is the service mirror target).
- Grid resolve payload: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
  `handleResolveConflicts(candidateId, selections)` at line 960; in-memory payload keys are
  `chosenValue` / `chosenSource` / `resolvedBy` / `resolvedAt` (sets canonical `data[attr]`,
  stamps `data._conflictResolutions[attr]`, clears `data._conflicts[attr]`).
- Gateway candidate `/review` PATCH proxy: `gateway/src/routes/discovery.ts` at line 1542
  (the per-candidate proxy to mirror). `bulk-review-cascade` POST proxy at line 1517.
- Pure resolver: `gateway/src/services/discovery/resolveBulkActionSet.ts` (the `preview` tool imports
  it directly). Wire types: `gateway/src/services/discovery/reviewModelWire.ts`.
- Chassis (gateway): `gateway/src/services/architectConversation/{llmLoopRunner,architectLlmClient,decisionCaptureOrchestrator,architectConversationCoordinator,questionSequencer,turnShape}.ts`;
  routes + `buildArchitectLlmClient()` in `gateway/src/routes/architectConversation.ts`.
- Chassis (frontend): `frontend/src/components/targetState/architectConversation/{ArchitectConversationTab,ConversationMainPane}.tsx`;
  shell `frontend/src/components/common/RightHandPanelShell.tsx`; persona `frontend/src/config/personaConfig.ts`.
- Thread store mirror: `gateway/src/services/targetStateConversationStore.ts`.
- Run-detail launch host: `frontend/src/components/Discovery/DiscoveryRunDetailView.tsx`
  (route `/projects/:p/architectures/:a/discovery/runs/:runId`).
- Proxy test mirror: `gateway/src/__tests__/discovery-findings-bulk-review-proxy.test.ts`.

### Test commands (scoped — never run the whole suite at a group boundary)
- AMS (Maven, scoped): `mvn -Dtest=<ClassName> test` (run from `architecture-model-service/`).
- Gateway (jest, scoped): `npx jest <path-or-pattern>` (run from `gateway/`).
- Frontend (vitest, scoped): `npx vitest run <files>` (run from `frontend/`).

## Task List

### Architecture Model Service (Java / Maven)

#### Task Group 1: Durable server-side conflict-resolution write (foundational, independent)
**Dependencies:** None

Today conflict resolution is CLIENT-SIDE-ONLY (the grid mutates `data` in React state and persists
only on save-back; no server write exists). This group adds the THIN DETERMINISTIC server-side write
that the conversation's `resolveConflict` calls so a conversational resolution is DURABLE IMMEDIATELY.
JSONB passthrough on the existing candidate `data` column — NO schema/Liquibase change.

- [x] 1.0 Complete the AMS `resolve-conflict` write
  - [x] 1.1 Write 2-8 focused JUnit tests (a focused service test, e.g.
        `DiscoveryCandidateResolveConflictTest`, mirroring the existing review-action test style)
    - Limit to 2-8 highly focused tests maximum
    - Prove: resolve stamps `data._conflictResolutions[attr]` with **camelCase** keys
      (`chosenValue` / `chosenSource` / `resolvedBy` / `resolvedAt`) — matching Spec 0 + the frontend
      reader (`DiscoveryCandidateTable.tsx:995-997`); `data` is a JSONB passthrough map (Jackson does
      NOT snake_case map keys), so snake_case here would silently break the grid
    - Prove: the canonical slot `data[attr]` is set to the chosen value
    - Prove: `data._conflicts[attr]` is cleared for the resolved attribute
    - Prove: the write persists IMMEDIATELY (no full-candidate `@PutMapping` round-trip)
    - Add a `committed`-row guard test IF the existing review path guards committed rows (mirror it)
    - Skip exhaustive coverage of every attribute/edge case
  - [x] 1.2 Add `@PatchMapping("/{candidateId}/resolve-conflict")` to
        `controller/DiscoveryCandidateController.java`
    - Mirror the existing `@PatchMapping("/{candidateId}/review")` (line 202) — focused, single-concern
    - Do NOT round-trip the whole candidate via `@PutMapping("/{candidateId}")` (line 179)
    - Accept a snake_case request DTO (e.g. `ResolveDiscoveryConflictRequest` with `attr`,
      `chosen_value`, `chosen_source`, `resolved_by`, `resolved_at`; resolve-by-pattern is driven by
      the gateway issuing one call per class member, so the endpoint stays single-attribute)
    - Return the updated `DiscoveryCandidateDto` (consistent with `reviewCandidate`)
  - [x] 1.3 Add the service method to `service/DiscoveryCandidateService.java`
    - Mirror `reviewCandidateInArchitecture(...)`
    - Mutate ONLY the candidate `data` map: set `data[attr]` = the chosen value, stamp
      `data._conflictResolutions[attr] = { chosenValue, chosenSource, resolvedBy, resolvedAt }`
      (camelCase keys — match the frontend `handleResolveConflicts`; server sets `resolvedAt`),
      remove `data._conflicts[attr]`
    - Persist via the existing repository save path; NO schema change, NO Liquibase changeset
    - Honor the `committed`-row guard if the review path does (do not mutate a committed candidate)
  - [x] 1.4 Confirm snake_case wire serialization
    - The request/response DTO TOP-LEVEL fields follow the AMS global `SNAKE_CASE` default (no
      `@CamelCaseWire`). But the nested `_conflictResolutions[attr]` keys INSIDE the `data` JSONB stay
      camelCase (`chosenValue`/`chosenSource`/`resolvedBy`/`resolvedAt`) — they are map values Jackson
      serializes verbatim, and the frontend reads camelCase. Verify a round-trip preserves camelCase
      inside `data`.
    - Confirm the write shape is reusable by a future grid refactor (matches the grid's
      `handleResolveConflicts` semantics; that refactor is OUT of scope here)
  - [x] 1.5 Ensure AMS layer tests pass
    - Run ONLY the 2-8 tests from 1.1: `mvn -Dtest=DiscoveryCandidateResolveConflictTest test`
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `PATCH /{candidateId}/resolve-conflict` stamps `_conflictResolutions[attr]` (camelCase keys inside
  `data`, matching the frontend), sets the canonical `data[attr]`, clears `_conflicts[attr]`, and
  persists immediately.
- NO full-candidate round-trip; NO schema/Liquibase change.
- Wire is snake_case; the write shape matches the grid's `handleResolveConflicts` payload semantics.

### Gateway — Review Engine (TypeScript / jest)

#### Task Group 2: Discovery-review coordinator, orchestrator, sequencer, tools + the HARD confirmation gate (the core)
**Dependencies:** Task Group 1 (for the `resolveConflict` write contract — orchestrator-side it calls the G3 proxy)

Build a PARALLEL review engine under a NEW `gateway/src/services/discoveryReviewConversation/`. REUSE
the chassis primitives verbatim; do NOT add a mode to the target-state coordinator. The confirmation
gate is the oracle-safety heart: the LLM's terminal call only PROPOSES a structured intent; the
coordinator surfaces a PENDING-CONFIRMATION turn carrying DETERMINISTIC preview counts; only an
explicit user confirm triggers the orchestrator's write. EVERY mutation is gated — there is NO
low-stakes fast path.

- [x] 2.0 Complete the gateway review engine
  - [x] 2.1 Write 2-8 focused jest tests (mock `architectLlmClient`), including the oracle-critical proof
    - Limit to 2-8 highly focused tests maximum
    - THE oracle-critical test: a mocked LLM proposing an `applyDecision` intent produces ONLY a
      pending-confirmation turn (with preview counts from `resolveBulkActionSet`) and calls NO
      mutation endpoint until an explicit confirm — i.e. the LLM CANNOT cause a write
    - Prove preview counts come from the deterministic resolver, NOT the LLM
    - Prove a re-validated NL "yes" AND the click-to-confirm path each trigger EXACTLY ONE
      orchestrator write; a "no"/changed-intent cancels with NO write
    - Prove read-only tools (`selectScans` / `getReviewChunk` / `preview` / `getConflictSet` /
      `getSimilarConflicts`) are callable within budget and never write
    - Skip exhaustive coverage of every tool/branch (deeper cross-stack proofs live in Group 5)
  - [x] 2.2 Build the deterministic agenda/chunk sequencer (replaces `questionSequencer.ts`; PURE)
    - Pure: no fetch / no LLM / no clock — ordering is unit-testable in isolation
    - Order computed by CODE, NEVER the LLM: (1) live conflicts, (2) high-blast-radius
      interfaces/services, (3) remaining candidates by type, (4) findings by severity,
      (5) cross-scan logical<->physical links
    - Scoped per scan: code run first, then DB run, then cross-scan bridges LAST
    - "Live conflict" reuses Spec 1's precomputed `conflict_state.has_live_conflict`
      (a `_conflicts[attr]` with no matching `_conflictResolutions[attr]`); "high blast radius"
      reuses per-candidate `blast_radius`; severity/type buckets reuse Spec 1 `aggregations`
    - NO new computation — read the Spec 1 review model only
    - `getReviewChunk(agendaCursor)` returns the next ~10-20-item chunk + an advancing cursor;
      never the firehose
  - [x] 2.3 Build the read-only tool registry (the LLM may call freely within budget; none write)
    - `selectScans` (resolve the chosen <=1-code + <=1-DB run pair)
    - `getReviewChunk(agendaCursor)` (drives the sequencer in 2.2)
    - `preview(seedIds, action)` -> imports the PURE `gateway/src/services/discovery/resolveBulkActionSet.ts`
      DIRECTLY (returns the full touched set + net counts)
    - `getConflictSet(candidateId)` (the candidate's live `_conflicts`)
    - `getSimilarConflicts(candidateId, attr)` (the Spec 0 similarity class: same attribute + same
      competing source-set)
    - Register these in the chassis `llmLoopRunner` pluggable `tools` registry; tool-runtime errors
      are fed back to the LLM (existing chassis recovery behavior)
  - [x] 2.4 Build the review-decision orchestrator (the SOLE writer; mirror `decisionCaptureOrchestrator.ts`)
    - `applyDecision` -> POST `bulk-review-cascade` (gateway proxy, line 1517 -> AMS); findings apply
      via `findings/bulk-review`
    - `resolveConflict` -> the NEW G1 `resolve-conflict` write via the G3 gateway proxy
    - `resolveConflictsByPattern` -> one deterministic resolve-by-SAME-SOURCE per similarity-class
      member via the Decision-4 write (NEVER a per-item LLM loop, NEVER same-literal-value)
    - `save` -> POST `save-approved` (gateway proxy, line 1641)
    - After each write, append the matching transcript turn; the LLM loop NEVER writes
  - [x] 2.5 Build the review coordinator + the HARD confirmation gate (mirror `architectConversationCoordinator.ts`)
    - Owns: appending transcript turns, driving the sequencer, running the LLM loop for narration +
      intent-proposal, surfacing the pending-confirmation turn, and — only on explicit confirm —
      invoking the orchestrator to write
    - The LLM's terminal call (modeled on the reserved `submit_structured_answer`) only PROPOSES a
      structured mutation intent; the coordinator attaches DETERMINISTIC preview counts (from
      `preview` / the conflict reads) to a PENDING-CONFIRMATION turn — never an LLM-asserted number
    - Explicit confirm = a re-validated NL "yes" against the STILL-PENDING intent OR the deterministic
      click-to-confirm button; reuse the validated-intent->writer seam so the LLM structurally CANNOT
      mutate state or fabricate a count
    - EVERY mutation gated (proportionate: trivial for a clean single Approve, fuller for a cascade);
      NO low-stakes fast path that skips confirmation
    - Bulk-resolve-by-pattern offered ONLY when the similarity class has >=2 members (below 2, resolve
      singly); ALWAYS surface the exact count + attribute + competing sources before applying
    - Expose BOTH an LLM path and a deterministic NO-LLM `captureDeterministicAnswer`-style path
      returning ONE shared `applied | error | skipped` union (mirror the chassis twin)
  - [x] 2.6 Ensure gateway review-engine tests pass
    - Run ONLY the 2-8 tests from 2.1 (jest scoped to the new engine test file)
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- The agenda order/segmentation is computed by deterministic code (the LLM is never consulted for ordering).
- Read-only tools are callable within budget and never write.
- The LLM CANNOT cause a write without an explicit confirm; preview counts come from the deterministic
  resolver, not the LLM.
- A re-validated NL "yes" and the click-to-confirm path each fire exactly one write; "no"/changed-intent
  fires none.
- Bulk-resolve-by-pattern is same-source per class member, offered only for classes of >=2.

### Gateway — Persistence, Routes, Proxy, Prompt (TypeScript / jest)

#### Task Group 3: Discovery-review thread store + turn union + routes + resolve-conflict proxy + persona prompt
**Dependencies:** Task Group 1 (AMS endpoint to proxy) + Task Group 2 (coordinator/orchestrator + turn shapes)

- [x] 3.0 Complete the gateway persistence, routes, proxy, and prompt
  - [x] 3.1 Write 2-8 focused jest tests
    - Limit to 2-8 highly focused tests maximum
    - Thread store: writes/reads `threads/discovery-review/{runId}/thread.json` keyed by the PRIMARY
      run id; ENOENT returns the default envelope; atomic .tmp+rename succeeds; the in-session DB-run
      pairing is recorded on the OPEN turn (not in the path)
    - Resolve-conflict proxy (mirror `discovery-findings-bulk-review-proxy.test.ts`): forwards to the
      correct AMS path and round-trips the snake_case body
    - MUST include `beforeEach` cleanup of the shared `threads/` dir (projectId is NOT in the path, so
      runs can collide on the shared folder) — `await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true })`
    - Skip exhaustive route coverage
  - [x] 3.2 Build the discovery-review thread store (mirror `targetStateConversationStore.ts`)
    - Path `{projectParentFolder}/threads/discovery-review/{runId}/thread.json`; projectId NOT in path;
      resolve the parent folder via `fetchProjectFolder(projectId)`
    - Atomic write (.tmp + rename); opaque `unknown[]` turns; default envelope on ENOENT;
      single-writer per run (no locking)
    - Keyed by the PRIMARY run id (the code run when both selected, else whichever single run)
  - [x] 3.3 Define the NEW review-flavoured closed turn union (mirror `turnShape.ts`)
    - At least: `open` (carrying the selected scan pair), `chunk-summary`, `preview`,
      `pending-confirmation`, `decision-applied`, `conflict-resolved`, `bulk-pattern-resolved`,
      `saved`, `error`, plus the deterministic click-to-answer turns
    - The frontend renders per-kind (Group 4)
  - [x] 3.4 Add the conversation routes (thin pass-throughs)
    - An entry/answer route (LLM path) wiring `buildArchitectLlmClient()` -> `getLlmClient()`
      (READ the configured model; do NOT hard-code GPT 5.x)
    - A deterministic confirm/capture route mirroring the chassis `/capture` (no-LLM) route — drives
      the click-to-confirm + click-to-answer paths through the SAME orchestrator
    - A run-listing read for the scan-selection opener IF the existing listing is insufficient (runs by
      `discovery_kind`, code XOR database; no automatic pairing)
  - [x] 3.5 Add the gateway proxy for the new AMS `resolve-conflict` endpoint
    - Mirror the existing per-candidate `/review` PATCH proxy in `discovery.ts` (line 1542)
    - Pure passthrough: status + snake_case body, `requestId` logging, 503 on AMS network error;
      register alongside the other candidate-action proxies
  - [x] 3.6 Author the Architect REVIEW persona prompt asset under `gateway/src/config/prompts/`
    - Instruct the LLM to: narrate the deterministic chunk/conflict/preview facts it is handed WITHOUT
      inventing or recomputing counts/cascades; parse the user's intent into a structured proposal via
      the reserved terminal tool; use the read-only tools to fetch context within budget
    - The prompt MUST state the LLM cannot apply changes — only PROPOSE them for explicit confirmation
    - Reuse the prompt-assembly + tool-definition pattern from `llmLoopRunner.ts`; the prompt is
      forwarded VERBATIM (never paraphrased)
  - [x] 3.7 Ensure gateway store/routes/proxy/prompt tests pass
    - Run ONLY the 2-8 tests from 3.1 (jest scoped)
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- The thread store reads/writes the correct path keyed by the primary run id, atomically, with the
  DB-run pairing recorded in-session on the open turn.
- The resolve-conflict proxy forwards to the correct AMS path and round-trips snake_case.
- The review turn union covers the listed kinds; the persona prompt forbids LLM computation/mutation
  and is forwarded verbatim.

### Frontend — Discovery Review Room (React / vitest)

#### Task Group 4: Discovery Review Room UI + scan-selection opener + grid sync + degradation
**Dependencies:** Task Group 3 (routes + thread/turn shapes) + Task Group 2 (tool/turn shapes)

Net-new UI is ONLY the chunk/agenda renderer + the pending-confirmation surface. Re-skin (do NOT
rebuild) the per-kind transcript renderer and the click-to-answer input bar; reuse the shell and the
existing `architect` persona verbatim.

- [x] 4.0 Complete the Discovery Review Room UI
  - [x] 4.1 Write 2-8 focused vitest tests
    - Limit to 2-8 highly focused tests maximum
    - The pending-confirmation surface renders the DETERMINISTIC counts and the click-to-confirm
      button; clicking confirm triggers exactly one apply via the API client
    - The scan-selection OPENING TURN lists runs by `discovery_kind` and lets the user pick a
      <=1-code + <=1-DB pair, defaulting to the current run
    - Degrade-in-place: on an LLM-failure signal the room shows the deterministic click-to-answer
      agenda over the SAME chunk (not bounced to the grid)
    - Re-read-after-write: after a confirmed apply the conversation refetches the review model
      (optimistic local echo first, then authoritative refetch)
    - Skip exhaustive rendering/interaction coverage
  - [x] 4.2 Add the "Discovery Review Room" launch button to `DiscoveryRunDetailView.tsx`
    - Route `/projects/:p/architectures/:a/discovery/runs/:runId`
    - Reuse `RightHandPanelShell.tsx` VERBATIM: `personaId="architect"` (existing in
      `personaConfig.ts`); `roomName` = the run/service name; behind a simple open/collapse toggle
      (mirror the `TargetArchitectureWorkspace` mount pattern)
  - [x] 4.3 Build the scan-selection OPENING TURN inside the room
    - List the project/architecture's runs by `discovery_kind` (code XOR database) for a <=1-code +
      <=1-DB pick, defaulting to the current run; no automatic pairing (no sibling-run helper exists)
    - On both selected, the room consumes the two-run union by requesting the review model with the
      `secondRunId` (the grid stays SINGLE-run)
  - [x] 4.4 Re-skin the per-kind transcript renderer + the click-to-answer input bar
    - Re-skin `ConversationMainPane.tsx`'s `TurnView` switch + its choice-chip / multi-choice /
      custom-text / opt-out input bar for the NEW review turn union (from 3.3)
    - Do NOT rebuild the chrome — reuse the chassis surfaces
  - [x] 4.5 Build the net-new chunk/agenda renderer + the pending-confirmation surface
    - Chunk/agenda renderer for `chunk-summary` (the deterministically-ordered ~10-20-item chunk)
    - Pending-confirmation surface for `pending-confirmation`: shows the DETERMINISTIC preview counts
      (+ attribute + competing sources for a bulk-pattern resolve) and a click-to-confirm button
  - [x] 4.6 Add the API client + re-read-after-write grid<->conversation sync
    - API client for the entry/answer + deterministic confirm/capture routes and the review-model read
    - Keep an OPTIMISTIC local snapshot for instant transcript feedback (as the target-state tab does),
      then a lightweight refetch of the Spec 1 review model after each apply to keep counts
      authoritative; NO shared cross-page React store
  - [x] 4.7 Implement degrade-in-place to the deterministic click-to-answer agenda
    - On ANY LLM failure (timeout, the chassis 5-round / 30s-per-call / 120s-wall limits, budget, relay
      down) the room falls back IN PLACE to the deterministic click-to-answer agenda over the same
      chunk and the SAME confirmation gate; the user is NOT bounced out to the grid
  - [x] 4.8 Ensure frontend Review Room tests pass
    - Run ONLY the 2-8 tests from 4.1: `npx vitest run <new test files>`
    - Do NOT run the entire frontend suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- The room launches from the run-detail page via `RightHandPanelShell` (persona `architect`),
  re-skinning the transcript chrome rather than rebuilding it.
- The scan-selection opener lists runs by `discovery_kind` and consumes the two-run union; the grid
  stays single-run.
- The pending-confirmation surface shows deterministic counts + click-to-confirm; the room degrades in
  place on LLM failure and never bounces to the grid.
- Re-read-after-write keeps the conversation counts authoritative with no shared cross-page store.

### Cross-Stack Verification

#### Task Group 5: Test review, gap analysis, and the oracle-standard proofs (capstone)
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only (oracle-standard proofs prioritized)
  - [x] 5.1 Review the tests from Task Groups 1-4
    - Review the 2-8 AMS tests (1.1), the 2-8 gateway engine tests (2.1), the 2-8 gateway
      store/routes/proxy tests (3.1), and the 2-8 frontend tests (4.1)
    - Total existing: approximately 8-32 tests
  - [x] 5.2 Analyze test-coverage gaps for THIS feature only
    - Focus ONLY on this spec's requirements; do NOT assess whole-application coverage
    - Prioritize the oracle-standard / confirmation-gate end-to-end proofs and the cross-stack seams
    - Candidate gaps to confirm are covered (write up to 10 NEW tests ONLY where a real gap exists):
      - Deterministic agenda ordering (pure): the exact order live conflicts -> high-blast-radius
        interfaces/services -> remaining by type -> findings by severity -> cross-scan links, scoped
        code-run -> DB-run -> cross-scan bridges last, chunk size ~10-20 + correct cursor; LLM not
        consulted for ordering
      - Read-only vs proposed-mutating tools: the read-only set never writes; a proposed
        `applyDecision` yields ONLY a pending-confirmation turn with deterministic counts
      - The confirmation-gate proof: the mocked LLM CANNOT cause a write without an explicit confirm,
        and never supplies a count/cascade (THE highest-stakes proof — must be explicit)
      - The durable `resolve-conflict` write matches the grid payload semantics end-to-end
        (gateway proxy -> AMS), snake_case, persists immediately
      - Bulk-resolve-by-pattern: a class of >=2 offers the prompt with exact count + attribute +
        competing sources and issues one same-source resolve per member; a class of 1 does NOT offer it
      - Thread persistence keyed by the primary run id; the in-session DB-run pairing on the open turn
      - Degradation: a timing-out / budget-exhausting mocked LLM degrades in place, still surfaces the
        chunk + the confirmation gate, applies via the SAME orchestrator, never bounces to the grid
      - Re-read-after-write: post-confirm counts reflect the server (optimistic snapshot then
        authoritative refetch), with no shared cross-page store
  - [x] 5.3 Write up to 10 additional strategic tests maximum (only where 5.2 found a real gap)
    - Maximum of 10 NEW tests total across the stack to fill critical gaps
    - Focus on integration points + the oracle-standard end-to-end proofs; NO stubs on the gate path
    - Skip edge-case / performance / accessibility tests unless business-critical
  - [x] 5.4 Run feature-specific tests only (scoped per stack)
    - AMS: `mvn -Dtest=<feature test classes> test`
    - Gateway: `npx jest <feature test files/patterns>`
    - Frontend: `npx vitest run <feature test files>`
    - Expected total approximately 18-42 tests; do NOT run the entire application suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 tests total).
- The oracle-standard proofs are explicit and green: the mocked LLM can never write without an explicit
  confirm and never supplies a count/cascade; all counts/cascades come from the deterministic backbone.
- The durable `resolve-conflict` write, bulk-resolve-by-pattern, thread persistence, degradation, and
  re-read-after-write sync are each covered.
- No more than 10 additional tests were added; testing stayed exclusively within this spec's
  requirements.

## Execution Order

Recommended implementation sequence:
1. AMS durable conflict-resolution write (Task Group 1) — foundational, independent.
2. Gateway review engine: coordinator + orchestrator + sequencer + tools + confirmation gate (Task Group 2).
3. Gateway thread store + turn union + routes + resolve-conflict proxy + persona prompt (Task Group 3).
4. Frontend Discovery Review Room: UI + scan-selection opener + grid sync + degradation (Task Group 4).
5. Cross-stack verification + the oracle-standard proofs (Task Group 5).
