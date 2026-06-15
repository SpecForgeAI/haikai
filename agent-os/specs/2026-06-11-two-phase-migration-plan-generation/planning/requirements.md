# Spec Requirements: Two-Phase Migration Delivery Plan Generation (skeleton → expand) with Inventory Batching + Template Stamping

> Status: AUTHORITATIVE / BUILD-READY. All eight clarifying questions from the
> shaping session have been answered by the user and are baked in below as settled.
> Do NOT re-ask. The raw idea in `planning/raw-idea.md` carries the full problem
> statement, solution outline, and the decisions that were already settled before
> shaping (treat those as settled too).

## Initial Description

See `planning/raw-idea.md` (comprehensive). Summary:

The PM "Create Migration Delivery Plan" wizard's Generate step makes LLM calls to
generate a draft migration book of work. The original single whole-plan call exceeded
the Azure OpenAI relay's hard ~300s request cap (HTTP 504 at ~5 minutes). The
per-delivery-stream split (one parallel LLM call per selected stream, deterministic
assembly — built 2026-06-11, uncommitted) mitigates this, but a single stream can
still overflow the cap for large inventories (e.g. 100+ API endpoints in
`target_service_api_implementation` or 100+ tables in
`target_database_schema_implementation`). The binding constraint is OUTPUT tokens
per call.

The solution combines a two-phase UX with three techniques:

1. **Phase 1 — "Generate plan" (skeleton):** the existing wizard Generate button
   produces ONLY the initiative → epic → feature skeleton per selected delivery
   stream (titles, one-line descriptions, NO stories, NO acceptance criteria).
   The skeleton draft persists to AMS and opens in the existing review workspace.
2. **Phase 2 — "Expand" (detailed stories), user-triggered in the review
   workspace:** "Expand epic" per epic row PLUS an "Expand all epics" bulk control.
   Expansion generates the epic's stories and appends them to the persisted draft.
   Per-epic state machine: `not_expanded` / `expanding` / `expanded` /
   `failed` (retryable). Partial progress visible and resumable.
3. **Deterministic inventory batching (inside phase 2):** for inventory-driven
   epics, the gateway partitions the real inventory deterministically BEFORE
   calling — batches of ~12 items → one expansion call per batch under the
   skeleton's epic ids — under a bounded concurrency pool.
4. **Template + exception stamping:** homogeneous bulk stories are NOT individually
   LLM-written. The LLM produces the story template(s) per work type, a
   standard-vs-exceptional classification of inventory items, and full bespoke
   stories ONLY for exceptions. The gateway stamps the template across the
   inventory in code with real model facts; coverage becomes a code guarantee.
5. **Layered verification:** (a) code-level referential checks on every stamped
   item (blocking); (b) hard-wired classification overrides in code (findings,
   live conflicts, missing baselines, complex SOAP schemas, not-ready_for_spec →
   ALWAYS bespoke); (c) an LLM judge pass per stamped batch with flagged items
   re-routed to the bespoke path; (d) the downstream per-story shape-spec stage
   as the implementation-correctness safety net.

NOTE on terminology: phase 2 produces detailed STORIES in the book of work. The
downstream per-story SHAPE-SPEC generation stage (already wired) remains unchanged.

## Requirements Discussion

### First Round Questions (all answered — settled)

**Q1: AMS persistence for phase-2 appends.** How should expanded stories and
per-epic expansion state be persisted — a new AMS append/update path, and does it
need schema (Liquibase) changes?
**Answer:** A dedicated server-side append/merge endpoint (e.g.
`POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append`)
that atomically merges appended stories + per-epic expansion state inside
`book_of_work_json`. **NO Liquibase change** — no new columns, no new
`chk_gmbw_status` values; expansion state rides inside `book_of_work_json` per
epic. This avoids read-modify-write races during concurrent expansion.

**Q2: Inventory ground truth for batching/stamping.** Where does the gateway get
the authoritative endpoint/table inventory it partitions and stamps against?
**Answer:** The gateway fetches the REAL endpoint/table inventory from the AMS
architecture model via `architectureModelClient` (the same source the shape-spec
stage uses). The Migration Discovery Context stays summary-level.

**Q3: Batch size & concurrency.** What batch size per expansion call, and how is
LLM concurrency bounded?
**Answer:** ~12 inventory items per expansion call (env-configurable). One
concurrency pool shared across all epics during "Expand all".

> **USER EMPHASIS (verbatim requirement):** the number of CONCURRENT LLM REQUESTS
> MUST BE CONFIGURABLE (env var) — the user does not know how the internal
> gateway/relay will react to multiple concurrent requests. Default 4 in-flight,
> but it must be tunable down to 1 (fully serial) WITHOUT a code change. Make this
> a first-class, documented gateway config value (e.g.
> `MIGRATION_PLAN_LLM_CONCURRENCY`) alongside the batch size (e.g.
> `MIGRATION_PLAN_EXPANSION_BATCH_SIZE`). The phase-1 per-stream skeleton calls
> must respect the SAME concurrency pool.

**Q4: Judge-pass failure semantics.** What happens when the judge call itself
fails, or a judge-flagged item's bespoke rewrite fails?
**Answer:** If the judge call fails after one retry, the epic goes to `failed`
(retryable) — unverified stamped content NEVER silently lands. Same epic-level
`failed` (retryable) when a judge-flagged item's bespoke rewrite fails after retry.

**Q5: Phase-1 UI surfaces.** Which surfaces need updating so the PM understands
the skeleton-then-expand model?
**Answer:** All four: (a) update the Generate progress overlay copy for skeleton
generation; (b) DraftSummary shows skeleton counts + an "X of Y epics expanded"
line; (c) the draft list row gets an aggregate expansion indicator; (d) a one-line
note on the wizard's Generate step that detailed stories are expanded later in the
review workspace.

**Q6: Save-to-backlog on partially expanded drafts.** Allowed or blocked?
**Answer:** ALLOWED, with a NON-BLOCKING warning when the selection includes an
unexpanded epic. Plus a per-epic expansion-state badge in the hierarchy tree.

**Q7: Stamped story content shape.** How rich is a stamped story, and how is
provenance recorded?
**Answer:** Full `MigrationBookOfWorkItem` shape + a SMALL set of templated
acceptance criteria per work type (e.g. "Behavioural parity with baseline {id}
for {METHOD} {path}") stamped in code; deep detail stays with the downstream
shape-spec stage. A provenance tag distinguishes stamped vs generated items
(mirroring the existing `stream:<name>` per-item tag convention).

**Q8: Scope boundaries.** Confirm what is out of scope.
**Answer:** CONFIRMED out of scope: the downstream shape-spec stage + Jira upload
are unchanged; the legacy no-streams combined path keeps producing a full plan in
one call; no per-story regeneration UI beyond the existing item drawer.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Per-stream split + deterministic assembly — Path:
  `gateway/src/services/migrationBookOfWorkHandler.ts` (id namespacing
  `<stream>:<id>`, `STREAM_SEQUENCE_RANK` stream ordering, global `sequenceOrder`
  renumbering, deterministic counts, worst-of `qualityAssessment`, per-item
  `stream:<name>` tags, one-retry-per-stream, atomic AMS write). Built
  2026-06-11, uncommitted — this spec builds directly on it.
- Feature: Book-of-work schema + hierarchy validation — Path:
  `gateway/src/services/generatedMigrationBookOfWorkSchema.ts`
  (`GeneratedMigrationBookOfWork`, `validateBookOfWorkHierarchy`:
  initiative→epic→feature→story, no orphans/cycles/level-jumps, duplicate-id
  rejection).
- Feature: PM migration-delivery-plan system prompt — Path:
  `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
  (hard constraints: sequenceOrder dependencies, 14-value workstream vocabulary,
  captured-decision alignment, `[decision:<code>]` tags).
- Feature: Validated-LLM-pass precedent (judge/validator pattern) — Path:
  `gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts`.
- Feature: AMS draft creation — `POST /api/projects/{projectId}/migration-books-of-work`
  (draft fields: `title`/`summary`/`generation_inputs_json`/`generation_summary_json`/
  `quality_assessment_json`/`book_of_work_json`). NO append/update path for items
  yet — Q1's endpoint is new.
- Feature: Frontend surfaces — Paths: `frontend/.../MigrationDeliveryPlanWizard.tsx`
  (Generate), `frontend/.../MigrationBookOfWorkReviewWorkspace.tsx` (review),
  `frontend/.../migrationDeliveryPlanApi.ts`.
- Inventory source: `architectureModelClient` (gateway) — same model source the
  shape-spec stage uses (per Q2).

**Reuse gap (confirmed in shaping research):** there is NO existing
bounded-concurrency LLM-pool utility in the gateway — build a small one (used by
both phase-1 skeleton calls and phase-2 expansion, per Q3).

### Follow-up Questions

None required — all eight first-round questions were answered with no
contradictions.

## Visual Assets

### Files Provided:

No visual assets provided (verified: `planning/visuals/` contains no image files).

### Visual Insights:

- Follow existing review-workspace styling
  (`MigrationBookOfWorkReviewWorkspace.tsx`) for all new phase-2 controls,
  badges, and indicators.

## Requirements Summary

### Functional Requirements

**Phase 1 — skeleton generation (wizard Generate button):**
- Generate ONLY initiative → epic → feature skeleton per selected delivery stream
  (titles, one-line descriptions; no stories, no acceptance criteria).
- Skeleton write to AMS stays atomic as today; draft opens in the review workspace.
- Per-stream skeleton calls run through the shared bounded-concurrency pool.
- UI: updated Generate overlay copy; one-line wizard note that detailed stories
  are expanded later in the review workspace.

**Phase 2 — expansion (review workspace, user-triggered):**
- "Expand epic" per epic row AND "Expand all epics" bulk control (product rule:
  never individual-only actions).
- Per-epic state machine: `not_expanded` / `expanding` / `expanded` / `failed`
  (retryable); failed epics re-expand without regenerating the rest; expansion is
  atomic per epic.
- Expansion state persists per epic INSIDE `book_of_work_json` (no schema change).
- New AMS server-side append/merge endpoint (e.g.
  `POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append`)
  atomically merges appended stories + per-epic expansion state — safe under
  concurrent expansion.

**Inventory batching:**
- Gateway fetches the real endpoint/table inventory from the AMS model via
  `architectureModelClient`; deterministic partition into batches of
  ~`MIGRATION_PLAN_EXPANSION_BATCH_SIZE` (default ~12) before calling; one
  expansion call per batch under the skeleton's epic ids.
- Single shared concurrency pool, `MIGRATION_PLAN_LLM_CONCURRENCY` (default 4,
  MUST be tunable down to 1 / fully serial via env alone). First-class,
  documented gateway config values for both knobs.

**Template + exception stamping:**
- LLM output per inventory epic: story template(s) per work type +
  standard/exceptional classification + bespoke stories for exceptions only.
- Gateway stamps templates across the inventory in code (real model facts:
  method/path/baseline id/data-effect entities/mappings) — coverage is a code
  guarantee.
- Stamped story = full `MigrationBookOfWorkItem` + a small set of templated
  acceptance criteria per work type; provenance tag (stamped vs generated)
  alongside the existing `stream:<name>` tag convention.

**Layered verification:**
1. Code-level referential checks on every stamped item (endpoint exists, baseline
   resolves, data-effect entities resolve) — deterministic, blocking.
2. Hard-wired bespoke overrides in code (attached findings, live conflicts,
   missing baselines, complex SOAP message schemas, not `ready_for_spec`) —
   regardless of LLM classification.
3. LLM judge pass per stamped batch (verdict-only); flagged items re-routed to
   the bespoke path and rewritten individually.
4. Judge failure after one retry → epic `failed` (retryable); flagged-item
   bespoke-rewrite failure after retry → epic `failed` (retryable). Unverified
   stamped content never silently lands.

**Save-to-backlog:**
- Allowed on partially expanded drafts, with a non-blocking warning when the
  selection includes an unexpanded epic.

**UI state surfaces:**
- Per-epic expansion-state badge in the review-workspace hierarchy tree.
- DraftSummary: skeleton counts + "X of Y epics expanded" line.
- Draft list row: aggregate expansion indicator.

### Reusability Opportunities

- Build on `migrationBookOfWorkHandler.ts` (per-stream split, assembly,
  retry-once, atomic write) and `generatedMigrationBookOfWorkSchema.ts`
  (hierarchy validation) rather than parallel machinery.
- Model the judge pass on the validated-LLM-pass precedent in
  `techStackPrefillResponseValidator.ts`.
- Reuse the existing per-item tag convention (`stream:<name>`) for the new
  stamped/generated provenance tag.
- New small bounded-concurrency LLM-pool utility (none exists) — shared by
  phase 1 and phase 2.

### Scope Boundaries

**In Scope:**
- Two-phase generate/expand UX across wizard + review workspace.
- New AMS append/merge endpoint for book-of-work items + expansion state
  (no DDL/Liquibase change).
- Deterministic inventory batching from the real AMS model inventory.
- Template + exception stamping with the full 4-layer verification.
- Bounded-concurrency LLM pool with the two documented env knobs
  (`MIGRATION_PLAN_LLM_CONCURRENCY` default 4, tunable to 1;
  `MIGRATION_PLAN_EXPANSION_BATCH_SIZE` default ~12).
- Per-epic retryable failure handling; partial-save warning; all listed UI
  state surfaces.
- Small streams (e.g. `cutover_rollback_decommission`,
  `reconciliation_reporting`) may stay on the current single-call-per-stream
  path where one call already fits — no machinery where not needed.

**Out of Scope (confirmed by user):**
- The downstream per-story shape-spec stage — unchanged.
- Jira upload — unchanged.
- The legacy no-streams-selected combined path — keeps producing a full plan in
  one call; must keep working (back-compat).
- Per-story regeneration UI beyond the existing item drawer.
- Any AMS schema (Liquibase) change — explicitly none; no new columns, no new
  `chk_gmbw_status` values.

### Technical Considerations

- **Hard external constraint:** Azure OpenAI relay ~300s per request (node undici
  default ~300s is the next ceiling). Every individual LLM call (skeleton-per-stream,
  expansion-per-batch, judge-per-batch, bespoke rewrites) must fit comfortably
  under it — that is the whole rationale for batching + stamping.
- Concurrency behaviour against the internal gateway/relay is UNKNOWN — hence the
  hard requirement that in-flight LLM request count is env-tunable down to 1
  without a code change.
- Append endpoint must be server-side atomic merge (not client read-modify-write)
  to survive concurrent per-epic expansions during "Expand all".
- Expansion state lives inside `book_of_work_json` per epic — the draft document
  is the single source of truth for resume/retry across page reloads.
- AMS wire format: AMS speaks `snake_case` by default; DTOs with `camelCase`
  consumers use `@CamelCaseWire` (see repo `CLAUDE.md`) — the new append endpoint
  must follow the existing migration-books-of-work wire conventions.
- Stamping substitutions must come from the same model facts the referential
  checks validate (endpoint/method/path, baseline ids, data-effect
  entities/mappings) so a passing check guarantees a correct stamp.
- Judge pass is verdict-only output (cheap, adversarial-verify pattern).
