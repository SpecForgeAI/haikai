# Specification: Generate Shape-Specs from Migration Book of Work (Spec 2)

## Goal
Add a Product Manager task `product-manager--migration-shape-spec-generation` that consumes the saved `GeneratedMigrationBookOfWork` + saved `WorkItem`s + focused migration context and produces literal `/agent-os:shape-spec [spec details]` implementation specs in configurable batches (default 25), each linked to its saved `WorkItem` with status / confidence / warnings / missingInputs preserved. This spec generates the specs; it does NOT execute them.

## User Stories
- As a Product Manager moving from a saved migration book of work to implementation-ready prompts, I want to generate `/agent-os:shape-spec` content for all saved story `WorkItem`s in batches of 25 so I can fill the implementation backlog without hand-authoring every spec.
- As a reviewer of generated specs, I want to see per-story actual generation status, confidence, warnings, missingInputs, and predicted-vs-actual comparison so I can identify weak specs and the stories that still need more context before re-attempting.
- As an implementing engineer, I want each generated shape-spec retrievable from the WorkItem's existing Implement tab so the normal implementation flow picks up the spec without a parallel UX.

## Specific Requirements

**Gateway task config (R-2, R-11)**
- New task config `gateway/src/config/tasks/product-manager--migration-shape-spec-generation.json`, key-for-key matching the shape of `product-manager--migration-delivery-plan.json` from Spec 1.
- `personaId = "product-manager"`, `menuLabel = "Generate Migration Shape-Specs"`, `mode` matching Spec 1's PM-task mode.
- `contextNeeds`: the saved book of work + saved WorkItems + the NEW focused migration context resolver (A-5) + API baselines + ArchitectureElementMappings + Discovery Findings/Evidence. The existing migration-summary resolver may be reused for project-level base context but the new resolver is the primary one for this task.
- `responseFormat` references the three structured-response variants (Generated / InsufficientContext / Failed) validated by `assertSpecGenerationResponse` (A-4).
- `persistence` scope keyed by `(projectId, bookOfWorkId)`.
- Auth / role gating taken verbatim from `product-manager--migration-delivery-plan.json` (R-11) — no new role or permission flag.
- `availableFrom` mirrors Spec 1 so the entry surfaces in the same PM menus.

**Gateway prompt**
- New markdown task prompt at `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`, sibling to Spec 1's prompt file.
- Prompt rules, restated verbatim from the raw idea as numbered hard constraints:
  1. Output MUST be literal `/agent-os:shape-spec [spec details]` — no preamble, no commentary outside the spec body.
  2. Do NOT invent missing contracts, mappings, data details, or architecture details — if context is insufficient, return `status='insufficient_context'`, never fake a complete spec.
  3. Use the provided focused migration context and evidence references; cite them in the spec body.
  4. Include implementation steps, affected files / modules / components where known, acceptance criteria, test requirements, and evidence references.
  5. Preserve the functional like-for-like migration goal — never propose a non-equivalent target.
  6. Keep each spec scoped to its single story / WorkItem; no unrelated roadmap or backlog context.
  7. Prerequisite-work stories must describe the prerequisite clearly rather than pretending to implement final functionality.
  8. The LLM self-rates `confidence` per the focused-context payload it received; the gateway validates and may downgrade (R-7).

**Gateway orchestration handler (R-2, R-3, R-4, R-12)**
- New `gateway/src/services/migrationShapeSpecGenerationHandler.ts` modelled on Spec 1's `migrationBookOfWorkHandler.ts`.
- Sequence per batch:
  1. Load book of work + saved WorkItems + per-story metadata via AMS.
  2. Select the next batch of up to N unattempted saved-story WorkItems in book-of-work `sequenceOrder` (default N=25, configurable).
  3. For each story in the batch, SERIALLY (R-4):
     a. Call AMS focused-context endpoint (A-5) with the story's IDs + the six context types.
     b. Apply `applyTokenBudgetCascade` (R-5, A-3) to the assembled payload at the ~24K-per-story cap.
     c. Single synchronous LLM call.
     d. `assertSpecGenerationResponse` validation (A-4).
     e. Confidence post-validation + structured-warning attachment (R-7).
     f. POST result to AMS persistence endpoint (R-1).
  4. Return per-story result list + batch summary (counts + `resultsCouldNotPersist`).
- Gateway-only orchestration (R-2). AMS owns persistence + focused-context only; no AMS-side generation endpoint.
- Synchronous per-batch response (R-3); no token streaming.
- Per-story failure isolation (R-12): a story's exception, validator failure, or persistence failure NEVER aborts the batch. Each story result is persisted whenever possible (including `{ status: 'failed', errorMessage: '...' }`). When persistence itself fails for a result, the batch response surfaces a `resultsCouldNotPersist` count plus the unpersisted failure details inline so the UI can render them.
- Auth gating identical to Spec 1's PM task (R-11).

**Gateway focused-context client (A-5)**
- New `gateway/src/services/migrationSpecContextClient.ts` wrapping `POST /api/projects/{projectId}/migration-spec-context`.
- Request shape per raw-idea (`bookOfWorkId`, `bookItemId`, `workItemId`, `currentArchitectureId`, `targetArchitectureId`, `contextTypes`, `maxFindings`, `maxEvidenceItems`, `maxBaselineItems`).
- Returns `MigrationSpecContextDto`. Surfaces `missingInputs` and readiness blockers when AMS reports them.
- A new `MigrationSpecContextResolver` is registered in `contextResolvers.ts`, separate from the existing migration-summary resolver but allowed to call it internally for project-level base context.

**Gateway token-budget reuse (R-5, A-3)**
- Reuse `applyTokenBudgetCascade` + `TokenBudgetOverflowError` from `gateway/src/services/migrationBookOfWorkHandler.ts` (Spec 1). Do NOT duplicate.
- Per-story cap: ~24K tokens on the focused-context payload.
- Truncation cascade order (applied only as needed): (1) drop oldest evidence first, (2) trim mapping-rationale text, (3) collapse baseline detail to summaries.
- ALWAYS retained, never dropped: architecture refs for the story, mappings touching the story, contract / baseline IDs (even if their bodies are dropped).
- On cascade-unresolvable overflow → the story result is `status='insufficient_context'` with the overflow recorded as `missingInputs[0]` (no LLM call made, no fabricated spec).

**Gateway response validator (A-4)**
- New `gateway/src/services/migrationShapeSpecResponseSchema.ts` exporting hand-rolled `assertSpecGenerationResponse(value): GeneratedShapeSpecResponse`, modelled on Spec 1's `generatedMigrationBookOfWorkSchema.ts`. NO Zod, NO Ajv, NO schema library.
- Three variants validated by explicit branch checks on `status`:
  - **A. Generated**: `{ status: 'generated' | 'generated_with_warnings', confidence, specText, warnings, evidenceRefs, assumptions, tests, affectedAreas }`.
  - **B. Insufficient context**: `{ status: 'insufficient_context', missingInputs, reason, recommendedNextAction, evidenceRefs }`.
  - **C. Failed**: `{ status: 'failed', errorMessage }`.
- Hard rules enforced inside the validator:
  - When `status` is `generated` / `generated_with_warnings`: `specText` REQUIRED, must START with the literal string `/agent-os:shape-spec`, must reference the story / WorkItem title or scope, must include actionable implementation detail (non-empty `affectedAreas` OR non-empty `tests` OR a heuristic content-length floor).
  - When `status='insufficient_context'`: `missingInputs` REQUIRED and non-empty.
  - When `status='failed'`: `errorMessage` REQUIRED.
- Validator failures map to per-story `failed` results, not whole-batch failures.

**Gateway confidence downgrade (R-7)**
- After validator passes for a Generated result, gateway inspects the focused-context payload that produced the spec:
  - LLM-rated `high` is downgraded to `medium` if any one of `mappings` / `baselines` / `contracts` is empty for an API/SOAP story type, OR if `evidenceRefs` is empty for a story whose type expects discovery evidence.
  - LLM-rated `high` is downgraded to `low` when two or more of the above signals are missing.
  - On downgrade, gateway appends a structured `warnings[]` entry of the form `{ code: 'CONFIDENCE_DOWNGRADED', from, to, missingSignals: [...] }` and flips `status` to `generated_with_warnings` if it was `generated`.
- LLM-rated `medium` / `low` are never upgraded.

**AMS focused-context endpoint (A-5)**
- New `POST /api/projects/{projectId}/migration-spec-context` controller endpoint backed by a new `MigrationSpecContextService`.
- Request body: `{ bookOfWorkId, bookItemId, workItemId, currentArchitectureId, targetArchitectureId, contextTypes: string[], maxFindings, maxEvidenceItems, maxBaselineItems }`.
- Response: `MigrationSpecContextDto` with one populated block per requested context type. Six supported types: `service` (service / application), `api` (REST/OAS operation), `soap` (SOAP/WSDL operation), `data` (data entity / table), `infrastructure`, `test_pack` (migration test pack / reconciliation).
- Each context-type block is detailed enough for shape-spec generation (story-scoped current-state evidence, target-state mapping, contract IDs, behaviour baseline IDs, data-entity refs, infra refs, test-pack refs, evidence IDs) but bounded by the requested `maxFindings` / `maxEvidenceItems` / `maxBaselineItems` caps. No unbounded raw dump.
- When required detail is absent: response carries `missingInputs[]` + readiness-blocker reasons per block; the resolver returns the partial DTO rather than 4xx-ing, so the gateway can decide between `insufficient_context` and an LLM attempt.

**AMS spec-generation persistence (R-1, A-2)**
- Spec-writer / implementer MUST inspect at write time: `WorkItemImplementWorkspaceEntity` (`architecture-model-service/.../model/entity/WorkItemImplementWorkspaceEntity.java`), `ImplementWorkspaceDto`, `WorkItemImplementWorkspaceController`, `WorkItemImplementWorkspaceService`, `WorkItemImplementWorkspaceRepository`.
- Decision rule:
  - IF the existing workspace entity can carry `generated_spec_text` + the generation metadata bundle (status / confidence / predicted_readiness / warnings_json / missing_inputs_json / focused_context_refs_json / evidence_refs_json / generated_at / error_message / generation_attempt_number / created_by_task) via minimal nullable column additions in a NEW Liquibase changeset → EXTEND it in place.
  - ELSE add a new table `migration_story_spec_generations` with the fields from the raw idea (`id`, `project_id`, `work_item_id`, `book_of_work_id`, `book_item_id`, `status`, `confidence`, `predicted_readiness`, `generated_spec_text`, `warnings_json`, `missing_inputs_json`, `focused_context_refs_json`, `evidence_refs_json`, `generated_at`, `created_at`, `updated_at`, `error_message`, `generation_attempt_number`, `created_by_task`).
- WorkItem FK is the source of truth either way (R-9). NO new field on `WorkItemEntity` itself. NO orphan spec rows.
- Status enum: `not_attempted | generated | generated_with_warnings | insufficient_context | failed | skipped_blocked`. Confidence enum: `high | medium | low`. `not_attempted` is LAZY (A-6) — no row is written until first attempt; "not attempted" count is computed in-memory as `book_of_work_json.stories - rows-in-generations-table`.
- `skipped_blocked` is only reachable when the explicit "Skip blocked stories" UI toggle is ON (R-6, default OFF).
- Spec storage rule: generated spec text MUST be retrievable from the WorkItem implementation flow (existing Implement tab). NO parallel UX for stored specs.
- Manual-edit protection: if a stored spec already shows manual-edit metadata (e.g. `created_by_task` is not the generator's, or an edit-timestamp marker exists), the persistence layer rejects an overwrite request unless the gateway sends an explicit `confirmOverwrite=true` flag. Save-back without the flag → result row marked `status='failed'` with `errorMessage='manual_edit_protected'`.

**AMS Liquibase changeset**
- New changeset (next free id after Spec 1's `139-generated-migration-books-of-work`, expected `140-migration-story-spec-generations` or `140-work-item-implement-workspace-spec-generation-fields` depending on R-1 outcome) creates either the new table or adds the nullable columns to the workspace table.
- Indexes: `(book_of_work_id, status)`, `(work_item_id)` for the new-table path; equivalent unique constraint on `(work_item_id)` for the extension path.
- Per `feedback_liquibase_immutable_changesets.md`: NEVER edit applied changesets. Spec 1's `139` is treated as immutable.

**AMS endpoints (R-1, R-12)**
- Mode depends on the R-1 inspection outcome. Both modes expose the same controller surface for the gateway:
  - `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/batch` — batch persist results from the gateway. Per-item insert/upsert; partial-failure tolerant; response echoes each persisted row plus any persistence errors.
  - `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations` — list spec-generation rows for the book.
  - `GET /api/projects/{projectId}/work-items/{workItemId}/spec-generations` — list rows for a WorkItem (1:1 in the lazy model, but a list shape future-proofs regeneration history).
  - `PUT /api/projects/{projectId}/spec-generations/{generationId}` — update single row (status / regeneration attempt / manually-corrected spec text). Honours manual-edit protection.
  - `GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary` — counts (total saved stories, attempted, by status, remaining), `nextBatchStart` (book-of-work index of the first unattempted story), `nextBatchSize`.
- Service layer NEVER destructively overwrites a manually-edited spec without explicit confirm (acceptance signal 17).

**Frontend — spec generation workspace (R-9, R-10, A-1, A-8, A-9)**
- New workspace surfaced under the book-of-work detail page (primary entry) AND from the WorkItem Implement tab (drill-in entry).
- Existing frontend paths inspected at write time:
  - `frontend/src/components/ProductManager/MigrationDeliveryPlan/*` — modelling shell for the new workspace.
  - `frontend/src/components/ProductView/ImplementTab.tsx`, `ImplementationAssistantPanel.tsx`, `ImplementationPlanSection.tsx`, `WorkItemDetailsPanel.tsx` — for the WorkItem-side integration (A-1).
  - `frontend/src/api/implementWorkspaceApi.ts`, `frontend/src/api/workItemsApi.ts` — for API call patterns.
- Eight UI surfaces:
  1. **Spec generation summary header** — totals (saved stories, attempted, generated, generated_with_warnings, insufficient_context, failed, skipped_blocked, remaining), current batch size, next batch range, optional predicted-vs-actual metric (R-10).
  2. **Primary action** — "Generate specs for all stories" button (starts batch of next 25 unattempted). Sibling controls: "Generate next 25", "Stop after current batch", "Regenerate all (including generated)" toggle (R-8), "Skip blocked stories" toggle (R-6, default OFF).
  3. **Batch results table** — columns: story title, parent feature/epic, predicted readiness, actual status, confidence, warnings count, missingInputs count, generated-spec link, recommendedNextAction. Predicted and actual columns sit side-by-side (R-10).
  4. **Filters** — by actual status, confidence, predicted readiness, workstream, parent epic/feature.
  5. **Story result detail drawer** — right-hand side panel ~480–560px wide (A-8); overlays the batch results table; dismissible via Esc, backdrop click, or explicit X. Contents: story description, predicted readiness, actual status, confidence, generated spec text (copy button), missingInputs, warnings, evidence refs, focused-context refs, recommendedNextAction, link to WorkItem + Implement tab.
  6. **WorkItem integration** — WorkItem detail / Implement tab shows: a read-only "Generated shape-spec available" chip (R-9) when a generation row exists, drill-back link to the workspace drawer, the generated spec text + copy button + generation status / confidence indicator. NO new field on WorkItem; the chip queries `GET .../work-items/{workItemId}/spec-generations`.
  7. **Pagination / batch continuation** — "Generate next 25" continues from `nextBatchStart`; "Generate remaining" loops batches; current-range completed indicator; user position preserved across batch boundaries.
  8. **Failure UX** — clear missingInputs list for insufficient_context rows, error + retry button for failed rows, warnings summary for generated_with_warnings rows, manual-edit-protected dialog confirm flow for regen attempts that would overwrite an edited spec.
- Batch concurrency control (A-9): "Generate next batch" button DISABLED while a batch is in-flight; in-progress banner displays `Batch in progress (story X of 25)`; navigating away does NOT cancel the batch; on return the workspace re-fetches the spec-generation summary.
- Re-run idempotency (R-8): default re-run skips rows already at `status='generated'`. `failed` / `insufficient_context` / `generated_with_warnings` rows are re-attempted by default. Explicit "Regenerate all (including generated)" toggle bumps `generation_attempt_number`; on hitting a manually-edited spec, a confirm dialog appears before overwrite.

**Status + confidence sentinels**
- Status values: `not_attempted | generated | generated_with_warnings | insufficient_context | failed | skipped_blocked`. `not_attempted` is computed lazily (A-6); `skipped_blocked` only via explicit toggle (R-6).
- Confidence values: `high | medium | low`. LLM self-rates; gateway downgrades only (R-7).

**Tests — gateway (10 cases)**
- Batch selection picks the next 25 unattempted saved-story WorkItems from the book of work.
- Batch selection preserves book-of-work `sequenceOrder` and parent hierarchy ordering.
- Per-story focused-context call invokes the new `MigrationSpecContextResolver` with the story's IDs and the six context types.
- LLM output that starts with the literal `/agent-os:shape-spec` passes `assertSpecGenerationResponse`; output without it is rejected.
- `specText` that does not reference the story title or scope is rejected by the validator.
- A `status='generated'` row is persisted to AMS via the batch endpoint and links to the saved WorkItem.
- When the focused context is missing mappings / contracts / baselines, the gateway records `status='insufficient_context'` with `missingInputs[]` populated — never fakes a complete spec.
- One story raising mid-batch does NOT abort the batch; per-story `failed` result is still persisted; remaining stories still process (R-12).
- Re-running batch generation does NOT overwrite rows already at `status='generated'` unless the "Regenerate all" flag is passed (R-8).
- A `status='generated'` result row includes non-empty `evidenceRefs`.

**Tests — AMS (11 cases)**
- Focused-context endpoint returns a populated `service` block for a service story.
- Focused-context endpoint returns a populated `api` block for an API operation story.
- Focused-context endpoint returns a populated `soap` block for a SOAP operation story.
- Focused-context endpoint returns a populated `data` block for a data-entity story.
- Focused-context endpoint returns a populated `infrastructure` block for an infra story.
- Focused-context endpoint returns a populated `test_pack` block for a migration-test-pack / reconciliation story.
- Focused-context endpoint reports `missingInputs[]` when mappings / baselines / contracts are absent.
- Spec-generation result persisted via batch endpoint is linked to the WorkItem (FK + retrievable via `/work-items/{workItemId}/spec-generations`).
- `spec-generation-summary` returns correct counts (total saved, attempted, by status, remaining, `nextBatchStart`, `nextBatchSize`).
- `nextBatchStart` identifies the first unattempted saved story in book-of-work order.
- Manual-edit-protected spec is NOT overwritten on regenerate without `confirmOverwrite=true`; the request returns the per-row failure with `errorMessage='manual_edit_protected'` and leaves the stored spec untouched.

**Tests — frontend (9 cases)**
- Spec generation summary header renders totals, by-status counts, remaining, next batch range, and the optional predicted-vs-actual metric.
- Clicking "Generate specs for all stories" starts the first batch via the gateway endpoint.
- Batch results table renders each story with predicted / actual / confidence columns side-by-side.
- "Generate next 25" continues from `nextBatchStart` and appends results to the table.
- Filters narrow the table by status, confidence, predicted readiness, workstream, and parent epic/feature.
- Story drawer renders generated spec text for a `generated` row with a working copy button.
- Story drawer renders `missingInputs[]` and `recommendedNextAction` for an `insufficient_context` row.
- WorkItem Implement tab renders the "Generated shape-spec available" chip and links back to the workspace drawer when a generation row exists.
- A `failed` row exposes a retry control that triggers a single-story regenerate via the gateway.

**Tests — integration (7 cases)**
- Happy path: saved book of work + saved WorkItems → batch generation → spec-generation rows created, linked, and visible from each WorkItem.
- API story integration: generated spec body references the relevant OAS contract ID, API behaviour baseline ID, and mapping ID from the fixture.
- SOAP story integration: generated spec body references the SOAP operation details from the fixture (operation name, WSDL ref, expected request/response shape).
- Data-migration story integration: generated spec body references the data mapping and reconciliation hooks from the fixture.
- Missing-mapping path: a story whose mapping is absent in the fixture produces `status='insufficient_context'` with the missing mapping listed in `missingInputs[]`.
- 60-story scenario with default batch size 25 → exactly 3 batches required to attempt all stories; the third batch is correctly sized (10 stories).
- Reload persistence: after a full generate run, refreshing the workspace re-fetches summaries from AMS and renders the same spec-generation rows linked to the same WorkItems.

**Test fixtures (R-13, A-7)**
- Reuse Spec 1's `agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/planning/visuals/fixture-migration-delivery-plan-scenario.json` as the upstream input scenario (book of work + saved WorkItems + architecture refs + mappings + baselines + evidence).
- Add three NEW LLM-output fixtures, placed in BOTH locations (A-7):
  - `planning/visuals/llm-output-generated.json` AND `gateway/src/__tests__/fixtures/llm-output-generated.json`.
  - `planning/visuals/llm-output-insufficient-context.json` AND `gateway/src/__tests__/fixtures/llm-output-insufficient-context.json`.
  - `planning/visuals/llm-output-failed.json` AND `gateway/src/__tests__/fixtures/llm-output-failed.json`.
- These three LLM-output fixtures are implementer artefacts produced in Group 1 of the build; they are NOT user-supplied design assets.

**Acceptance signals (all 18 from raw-idea, verbatim)**
1. User can generate shape-specs from a saved migration book of work.
2. System attempts spec generation for all saved story WorkItems in configurable batches.
3. Default batch size 25.
4. User can continue to next batch easily.
5. Each story receives an actual generation status.
6. Generated specs are literal `/agent-os:shape-spec [spec details]`.
7. Generated specs linked to saved WorkItems.
8. Existing implementation flow can access generated spec from the WorkItem.
9. Stories with insufficient context do NOT receive fabricated specs.
10. Insufficient-context results clearly list missing inputs + recommendedNextAction.
11. Generated specs include evidence/traceability references.
12. Generated specs use focused migration context.
13. API, SOAP, data, infrastructure, and migration test-pack story types supported.
14. Batch generation resilient to individual story failures.
15. UI shows generation progress, summary, confidence, failure/missing-context details.
16. System can compare predicted readiness from Spec 1 with actual generation result.
17. Existing manually-generated/edited implementation specs not overwritten without explicit user action.
18. Output ready for the implementing LLM / Claude Code to run through normal implementation flow.

**Implementation notes (verbatim from raw-idea)**
- This spec generates implementation specs, NOT executes them.
- Reuse the normal implementation flow + WorkItem-linked workspace where possible.
- Do NOT create a parallel spec storage UX if the existing WorkItem implementation flow can be extended.
- Keep batch generation controllable and resumable.
- Use focused context retrieval instead of stuffing all scan detail into one giant prompt.
- Treat confidence / readiness as quality-control metadata, NOT backlog status.
- Capture actual generation results so the tool can improve over time.
- Avoid fabricating technical detail when context is missing.
- Ultimate product goal is all specs generated automatically, but v1 still exposes clear status + confidence so users can identify weak areas.

## Visual Design

No user-supplied mockups, wireframes, or screenshots for any surface in this spec (workspace summary, primary action controls, batch results table, filters, story drawer, WorkItem Implement-tab chip, pagination, failure UX). `planning/visuals/` was confirmed empty of user assets at shaping time (A-1 / A-2). Frontend implementers work from the textual surface descriptions above and lean on the most analogous precedents: Spec 1's `frontend/src/components/ProductManager/MigrationDeliveryPlan/*` workspace and `frontend/src/components/ProductView/ImplementTab.tsx` / `ImplementationAssistantPanel.tsx` / `WorkItemDetailsPanel.tsx` for the Implement-tab integration. The only artefacts that will land under this spec's `planning/visuals/` are the three LLM-output JSON fixtures listed under Test fixtures — implementation artefacts produced in Group 1 of the build, not UI mockups.

## Existing Code to Leverage

**`gateway/src/services/migrationBookOfWorkHandler.ts` + `gateway/src/services/generatedMigrationBookOfWorkSchema.ts` (Spec 1)**
- Closest precedent for the new `migrationShapeSpecGenerationHandler.ts` and `migrationShapeSpecResponseSchema.ts`.
- Source of `applyTokenBudgetCascade` + `TokenBudgetOverflowError` — reused verbatim (R-5, A-3); do not duplicate.
- Pattern source for hand-rolled `assertSpecGenerationResponse` per-status branch validator (A-4).
- Sync-per-batch pattern + fixture-driven LLM-output tests are mirrored.

**`gateway/src/config/tasks/product-manager--migration-delivery-plan.json` + `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`**
- Closest precedent for the new task config + markdown task prompt. New files match this pair key-for-key, only contents differ.
- `personaId`, `mode`, `contextNeeds`, `responseFormat`, `persistence`, `availableFrom`, and auth gating all come from this pair (R-11).

**`gateway/src/services/contextResolvers.ts` + existing migration-summary resolver**
- Registration point for the new `MigrationSpecContextResolver` (A-5). The new resolver is sibling to the existing summary resolver and may call it internally for project-level base context.

**`architecture-model-service/.../WorkItemImplementWorkspaceEntity.java` + `ImplementWorkspaceDto.java` + `WorkItemImplementWorkspaceController.java` + `WorkItemImplementWorkspaceService.java` + `WorkItemImplementWorkspaceRepository.java`**
- Mandatory inspection target at spec-implementation write time (A-2 / R-1). Either extended in place or used as the persistence-layer precedent (mapper / controller / service / repository quintet) for the new `migration_story_spec_generations` table.
- Existing JSONB-column patterns (per `project_jira_sync_dynamic_mapping` / `fix-hibernate-jsonb-mapping`) carry over.

**`frontend/src/components/ProductView/ImplementTab.tsx` + `ImplementationAssistantPanel.tsx` + `WorkItemDetailsPanel.tsx` + `ImplementationPlanSection.tsx` + `frontend/src/api/implementWorkspaceApi.ts` + `frontend/src/api/workItemsApi.ts`**
- WorkItem Implement-tab integration target (A-1, R-9). The "Generated shape-spec available" chip, drill-back link, and stored-spec rendering hook into these existing components.
- API client patterns inform the new spec-generation API client.

## Out of Scope
- Executing generated specs in Claude Code.
- Automatically modifying application repositories.
- Automatically running tests.
- Target API reconciliation execution.
- Database reconciliation execution.
- Data migration execution.
- First-class work-item dependency model.
- First-class traceability table (unless the existing implementation flow already provides equivalent).
- Replacing the existing implementation assistant flow.
