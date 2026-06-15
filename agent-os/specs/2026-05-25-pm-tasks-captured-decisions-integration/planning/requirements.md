# Spec Requirements: PM Tasks Captured Decisions Integration + Delivery Sequencing

## Initial Description

Specs 1-3 ship the upstream half of the migration workflow (target architecture clone, captured-decisions data plane, architect conversation). The existing PM tasks (`product-manager--migration-delivery-plan` and `product-manager--migration-shape-spec-generation`) still produce technology-naive output — they don't read the captured decisions, don't cite decision codes, and may re-ask questions the architect already answered.

This spec closes the loop on the downstream half by:

1. Updating the two existing PM-task prompts to treat captured decisions as facts (not questions to re-ask) and to cite decision codes in their output.
2. Adding `target-state-decisions-context` to both tasks' `contextNeeds` so the resolver from Spec 2 feeds them.
3. Introducing one new single-turn PM task `product-manager--migration-delivery-sequencing` — the one question the architect can't answer alone (initiative ordering / parallelisation / blockers). Its answer is itself captured as a decision via Spec 2's POST endpoint.
4. Extending the existing shape-spec generation validator to flag missing decision-code citations and downgrade confidence.
5. Backend tests across all touched surfaces. No frontend changes.

After this spec, the full Suggest → Architect Conversation → Book of Work → Shape-Specs flow produces artefacts that cite the decisions which shaped them.

## Settled Decisions (load-bearing — already agreed; do not re-litigate)

These eight decisions were settled in the conversation that produced the raw idea. The spec-writer must treat them as given:

1. **Prompt updates, not orchestration rewrites.** Existing `migrationBookOfWorkHandler.ts` and `migrationShapeSpecGenerationHandler.ts` stay; only `gateway/src/config/prompts/*.task.md` files and `gateway/src/config/tasks/*.json` task configs change.
2. **Captured decisions surfaced via `target-state-decisions-context`** — the resolver Spec 2 shipped. Added to the `contextNeeds` of the two existing PM tasks.
3. **One new PM task** — `product-manager--migration-delivery-sequencing`. Single-turn. Structured-response validator. No multi-turn loop. Mirrors the existing PM-task handler shape.
4. **The sequencing task's answer is itself a captured decision** with `decision_code='delivery.sequencing'`, written via Spec 2's existing POST endpoint. Recorded under `scope_kind='architecture'` since sequencing applies to the whole book of work, not per-element.
5. **Confidence downgrade for missing citations** — the shape-spec generation handler's existing confidence-downgrade logic (per the 2026-05-19 spec) gets extended with a rule that downgrades when a story should cite a decision code but doesn't.
6. **No new AMS endpoints.** All reads go through existing Spec 2 surfaces. The new sequencing PM-task writes through Spec 2's existing POST endpoint.
7. **No frontend changes** — the new sequencing task surfaces through the existing PM-task menu.
8. **One commit boundary** — the spec is small enough; per-commit splits would create churn.

## Requirements Discussion

### Clarifying Questions and Answers

**Q1: Sequencing decision code — single code or multi-code?**
**Answer:** Single `decision_code='delivery.sequencing'` with the full `initiativeOrder` structured JSON in `answer_value`. Simpler; sequencing is a single atomic concept; multi-code adds complexity with no obvious downstream consumer.

**Q2: Sequencing task re-runnable?**
**Answer:** Normal POST through Spec 2's data plane — supersession does the work. No `previousDecisionId` parameter on the POST; no special "regenerate" flag; no UI affordance. Just re-run the task.

**Q3: Sequencing task availability gating — should it be greyed out / hidden when no decisions are captured?**
**Answer:** Static `availableFrom` (mirroring the existing two PM tasks); runtime gate lives in the handler. When no captured decisions exist the handler returns `status='insufficient_context'` with a clear "run the architect conversation first" `recommendedNextAction`.

**Q4: `evidenceRefs` shape for decision codes — string or object?**
**Answer:** Object form `{type: 'captured_decision', id: 'db.engine'}` — snake_case `type` value to match the existing `type: 'architecture_element_mapping'` convention used in the May-19 shape-spec generation validator.

**Q5: Validator downgrade trigger — what counts as "should have cited a decision"?**
**Answer:** Downgrade fires when the project has captured decisions AND a story's `evidenceRefs[]` contains zero entries with `type: 'captured_decision'`. Story-level scope cross-check (e.g. only downgrade if the story actually touches a domain that has a decision) is deferred to a future spec.

**Q6: Prompt-update test approach — golden file or structural assertions?**
**Answer:** Structural assertions — substring checks for the new section headings and the critical anti-rule phrases. The existing prompt content remains in scope of the upstream specs that introduced it.

**Q7: Token budget cascade — where does the decisions block sit?**
**Answer:** Decisions block is appended **post-cascade and is never truncated**. If the combined payload exceeds the cap a `TokenBudgetOverflowError` is thrown. Decisions are high-signal evidence and bounded in size by the question-library size (~51 decisions max).

**Q8: Handling incomplete architect conversations (deferred / un-answered questions)?**
**Answer:** LLM-infers gaps from the rendered markdown alone — no resolver change in Spec 2. The updated PM-task prompts instruct the LLM to flag inferred gaps as warnings in the structured response.

**Q9: Single PM-level sequencing question, or multiple?**
**Answer:** v1 = sequencing only. Team / squad allocation, release cadence, and risk acceptance are explicitly recorded out-of-scope for v1.

**Q10: Sequencing handler error — `insufficient_context` vs `failed`?**
**Answer:** Both the no-active-target case AND the no-decisions case return `status='insufficient_context'`. The two are distinguished by `recommendedNextAction` text — "Define a target architecture first" vs "Run the architect conversation first."

**Q11: New sequencing-response validator file name and style?**
**Answer:** `gateway/src/services/migrationDeliverySequencingResponseValidator.ts`. Hand-rolled, mirroring `specGenerationResponseValidator.ts`. NOT JSON-schema style. (Note: the raw idea proposed `migrationDeliverySequencingResponseSchema.ts` — that was an audit miss; the correct convention is the `*ResponseValidator.ts` hand-rolled pattern established by the May-19 spec.)

**Q12: Sequencing handler `bookOfWorkId` — required input or fetched server-side?**
**Answer:** Required input parameter on the handler. Frontend supplies it (it just rendered the book of work). No new AMS endpoint for "latest book of work."

**Q13: Sequencing validator hard checks?**
**Answer:**
Hard fails:
- Every `initiativeId` in the response must exist in the loaded book of work.
- `parallelisableWith` and `blockedBy` arrays must only contain valid initiative IDs.
- `sequence` must be a positive integer.

Warning only (not hard fail):
- Cycle detection in the `blockedBy` graph.

**Q14: Sequencing prompt body wording?**
**Answer:** Defer to the write-spec phase. Raw idea and requirements only record the high-level rules:
- Must cite decision codes in `rationale`.
- Must reference initiative IDs from the supplied book of work.
- Mandatory functional-equivalence clause.

**Q15: `createdByTask` value on the sequencing capture; `conversationThreadId` + `conversationTurnRef`?**
**Answer:** `createdByTask = 'product-manager--migration-delivery-sequencing'`. `conversationThreadId = null` and `conversationTurnRef = null` (single-turn task, no conversation thread).

**Q16: Test count caps — keep the 4-8-per-surface convention or relax?**
**Answer:** (a) Keep the 4-8 cap per surface — up to ~40 tests total across the 6 surfaces.

**Q17: Gateway client method for structured decisions list — new method or reuse existing?**
**Answer:** Reuse the existing `fetchLatestCapturedDecisions` and `fetchActiveTargetArchitectureId` on `targetStateCapturedDecisionsClient.ts`. **No new method needed** — the raw idea's proposed `fetchLatestCapturedDecisionsStructured` was an audit miss; the existing `fetchLatestCapturedDecisions` already returns the structured `TargetStateCapturedDecision[]` list.

**Q18: Validator extension ordering inside the shape-spec handler?**
**Answer:** Parse → validator extension (warnings + confidence downgrade) → auto-seed (the existing Spec 19-May behaviour) → persist.

**Q19: Should PM prompts mention `[decision:<code>]` tagging?**
**Answer:** Yes — it's a low-cost prompt addition that helps the LLM correlate decision codes with the mapping rationale text written by Spec 3's architect conversation.

### Existing Code to Reference

**Similar features identified (from the raw idea — no additional references supplied by the user this session):**

- Existing PM-task handlers to mirror in shape and pattern:
  - `gateway/src/services/migrationBookOfWorkHandler.ts`
  - `gateway/src/services/migrationShapeSpecGenerationHandler.ts`
- Existing structured-response validator pattern to mirror (hand-rolled, NOT JSON-schema):
  - `gateway/src/services/specGenerationResponseValidator.ts`
- Existing gateway client to reuse (no new method needed):
  - `gateway/src/services/targetStateCapturedDecisionsClient.ts` — `fetchLatestCapturedDecisions` + `fetchActiveTargetArchitectureId`
- Existing PM-task prompts being extended:
  - `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
  - `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
- Existing PM-task configs being extended:
  - `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
  - `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
- Upstream Specs 1-3 (shipped) provide the data plane and architect conversation this spec consumes.

### Follow-up Questions

None — all 19 clarifying questions resolved cleanly. No contradictions or critical gaps surfaced during requirements gathering.

## Visual Assets

No visual assets provided. Bash check of `planning/visuals/` returned no files. Work proceeds from prose only.

## Audit Corrections Applied

Two factual misnomers in the raw idea are silently corrected throughout this requirements doc and must be carried through to `spec.md`:

1. **Shape-spec validator file name.** Raw idea references `gateway/src/services/migrationShapeSpecResponseSchema.ts`. The actual existing file is **`gateway/src/services/specGenerationResponseValidator.ts`** (hand-rolled, not JSON-schema). All references to the shape-spec validator file should use the correct name.
2. **Gateway client method.** Raw idea proposes adding `fetchLatestCapturedDecisionsStructured` to `targetStateCapturedDecisionsClient.ts`. That subsection is **dropped** — the existing `fetchLatestCapturedDecisions` method already returns the structured `TargetStateCapturedDecision[]` list. No new client method is needed; the sequencing handler and the shape-spec validator extension both reuse the existing surface.

## Requirements Summary

### Functional Requirements

**Prompt update: `product-manager--migration-delivery-plan`**
- File: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
- Add a new section "## Target State Decisions Context" explaining the architect persona has already captured technology decisions; they are facts, not alternatives to propose.
- Add rule: "Initiative grouping must align with captured decisions" (e.g. `db.engine` change → at least one database-migration initiative; `service.framework` change → at least one service-layer-refactor initiative).
- Add rule: "Stories MUST reference the decision codes that drove them in their evidence section."
- Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable, mirroring Spec 3's mapping-row decoration convention."
- Add anti-rule: "Do NOT ask the user follow-up questions about technology choices — those are settled in the captured decisions."
- Existing 8 prompt rules (functional equivalence, evidence-only, no invention, etc.) preserved verbatim.

**Config update: `product-manager--migration-delivery-plan.json`**
- File: `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
- Add `target-state-decisions-context` to the `contextNeeds` array (alongside existing `migration-discovery-context`). No other changes.

**Prompt update: `product-manager--migration-shape-spec-generation`**
- File: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
- Add a section explaining captured decisions are evidence the generated spec must cite.
- Add rule: "Every generated shape-spec MUST include `evidenceRefs[]` entries with `type: 'captured_decision'` naming the decision codes that drove the story. If no decision applies, the story should explain why."
- Add rule: "Use `[decision:<code>]` tags inline in story rationale where applicable."
- Add anti-rule: "Do NOT generate technology-specific implementation detail that contradicts a captured decision. If `db.engine='Postgres 18'` is captured, the spec MUST NOT propose generating MySQL DDL."
- Add rule (gap-handling): "If the captured decisions context appears incomplete relative to the story scope, flag the gap as a warning in the structured response."
- Existing 8 prompt rules preserved verbatim.

**Config update: `product-manager--migration-shape-spec-generation.json`**
- File: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
- Add `target-state-decisions-context` to the `contextNeeds` array. No other changes.

**New PM task: `product-manager--migration-delivery-sequencing`**
- New task config: `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json`
- New prompt: `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`
- New handler: `gateway/src/services/migrationDeliverySequencingHandler.ts` (modelled on `migrationBookOfWorkHandler.ts`).
- New structured-response validator: `gateway/src/services/migrationDeliverySequencingResponseValidator.ts` (hand-rolled, modelled on `specGenerationResponseValidator.ts`).
- `availableFrom`: static, mirroring the existing two PM tasks. No dynamic gating in the task-config surface.
- Handler input: `bookOfWorkId` is a **required** parameter supplied by the frontend.
- Handler flow:
  1. Resolve context (book of work loaded via supplied `bookOfWorkId` + `target-state-decisions-context` + `migration-discovery-context`).
  2. If no active target architecture: return `status='insufficient_context'`, `recommendedNextAction='Define a target architecture first'`.
  3. If no captured decisions exist: return `status='insufficient_context'`, `recommendedNextAction='Run the architect conversation first'`.
  4. Apply token-budget cap (mirror existing PM tasks); the decisions block is appended post-cascade and never truncated — throw `TokenBudgetOverflowError` on overflow.
  5. Single synchronous LLM call.
  6. Validate the structured response against `migrationDeliverySequencingResponseValidator.ts`.
  7. POST the answer to Spec 2's POST captured-decisions endpoint with `decision_code='delivery.sequencing'`, `scope_kind='architecture'`, `createdByTask='product-manager--migration-delivery-sequencing'`, `conversationThreadId=null`, `conversationTurnRef=null`, and the full `initiativeOrder` JSON in `answer_value`.
  8. Return `{ sequenceId, summary }` to the frontend.
- Structured response shape (refine in spec.md):
  ```
  {
    status: 'sequenced' | 'insufficient_context' | 'failed',
    initiativeOrder: [{ initiativeId, sequence, parallelisableWith: [...], blockedBy: [...], rationale }],
    confidence,
    warnings,
    recommendedNextAction (when status != 'sequenced')
  }
  ```
- Prompt asks ONE question: given the captured decisions + the supplied book of work, what's the recommended initiative ordering? Prompt wording deferred to write-spec phase; mandatory rules: must cite decision codes in `rationale`, must reference initiative IDs from the supplied book of work, mandatory functional-equivalence clause.

**Sequencing validator hard checks (`migrationDeliverySequencingResponseValidator.ts`)**
- Hard fail: every `initiativeId` in the response exists in the supplied book of work.
- Hard fail: every entry in `parallelisableWith` and `blockedBy` is a valid initiative ID from the supplied book of work.
- Hard fail: every `sequence` value is a positive integer.
- Hard fail: when `status='sequenced'`, `initiativeOrder` must be non-empty.
- Warning only (not hard fail): cycle detection in the `blockedBy` graph.

**Shape-spec validator extension (`specGenerationResponseValidator.ts`)**
- Extend the existing hand-rolled validator: for `status='generated'` or `'generated_with_warnings'`, if the project has captured decisions AND a story's `evidenceRefs[]` contains zero entries with `type: 'captured_decision'`, append a structured warning `{kind: 'missing_decision_citation', recommendedNextAction: 'review and add decision codes'}` and downgrade the LLM-rated confidence by one notch (high → medium, medium → low, low → stays low).
- Per-story check; story-level scope cross-check is out of scope for this spec.
- Handler ordering within `migrationShapeSpecGenerationHandler.ts`: parse → validator extension (warnings + confidence downgrade) → auto-seed (Spec 19-May behaviour) → persist.
- The validator extension consumes the structured decisions list via the existing `fetchLatestCapturedDecisions` (no new client method).

**Gateway client — no change**
- `targetStateCapturedDecisionsClient.ts` already exposes `fetchLatestCapturedDecisions` and `fetchActiveTargetArchitectureId`. Both the new sequencing handler and the shape-spec validator extension reuse these. No new client method.

### Reusability Opportunities

- Mirror the structure of `migrationBookOfWorkHandler.ts` when building `migrationDeliverySequencingHandler.ts` — context resolution, token-budget application, single-turn LLM call, structured-response validation, POST-back to AMS, return shape.
- Mirror `specGenerationResponseValidator.ts` for the new hand-rolled `migrationDeliverySequencingResponseValidator.ts`.
- Reuse `targetStateCapturedDecisionsClient.ts` surface as-is — no new methods.
- Reuse Spec 2's POST captured-decisions endpoint to persist the sequencing answer.
- Reuse the existing PM-task menu surface for the new sequencing task — no frontend changes.

### Scope Boundaries

**In scope:**
- Two prompt updates: delivery-plan and shape-spec-generation.
- Two task-config `contextNeeds` extensions.
- One new PM task: config + prompt + handler + structured-response validator.
- One shape-spec validator extension (missing-decision-citation warning + one-notch confidence downgrade).
- Backend tests across 6 surfaces, capped 4-8 each (~40 tests total).
- One commit.

**Out of scope:**
- Frontend changes — the new sequencing task surfaces through the existing PM-task menu.
- New AMS endpoints — all reads/writes use existing Spec 2 surfaces.
- Changes to the architect conversation in Spec 3.
- A separate captured-decision `scope_kind` for "delivery" — sequencing fits under `scope_kind='architecture'`.
- Automatic re-generation of the book of work when decisions change after the book is generated; v1 leaves the existing book as-is and the user explicitly re-runs the delivery-plan task to refresh.
- Mapping mutations driven by sequencing decisions (sequencing is project-level orchestration, not a per-element technology change).
- Decision-code citation validation on existing already-generated stories — only applies to new generations.
- Additional PM-level questions beyond sequencing (team / squad allocation, release cadence, risk acceptance) — deferred to a future spec.
- Story-level scope cross-check for the missing-citation downgrade (only downgrade when the story touches a domain that has a decision) — deferred to a future spec.
- A new `fetchLatestCapturedDecisionsStructured` client method — existing surface is sufficient.
- A `previousDecisionId` parameter on the sequencing POST — supersession is handled by Spec 2's data plane.
- Multi-code decomposition of the sequencing answer (`delivery.sequencing.order`, `delivery.sequencing.parallelisable`, etc.) — single `delivery.sequencing` code with structured JSON in `answer_value`.

### Technical Considerations

- **Integration points:** Spec 2's resolver `target-state-decisions-context`, Spec 2's POST captured-decisions endpoint, Spec 2's `fetchLatestCapturedDecisions` client method, existing PM-task handler shape.
- **Constraints:**
  - No frontend code.
  - No new AMS endpoints.
  - Hand-rolled validators (no JSON-schema libraries) per the established May-19 pattern.
  - `@JsonNaming(LowerCamelCaseStrategy.class)` pattern for any new sequencing-response DTOs.
  - Token-budget cascade: decisions block appended post-cascade and never truncated; overflow throws `TokenBudgetOverflowError`.
  - Static `availableFrom` on the new task config; runtime gating lives in the handler.
- **`evidenceRefs[]` convention:** object form `{type: 'captured_decision', id: 'db.engine'}` with snake_case `type` value, matching the existing `type: 'architecture_element_mapping'` convention.
- **Captured-decision write attributes for the sequencing task:**
  - `decision_code = 'delivery.sequencing'`
  - `scope_kind = 'architecture'`
  - `createdByTask = 'product-manager--migration-delivery-sequencing'`
  - `conversationThreadId = null`
  - `conversationTurnRef = null`
  - `answer_value` = full structured `initiativeOrder` JSON.
- **Test surfaces (6 total, 4-8 each):**
  1. Prompt update tests — structural assertions for the new section headings and critical anti-rule phrases.
  2. `contextNeeds` extension tests — verify the two task-config JSON files have `target-state-decisions-context` in the array.
  3. New sequencing task handler tests — happy path, both `insufficient_context` variants (no active target / no decisions), failed path, structured-response validator coverage, POST-to-Spec-2 wiring.
  4. Sequencing validator tests — schema validation for the three response variants, hard rules enforcement, cycle-detection warning.
  5. Shape-spec validator extension tests — missing-decision-citation warning + the three confidence-downgrade combinations.
  6. Gateway-client integration coverage — exercised via the handler tests above (no new client method, so no dedicated client test surface needed beyond what the existing `targetStateCapturedDecisionsClient.ts` already has).

### Verification

After this spec:
- The existing `product-manager--migration-delivery-plan` task reads `target-state-decisions-context` from its resolved context and produces a book of work that cites decision codes in story rationale.
- The existing `product-manager--migration-shape-spec-generation` task reads the same context and produces per-story specs with `evidenceRefs` entries naming decision codes.
- The shape-spec validator flags missing citations and downgrades confidence by one notch.
- The new `product-manager--migration-delivery-sequencing` task exists in the PM menu, runs single-turn, produces an initiative ordering, and writes its answer as a captured decision via Spec 2's POST endpoint.
- Re-running the architect conversation to capture new decisions changes the next book-of-work generation's output without code changes (prompt + context consumption only).
- All new backend tests pass; existing PM-task tests still pass (contextNeeds extension is additive; prompt updates are additive sections).

### Commit Boundary

One commit covering: two prompt updates, two task-config updates, new sequencing task config + prompt + handler + validator, shape-spec validator extension, backend tests across six surfaces. No new gateway client method; no frontend changes; no new AMS endpoints.
