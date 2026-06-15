# Specification: PM Tasks Captured Decisions Integration + Delivery Sequencing

## Goal

Close the migration-workflow loop so the captured decisions written by the architect-persona conversation (Spec 3) actually shape the downstream Product Manager outputs: the existing Book of Work and per-story Shape-Spec generations consume the new `target-state-decisions-context` and cite decision codes, and a new single-turn `product-manager--migration-delivery-sequencing` task answers the one question the architect cannot answer alone (initiative ordering / parallelisation / blockers), persisting its answer as a captured decision via the Spec 2 data plane. This is the smallest and final spec of the four-spec migration-workflow rework.

## User Stories

- As a migration architect, I want the Book of Work generated after I finish the architect conversation to group initiatives consistently with the technology decisions I captured, so I am not re-asked questions I have already answered.
- As a Product Manager consuming generated shape-specs, I want every story to cite the decision codes that drove it via `evidenceRefs[]` entries, so I can trace each implementation choice back to the architect's recorded rationale.
- As a delivery lead running the new sequencing task once the Book of Work exists, I want a recommended initiative ordering with `parallelisableWith` / `blockedBy` relationships and decision-code rationale, persisted as a supersedable captured decision, so the sequencing answer survives re-runs without losing audit history.
- As a backend developer extending the shape-spec validator, I want missing decision-code citations flagged as warnings and the LLM-rated confidence downgraded one notch when the project has captured decisions but the generated story cites none, so weak generations surface without hard-failing the pipeline.
- As an operator running the sequencing task before captured decisions exist or before a target architecture is defined, I want a clear `insufficient_context` response with a `recommendedNextAction` pointing me to the right upstream step, so the failure mode is self-explanatory.

## Specific Requirements

### Prompt update: `product-manager--migration-delivery-plan`

- File: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`.
- Add a new section "## Target State Decisions Context" explaining the architect persona has already captured technology decisions; they are facts, not alternatives the Book of Work prompt should propose.
- Add rule: "Initiative grouping must align with captured decisions" — e.g. a captured `db.engine` change implies at least one database-migration initiative; a captured `service.framework` change implies at least one service-layer-refactor initiative.
- Add rule: "Stories must reference the decision codes that drove them in their rationale / evidence section."
- Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable, mirroring Spec 3's mapping-row decoration convention."
- Add anti-rule: "Do not ask the user follow-up questions about technology choices — those are settled in the captured decisions; flag inferred gaps as warnings in the structured response instead."
- Existing eight prompt rules (functional equivalence, evidence-only, no invention, etc.) are preserved verbatim — additions only, no removals.

### Config update: `product-manager--migration-delivery-plan.json`

- File: `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`.
- Add `target-state-decisions-context` to the `contextNeeds` array alongside the existing `migration-discovery-context`. No other changes — `availableFrom`, persona, model, and turn-limit stay untouched.

### Prompt update: `product-manager--migration-shape-spec-generation`

- File: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`.
- Add a "## Target State Decisions Context" section explaining captured decisions are evidence the generated spec must cite.
- Add rule: "Every generated shape-spec must include `evidenceRefs[]` entries with `{type: 'captured_decision', id: '<decision_code>'}` naming the decision codes that drove the story. If no decision applies, the story should explain why in its rationale."
- Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable."
- Add anti-rule: "Do not generate technology-specific implementation detail that contradicts a captured decision. If `db.engine='Postgres 18'` is captured, the spec must not propose generating MySQL DDL."
- Add gap-handling rule: "If the captured decisions context appears incomplete relative to the story scope, flag the gap as a structured warning rather than inventing a default."
- Existing eight prompt rules preserved verbatim.

### Config update: `product-manager--migration-shape-spec-generation.json`

- File: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`.
- Add `target-state-decisions-context` to the `contextNeeds` array. No other changes.

### New PM task: `product-manager--migration-delivery-sequencing`

- New task config: `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json` with `contextNeeds` of `['migration-discovery-context', 'target-state-decisions-context']`, static `availableFrom` mirroring the existing two PM tasks, persona `product-manager`, single-turn-only behaviour. No dynamic gating at the task-config surface — runtime gating lives in the handler.
- New prompt: `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`. Asks one question: given the captured decisions plus the supplied book of work, what is the recommended initiative ordering? Mandatory rules — must cite decision codes in `rationale`, must reference initiative IDs from the supplied book of work, mandatory functional-equivalence clause. Prompt body wording finalised at write time.
- New handler: `gateway/src/services/migrationDeliverySequencingHandler.ts`, modelled on `migrationBookOfWorkHandler.ts`. Handler input includes a required `bookOfWorkId` parameter — the frontend supplies it (it just rendered the book of work); no new Architecture Model Service endpoint for "latest book of work".
- New structured-response validator: `gateway/src/services/migrationDeliverySequencingResponseValidator.ts`, hand-rolled mirroring `specGenerationResponseValidator.ts` — not JSON-schema-library style.
- Handler flow: load context (supplied book of work + `target-state-decisions-context` + `migration-discovery-context`) → if no active target architecture return `status='insufficient_context'` with `recommendedNextAction='Define a target architecture first'` → if zero captured decisions return `status='insufficient_context'` with `recommendedNextAction='Run the architect conversation first'` → apply token-budget cap → single synchronous LLM call → validate structured response → POST sequencing answer to the Spec 2 captured-decisions endpoint → return `{ sequenceId, summary }` to the frontend.

### Sequencing handler structured-response shape and validator hard checks

- Structured response: `{ status: 'sequenced' | 'insufficient_context' | 'failed', initiativeOrder: [{ initiativeId, sequence, parallelisableWith: string[], blockedBy: string[], rationale }], confidence: 'high' | 'medium' | 'low', warnings: [...], recommendedNextAction?: string }`. Field ordering and exact JSON shape finalised at write time.
- Validator hard fails: every `initiativeId` in `initiativeOrder` exists in the supplied book of work; every entry of `parallelisableWith` and `blockedBy` is a valid initiative ID from the supplied book of work; every `sequence` value is a positive integer; when `status='sequenced'` the `initiativeOrder` array is non-empty.
- Validator warning-only (not hard fail): cycle detected in the `blockedBy` graph — surfaces as a structured warning, sequencing still persists.

### Sequencing decision-capture write attributes

- The sequencing answer is persisted as a captured decision via the existing Spec 2 POST endpoint (no new endpoint, no new client method).
- Write attributes: `decision_code = 'delivery.sequencing'`; `scope_kind = 'architecture'` — sequencing applies to the whole book of work, not per-element; `created_by_task = 'product-manager--migration-delivery-sequencing'`; `conversation_thread_id = null` and `conversation_turn_ref = null` since the task is single-turn and owns no thread; `answer_value` = JSON-stringified full `initiativeOrder` structure.
- Re-running the task uses Spec 2's normal supersession path — no `previousDecisionId` parameter on the POST, no "regenerate" flag, no special affordance.

### Shape-spec validator extension: `specGenerationResponseValidator.ts`

- Extend the existing hand-rolled validator. For responses with `status='generated'` or `status='generated_with_warnings'`: if the project has captured decisions and a story's `evidenceRefs[]` contains zero entries with `type: 'captured_decision'`, append a structured warning `{ kind: 'missing_decision_citation', recommendedNextAction: 'review and add decision codes' }` and downgrade the LLM-rated confidence by one notch (`high` → `medium`, `medium` → `low`, `low` stays `low`).
- Per-story check. Story-level scope cross-check (e.g. only downgrade if the story actually touches a domain that has a decision) is deferred — see Out of Scope.
- Validator consumes the structured decisions list via the existing `fetchLatestCapturedDecisions` on `targetStateCapturedDecisionsClient.ts`. No new client method.
- Handler ordering inside `migrationShapeSpecGenerationHandler.ts` is preserved per Q18: parse LLM response → validator extension (warnings + confidence downgrade) → auto-seed (the existing May-19 spec behaviour) → persist.

### Token-budget cascade — decisions block placement

- The decisions block is appended **post-cascade and is never truncated** in any of the three PM tasks (delivery-plan, shape-spec-generation, delivery-sequencing).
- If the combined payload (discovery context after cascade + decisions block) exceeds the model token cap, the handler throws `TokenBudgetOverflowError` — never silently drops decision lines.
- Justification: the question library is bounded (~51 decisions max), so the decisions payload is bounded and high-signal.

### `evidenceRefs[]` object shape

- The shape-spec prompt and validator both treat `evidenceRefs[]` decision entries as objects of shape `{ type: 'captured_decision', id: '<decision_code>' }`.
- `type` is snake_case (`captured_decision`) to match the existing `type: 'architecture_element_mapping'` convention used by the May-19 shape-spec generation validator and the existing prompt examples.

### Tests (backend only — 6 surfaces, 4-8 tests per surface, capped at ~40 total)

- **Prompt update tests** (4-8): structural substring assertions on the two updated `.task.md` files — new section heading present, critical anti-rule phrases present, `[decision:<code>]` mention present, existing eight rules still present.
- **Config `contextNeeds` extension tests** (4-8): both updated `.json` files contain `target-state-decisions-context` in the `contextNeeds` array; existing `migration-discovery-context` still present; no other top-level keys changed.
- **Sequencing handler tests** (4-8): happy path posts to the Spec 2 endpoint with the correct write attributes; no-active-target returns `insufficient_context` with the "Define a target architecture first" `recommendedNextAction`; no-decisions returns `insufficient_context` with the "Run the architect conversation first" `recommendedNextAction`; LLM-error returns `status='failed'`; structured-response invalid (e.g. unknown initiative ID) returns `status='failed'` with validator messages.
- **Sequencing validator tests** (4-8): three response variants (`sequenced` / `insufficient_context` / `failed`) parse correctly; each of the four hard-fail rules triggers a failure on a crafted bad input; the cycle-detection warning fires on a crafted cyclic `blockedBy` graph but does not hard-fail.
- **Shape-spec validator extension tests** (4-8): missing-citation case appends the structured warning; three confidence-downgrade combinations (`high` → `medium`, `medium` → `low`, `low` → `low`); no-downgrade when project has zero captured decisions; no-downgrade when story already has at least one `captured_decision` evidenceRef.
- **Gateway client integration coverage**: exercised via the handler tests above — no new client method, so no dedicated client test surface needed beyond what `targetStateCapturedDecisionsClient.ts` already covers.

## Out of Scope

- A future spec ("Spec 5") for a full standards-registry read API exposing decision codes, allowed answers, and standards lookups — this spec hardcodes nothing about the question library.
- Additional PM-level questions beyond sequencing: team / squad allocation, release cadence, risk acceptance — all deferred to a future spec.
- Mapping mutations driven by sequencing decisions — sequencing is project-level orchestration, not a per-element technology change.
- Automatic re-generation of the book of work when captured decisions change after the book is generated — v1 leaves the existing book as-is and the user explicitly re-runs the delivery-plan task to refresh.
- Decision-code citation validation on pre-existing already-generated stories — the validator extension only applies to new generations going through the handler.
- Story-level scope cross-check for the missing-citation downgrade (only downgrade when the story actually touches a domain that has a decision) — deferred.
- Any frontend changes — the new sequencing task surfaces through the existing PM-task menu; no UI work in this spec.
- New Architecture Model Service endpoints — all reads and writes use existing Spec 2 surfaces.
- A new `fetchLatestCapturedDecisionsStructured` client method — the existing `fetchLatestCapturedDecisions` already returns the structured `TargetStateCapturedDecision[]` list.
- Multi-code decomposition of the sequencing answer (`delivery.sequencing.order`, `delivery.sequencing.parallelisable`, etc.) — single `delivery.sequencing` code with structured JSON in `answer_value`.

## Existing Code to Leverage

### `gateway/src/services/migrationBookOfWorkHandler.ts`

- Existing PM-task handler for the Book of Work generation. Establishes the shape the new sequencing handler mirrors: load resolved context blocks, apply token-budget cascade, single synchronous LLM call, validate structured response, persist downstream artefact, return summary to the frontend.
- The new `migrationDeliverySequencingHandler.ts` follows this template end-to-end and re-uses the same context-resolution + LLM-call utilities — only the persistence step differs (POST to Spec 2's captured-decisions endpoint instead of writing a book-of-work record).

### `gateway/src/services/migrationShapeSpecGenerationHandler.ts`

- Existing PM-task handler for per-story shape-spec generation. Owns the parse → auto-seed → persist sequence that the validator-extension change must slot into. The Q18 ordering decision (parse → validator extension → auto-seed → persist) targets this file directly.
- The existing handler already loads `migration-discovery-context` from the resolver registry — adding `target-state-decisions-context` to its `contextNeeds` array means the resolver auto-feeds it; no code change in this handler beyond the validator-extension hook.

### `gateway/src/services/specGenerationResponseValidator.ts`

- Existing hand-rolled validator for shape-spec generation responses (NOT JSON-schema-library style). This spec extends it directly with the missing-decision-citation warning and the one-notch confidence downgrade — additive, no behaviour change for projects with zero captured decisions.
- Sets the style template for the new hand-rolled `migrationDeliverySequencingResponseValidator.ts` — same error/warning shape, same return type, same exported entry-point convention.

### `gateway/src/services/targetStateCapturedDecisionsClient.ts`

- Spec 2 gateway client. Already exposes `fetchLatestCapturedDecisions(projectId, targetArchitectureId)` returning the structured `TargetStateCapturedDecision[]` list and `fetchActiveTargetArchitectureId(projectId)`. Both consumed unchanged by the new sequencing handler and by the shape-spec validator extension.
- No new client method needed — the raw idea's proposed `fetchLatestCapturedDecisionsStructured` was an audit miss documented in `planning/requirements.md`.

### `target-state-decisions-context` resolver + Spec 2 aggregation extension

- Resolver registered in `gateway/src/services/contextResolvers.ts` under key `target-state-decisions-context`. Renders the bounded grouped-by-scope prompt-ready summary the two existing PM-task prompts and the new sequencing prompt consume via their `contextNeeds` arrays.
- Spec 2's POST captured-decisions endpoint is reused as-is by the new sequencing handler to persist the `delivery.sequencing` answer — supersession is handled by the data plane on re-runs.

## Implementation Notes

- **Audit corrections from `planning/requirements.md`**: (1) the shape-spec validator file is `gateway/src/services/specGenerationResponseValidator.ts`, not the `migrationShapeSpecResponseSchema.ts` name from the raw idea — hand-rolled, not JSON-schema; (2) no new `fetchLatestCapturedDecisionsStructured` client method — the existing `fetchLatestCapturedDecisions` already returns the structured list. Both correctly threaded through this spec.
- **Sequencing-task availability gating** (per Q3 + Q10): the task config uses a static `availableFrom` mirroring the existing two PM tasks — no dynamic eligibility check at the config surface. The two `insufficient_context` runtime paths (no active target / no captured decisions) are handled in the handler itself and distinguished by `recommendedNextAction` text — "Define a target architecture first" vs "Run the architect conversation first".
- **Hand-rolled validators** (per project pattern established May-19): both the new `migrationDeliverySequencingResponseValidator.ts` and the extension to `specGenerationResponseValidator.ts` stay hand-rolled — no JSON-schema library introduced. Mirror the existing validator's error / warning return shape.
- **Boxed types on any new DTOs** (per `project_primitive_double_dto_overwrite.md`): if the sequencing structured response surfaces a Java DTO on the Architecture Model Service side, every numeric and boolean field uses `Long` / `Integer` / `Boolean`. This spec writes through the Spec 2 endpoint which already enforces this pattern — no new DTOs expected gateway-side beyond TypeScript interfaces.
- **Plain-English naming** (per `feedback_no_invented_acronyms.md`): write "Architecture Model Service" in error messages, log lines, and doc comments rather than introducing an acronym. Existing class names follow project convention.
- **Pre-existing test failures** (per project memory): the listed pre-existing failures are unrelated to this work and must not be touched. New tests in this spec are additive across six surfaces with the 4-8 cap per surface.
- **Trace before coding** (per `feedback_trace_before_coding.md`): before wiring the sequencing handler's POST to the Spec 2 endpoint, confirm the existing client method signature in `targetStateCapturedDecisionsClient.ts` matches the required write attributes (`createdByTask`, `conversationThreadId=null`, `conversationTurnRef=null`) — adjust the call site, not the client.
- **No frontend in this spec**: the new sequencing task surfaces through the existing PM-task menu automatically once the task config is registered. Project memory's frontend cache invariants are unaffected since no AppShell model state changes.

## Commit Boundary

One commit covering:
- Two prompt updates: `product-manager.migration-delivery-plan.task.md` and `product-manager.migration-shape-spec-generation.task.md`.
- Two task-config updates: `product-manager--migration-delivery-plan.json` and `product-manager--migration-shape-spec-generation.json` — `contextNeeds` extensions only.
- New sequencing task: `product-manager--migration-delivery-sequencing.json` config + `product-manager.migration-delivery-sequencing.task.md` prompt + `migrationDeliverySequencingHandler.ts` handler + `migrationDeliverySequencingResponseValidator.ts` validator.
- Shape-spec validator extension inside the existing `specGenerationResponseValidator.ts` plus the parse → validator → auto-seed → persist ordering hook in `migrationShapeSpecGenerationHandler.ts`.
- All backend tests across the six surfaces, 4-8 each, all LLM-mocked.
- No frontend changes, no new gateway client methods, no new Architecture Model Service endpoints, no Liquibase changesets.

## Definition of Done

- Running `product-manager--migration-delivery-plan` on a project with captured decisions produces a Book of Work whose initiative groupings reflect the captured decisions and whose story rationale references decision codes (verified by tests asserting prompt-section presence and resolved context delivery).
- Running `product-manager--migration-shape-spec-generation` on a project with captured decisions produces shape-specs whose `evidenceRefs[]` arrays include entries of shape `{ type: 'captured_decision', id: '<decision_code>' }`.
- The shape-spec validator extension appends a `missing_decision_citation` warning and downgrades LLM-rated confidence by exactly one notch when the project has captured decisions and a story's `evidenceRefs[]` contains zero `captured_decision` entries; no behaviour change when the project has zero captured decisions or when at least one `captured_decision` evidenceRef is present.
- The new `product-manager--migration-delivery-sequencing` task appears in the PM-task menu (via existing task-config-driven menu rendering — no frontend change required), runs single-turn, validates the structured response, posts the answer to the Spec 2 captured-decisions endpoint with the write attributes specified above, and returns `{ sequenceId, summary }`.
- Running the sequencing task on a project with no active target architecture returns `status='insufficient_context'` with `recommendedNextAction='Define a target architecture first'`.
- Running the sequencing task on a project with an active target but zero captured decisions returns `status='insufficient_context'` with `recommendedNextAction='Run the architect conversation first'`.
- Re-running the sequencing task supersedes the prior `delivery.sequencing` capture via the Spec 2 data plane's normal supersession path — verified by the handler test posting twice and asserting the second POST does not carry a `previousDecisionId` parameter.
- The token-budget cascade appends the decisions block post-cascade in all three PM tasks; the block is never truncated; combined overflow throws `TokenBudgetOverflowError` — verified by handler tests on a crafted oversized payload.
- All new backend tests pass; all existing PM-task tests still pass (additive `contextNeeds` extensions and additive prompt sections do not regress existing assertions).
- No frontend changes, no new Architecture Model Service endpoints, no new gateway client methods, and no Liquibase changesets are introduced — verified by file-presence assertions in the test surface for the two updated config files and by the absence of changes elsewhere.
