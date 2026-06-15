# Task Breakdown: Target State Architect-Persona Conversation

## Overview

Total Task Groups: 6 (one per planned commit)
Total Top-Level Tasks: 6
Total Sub-Tasks: 71

Each task group below corresponds to **exactly one commit** in the Commit Plan in `spec.md`. Every group must be standalone-verifiable (compiles, focused tests green, slice works end-to-end at its level of completeness) before the next group begins. Test counts per group are capped at 4-8 per Q26/Q27.

Per the spec's hard constraints:
- All LLM calls are mocked at the `gatewayClient.callLlmToolLoop` boundary in tests. No live LLM tests.
- No new Liquibase changesets — all writes route through Spec 2's existing surfaces.
- No backfill — only forward writes through the new flow.
- The `scope_ref_type` closed set is: `service` | `interface` | `endpoint` | `physical_data_entity` | `physical_data_attribute` | `method` | `class`.
- The 13-kind turn union is closed for v1.

## Task List

### Commit 1 — Config Foundations

#### Task Group 1: Question Library + Mapping Mutation Rules Configs
**Dependencies:** None
**Commit boundary:** First commit (Commit 1 in `spec.md` Commit Plan).

- [x] 1.0 Ship the two TypeScript config artefacts with loader-time validation
  - [x] 1.1 Write 4-8 focused backend tests for the question library loader + validation
    - File: `gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`
    - Test 1: library loads with exactly 51 entries spread across groups A-J (6,6,6,4,5,5,5,5,5,4)
    - Test 2: no duplicate `code` values across the library
    - Test 3: every cascade entry's `decisionCode` resolves to a real library entry
    - Test 4: every `allowedExceptionScopes` value is in the Q12 closed set (`service`/`interface`/`endpoint`/`physical_data_entity`/`physical_data_attribute`/`method`/`class`)
    - Test 5: every `relevanceCondition` (where present) is a callable function returning boolean
    - Test 6: `mappingMutationRules` entries reference only decision codes that exist in the library; all `mapping_type` values are in the closed set (`none`/`keep-equivalent`/`replaced_by`/`renamed`/`merged`/`split`)
    - Skip exhaustive per-entry assertions
  - [x] 1.2 Create `gateway/src/config/architect-conversation/questionLibrary.ts`
    - Export the `QuestionLibrary` type and `QUESTION_LIBRARY` constant
    - Per-entry fields per `spec.md` "Question library config" section: `code`, `group` (`'A'..'J'`), `orderInGroup`, `prompt`, `discoveryContextLead?`, `expectedAnswerShape` (`'free-text' | 'single-choice' | 'multi-choice' | 'structured'`), `choices?`, `defaultsWhenUnchanged`, `cascades`, `relevanceCondition?`, `allowedExceptionScopes`
    - Cascade entry shape: `{ decisionCode: string; valueByTriggerValue: Record<string, unknown>; sourceStandardId: string }`
    - Populate all 51 entries verbatim from `spec.md` Appendix A (groups A-J)
    - Inline the cascade seed map values per Q9 — no runtime standards-registry call
    - Mark Group E entries with a `relevanceCondition` that returns false when the target architecture has no UI screens (per Q7); all other groups default to always-relevant
  - [x] 1.3 Create `gateway/src/config/architect-conversation/mappingMutationRules.ts`
    - Export the `MappingMutationRules` type and `MAPPING_MUTATION_RULES` constant keyed by `decisionCode`
    - Per-rule fields: `affectedTableSets`, `defaultMappingTypeChange` (`'none' | 'keep-equivalent' | 'replaced_by' | 'renamed' | 'merged' | 'split'`), `scopeBoundary` (always parent-not-leaf per Q15)
    - v1 rules per `spec.md`:
      - `db.engine`: tables = `physical_data_entity`, `physical_data_attribute`, `data_entity_points`; change = `keep-equivalent`
      - `api.protocol`: tables = `interface`, `endpoint`; change = `replaced_by`
      - `service.framework`: tables = `service`; change = `keep-equivalent`
      - `service.language`: tables = `method`, `class`; change = `keep-equivalent`
      - All other 47 decision codes: notes-only (`defaultMappingTypeChange = 'none'`, `affectedTableSets = []`)
  - [x] 1.4 Create a loader helper that validates the configs at module-init time
    - File: `gateway/src/config/architect-conversation/loadConfigs.ts`
    - Export `validateQuestionLibrary(lib)` and `validateMappingMutationRules(rules, lib)` returning structured validation errors
    - Throw on load if validation fails (caught by test 1.1)
    - Surface the Q12 closed set as an exported constant `ALLOWED_SCOPE_REF_TYPES`
  - [x] 1.5 Ensure Group 1 tests pass
    - Run ONLY the 4-8 tests written in 1.1: `cd gateway && npx jest src/config/architect-conversation`
    - TypeScript compile must succeed: `cd gateway && npx tsc --noEmit`
    - Do NOT run the entire gateway suite at this stage

**Acceptance Criteria (Commit 1 shippable):**
- The 4-8 tests in 1.1 pass; gateway TS compiles
- Both config files exist, all 51 question entries present, mapping rules cover the 4 mutation cases + notes-only for the other 47 codes
- Validation rejects duplicate codes, unresolved cascade refs, scope values outside the Q12 closed set, non-function relevance predicates
- No behaviour wired up beyond config + loader-time validation; no orchestration, no endpoints

---

### Commit 2 — LLM Orchestration Loop

#### Task Group 2: Gateway-Native LLM Loop Runner (Mocked LLM)
**Dependencies:** Task Group 1
**Commit boundary:** Second commit (Commit 2 in `spec.md` Commit Plan).

- [x] 2.0 Port `captureLoopRunner` pattern as a simplified gateway-native loop with hard limits
  - [x] 2.1 Write 4-8 focused backend tests for the LLM orchestration loop
    - File: `gateway/src/services/architectConversation/__tests__/llmLoopRunner.test.ts`
    - Mock the LLM at `gatewayClient.callLlmToolLoop` (or equivalent boundary) per Q26 — no live calls
    - Test 1: 5-round cap — after 5 rounds without a structured answer, the loop emits an `error` turn with `errorKind = 'round-budget-exhausted'` and returns
    - Test 2: 30s per-call timeout — a mocked LLM call that exceeds 30s yields an `error` turn with `errorKind = 'llm-call-timeout'`
    - Test 3: 2-minute wall-clock per question — emits `error` turn with `errorKind = 'wall-clock-exceeded'`
    - Test 4: happy-path structured-answer parsing — mocked LLM returns a well-formed structured answer on round 1; loop exits with the typed answer
    - Test 5: default-when-unchanged path — when the user response is "no change", loop short-circuits and produces an answer matching the library entry's `defaultsWhenUnchanged` without invoking the LLM
    - Test 6: ambiguity triggers another round within budget — round 1 returns ambiguity flag, round 2 returns valid structured answer; loop succeeds and consumes 2 rounds
    - Skip exhaustive permutations of round/timeout combinations
  - [x] 2.2 Create `gateway/src/services/architectConversation/llmLoopRunner.ts`
    - Export `runArchitectQuestionLoop(args)` taking the library entry, user response, captured-decisions context (via Spec 2's resolver), inline cascade seed map
    - Hard limits per Q2: max 5 LLM rounds per question, 30s per individual LLM call, 2-minute wall-clock per question
    - Limits enforced inside the loop; breach surfaces as an `error` turn (kind from the closed 13-kind union)
    - Per-turn LLM input: fixed prompt from the library entry (with `discoveryContextLead` prepended when present per Q17), user free-text, captured-decisions context, inline cascade seed map for this question
    - LLM responsibilities: parse free-text into typed `expectedAnswerShape`, propose cascades, surface ambiguity for another round
    - LLM never writes decisions or mutates mappings (Commit 3 handles that)
    - Reference pattern only: `api-migration-validation-service/src/services/captureLoopRunner.ts` — do not introduce a runtime dependency
  - [x] 2.3 Define the gateway LLM-client boundary contract
    - File: `gateway/src/services/architectConversation/architectLlmClient.ts`
    - Export the typed `callLlmToolLoop` signature the loop calls
    - Real implementation can route to the existing gateway LLM client; this file is the mock seam used by all tests
  - [x] 2.4 Define the typed structured-answer parser
    - File: `gateway/src/services/architectConversation/structuredAnswerParser.ts`
    - Per-shape parsers for `'free-text' | 'single-choice' | 'multi-choice' | 'structured'`
    - Validate `single-choice`/`multi-choice` values are members of the entry's `choices` array
    - Return `{ ok: true, value }` or `{ ok: false, reason }` for the loop to retry on `false`
  - [x] 2.5 Ensure Group 2 tests pass
    - Run ONLY the 4-8 tests written in 2.1: `cd gateway && npx jest src/services/architectConversation`
    - TypeScript compile must succeed
    - Do NOT run the entire gateway suite

**Acceptance Criteria (Commit 2 shippable):**
- The 4-8 tests in 2.1 pass; gateway TS compiles
- Loop enforces all Q2 hard limits and emits typed `error` turns on breach
- Structured-answer parsing covers all four shapes; default-when-unchanged short-circuits the LLM
- LLM mocked at the `callLlmToolLoop` seam; no live LLM calls in any test

---

### Commit 3 — Decision Capture + Cascade Plumbing

#### Task Group 3: Wire Loop to Spec 2 POST + Cascade-Accept-Batch + Revisions
**Dependencies:** Task Groups 1, 2
**Commit boundary:** Third commit (Commit 3 in `spec.md` Commit Plan).

- [x] 3.0 Orchestrate decision capture through Spec 2's POST endpoint with cascade plumbing
  - [x] 3.1 Write 4-8 focused backend tests covering standards seed-map cascade pre-fill AND decision capture
    - File: `gateway/src/services/architectConversation/__tests__/decisionCaptureOrchestrator.test.ts`
    - Mock the LLM and the Spec 2 captured-decisions POST client
    - Test 1: answering `service.language = Java 21` triggers the inline cascade seed map; cascade-summary turn payload lists `testing.unit → JUnit 5`, `dto.style → records`, `build.tool → Gradle 8`, `service.runtime → JVM 21`, each carrying the entry's `sourceStandardId`
    - Test 2: every cascaded decision row recorded via Spec 2 POST carries the inline `sourceStandardId` in `standardsLookupRef` (per Q9 audit continuity)
    - Test 3: cascade-accept-batch — accepting all N cascades fires N sequential POSTs each sharing the same `conversation_turn_ref` value per Q10
    - Test 4: per-cascade override — overriding one of N cascades records that single decision with `wasOverridden: true` and an `overrideReason`; the other N-1 cascades capture normally
    - Test 5: default-when-unchanged path — picking "no change" writes a real decision row with `answerValue = defaultsWhenUnchanged` (not a skip)
    - Test 6: revision-after-answer — editing a prior answer writes a new superseding POST (insert-only per settled decision #10) and emits an `edit-superseded` turn with `originalDecisionId`, `newDecisionId`, and the Q6 `affectedDownstreamCodes[]` banner payload
    - Test 7: relevance auto-skip — a library entry whose `relevanceCondition` returns false silently POSTs `answerValue = 'not_applicable'` plus appends a `system-skip` turn with `relevanceReason`
    - Skip exhaustive permutations
  - [x] 3.2 Create `gateway/src/services/architectConversation/decisionCaptureOrchestrator.ts`
    - Export `captureDecision(args)` taking the validated structured answer + library entry
    - Internally calls Spec 2's `POST /api/projects/{p}/target-architectures/{t}/captured-decisions` via the existing gateway client
    - Records `standardsLookupRef` from the library entry's cascade `sourceStandardId` on every cascaded row
    - Cascade-accept-batch: N sequential POSTs each carrying the same `conversation_turn_ref` per Q10
    - Edit-after-answer: writes a new POST (insert-only); composes the `edit-superseded` turn payload with `affectedDownstreamCodes[]` per Q6 (no auto-replay)
    - Default-when-unchanged: writes a real row with `answerValue = defaultsWhenUnchanged`
  - [x] 3.3 Create the relevance evaluator + auto-skip helper
    - File: `gateway/src/services/architectConversation/relevanceEvaluator.ts`
    - Export `evaluateRelevance(libraryEntry, ctx)` returning `{ relevant: boolean; reason?: string }`
    - Auto-skip path silently POSTs a row with `answerValue = 'not_applicable'` and appends a `system-skip` turn
    - Re-evaluation hook called on each captured-decision write that might unlock/lock a gate (per Q7)
  - [x] 3.4 Define the typed conversation turn union + payloads
    - File: `gateway/src/services/architectConversation/turnShape.ts`
    - Export the closed 13-kind union: `'question' | 'answer' | 'cascade-summary' | 'cascade-accepted' | 'cascade-overridden' | 'decision-captured' | 'mapping-mutation-summary' | 'exception-pinned' | 'edit-superseded' | 'system-skip' | 'error' | 'open' | 'close'`
    - Export per-kind payload types per `spec.md` "Conversation transcript turn shape" section (Q19/Q20)
    - Persist turns via Spec 2's `targetStateConversationStore.ts` verbatim — do NOT extend its signature (per Q3)
  - [x] 3.5 Wire the loop runner to the orchestrator
    - File: `gateway/src/services/architectConversation/architectConversationCoordinator.ts`
    - Sequence per answered question: `runArchitectQuestionLoop` → `structuredAnswerParser` → `captureDecision` → append `decision-captured` turn → if cascades, append `cascade-summary` turn and await user accept/override → on accept, batch-`captureDecision` with shared `conversation_turn_ref`
    - Intra-group ordering enforced (A.1 → A.2 → A.3 per Q5); inter-group ordering free
  - [x] 3.6 Ensure Group 3 tests pass
    - Run ONLY the 4-8 tests written in 3.1: `cd gateway && npx jest src/services/architectConversation/__tests__/decisionCaptureOrchestrator.test.ts`
    - TypeScript compile must succeed
    - Do NOT run the entire gateway suite

**Acceptance Criteria (Commit 3 shippable):**
- The 4-8 tests in 3.1 pass; gateway TS compiles
- Answering one question end-to-end against a real Architecture Model Service writes the expected captured-decision rows via Spec 2's POST, with correct `standardsLookupRef`
- Cascade-accept-batch writes N rows sharing one `conversation_turn_ref`
- Revisions write a new superseding row plus emit the `edit-superseded` turn with the Q6 downstream-codes banner payload
- Relevance auto-skip silently captures `not_applicable` and emits `system-skip`
- No mapping mutations yet (Commit 4 adds them); no UI yet (Commit 5 adds it)

---

### Commit 4 — AMS Mapping Mutations Endpoint + Gateway Wiring

#### Task Group 4: New AMS Endpoint, Gateway Client, Orchestrator Integration
**Dependencies:** Task Group 3
**Commit boundary:** Fourth commit (Commit 4 in `spec.md` Commit Plan).

- [x] 4.0 Land the transactional AMS apply-mapping-mutations endpoint and wire the gateway to invoke it after every captured decision
  - [x] 4.1 Write 4-8 focused backend tests for the AMS endpoint + gateway integration
    - File: `architecture-model-service/src/test/java/.../ApplyMappingMutationsEndpointTest.java` (AMS) and `gateway/src/services/architectConversation/__tests__/mappingMutationOrchestrator.test.ts` (gateway)
    - AMS Test 1: endpoint runs all effects inside a single `@Transactional` boundary per Q13 (verify via spy/aspect or by inducing a mid-transaction failure and asserting rollback of all rows)
    - AMS Test 2: `ArchitectureElementMappingNotesDecorator` invoked for every affected mapping; notes idempotently gain `[decision:<code>]` (re-running the endpoint does not duplicate the tag)
    - AMS Test 3: `mapping_type` changes applied per rules for `db.engine` / `api.protocol` / `service.framework` / `service.language`; notes-only for any other decision code
    - AMS Test 4: `created_by_task` is never modified per Q14 (assert original value preserved after mutation)
    - AMS Test 5: cross-project leak protection — request with mismatched `project_id` / `target_architecture_id` / `decisionId` returns HTTP 404 (mirrors Spec 2 pattern)
    - AMS Test 6: parent-not-leaf scope per Q15 — only mappings rooted under the target architecture's parent scope are affected; per-element exception narrows to a single row
    - Gateway Test 7: orchestrator invokes the new endpoint after Spec 2 POST and appends a `mapping-mutation-summary` turn carrying `affectedMappings`, `mappingTypeChanges`, `notesDecorations`, `tableSetSummary`
    - Skip exhaustive per-table-set permutations
  - [x] 4.2 Add the AMS endpoint
    - File: `architecture-model-service/src/main/java/.../CapturedDecisionsApplyMappingMutationsController.java`
    - Route: `POST /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions/{decisionId}/apply-mapping-mutations`
    - Single `@Transactional` per Q13
    - Request body: the `MappingMutationRuleSubsetDto` for the decision code (gateway forwards from `MAPPING_MUTATION_RULES`)
    - Response body: per-table-set summary (`affectedMappings`, `mappingTypeChanges`, `notesDecorations`, `tableSetSummary`)
    - Verify loaded decision row's `project_id` and `target_architecture_id` match the request path; return HTTP 404 on mismatch
    - Use boxed numeric/boolean fields on all new DTOs per `project_primitive_double_dto_overwrite.md`
    - `@JsonNaming(LowerCamelCaseStrategy.class)` on every new DTO
  - [x] 4.3 Wire the new endpoint to Spec 2's `ArchitectureElementMappingNotesDecorator`
    - For each affected mapping row, decorate notes idempotently with `[decision:<code>]`
    - If the rule dictates a `mapping_type` change, apply it
    - Never touch `created_by_task` (per Q14)
    - Read affected mappings via the parent-not-leaf scope helper from the 2026-05-22 `architecture-scope-via-parent-not-leaf` spec
    - Per-element exception path narrows the affected set to one row
  - [x] 4.4 Add the gateway client method
    - File: `gateway/src/clients/architectureModelClient.ts` (extend existing client)
    - Add `applyMappingMutationsForDecision(projectId, targetArchitectureId, decisionId, ruleSubset)`
    - Mirror the existing captured-decisions proxy shape from Spec 2
  - [x] 4.5 Wire the orchestrator to invoke the new endpoint after every captured decision
    - File: `gateway/src/services/architectConversation/mappingMutationOrchestrator.ts`
    - Sequence: capture-decision via Spec 2 → select rule subset from `MAPPING_MUTATION_RULES` for the decision code → invoke `applyMappingMutationsForDecision` → append `mapping-mutation-summary` turn with per-table-set counts
    - Cascade-accept-batch path runs the orchestrator once per cascaded decision
  - [x] 4.6 Verify no new Liquibase changesets are required
    - This endpoint reads and updates existing mapping tables only; the spec adds no new schema
    - If any incidental schema work surfaces during implementation, add a brand-new changeset rather than editing an applied one (per `feedback_liquibase_immutable_changesets.md`)
    - Document the verification in the commit message
  - [x] 4.7 Ensure Group 4 tests pass
    - Run ONLY the AMS test class and the gateway test file written in 4.1:
      - AMS: `cd architecture-model-service && mvn test -Dtest=ApplyMappingMutationsEndpointTest`
      - Gateway: `cd gateway && npx jest src/services/architectConversation/__tests__/mappingMutationOrchestrator.test.ts`
    - Do NOT run the entire AMS or gateway suites

**Acceptance Criteria (Commit 4 shippable):**
- The 4-8 tests in 4.1 pass; AMS compiles and starts; gateway TS compiles
- Answering a `db.engine` or `api.protocol` question end-to-end mutates the expected mappings within one `@Transactional` boundary and idempotently decorates notes
- `created_by_task` unchanged; parent-not-leaf scope respected; cross-project requests return 404
- `mapping-mutation-summary` turn appears in the transcript with accurate per-table-set counts
- No new Liquibase changesets shipped

---

### Commit 5 — Frontend Architect Conversation Tab

#### Task Group 5: View-Mode Tab + Chat UI + 7 Frontend Surfaces
**Dependencies:** Task Group 4
**Commit boundary:** Fifth commit (Commit 5 in `spec.md` Commit Plan).

- [x] 5.0 Build the Architect Conversation view-mode tab and all in-conversation surfaces
  - [x] 5.1 Write 4-8 focused frontend tests for Surface 1 — tab renders in Target State sub-tab
    - File: `frontend/src/components/targetState/architectConversation/__tests__/ArchitectConversationTab.test.tsx`
    - Mock `targetArchitecturesApi`, `architectConversationApi`, the chat coordinator client
    - Test: tab renders as a peer to "Table editor" and "Compare with current" inside the Target State sub-tab
    - Test: tab is selectable and renders the active content area
    - Test: tab hides when the user is not on the Target State sub-tab
    - Test: tab label and ordering match the design (3rd peer)
  - [x] 5.2 Write 4-8 focused frontend tests for Surface 2 — empty-state per Q23
    - File: `frontend/src/components/targetState/architectConversation/__tests__/EmptyState.test.tsx`
    - Test: when `GET /api/projects/{projectId}/active-target-architecture-id` returns null, tab soft-pushes router to Table editor view-mode
    - Test: a one-frame CSS highlight appears on the Suggest button after the push
    - Test: no modal, no toast emitted
    - Test: when an active target exists, the empty-state does NOT trigger
  - [x] 5.3 Write 4-8 focused frontend tests for Surface 3 — start-conversation flow
    - File: `frontend/src/components/targetState/architectConversation/__tests__/StartConversation.test.tsx`
    - Test: active target with no prior session shows "Start conversation" button
    - Test: clicking the button writes an `open` turn (with `sessionId` + `openedBy`) via the conversation API
    - Test: active target with a prior closed session shows read-only prior transcript + "Start new conversation" button
    - Test: starting a new conversation appends a new logical session inside the same thread file
  - [x] 5.4 Write 4-8 focused frontend tests for Surface 4 — cascade-summary accept-batch UX
    - File: `frontend/src/components/targetState/architectConversation/__tests__/CascadeSummary.test.tsx`
    - Test: cascade-summary turn renders the proposed `cascadedDecisions[]` with per-cascade controls (accept / override)
    - Test: "Accept all" calls the gateway batch endpoint and renders a `cascade-accepted` turn with `wasOverridden: false` for each entry
    - Test: per-cascade override opens an inline reason input; submission records `wasOverridden: true` + `overrideReason` for that cascade only
    - Test: while batch in flight, "Thinking…" spinner shows; 60s frontend timeout per Q18 surfaces an error toast and lets the user retry
  - [x] 5.5 Write 4-8 focused frontend tests for Surface 5 — per-question "Set exception" sub-dialog
    - File: `frontend/src/components/targetState/architectConversation/__tests__/ExceptionSubDialog.test.tsx`
    - Test: clicking "Set exception for…" opens a sub-dialog with an entity picker
    - Test: the picker is filtered per Q11 by the decision code's `allowedExceptionScopes` (e.g. `service.framework` shows service-only, `db.engine` shows physical_data_entity-only)
    - Test: submitting writes an `exception-pinned` turn with `scope = { kind: 'element', refType, refId }` and an `answerValue`
    - Test: the picker rejects any `scope_ref_type` value outside the Q12 closed set
  - [x] 5.6 Write 4-8 focused frontend tests for Surface 6 — close-conversation flow + retire-current-session per Q4
    - File: `frontend/src/components/targetState/architectConversation/__tests__/CloseConversation.test.tsx`
    - Test: close-conversation CTA disabled until A.1 (`service.language`) + B.1 (`api.protocol`) + C.1 (`db.engine`) are all answered per Q8
    - Test: clicking close writes a `close` turn with `closeReason: 'completed-by-user'` and `summaryMarkdown` embedded inline per Q16 (full grouped-by-scope summary, self-contained)
    - Test: second-user opening a draft with an open session sees a "retire current and start new" affordance; choosing retire writes a synthetic `close` turn with `closeReason: 'retired-by-other-user'`, then opens a fresh session
    - Test: summary panel visually distinguishes `'deferred'` rows from un-answered questions per Q8
  - [x] 5.7 Write 4-8 focused frontend tests for Surface 7 — revise-prior-answer flow + Q6 banner
    - File: `frontend/src/components/targetState/architectConversation/__tests__/ReviseAnswer.test.tsx`
    - Test: clicking any prior decision in the summary panel opens the same answer-edit flow (or exception sub-dialog when scope is element)
    - Test: submitting a revision triggers a new superseding POST (insert-only) and emits an `edit-superseded` turn
    - Test: a conversation-level banner appears listing the Q6 `affectedDownstreamCodes[]` for review; no auto-replay occurs
    - Test: dismissing the banner does not reset the decision; cascaded codes remain at their original values until manually re-visited
  - [x] 5.8 Build the Architect Conversation tab component
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
    - Register as a peer view-mode tab inside the existing Target State sub-tab (alongside Table editor + Compare with current)
    - Implement Surface 1 + Surface 2 (empty-state with soft router push + one-frame Suggest highlight per Q23)
    - Use only Spec 2's `GET /api/projects/{projectId}/active-target-architecture-id` for active-target lookup per Q21
  - [x] 5.9 Build the chat-style main pane
    - File: `frontend/src/components/targetState/architectConversation/ConversationMainPane.tsx`
    - Left rail: LLM messages (question prompts with `discoveryContextLead` prepended, cascade summaries, mutation summaries)
    - Right rail: user responses + structured-answer chips ("accept default", "no change", free-text input)
    - Per-question "Set exception for…" button opening the sub-dialog (Surface 5)
    - Cascade-summary turn renders accept-all + per-cascade override controls (Surface 4)
    - 60-second per-turn frontend timeout per Q18; "Thinking…" spinner; error toast on breach
    - Render the 13 turn kinds per their typed payload (per the `turnShape.ts` from Commit 3)
  - [x] 5.10 Build the right-side summary panel
    - File: `frontend/src/components/targetState/architectConversation/SummaryPanel.tsx`
    - Always visible during conversation
    - Running grouped-by-scope summary of captured decisions
    - Visual distinction between `'deferred'` rows and un-answered questions per Q8
    - "Preview prompt-ready output" link surfacing Spec 2's `TargetStateDecisionsContextResolver` output
    - Each prior decision clickable to revise (Surface 7)
  - [x] 5.11 Build the exception sub-dialog
    - File: `frontend/src/components/targetState/architectConversation/ExceptionSubDialog.tsx`
    - Entity picker filtered per Q11 by the decision code's `allowedExceptionScopes`
    - Sources rows from existing target-architecture read endpoints
    - Rejects any `scope_ref_type` value outside the Q12 closed set (defence-in-depth — gateway also validates)
  - [x] 5.12 Build the close-conversation flow + retire-current handling
    - File: `frontend/src/components/targetState/architectConversation/CloseConversationFlow.tsx`
    - Close CTA gated on A.1 + B.1 + C.1 per Q8
    - On close: write `close` turn with full `summaryMarkdown` inline per Q16
    - Retire-current: write `close` (reason = `'retired-by-other-user'`) then `open` for the new session
    - No optimistic locking; UI-level prevention only per Q4
  - [x] 5.13 Build the revise-prior-answer flow + Q6 banner
    - File: `frontend/src/components/targetState/architectConversation/RevisePriorAnswer.tsx`
    - Edit triggers a new superseding POST
    - Conversation-level banner lists `affectedDownstreamCodes[]` per Q6 — no auto-replay
  - [x] 5.14 Add the backend tests for Test Group 6 — Conversation transcript turn append + close
    - File: `gateway/src/services/architectConversation/__tests__/conversationTranscript.test.ts`
    - Test 1: turn append round-trips via Spec 2's `targetStateConversationStore.ts` helper without extending its signature (per Q3)
    - Test 2: session `open` / `close` markers correctly delimit logical sessions inside one thread file
    - Test 3: relevance auto-skip writes a `system-skip` turn with `relevanceReason`
    - Test 4: `edit-superseded` turn carries `originalDecisionId`, `newDecisionId`, and `affectedDownstreamCodes[]`
    - Test 5: `close` turn embeds the full `summaryMarkdown` inline per Q16 (self-contained — no resolver re-query needed at read time)
    - Test 6: retire-current writes a synthetic `close` turn with `closeReason: 'retired-by-other-user'`, then a fresh `open` turn
    - Skip exhaustive turn-shape permutations
    - Critical: include `beforeEach` cleanup `await fs.rm(path.join(testTmpDir, 'threads'), { recursive: true, force: true })` per the test-pattern note in project memory
  - [x] 5.15 Ensure Group 5 tests pass
    - Run ONLY the 7 frontend test files (5.1-5.7) + the backend transcript test file (5.14):
      - Frontend: `cd frontend && npx vitest run src/components/targetState/architectConversation`
      - Gateway: `cd gateway && npx jest src/services/architectConversation/__tests__/conversationTranscript.test.ts`
    - Do NOT run the entire frontend or gateway suite

**Acceptance Criteria (Commit 5 shippable):**
- The 4-8 tests for each of the 7 frontend surfaces pass; the 4-6 backend transcript tests pass
- A user can complete a full end-to-end conversation against a real backend: empty-state push, start, walk through grouped questions, see standards-driven cascades, accept-batch or override per cascade, pin per-element exceptions, revise prior answers (with Q6 banner), retire a stale concurrent session, close with a self-contained `summaryMarkdown`
- Spec 2's `TargetStateDecisionsContextResolver` and `MigrationDiscoveryContextDto.targetStateDecisionsSummary` start emitting populated output for projects that ran the conversation
- Compare view is untouched (no decoration in v1 per Q22)
- No streaming / SSE (synchronous per Q18); no optimistic locking on the thread file (UI prevention only per Q4)

---

### Patch between Commit 5 and Commit 6 — Gateway HTTP routes

#### Task Group 5b: Architect-Conversation HTTP route surface
**Dependencies:** Task Groups 3, 4, 5
**Commit boundary:** Patch commit (in flight 2026-05-21). The original Commit-5 scope built the frontend client (`frontend/src/api/architectConversationApi.ts`) but did not wire the matching gateway HTTP routes; without them the frontend URLs return 404 in production and the Definition of Done cannot be met end-to-end. This task group is pass-through only (no business logic) -- behaviour is owned by the Commit-3/4 orchestrators and their existing test coverage.

- [x] 5b.0 Land the 8 gateway HTTP routes the frontend client already calls
  - [x] 5b.1 Create `gateway/src/routes/architectConversation.ts`
    - Modeled on `gateway/src/routes/targetArchitectures.ts` (the established pattern for related routes)
    - 8 endpoints under `/api/projects/:projectId/target-architectures/:targetArchitectureId/architect-conversation`:
      - `GET .../architect-conversation` -- envelope (turns + decisions + currentSession)
      - `POST .../architect-conversation/open` -- append `open` turn
      - `POST .../architect-conversation/close` -- append `close` turn
      - `POST .../architect-conversation/answer` -- coordinator.answerQuestion
      - `POST .../architect-conversation/cascade/accept-batch` -- orchestrator.acceptCascadeBatch (also runs mapping-mutation orchestrator per cascade)
      - `POST .../architect-conversation/cascade/override` -- orchestrator.overrideCascade (also runs mapping-mutation orchestrator)
      - `POST .../architect-conversation/revise` -- orchestrator.revisePriorAnswer
      - `POST .../architect-conversation/exception` -- orchestrator.pinException
    - Use the `defaultCoordinatorDeps` / `defaultDecisionCaptureOrchestrator` / `defaultMappingMutationOrchestrator` constants directly; expose a `setArchitectConversationDeps` test seam for future HTTP-layer tests
    - `GET .../architect-conversation` fetches the conversation thread via `loadTargetStateConversation` AND the captured decisions via `fetchLatestCapturedDecisions`, then derives `currentSession` by walking the turns (most recent `open` whose `sessionId` is not in the set of `close` `sessionId`s)
    - Error policy: missing/malformed required body fields -> 400 `{error}`; `CapturedDecisionsWriteError` re-emits the AMS upstream status verbatim (so cross-project 404 / 409 round-trip); any other orchestrator throw -> 500 `{error}`
    - Defence-in-depth: validate `scope.refType` against the closed Q12 set up-front so out-of-set values surface as 400 (the orchestrator also enforces this)
    - LLM client: build a small adapter wrapping the gateway-default `getLlmClient()` into the `ArchitectLlmClient` shape (this is the only piece of production wiring the patch introduces; everything else is re-use of existing orchestrators)
  - [x] 5b.2 Re-export the router from `gateway/src/routes/index.ts`
  - [x] 5b.3 Mount the router in `gateway/src/server.ts` under `/api` (next to `targetArchitecturesRouter`)
  - [x] 5b.4 Verify `tsc --noEmit` stays clean
    - No new tests are introduced by this patch (per brief); the orchestrator behaviour is already covered by Groups 3+4

**Acceptance Criteria (Patch shippable):**
- All 8 frontend URLs in `frontend/src/api/architectConversationApi.ts` are reachable end-to-end
- `cd gateway && npx tsc --noEmit` exits 0
- No business logic in the route handlers (pass-through only)
- Request/response shapes match the frontend client's typed contract

---

### Commit 6 — Verification

#### Task Group 6: Definition-of-Done Sweep + Regression Check
**Dependencies:** Task Groups 1-5
**Commit boundary:** Sixth commit (Commit 6 in `spec.md` Commit Plan). No new product behaviour — bundles verification artefacts only.

- [x] 6.0 Verify the feature against the Definition of Done; record sign-off artefacts
  - [x] 6.1 Review tests written in Groups 1-5
    - Group 1: 4-8 tests for question library loader + validation
    - Group 2: 4-8 tests for LLM orchestration loop
    - Group 3: 4-8 tests for decision capture + cascade plumbing
    - Group 4: 4-8 tests for AMS endpoint + gateway integration (split across AMS + gateway)
    - Group 5: 4-8 tests per frontend surface (7 surfaces) + 4-6 backend transcript tests
    - Approximate total feature tests: 50-80
  - [x] 6.2 Identify critical gaps for THIS feature only (cap additional tests at 10)
    - Walk the spec's Definition of Done bullet-by-bullet; check each is covered by an existing test
    - Focus on integration points and end-to-end workflows
    - Skip edge cases, performance tests, accessibility tests unless business-critical
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 10 additional strategic tests maximum, only for genuine gaps
    - Suggested gap-filler candidates if missing from Groups 1-5:
      - End-to-end happy path: answer A.1 → cascade pre-fill → accept-batch → mapping mutation → transcript shape (single integration test in gateway)
      - Cross-project leak protection for the apply-mapping-mutations endpoint at the gateway client layer (mirroring the AMS-side 404 test)
      - Frontend integration: full conversation flow from empty-state through close (single Vitest scenario)
      - Idempotency of the notes decorator after running the apply-mapping-mutations endpoint twice for the same decision
    - Cap: 10 additional tests total across all layers
  - [x] 6.4 Run feature-specific tests only
    - Gateway: `cd gateway && npx jest src/config/architect-conversation src/services/architectConversation src/clients/architectureModelClient`
    - AMS: `cd architecture-model-service && mvn test -Dtest=ApplyMappingMutationsEndpointTest`
    - Frontend: `cd frontend && npx vitest run src/components/targetState/architectConversation`
    - Approximate total: 60-90 tests
    - Do NOT run the entire application test suite (pre-existing failures from project memory must remain untouched)
  - [x] 6.5 Definition-of-Done verification (record results inline)
    - Verify each of the 11 Definition of Done bullets from `spec.md`:
      - Question library compiles + validates (51 entries, no duplicate codes, cascades resolve, scopes in Q12 closed set, predicates well-formed)
      - Mapping mutation rules apply correctly for the 4 mutation codes; notes-only for the rest
      - Gateway LLM loop enforces Q2 limits; LLM mocked at the client boundary in tests
      - Every answered question writes via Spec 2 POST; batch shares `conversation_turn_ref`; revisions write superseding rows + Q6 banner payload
      - AMS endpoint runs in single `@Transactional`; decorator invoked; `mapping_type` per rules; `created_by_task` untouched; parent-not-leaf scope
      - View-mode tab appears as peer to Table editor + Compare with current; empty-state, start, in-progress, cascade-summary, exception sub-dialog, revise, retire-current, close all work
      - Transcript persists via Spec 2 helper with the 13-kind union; close turn embeds `summaryMarkdown` inline
      - `TargetStateDecisionsContextResolver` starts emitting populated output
      - `MigrationDiscoveryContextDto.targetStateDecisionsSummary` starts emitting populated blocks
      - All 6 backend test groups + 7 frontend test surfaces pass; pre-existing failures untouched
      - Each of the 6 commits in the Commit Plan was standalone-verifiable at the time of the commit
  - [x] 6.6 Grep sweeps for stray references
    - Confirm no `scope_ref_type` literals outside the Q12 closed set exist in new code
    - Confirm no new turn kinds outside the closed 13-kind union exist in new code
    - Confirm no new Liquibase changesets were added under `architecture-model-service/src/main/resources/db/changelog/`
    - Confirm no extensions to `targetStateConversationStore.ts` helper signature (per Q3)
    - Confirm no calls to a non-existent runtime standards-registry endpoint (Q9 — inline seed map only)
    - Confirm no edits to `product-manager--migration-delivery-plan` or `product-manager--migration-shape-spec-generation` (those belong to Spec 4)
    - Confirm no `discovery-service/src/**` edits
  - [x] 6.7 Cross-group regression check
    - Re-run all feature-specific tests from 6.4 in a fresh shell to confirm no cross-test ordering issues
    - Confirm pre-existing failures listed in project memory remain at the same count (untouched)
  - [x] 6.8 Record verification artefacts
    - Create `agent-os/specs/2026-05-24-target-state-architect-conversation/verifications/commit-6-verification.md`
    - Capture: test-run logs (paste tail of the gateway/AMS/frontend runs), screenshots of the end-to-end UI walkthrough, DoD bullet checklist with status per bullet, list of any incidental fit-and-finish changes shipped in this commit

**Acceptance Criteria (Commit 6 shippable):**
- All feature-specific tests pass (~60-90 total across the 4-6 layers); pre-existing failures untouched
- All 11 Definition of Done bullets verified and recorded
- Grep sweeps return clean (no stray scope types, no stray turn kinds, no extensions to frozen signatures, no out-of-scope edits)
- No more than 10 additional tests added in 6.3
- Verification document committed under `verifications/`

## Execution Order

Recommended implementation sequence — one commit per group, each standalone-verifiable:

1. **Commit 1**: Task Group 1 — Question library + mapping mutation rules configs (pure config + validation tests)
2. **Commit 2**: Task Group 2 — Gateway-native LLM orchestration loop (mocked at the `callLlmToolLoop` boundary)
3. **Commit 3**: Task Group 3 — Decision capture + cascade plumbing (wires loop to Spec 2 POST; relevance auto-skip; revisions; Q6 banner payload)
4. **Commit 4**: Task Group 4 — AMS apply-mapping-mutations endpoint + gateway client + orchestrator integration
5. **Commit 5**: Task Group 5 — Frontend Architect Conversation view-mode tab + 7 UI surfaces + backend transcript tests
6. **Commit 6**: Task Group 6 — Definition-of-Done verification, grep sweeps, regression check, sign-off artefacts
