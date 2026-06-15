# Raw Idea: PM Tasks Consume Captured Decisions + Delivery Sequencing

## Why this spec exists

Specs 1–3 ship the upstream half of the migration workflow:

- **Spec 1** seeds a target architecture that's a structural 1:1 clone of current state with equivalence mappings.
- **Spec 2** persists captured decisions, exposes them via a gateway resolver (`target-state-decisions-context`), and surfaces them in the `MigrationDiscoveryContextDto.targetStateDecisionsSummary` aggregation block.
- **Spec 3** lets the architect persona walk a ~50-question conversation that writes those decisions and decorates affected mapping rows with `[decision:<code>]` tags.

**This spec closes the loop on the downstream half.** Without it, the existing PM tasks (`product-manager--migration-delivery-plan` for book-of-work generation and `product-manager--migration-shape-spec-generation` for per-story spec generation) still produce **technology-naive** output. They don't read the captured decisions, they don't cite decision codes, and they may even re-ask questions the architect already answered. That breaks the end-to-end story.

After this spec ships, the user runs Suggest → Architect Conversation → Book of Work → Shape-Specs and every downstream artefact cites the decisions that shaped it. Stories say "Initiative: migrate Sybase 15 → Postgres 18 — driven by decision `db.engine`" instead of inventing technology context out of thin air. Per-story shape-specs cite the relevant decisions in their evidence section.

A second small but important piece: a new **single-turn PM-level question** — the *one* question the architect can't answer alone, namely initiative ordering / sequencing. The architect captures the technology deltas; the PM owns "which initiative ships first, what's parallelisable, what's blocked behind something else." This becomes a new PM task `product-manager--migration-delivery-sequencing` that runs after the architect conversation closes and writes its answer as a captured decision too.

## What this spec is (and isn't)

**This spec is:**
- Two **prompt updates** to existing PM-task prompts (delivery plan + shape-spec generation) telling them to treat captured decisions as facts, not questions to re-ask.
- A **`contextNeeds` extension** on the two existing PM-task configs adding `target-state-decisions-context` (Spec 2's resolver key) to their resolver list.
- A **new single-turn PM task** `product-manager--migration-delivery-sequencing` — task config + prompt + handler + structured-response validator.
- A **validator extension** on the existing shape-spec generation handler that flags missing decision-code citations and downgrades confidence accordingly.
- A small **gateway client method** for fetching the structured decisions list (the resolver returns prompt-ready text; the validator needs the structured list to cross-check citations).
- Backend tests on both PM-task surfaces. No frontend changes.

**This spec is not:**
- The architect conversation (Spec 3 — shipped).
- The captured-decisions data plane (Spec 2 — shipped).
- The Target State sub-tab + Suggest (Spec 1 — shipped).
- A rewrite of the PM-task orchestration pattern — the existing `gateway/src/services/migrationBookOfWorkHandler.ts` and `migrationShapeSpecGenerationHandler.ts` shape stays; only the prompts and context-resolver wiring change.
- The new sequencing task is NOT a multi-turn conversation — single-turn, structured-response, same pattern as the existing PM-task handlers.
- Any UI work. The sequencing task surfaces through the existing PM-task menu structure.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea. The shape-spec agent should treat them as given:

1. **Prompt updates, not orchestration rewrites.** The existing `migrationBookOfWorkHandler.ts` and `migrationShapeSpecGenerationHandler.ts` stay; only `gateway/src/config/prompts/*.task.md` files + `gateway/src/config/tasks/*.json` task configs change.
2. **Captured decisions surfaced via `target-state-decisions-context`** — the resolver Spec 2 shipped. Added to the `contextNeeds` of the two existing PM tasks.
3. **One new PM task** — `product-manager--migration-delivery-sequencing`. Single-turn. Structured-response validator. No multi-turn loop. Mirrors the existing PM-task handler shape.
4. **The sequencing task's answer is itself a captured decision** with `decision_code='delivery.sequencing'` (or similar) — writes through Spec 2's POST endpoint. Recorded under `scope_kind='architecture'` since sequencing applies to the whole book of work, not per-element.
5. **Confidence downgrade for missing citations** — the shape-spec generation handler already has confidence-downgrade logic (per the 2026-05-19 spec); extend it with a rule that downgrades when a story should cite a decision code but doesn't.
6. **No new AMS endpoints.** All reads go through the existing Spec 2 surfaces. The new sequencing PM-task writes through Spec 2's existing POST endpoint.
7. **No frontend changes** — the new sequencing task surfaces through the same PM-task menu the existing tasks use.
8. **One commit boundary** — the spec is small enough; per-commit splits would create churn.

## Specific requirements (rough — let shape-spec refine)

### `product-manager--migration-delivery-plan` prompt update

- File: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
- Add a new section "## Target State Decisions Context" that explains: the architect persona has already captured the technology decisions for this migration; you must treat them as facts, not propose alternatives. Stories MUST reference the decision codes that drove them in their evidence section.
- Add rule: "Initiative grouping must align with the captured decisions. A `db.engine` change → at least one initiative for database migration. A `service.framework` change → at least one initiative for service-layer refactor. Etc."
- Add anti-rule: "Do NOT ask the user follow-up questions about technology choices — those are settled in the captured decisions."
- The existing 8 prompt rules (functional equivalence, evidence-only, no invention, etc) stay.

### `product-manager--migration-delivery-plan.json` config update

- File: `gateway/src/config/tasks/product-manager--migration-delivery-plan.json`
- Add `target-state-decisions-context` to the `contextNeeds` array alongside the existing `migration-discovery-context`.
- No other changes to the task config.

### `product-manager--migration-shape-spec-generation` prompt update

- File: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
- Add a section explaining captured decisions are evidence the generated spec must cite.
- Add rule: "Every generated shape-spec MUST include an `evidenceRefs` entry naming the decision codes that drove the story. If no decision applies, the story should explain why."
- Add anti-rule: "Do NOT generate technology-specific implementation detail that contradicts a captured decision. If `db.engine='Postgres 18'` is captured, the spec MUST NOT propose generating MySQL DDL."
- The existing 8 prompt rules stay.

### `product-manager--migration-shape-spec-generation.json` config update

- File: `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`
- Add `target-state-decisions-context` to the `contextNeeds` array.
- No other changes.

### New PM task: `product-manager--migration-delivery-sequencing`

- New task config: `gateway/src/config/tasks/product-manager--migration-delivery-sequencing.json`.
- New prompt: `gateway/src/config/prompts/product-manager.migration-delivery-sequencing.task.md`.
- New handler: `gateway/src/services/migrationDeliverySequencingHandler.ts` (modelled on the existing `migrationBookOfWorkHandler.ts`).
- New structured-response validator: `gateway/src/services/migrationDeliverySequencingResponseSchema.ts` (modelled on `generatedMigrationBookOfWorkSchema.ts`).
- Handler flow:
  1. Resolve context (book of work + target-state-decisions + migration-discovery-context).
  2. Apply token budget cap (mirror existing PM tasks).
  3. Single synchronous LLM call.
  4. Validate the structured response against the schema.
  5. POST the answer to Spec 2's POST captured-decisions endpoint with `decision_code='delivery.sequencing'` (or codes for each sequencing dimension if multi-field).
  6. Return `{ sequenceId, summary }` to the frontend.
- Structured response shape (rough): `{ status: 'sequenced' | 'insufficient_context' | 'failed', initiativeOrder: [{initiativeId, sequence, parallelisableWith: [...], blockedBy: [...], rationale}], confidence, warnings }`.
- The prompt asks ONE question only — given the captured decisions + book of work, what's the recommended initiative order?
- Surfaces in the existing PM-task menu (the `availableFrom` field on the task config — mirror the existing two PM tasks).

### Gateway client method for structured decisions

- New method on a gateway-side client (likely `gateway/src/services/targetStateCapturedDecisionsClient.ts` from Spec 2) — `fetchLatestCapturedDecisionsStructured(projectId, targetArchitectureId)`.
- Calls AMS `GET .../captured-decisions` (latest, structured), returns the parsed list.
- Used by the new shape-spec validator extension (below) and potentially by the sequencing handler.

### Shape-spec validator extension

- File: `gateway/src/services/migrationShapeSpecResponseSchema.ts` (existing).
- Extend the validator: for `status='generated'` or `'generated_with_warnings'`, check whether the story's `evidenceRefs` includes any decision codes. If the captured decisions list is non-empty AND the story doesn't cite any decision code, append a structured warning `{kind: 'missing_decision_citation', recommendedNextAction: 'review and add decision codes'}`. Downgrade LLM-rated confidence to `medium` if it was `high`, or to `low` if it was already `medium`.
- This is a per-story validator extension — runs after the existing validator passes the structural checks.

### Tests

Backend only. Moderate scope:
- **Prompt update tests** — golden-file or contract tests that the updated prompt text contains the expected new sections and the existing rules are preserved.
- **`contextNeeds` extension tests** — verify the task-config JSON has `target-state-decisions-context` in the array.
- **New sequencing task handler tests** — happy path (decisions + book of work → sequenced answer + captured decision POST), insufficient_context path (no decisions captured → returns insufficient), failed path, structured-response validator coverage.
- **Sequencing validator tests** — schema validation for the three response variants, hard rules enforcement (e.g. `initiativeOrder` non-empty when status=`'sequenced'`).
- **Shape-spec validator extension tests** — missing decision citation warning + confidence downgrade combinations.
- **Gateway client method tests** — happy path, empty response, error pass-through.
- Cap 4-8 tests per surface per the established pattern.
- No frontend tests.

### Out of scope

- Frontend changes — the new sequencing task surfaces through the existing PM-task menu.
- New AMS endpoints — all reads/writes use existing Spec 2 surfaces.
- Changes to the architect conversation in Spec 3.
- A separate captured-decision scope kind for "delivery" — sequencing fits under `scope_kind='architecture'` with a project-level decision code.
- Automatic re-generation of book of work when decisions change after the book is generated. v1 leaves the existing book as-is; the user explicitly re-runs the delivery-plan task if they want a refresh.
- Mapping mutations driven by sequencing decisions (sequencing is project-level orchestration, not a per-element technology change).
- Decision-code citation validation on existing already-generated stories — only applies to new generations.

## Dependencies

- `2026-05-24-target-state-subtab-deterministic-suggest` (Spec 1) — shipped + committed.
- `2026-05-24-target-state-captured-decisions-data-plane` (Spec 2) — shipped + committed. This spec writes to Spec 2's POST endpoint and reads via Spec 2's resolver + aggregation extension.
- `2026-05-24-target-state-architect-conversation` (Spec 3) — shipped + committed. The captured decisions this spec consumes get written by Spec 3's conversation.
- The existing PM-task handlers and their pre-Spec-4 prompts/configs (May-17 + May-19 specs). This spec extends them; doesn't replace.
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern — new sequencing-response DTOs follow.

## Open questions for shape-spec to clarify

1. **Decision code for sequencing — single code or multi-code?** Single `decision_code='delivery.sequencing'` with the full `initiativeOrder` JSON in `answer_value` is simpler. Multi-code (`delivery.sequencing.order`, `delivery.sequencing.parallelisable`, `delivery.sequencing.prerequisites`) is more queryable. My instinct: **single code with structured JSON in `answer_value`** — sequencing is a single atomic concept; multi-code adds complexity without obvious downstream consumer.

2. **Sequencing task: re-runnable?** The PM might want to re-run sequencing after the book of work changes. Supersession on Spec 2's data plane handles this — re-running writes a new superseding row. Confirm there's nothing else to do (no special "regenerate" flag, no UI affordance — just run the task again).

3. **Sequencing task availability gating** — should the task be greyed out / hidden in the PM menu if no architect conversation has been captured yet (no decisions to sequence around)? My instinct: **yes, gate it**. The task config's `availableFrom` mechanism can probably express "only when target-state-decisions-context is non-empty for the active target." If `availableFrom` can't express that, a runtime check in the handler that returns `status='insufficient_context'` with a clear "run the architect conversation first" message.

4. **`evidenceRefs` shape for decision codes** — the existing `evidenceRefs[]` field on a generated shape-spec is opaque. Does it accept an object like `{kind: 'captured-decision', code: 'db.engine'}` or strings like `'decision:db.engine'`? Audit the existing schema. My instinct: **mirror whatever shape the existing `evidenceRefs[]` uses for the existing evidence kinds** (probably string-based per the May-19 spec's hand-rolled validator). Use a string format like `'decision:db.engine'` if so.

5. **Validator extension confidence-downgrade severity** — missing citation = downgrade by one notch (high→medium, medium→low, low→stays-low)? Or downgrade by two? My instinct: **one notch** — citation absence is a yellow flag, not a red one; the spec might still be valid if the story is genuinely tech-agnostic.

6. **Prompt-update test approach — golden file or structural assertions?** Golden file (literal text match) catches every prompt edit accidentally. Structural assertions ("the prompt contains the substring 'captured decisions'") are more resilient but might miss subtle regressions. My instinct: **structural assertions** for the new sections; the existing prompt content stays in scope as a separate concern.

7. **Token budget impact** — adding `target-state-decisions-context` to two PM tasks' `contextNeeds` increases the assembled-context size. The existing token-budget cascade in `migrationBookOfWorkHandler.ts` and `migrationShapeSpecGenerationHandler.ts` handles overflow. Confirm: the new decisions block is added to the cascade order (probably drop AFTER architecture refs + mappings + baselines, BEFORE dropping evidence — decisions are highly relevant to story generation). My instinct: **decisions are last-to-drop alongside `architectureReferences[]`** — they're the most-cited evidence in the new generations.

8. **What happens if the architect conversation is incomplete** (some questions deferred or un-answered)? The PM tasks still run, but the decisions context is partial. My instinct: **prompt explicitly tells the LLM to flag deferred/un-answered decisions as gaps in the warnings array of the structured response**. The user sees them and decides whether to go back to the architect conversation or accept the partial.

9. **Single PM-level sequencing question, or multiple?** Earlier conversation called out "delivery sequencing" as the ONE PM-level question. Are there others worth surfacing here? Candidates: team/squad allocation, release cadence, risk acceptance. My instinct: **just sequencing for v1**. Team allocation lives outside this product. Release cadence is captured by cut-over decisions in the architect conversation (Group J). Risk acceptance is captured by story `readiness` field already. Defer additional PM questions to a future spec.

10. **Sequencing handler error: insufficient_context vs failed** — when no decisions exist, return `insufficient_context` (so the frontend can render "run the architect conversation first") rather than `failed` (which implies retry might help). Confirm.

## Verification

After this spec:
- The existing `product-manager--migration-delivery-plan` task reads `target-state-decisions-context` from its resolved context and produces a book of work that cites decision codes in story rationale.
- The existing `product-manager--migration-shape-spec-generation` task reads the same and produces per-story specs with `evidenceRefs` entries naming decision codes.
- The shape-spec validator flags missing citations and downgrades confidence.
- A new `product-manager--migration-delivery-sequencing` task exists in the PM menu, runs single-turn, produces an initiative ordering, and writes its answer as a captured decision.
- Re-running the architect conversation that captures new decisions changes the next book-of-work generation's output without code changes (just prompt + context consumption).
- All new backend tests pass.
- Existing PM-task tests still pass — the contextNeeds extension is additive; prompt updates are additive sections.

## Commit boundary

One commit covering: two prompt updates, two task-config updates, new sequencing task config + prompt + handler + validator, new gateway client method, shape-spec validator extension, backend tests.
