# Specification: Cross-Story Context Injection for Migration Shape-Spec Generation

## Goal
Extend the existing batch shape-spec generator so each story is generated with awareness of its siblings, parent epic decisions, and workstream-deduped references, via a bounded two-pass loop. The user-visible outcome is meaningfully higher spec quality without context overload, with full visibility into what crossed between stories and what trimming occurred.

## User Stories
- As a product manager triggering "Generate all", I want sibling story decisions, parent epic captured decisions, and deduped workstream references injected into each story's prompt so the resulting specs are internally consistent without me hand-merging them.
- As a product manager reviewing pass-2 output, I want an inline diff against pass 1 plus a "what changed and why" summary so I can validate that cross-story context actually moved the spec for a defensible reason.
- As an architect curating the epic-level record, I want a captured-decisions panel that I can edit and that survives regeneration so the decisions I have locked in are not overwritten by the next pass.

## Specific Requirements

**Extend the migration-spec-context endpoint with cross-story blocks**
- Keep the existing `POST /api/projects/{projectId}/migration-spec-context` signature for the focused per-story blocks; add four new top-level fields: `sibling_summaries`, `parent_rollup`, `workstream_context`, `budget_meta`.
- `sibling_summaries[]` carries `{ workItemId, title, decisions[], interfaces[], assumptions[], generationPass }` for siblings within the same parent feature or epic that already have a generated spec at the time of the request; never includes implementation steps.
- `parent_rollup` carries `{ epic: { title, description, capturedDecisions[] }, feature: { title, summary }, initiative: { title, summary } }`; feature/initiative summaries are 1 sentence each.
- `workstream_context` carries `{ apiBaselines[], architectureRefs[], referencedByStoryIds[] }` deduped at workstream level so per-story blocks never repeat the same baseline/ref.
- `budget_meta` carries `{ used_tokens, max_tokens, trimmed: { sibling_specs_dropped, evidence_refs_dropped } }`; surfaces trimming decisions to the UI.
- New optional request fields: `pass` (1 or 2), `passOneSpecIdsInScope[]` (which sibling rows pass 2 may read from).
- Failed and `insufficient_context` pass-1 rows MUST be excluded from `sibling_summaries[]` regardless of whether their id appears in `passOneSpecIdsInScope[]`.

**Parse structured fields from spec text at write time**
- Apply a deterministic regex/heading parser against the shape-spec template's stable headings when the gateway POSTs a spec to AMS persistence.
- Extract `decisions[]`, `interfaces[]`, `assumptions[]` and store as structured JSONB columns alongside `generated_spec_text` on `migration_story_spec_generations`.
- Parser failure does not block persistence; missing-heading cases store empty arrays and emit a warning that surfaces in `warnings_json`.
- No LLM call is used for this extraction at read or write time; no JSON-alongside-markdown emission is required from the LLM.
- Parser is the single canonical source for sibling-summary content; the context resolver reads these columns, never re-parses spec text at request time.

**Persist epic-level captured decisions as a first-class artifact**
- New table `epic_captured_decisions` keyed by `(project_id, epic_work_item_id)` with rows `{ id, projectId, epicWorkItemId, decisionKey, decisionText, source, sourceSpecGenerationId, status, createdAt, updatedAt, lastEditedBy }`.
- `source` enum: `auto_extracted`, `user_edited`, `user_added`; auto-seeded rows carry `auto_extracted` and a non-null `sourceSpecGenerationId`.
- `status` enum: `draft`, `confirmed`, `superseded`; only `confirmed` and `draft` rows feed pass-2 `parent_rollup.epic.capturedDecisions[]`.
- User edits flip `source` to `user_edited` and pin the row against further auto-overwrite.
- CRUD endpoints under `/api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions` (GET list, POST create, PATCH item, DELETE item); all changes audited via `lastEditedBy` and `updatedAt`.

**Two-pass batch orchestration with hard cap**
- Gateway extends `migrationShapeSpecGenerationHandler` to drive pass 1 then optionally pass 2 within a single "Generate all" invocation.
- Pass 1 runs unchanged from today's behaviour except `parent_rollup` and `workstream_context` are now included in the per-story prompt.
- Pass 2 runs only after pass 1 fully completes (success, failed, or insufficient_context per story); pass 2 reads sibling summaries from the just-persisted pass-1 rows.
- Hard cap: there is no pass 3; the handler refuses any third-pass request from the gateway boundary regardless of caller intent.
- Pass 2 NEVER reads other pass-2 outputs as sibling context; the resolver enforces this by filtering `sibling_summaries[]` to `generation_pass = 1` rows for the duration of the batch.
- Auto-run default: pass 2 fires automatically when pass 1 completes; per-project setting and per-batch toggle can disable it, leaving a manual "Regenerate with sibling context" action on the dashboard.

**Generation-pass persistence on `migration_story_spec_generations`**
- New columns: `generation_pass` (smallint, 1 or 2, CHECK constraint), `pass1_spec_text` (TEXT, snapshot of pass-1 output for diffing), `pass2_changes_summary` (TEXT, LLM-generated "what changed and why" blurb), `budget_meta_json` (jsonb, mirrors the resolver's `budget_meta` for the actually-executed call), `no_meaningful_change` (boolean).
- Pass-1 rows write `pass1_spec_text = generated_spec_text` and `generation_pass = 1`; pass-2 rows write `pass1_spec_text` carrying the snapshot from the prior row and `generation_pass = 2`.
- `no_meaningful_change` flips true when pass-2 output is byte-equivalent to pass-1 after a normalized whitespace compare; the UI uses this for the badge.
- Manual-edit protection (existing `confirmOverwrite` flag) continues to apply at pass-2 write time.

**Token budget envelope with tiered trimming**
- Per-project config: `per_story_context_token_cap` (default 24000) and `cross_story_context_token_cap` (default 12000); both editable in project config.
- Trimming order is fixed: sibling specs first (lowest-relevance siblings dropped first), then per-story evidence refs (lowest-relevance dropped first), then per-story discovery findings. The story description, parent rollup, and epic captured decisions are NEVER trimmed.
- Resolver records every trimming decision in `budget_meta.trimmed` and the gateway persists the same object on `migration_story_spec_generations.budget_meta_json`.
- When the cross-story budget cannot fit even a single sibling summary, the resolver emits a `no_sibling_context_available` warning and pass 2 still runs (it will simply behave like pass 1 with parent + workstream context only).

**Generation ordering for the batch**
- Pass 1 order: book-of-work `sequenceOrder` (parents-before-children, declared order within feature). This is the existing behaviour and is preserved.
- Pass 2 order: same `sequenceOrder` traversal; siblings are derived structurally from the work-item parent chain, not from dependency hints (which is Wave 2 #5 and out of scope).
- Both passes are serial within a batch (matches existing `R-4` posture); concurrency is not introduced by this spec.

**Concurrency lock per workstream**
- The "Generate all" button is disabled while any pass (1 or 2) of a batch is active for the same workstream; the UI shows a "Batch in progress" status with the active pass number.
- The handler refuses a second concurrent batch for the same workstream with a structured error the UI translates to a banner.
- The active batch must be cancelled (existing cancel flow) before a new one is launchable; no queueing, no fail-fast on the second request.

**Cost preview and post-batch actuals**
- New gateway endpoint `POST /api/migration-shape-spec/cost-preview` accepts `{ projectId, bookOfWorkId, includePass2 }` and returns `{ estimatedTokens, estimatedWallClockSeconds, perStoryEstimates[] }` computed from the existing focused-context payload sizes and a configurable tokens-per-second model.
- The "Generate all" dialog calls cost-preview before submitting and shows the estimate next to the auto-run pass-2 toggle, giving the user the explicit opportunity to disable pass 2 for heavy batches.
- After the batch completes, the post-batch summary renders actual tokens and wall-clock time per pass from `budget_meta_json` plus handler-side timing.

**Confidence + contradiction warnings on pass-2 outputs**
- After a pass-2 spec is generated, the gateway compares its `decisions[]` and `interfaces[]` (from the write-time parser) against the relevant sibling summaries and parent rollup.
- A `contradicts_sibling` warning entry (`{ kind: 'contradicts_sibling', siblingWorkItemId, conflictingDecisionKey, severity: 'review' }`) is appended to `warnings_json` when a sibling decision and the current spec decision disagree.
- An `aligned_with_epic_decision` informational entry is appended when a pass-2 decision matches a confirmed epic captured decision; confidence is bumped one notch (up to high).
- Existing confidence-downgrade rules (R-7) continue to fire; new rules are additive.
- Contradiction never auto-rolls-back pass-2 output; the warning is loud, the user always sees the latest reasoning.

## Visual Design

No visual assets were provided for this spec. The frontend additions described below should follow the conventions already established in `MigrationDeliveryDashboard` and its drawer components: card-based summary header, expandable sections via the existing `MigrationDeliverySectionRetryPlaceholder` pattern, badge styling consistent with confidence/status chips already in the dashboard.

## Existing Code to Leverage

**`MigrationSpecContextResolver` (architecture-model-service)**
- Already builds per-story focused blocks with `missingInputs[]` aggregation, bounded loaders for mappings/baselines/findings, and structured logging via `[diag-ams] spec_generation focused_context_*` markers.
- Extend with new private builders `buildSiblingSummaries(...)`, `buildParentRollup(...)`, `buildWorkstreamContext(...)`, and a `BudgetMetaTracker` helper that records trimming decisions.
- Reuse the existing `KNOWN_CONTEXT_TYPES` guard and the `shortPrefix` log helper.

**`migrationShapeSpecGenerationHandler` (gateway)**
- Already orchestrates serial-within-batch generation, applies `applyTokenBudgetCascade`, handles `TokenBudgetOverflowError` -> `insufficient_context`, validates via `assertSpecGenerationResponse`, posts results to AMS, and emits `[diag-gateway] pm_migration_shape_spec_generation` log markers.
- Wrap the existing handler in a pass-1 / pass-2 loop; reuse `applyTokenBudgetCascade` unchanged; reuse the per-story failure-isolation pattern verbatim; emit new `pass=1/2` and `cross_story_*` log marker variants.
- Reuse `specGenerationResponseValidator` and the story-title substring rule on pass-2 output.

**`MigrationStorySpecGenerationEntity` (architecture-model-service)**
- Already carries `generated_spec_text`, `warnings_json`, `missing_inputs_json`, `focused_context_refs_json`, `evidence_refs_json`, `generation_attempt_number`, `created_by_task`, `confirmOverwrite` semantics.
- Add `generation_pass`, `pass1_spec_text`, `pass2_changes_summary`, `budget_meta_json`, `no_meaningful_change`, plus the parsed `decisions_json`, `interfaces_json`, `assumptions_json` columns; reuse the existing `JsonType` + null-guard PATCH posture (see `project_primitive_double_dto_overwrite.md`).

**`MigrationDeliveryDashboard` and `MigrationDeliveryStoryDrawer` (frontend)**
- Already renders summary header with refresh, workstream progress strip, hierarchy tree, needs-attention panel, story detail drawer with missing-inputs subsection.
- Extend the dashboard with a "Workstream context" expandable section above the hierarchy tree, and the drawer with a pass-2 badge, no-meaningful-change badge, inline diff view, and cost summary; reuse the section retry placeholder for context-budget warnings.

**`product-manager--migration-shape-spec-generation` task config and prompt**
- Existing task config drives the LLM call; the prompt at `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md` already documents the spec template headings the parser depends on.
- Add a pass-2 variant of the prompt (or a conditional pass-2 section) that explicitly instructs the LLM to use sibling summaries and parent rollup; do NOT change the spec template heading structure (the parser is regex-based and the headings are load-bearing).

## Out of Scope
- Building the dependency-hint resolver (Wave 2 #5); pass-2 ordering uses book-of-work `sequenceOrder` only.
- Building the missing-input resolver flow (Wave 2 #1); missing-input surfacing keeps today's behaviour.
- An in-product spec editor (Wave 2 #3); user edits the spec via the existing flow.
- Extended quality scoring (Wave 2 #6); confidence-calc additions are limited to the contradiction / epic-alignment rules above.
- Any pass beyond pass 2; the hard cap is enforced and tested.
- LLM-based extraction of `decisions`/`interfaces`/`assumptions` from spec text (parser is deterministic).
- Per-story drawer backlinks from the deduped workstream context section.
- Per-story queueing or fail-fast when a workstream batch is in progress.
- Auto-rollback of pass-2 output on contradiction.
- env-var-only configuration of the auto-run pass-2 flag.
