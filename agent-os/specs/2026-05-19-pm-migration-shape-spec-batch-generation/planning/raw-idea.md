# Raw idea — Generate Shape-Specs from Migration Book of Work (Spec 2)

## Feature framing

Add the ability to generate literal `/agent-os:shape-spec [spec details]` implementation specs for stories produced by the PM Migration Delivery Plan workflow (Spec 1, landed 2026-05-17).

Consumes the saved `GeneratedMigrationBookOfWork`, saved `WorkItem`s, Migration Discovery Context, focused migration context, API Behaviour Baselines, Discovery Findings/Evidence, current-to-target mappings, and architecture model details to generate implementation-ready specs for the migration backlog.

The system attempts spec generation for all eligible stories in configurable batches (default **25**) and shows success/confidence indicators so the user can understand which specs are strong, which need more context, and which could not be safely generated.

## Primary goal

Move from a generated migration book of work to implementation-ready Agent OS shape-spec prompts linked to saved WorkItems, while preserving evidence, traceability, and quality signals.

## Key product principle

Discovery + evidence + target architecture + mappings + API baselines must be rich enough to generate an accurate, implementation-ready hierarchical book of work AND the detailed implementation specs for that work.

## Core v1 behaviour

- Attempt spec generation for all eligible stories
- Process stories in configurable batches, default 25
- Generate literal `/agent-os:shape-spec [spec details]` content
- Use existing implementation/spec flow where possible
- Link generated specs to saved WorkItems
- Show generation success/confidence results
- **Do not silently invent missing technical detail** — if a story lacks context, return an `insufficient_context` result with missing inputs

## Definitions

- **Book-of-work story** — generated story item from `GeneratedMigrationBookOfWork`
- **Saved WorkItem story** — a generated story that has been saved into the normal WorkItem/backlog model (Spec 1's save-to-backlog flow)
- **Shape-spec** — literal text beginning with `/agent-os:shape-spec` followed by implementation details suitable for Claude Code / Agent OS execution
- **Predicted readiness** — the readiness value generated in Spec 1 (`ready_for_spec|needs_focused_context|needs_user_decision|blocked`)
- **Actual spec generation status** — observed result after attempting spec generation (`generated|generated_with_warnings|insufficient_context|failed|skipped_blocked`)
- **Spec confidence** — generation confidence after focused context retrieval (`high|medium|low`)

## Inputs consumed

- `GeneratedMigrationBookOfWork` draft
- Saved `WorkItem`s generated from the book of work
- Migration Discovery Context (existing resolver)
- Focused migration context per story/work item (NEW resolver, see below)
- Current State + Target State Architecture
- Discovery Findings/Evidence
- API contracts (OAS + SOAP/WSDL-derived)
- API Behaviour Baselines
- `ArchitectureElementMappings`
- Existing `WorkItemImplementWorkspace` / implementation flow data where present

## Main output

For each attempted story: a generated shape-spec result row carrying one of:
- Generated literal `/agent-os:shape-spec [spec details]`
- `insufficient_context` result with `missingInputs` + `recommendedNextAction`
- `failed` result with `errorMessage`

Each generated spec is linked to the saved WorkItem and visible through the existing implementation/spec flow.

## V1 user flow

1. User generates and saves a migration book of work (Spec 1)
2. User saves generated stories into the normal WorkItem hierarchy (Spec 1)
3. User opens the migration spec-generation workspace
4. UI shows total story count, saved WorkItems count, predicted readiness summary, already-generated count, not-yet-attempted count, insufficient-context count, failed count
5. User clicks "Generate specs for all stories"
6. System processes first batch of up to 25 stories
7. For each story: load WorkItem → load book-of-work item metadata → retrieve focused context → generate literal shape-spec → validate → save/link to WorkItem → store status/confidence/warnings/missingInputs
8. UI shows batch result table
9. User can continue: generate next batch, auto-continue, inspect failed/weak specs, regenerate selected later
10. Once all batches attempted, UI shows final summary

## Out of scope

- Executing generated specs in Claude Code
- Automatically modifying application repositories
- Automatically running tests
- Target API reconciliation execution
- Database reconciliation execution
- Data migration execution
- First-class work-item dependency model
- First-class traceability table (unless the existing implementation flow already provides equivalent)
- Replacing the existing implementation assistant flow

## Services touched

- gateway
- architecture-model-service
- frontend
- mcp-server only if existing implementation/spec artifact persistence requires it

## Batching requirements

- **Default batch size**: 25 stories
- Configurable via env/config; frontend may allow user override within safe min/max
- Selection: next unattempted saved story `WorkItem`s from the generated book of work, in book-of-work sequence order, preserving parent hierarchy ordering. Skip non-story items. Skip stories without saved WorkItem and report them as `not_saved_to_backlog`.
- Controls: generate next batch / generate all remaining / stop after current batch / retry failed-or-insufficient later
- Safety: one story failure must not stop the whole batch; store result per story; show partial completion

## Data model

**Preferred**: extend the existing `WorkItemImplementWorkspace` / implementation artifact model if it can store generated spec content linked to a WorkItem.

**Fallback**: add a lightweight table `migration_story_spec_generations`:
- `id`, `project_id`, `work_item_id`, `book_of_work_id`, `book_item_id`
- `status` ∈ `not_attempted|generated|generated_with_warnings|insufficient_context|failed|skipped_blocked`
- `confidence` ∈ `high|medium|low`
- `predicted_readiness`
- `generated_spec_text` nullable
- `warnings_json`, `missing_inputs_json`, `focused_context_refs_json`, `evidence_refs_json` (all nullable)
- `generated_at` nullable, `created_at`, `updated_at`
- `error_message` nullable
- `generation_attempt_number`
- `created_by_task` (default `product-manager--migration-shape-spec-generation`)

**Spec storage rules**:
- Generated spec text must be retrievable from the WorkItem implementation flow
- Generated spec linked to the saved WorkItem
- If stored as ProjectArtifact, WorkItem must have a link/reference to that artifact
- If stored in `WorkItemImplementWorkspace`, frontend implementation panel must display/access it
- NO orphan specs that cannot be found from the WorkItem

## Focused migration context (NEW endpoint)

Suggested endpoint: `POST /api/projects/{projectId}/migration-spec-context`

Request body: `{ bookOfWorkId, bookItemId, workItemId, currentArchitectureId, targetArchitectureId, contextTypes: ["service","api","soap","data","infrastructure","test_pack"], maxFindings: 50, maxEvidenceItems: 50, maxBaselineItems: 25 }`

Response: `MigrationSpecContextDto`

Six context types with detailed shape per the feature description: service/application, API operation, SOAP operation, data entity/table, infrastructure, migration test pack / reconciliation. Each must be detailed enough for shape-spec generation, bounded enough to fit prompt constraints, evidence-referenced, and not an unbounded raw dump.

If detail is missing: response includes `missingInputs` and readiness blockers.

## Gateway

New task: `product-manager--migration-shape-spec-generation`

Responsibilities: load book-of-work → resolve saved WorkItems → select next batch → for each story: retrieve focused context, generate literal shape-spec, validate, store/link result, record status/confidence/warnings/missingInputs → return batch summary.

Prompt rules:
- Output MUST be literal `/agent-os:shape-spec [spec details]`
- Do not invent missing contracts/mappings/data/architecture details
- Use focused context and evidence references
- If context insufficient → `insufficient_context` result with `missingInputs`, never fake a complete spec
- Include implementation steps, affected files/modules where known, acceptance criteria, tests, evidence references
- Preserve functional like-for-like migration goal
- Keep spec scoped to the story
- No unrelated roadmap/backlog context

**Structured response variants**:
- A. Generated: `{ status: generated|generated_with_warnings, confidence, specText, warnings, evidenceRefs, assumptions, tests, affectedAreas }`
- B. Insufficient context: `{ status: insufficient_context, missingInputs, reason, recommendedNextAction, evidenceRefs }`
- C. Failed: `{ status: failed, errorMessage }`

**Output validation**:
- `specText` must START with `/agent-os:shape-spec`
- `specText` must reference the WorkItem/story title or scope
- `specText` must include enough implementation detail to be actionable
- if status=generated: `specText` required
- if status=insufficient_context: `missingInputs` required

## AMS endpoints

1. `POST /api/projects/{projectId}/migration-spec-context` — focused context (NEW)
2. Spec generation result persistence:
   - If new table: `POST .../migration-books-of-work/{bookId}/spec-generations/batch`, `GET .../migration-books-of-work/{bookId}/spec-generations`, `GET .../work-items/{workItemId}/spec-generations`, `PUT .../spec-generations/{generationId}`
   - If existing workspace: add/update endpoints to store generated spec + metadata in the workspace for a WorkItem
3. `GET .../migration-books-of-work/{bookId}/spec-generation-summary` returning counts (total, saved, attempted, by status, remaining, nextBatchStart, nextBatchSize)
4. Link to WorkItem: when a spec is generated, WorkItem shows it; existing implementation panel accesses it; minimal WorkItem metadata/tag update OK if no first-class field exists. NO destructive overwrite of manually-edited specs.

## Frontend

Migration spec generation workspace, surfaced under the generated migration book-of-work detail page or saved migration backlog/book-of-work review page or WorkItem implementation area (with batch entry point from book-of-work).

UI surfaces:
1. **Spec generation summary** — totals + saved/attempted/generated/with-warnings/insufficient/failed/skipped counts + remaining + batch size + next batch range
2. **Primary action**: "Generate specs for all stories" button — starts batch for next 25 unattempted; supports continue / auto-continue / stop
3. **Batch results table** — story title, parent feature/epic, predicted readiness, actual status, confidence, warnings, missingInputs, generated-spec link, recommendedNextAction
4. **Filters** — by status / confidence / workstream / parent epic/feature
5. **Story result detail drawer** — story description, predicted readiness, actual status, confidence, generated spec text, missingInputs, warnings, evidence refs, focused context refs, recommendedNextAction, link to WorkItem + implementation workspace
6. **WorkItem integration** — WorkItem detail / Implement tab shows generated shape-spec + copy/view + generation status/confidence + regenerate (future extension)
7. **Pagination / batch continuation** — "Generate next 25" / "Generate remaining" / current-range completed / preserve user position
8. **Failure UX** — clear missing-inputs display for insufficient-context, error+retry for failed, warning summary for generated_with_warnings

## Spec content requirements

Each generated `/agent-os:shape-spec` includes: story/work-item title, migration context, functional equivalence requirement, current-state evidence summary, target-state expectation, implementation scope, files/modules/components affected where known, API contract details, SOAP/WSDL details, data model/table details, infrastructure details, acceptance criteria, test requirements, migration test pack implications, reconciliation considerations, out-of-scope notes, evidence/traceability references.

Prerequisite-work stories should describe the prerequisite clearly rather than pretending to implement final functionality.

## Open design points to surface during shaping (R-1 through R-N)

The shape-spec process should surface clarifying questions for the following points the feature description leaves slightly open:

- **R-1 Spec storage approach**: extend existing `WorkItemImplementWorkspace` vs new `migration_story_spec_generations` table? Spec-writer to inspect the existing model and choose; the raw idea prefers extension if feasible.
- **R-2 Spec-generation orchestration**: gateway-only (like Spec 1's Q-1 choice) or AMS-side `/generate-batch` that gateway delegates to? Lean: gateway-only for parity with Spec 1.
- **R-3 Batch processing model**: sync per batch (frontend waits for the whole batch of 25 to finish before next call) vs async with job ID + polling? Lean: sync per batch (matches Spec 1's Q-15 sync style; per-story call is bounded by token budget so 25 stories is ~tens-of-seconds-to-a-couple-minutes; user can stop after each batch). NO token streaming.
- **R-4 Concurrency within a batch**: serial per-story calls (simpler, slower, easier to debug) vs parallel-N (faster, more LLM cost spikes, harder to debug)? Lean: serial in v1; parallel is a Phase-3 perf optimization once we have real timings.
- **R-5 Token budget for the focused-context retrieval**: per-call cap? Reuse the cascade helper from Spec 1? Lean: ~24K tokens per story per-call cap on focused context payload. Truncation order: drop oldest evidence first, trim mapping rationale text, trim baseline detail to summaries. Always retain: current/target architecture references for the story, mappings touching the story, contract/baseline IDs (even if bodies dropped). Fail loudly if still over budget.
- **R-6 `skipped_blocked` policy default**: when a story's predicted readiness is `blocked`, should the default `Generate all` action skip OR attempt? Lean: attempt — produce `insufficient_context` rather than skip silently. Per the feature description: "Default v1 policy: attempt all stories except those explicitly excluded/not saved; blocked stories should usually return insufficient_context rather than fake specs." Make `skipped_blocked` only reachable via explicit user opt-in (a "Skip blocked stories" toggle that defaults OFF).
- **R-7 Confidence inference rule**: explicit user policy or LLM self-rated? Lean: LLM returns a confidence rating, validated by the gateway against deterministic signals (presence/absence of mappings, baselines, contracts, evidence). If LLM says `high` but the focused-context payload was missing the contract or mapping, gateway downgrades to `medium` or `low` with a structured warning attached.
- **R-8 Idempotency on re-run**: when the user re-runs `Generate all` after some specs already exist, what's the default behaviour? Lean: skip stories with `status='generated'` by default (idempotent re-run is a continue-where-you-left-off). Failed/insufficient/with-warnings → re-attempt by default. User can explicitly toggle "Regenerate all (including generated)" — that path bumps `generation_attempt_number` and never overwrites a manually-edited spec without an explicit confirm dialog.
- **R-9 WorkItem-to-spec linkage shape**: store as new `spec_artifact_id` field on WorkItem? store as tag-style metadata? rely on the new table's `work_item_id` FK only? Lean: rely on FK on the new table (or workspace row if extending the existing model). Add a small read-only "Generated shape-spec available" indicator chip on the WorkItem detail panel that links back to the spec text.
- **R-10 Comparing predicted readiness vs actual generation status**: where in the UI does this comparison surface? Lean: in the batch results table and the story drawer side-by-side (`Predicted: ready_for_spec` next to `Actual: generated_with_warnings`), plus an optional summary metric on the workspace (e.g. "12 of 14 predicted-ready actually generated").
- **R-11 Auth gating**: same posture as Spec 1's PM task? Lean: match `product-manager--migration-delivery-plan` (Spec 1's Q-17).
- **R-12 Failure isolation contract**: if the LLM call throws AND the persistence call throws after, do we still mark the story `failed`? Lean: yes — per-story result must always be persisted, even if just `{ status: 'failed', errorMessage: '<reason>' }`. The batch summary surfaces total + per-status counts even when some persistence calls failed (best-effort guarantee).
- **R-13 Test fixtures**: reuse Spec 1's `fixture-migration-delivery-plan-scenario.json` plus a few generated shape-spec example outputs OR build a fresh shape-spec-specific fixture? Lean: reuse Spec 1's fixture as the upstream input; add new small fixtures for the LLM-output shape (one `generated` example + one `insufficient_context` example + one `failed` example) used by gateway response-validation tests.

## Acceptance signals (18 from raw-idea)

1. User can generate shape-specs from a saved migration book of work
2. System attempts spec generation for all saved story WorkItems in configurable batches
3. Default batch size 25
4. User can continue to next batch easily
5. Each story receives an actual generation status
6. Generated specs are literal `/agent-os:shape-spec [spec details]`
7. Generated specs linked to saved WorkItems
8. Existing implementation flow can access generated spec from the WorkItem
9. Stories with insufficient context do NOT receive fabricated specs
10. Insufficient-context results clearly list missing inputs + recommendedNextAction
11. Generated specs include evidence/traceability references
12. Generated specs use focused migration context
13. API, SOAP, data, infrastructure, and migration test-pack story types supported
14. Batch generation resilient to individual story failures
15. UI shows generation progress, summary, confidence, failure/missing-context details
16. System can compare predicted readiness from Spec 1 with actual generation result
17. Existing manually-generated/edited implementation specs not overwritten without explicit user action
18. Output ready for the implementing LLM / Claude Code to run through normal implementation flow

## Implementation notes

- This spec generates implementation specs, NOT executes them
- Reuse the normal implementation flow + WorkItem-linked workspace where possible
- Do NOT create a parallel spec storage UX if the existing WorkItem implementation flow can be extended
- Keep batch generation controllable and resumable
- Use focused context retrieval instead of stuffing all scan detail into one giant prompt
- Treat confidence/readiness as quality-control metadata, NOT backlog status
- Capture actual generation results so the tool can improve over time
- Avoid fabricating technical detail when context is missing
- Ultimate product goal is all specs generated automatically, but v1 still exposes clear status + confidence so users can identify weak areas
