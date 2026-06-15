# Raw idea — Product Manager Migration Delivery Plan + Draft Book-of-Work Generation

## Feature framing

Add a Product Manager migration-planning workflow that consumes rich current-state and target-state migration context and generates a draft hierarchical book of work for a functionally like-for-like migration.

The generated book of work should contain **Initiatives → Epics → Features → Stories**, ordered to respect practical delivery dependencies, with generation quality / readiness assessment and traceability explanations so the user understands why each item was generated.

This spec creates the **draft generation + review workspace**. It does NOT generate fully detailed shape-specs for every story — that is a future Spec 2.

## Primary goal

Use the tool's Current State Architecture, Discovery Findings/Evidence, Target State Architecture, API contracts (OAS + SOAP/WSDL), API Behaviour Baselines, and current-to-target mappings to generate a high-quality draft migration roadmap/backlog hierarchy that can be reviewed, assessed, and later converted into implementation-ready specs.

## Core v1 assumption

The migration is **functionally like-for-like**. The target state must preserve current business behaviour for the selected scope. Functional equivalence is mandatory; not a question to ask the user.

## Inputs consumed

- Product Definition
- Current State Architecture
- Target State Architecture
- Migration Discovery Context (the primary context input — already implemented by an earlier spec)
- Discovery Findings/Evidence
- API contracts (OAS + SOAP/WSDL-derived)
- API Behaviour Baselines
- Current-to-target `ArchitectureElementMappings`
- Existing Test Strategy (if present)
- Existing Roadmap/Backlog (if present)

## Main output

`GeneratedMigrationBookOfWork` draft artifact containing:

```
Initiative
  Epic
    Feature
      Story
```

Each generated item includes planning-level content, ordering, generation quality assessment, traceability explanation, and recommended next action.

## V1 scope

- Add Product Manager task/conversation `product-manager--migration-delivery-plan`.
- Use Migration Discovery Context as the primary context input.
- Ask a concise set of migration-planning questions (7-stage guided workflow — see below).
- Generate a draft hierarchical book of work.
- Include planning-level descriptions, acceptance criteria, traceability explanations, confidence/readiness assessment.
- Order work to respect practical dependencies.
- Add a draft review workspace (summary + hierarchy + filters + item drawer).
- Allow the user to save the draft artifact AND save all-or-selected items into existing roadmap/backlog if supported.
- Preserve generated draft for later Spec 2 focused detail/spec generation.

## Out of scope

- Generating final shape-spec-ready detailed specs for every story (Spec 2's job)
- Focused story-level deep context retrieval
- First-class work-item dependency model (sequenceOrder field is the v1 substitute)
- First-class traceability table (rides inside the draft JSON)
- Target API reconciliation
- Database reconciliation
- Actual data migration
- Migration test harness implementation
- Cutover execution
- Standalone "Migration Plan" document
- Architecture model changes from this task
- Replacing existing roadmap/backlog generation tasks

## Services touched

- gateway (new task config + structured-response handling)
- architecture-model-service (new entity + endpoints)
- frontend (wizard + review workspace)
- mcp-server (only if existing save-artifact tooling requires it)

## Recommended implementation shape

Implement as a Product Manager task/workflow using the existing persona/task framework, with a dedicated structured response schema and a dedicated draft review UI.

- Task name: `product-manager--migration-delivery-plan`
- User-facing label: **Create Migration Delivery Plan**
- Suggested placement: Product area, probably under Roadmap/Backlog/Migration preparation, and/or the Product Manager task menu where existing PM tasks live

## Data model

Suggested entity/table `generated_migration_books_of_work`:

- `id`, `project_id`, `current_architecture_id`, `target_architecture_id`
- `status` ∈ { `draft`, `reviewed`, `partially_saved`, `saved`, `archived`, `failed` }
- `title`, `summary`
- `generation_inputs_json`, `generation_summary_json`, `quality_assessment_json`, `book_of_work_json`
- `created_at`, `updated_at`, `created_by_task` (default `product-manager--migration-delivery-plan`)
- `saved_to_backlog_at` nullable, `error_message` nullable

`book_of_work_json` stores the full generated hierarchy. NO new first-class dependency or traceability tables in v1.

DTOs:
- `GeneratedMigrationBookOfWorkDto`
- `GenerateMigrationBookOfWorkRequest` / `Response`
- `MigrationBookOfWorkItemDto`
- `MigrationBookOfWorkQualityAssessmentDto`
- `SaveGeneratedMigrationBookOfWorkRequest` / `SaveGeneratedMigrationBookOfWorkSelectionRequest`

## Book-of-work item model

Each item carries:
- `id` (generated temp id), `type` ∈ `initiative|epic|feature|story`, `parentId` nullable
- `title`, `description`, `acceptanceCriteria` (array; mainly stories/features)
- `workstream` ∈ enumerated 13-value set (see below)
- `sequenceOrder`, `tags`
- `confidence` ∈ `high|medium|low`
- `readiness` ∈ `ready_for_spec|needs_focused_context|needs_user_decision|blocked`
- `readinessReasons`, `missingInputs`, `recommendedNextAction`, `traceabilitySummary`
- Lightweight reference arrays: `evidenceReferences`, `architectureReferences`, `apiBaselineReferences`, `discoveryFindingReferences`, `mappingReferences`, `sourceContextRefs`
- `saveState` ∈ `draft|selected|excluded|saved|failed`

Workstream values:
`target_service_api_implementation`, `target_frontend_implementation`, `target_database_schema_implementation`, `target_infrastructure_environment_implementation`, `data_migration`, `api_soap_integration_compatibility`, `migration_test_pack`, `reconciliation_reporting`, `cutover_rollback_decommission`, `architecture_refinement`, `discovery_gap_resolution`, `test_strategy`, `other`.

Reference shapes are lightweight (IDs only): `discoveryFindingId`, `discoveryEvidenceId`, `discoveryCandidateId`, `apiBehaviourBaselineId`, `apiBehaviourBaselineItemId`, `architectureElementMappingId`, `sourceArchitectureElementRef`, `targetArchitectureElementRef`, `interfaceId`, `endpointId`, `workItemId` (set after save).

## Generation quality assessment

Quality assessment at multiple levels: whole book + each initiative/epic/feature/story. Top-level summary includes counts: items per type, confidence breakdown, readiness breakdown, findings addressed / not addressed, contracts/baselines/data entities/infrastructure covered, mappings used, unresolved gaps.

Detailed scoring rubrics per workstream type (API/service, data migration, infrastructure, migration test pack) — see ARGUMENTS in the calling prompt for the full rubric.

## Traceability ("Why this exists")

Each item has a visible traceability explanation. v1 persists this inside `book_of_work_json` and optionally folds concise notes into saved work-item descriptions/tags when saving to backlog. NO first-class traceability tables.

## Conversation flow (7 stages)

1. **Input selection + context check** — confirm Product Definition, Current/Target Architecture, Discovery runs, API Behaviour Baselines, mappings; call Migration Discovery Context and show readiness summary
2. **Migration intent** — multi-select (functional equivalence is NOT asked; it's mandatory)
3. **Delivery streams** — multi-select; defaulted from context
4. **Migration style** — single-select; recommended from context
5. **Data and cutover assumptions** — concise questions only where relevant
6. **Migration Test Pack expectations** — multi-select; defaulted from context
7. **Generate draft book of work** — produces full hierarchy + summary + quality/readiness + traceability + gaps + recommended next actions

## Gateway requirements

Add or update task config `product-manager--migration-delivery-plan`:
- persona: `product-manager`
- mode: guided workflow / structured generation
- context needs: product definition, migration-discovery-context, current/target arch, API baselines, architecture mappings, optional existing roadmap/backlog/test strategy
- response schema: `GeneratedMigrationBookOfWork`
- persistence scope: project + currentArchitectureId + targetArchitectureId

Add context resolver usage for `migration-discovery-context`. Gateway fetches bounded discovery context, composes prompt with strict "do not invent missing detail" instruction, requests structured JSON, validates schema, saves draft to AMS, returns draft id+summary.

Prompt rules:
- Functional equivalence mandatory
- Generate a book of work, NOT a migration plan document
- Use the evidence provided; do not invent contracts, mappings, or data details
- Where detail is missing, create prerequisite/refinement stories and mark readiness accordingly
- Order work to respect dependencies
- Generate migration test pack work as backlog items, not as an immediate test artifact
- Include traceability explanations + readiness/confidence

## Architecture-model-service endpoints

- `POST /api/projects/{projectId}/migration-books-of-work/generate` (optional if generation lives in gateway only)
- `POST /api/projects/{projectId}/migration-books-of-work` — create draft from generated JSON
- `GET /api/projects/{projectId}/migration-books-of-work` — list drafts
- `GET /api/projects/{projectId}/migration-books-of-work/{bookId}` — get detail
- `PUT /api/projects/{projectId}/migration-books-of-work/{bookId}` — update metadata/status or edited JSON
- `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog` — save all/selected items into existing roadmap/backlog/WorkItem hierarchy

save-to-backlog request:
- `selectedItemIds` optional, `excludedItemIds` optional
- `saveMode` ∈ `all|selected|high_confidence_only|ready_for_spec_only`
- `statusForCreatedItems`, `includeTraceabilityInDescription` (bool), `includeReadinessInDescription` (bool), `tagPrefix` optional

Save behaviour: convert to existing WorkItem hierarchy if model supports `initiative|epic|feature|story` (otherwise map to closest existing types and document the mapping); preserve parent-child + sequence order; avoid duplicate save; mark `saveState=saved` on success or `failed` with reason; store traceability/readiness in description/tags only (no new tables). Existing items default to creating new draft/proposed items rather than replacing — no destructive overwrite.

## Frontend surfaces

- Start generation wizard (7 steps)
- Generation progress (current step + context loaded + generating + validating + saving)
- Draft book-of-work summary (counts + confidence/readiness breakdown + major gaps + coverage + blocking issues)
- Hierarchy tree (badges: confidence, readiness, workstream, saved/excluded state, warning/gap count)
- Filters (workstream, confidence, readiness, blocking gaps, low confidence, API/data/infra/test work, finding reference)
- Item detail drawer (title, type, description, acceptance criteria, workstream, confidence, readiness + reasons, missing inputs, recommended next action, "Why this exists" traceability summary, reference lists)
- Selection controls (select all/none, subtree select, exclude/include, save all, save selected, save high-confidence only, save ready-for-spec only)
- Save to backlog confirmation (counts + warnings + traceability/readiness inclusion options) + post-save view with created counts and saved-state marking
- Draft list view (title, current arch, target arch, status, created date, counts, confidence/readiness summary)

## Acceptance criteria (verbatim from feature description)

20 acceptance criteria covering: launch workflow, select architectures, consume context, generate hierarchy, ordered work, planning descriptions, traceability, confidence/readiness, review workspace surfaces, save flows, non-destructive saves, no fabricated detail, prerequisite stories, suitable for testing generation quality, ready to feed Spec 2.

## Implementation notes

- Draft-generation and review feature; don't try to make every story shape-spec-ready
- No first-class dependencies / traceability tables in v1
- No standalone Migration Plan document
- Treat readiness/confidence as generation-quality metadata, not normal backlog status
- Store generation metadata in the draft JSON; optionally copy concise notes to saved work items
- Prefer safe preview + selective save over auto-creating hundreds of work items
- Review workspace focuses on summary, coverage, confidence, exceptions — not line-by-line editing
- Use deterministic context and evidence references wherever possible
- Future Spec 2 uses readiness values + evidence references to retrieve focused context and generate detailed shape-specs

## Open design points for shaping (Q-1..Q-N candidates)

The shaping pass should surface clarifying questions for at least the following points the feature description leaves slightly open:

- Q-1 Generation routing: gateway-only orchestration (save-to-AMS at end) vs an explicit AMS `/generate` endpoint that gateway calls? Trade-off: single-source vs separation-of-concerns.
- Q-2 Existing WorkItem model fit: does the current model support `initiative|epic|feature|story` natively, or do we need a type-mapping table? Confirms whether the "if model supports them" branch fires or we need a documented mapping.
- Q-3 MCP-server involvement: confirm whether existing PM task save paths go through MCP tools or AMS direct. Avoid duplicate persistence.
- Q-4 Token budget for the generator. Migration discovery context can be huge; need a per-call cap + truncation strategy aligned with the Phase 2 token-cap helper if reusable.
- Q-5 Save-to-backlog atomicity. Per-item save failure ≠ whole-draft corruption — what happens to in-flight transaction state? Per-item commit vs all-or-nothing?
- Q-6 Idempotency on regenerate. If the user runs the workflow twice for the same (project, currentArch, targetArch), do we create a second draft, supersede the first, or refuse?
- Q-7 Workstream vocab — confirm the 13 values are right OR add `unknown` as a sentinel.
- Q-8 Readiness threshold for `save high_confidence_only` and `save ready_for_spec_only` — clear definitions in the spec.
- Q-9 Test-data realism. Integration tests need a mock Migration Discovery Context fixture. Reuse the Phase 1/2/3 fixtures, or create a new comprehensive PM-flow fixture?
- Q-10 Tag prefix conflict handling — if `tagPrefix='mig-2026q2-'` collides with existing tags on a re-save, do we suffix, error, or overwrite?
