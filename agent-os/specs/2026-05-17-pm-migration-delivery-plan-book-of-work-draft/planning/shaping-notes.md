# Shaping Notes: PM Migration Delivery Plan / Book of Work Draft

## Status

Shaping pass complete. All clarifying questions resolved via recommended defaults. No outstanding undecided items. Ready for spec-writer.

## Resolved Decisions

### Generation Routing + Persistence

#### Q-1 — Gateway-only orchestration
Gateway is the single orchestrator. Flow:
1. Gateway loads context (via the existing Migration Discovery Context resolver).
2. Gateway calls the LLM with the assembled context + new prompt.
3. Gateway validates the structured response against the schema.
4. Gateway POSTs the resulting JSON to AMS via `POST /api/projects/{projectId}/migration-books-of-work`.

The optional AMS `/generate` endpoint listed in the raw-idea is **dropped**. AMS only persists; it never calls the LLM for this flow.

#### Q-3 — Direct AMS REST from gateway for save paths
Gateway calls AMS directly over REST for all persistence in this flow. MCP-server is **not** in the path unless the spec-writer, while inspecting the codebase, discovers that existing PM-task save flows already route through MCP — in which case match that pattern to avoid drift. The intent is to avoid duplicate persistence and keep AMS as the system of record.

#### Q-12 — Reuse existing Migration Discovery Context resolver verbatim
Reuse the existing resolver at `gateway/src/services/contextResolvers.ts` without modification. Spec-writer must inspect `gateway/src/config/tasks/product-manager--backlog.json` to identify the exact `contextNeeds` registration pattern used by existing PM tasks and match it.

#### Q-13 — New prompt filename
`product-manager--migration-delivery-plan.prompt.ts`, placed alongside the existing PM task prompts. Spec-writer locates the directory by inspecting where `product-manager--backlog` and `product-manager--roadmap` prompts live.

#### Q-11 — New PM task config filename
`gateway/src/config/tasks/product-manager--migration-delivery-plan.json`. Shape mirrors `product-manager--backlog.json` exactly (same keys, same conventions; only contents differ).

### AMS Persistence Model

#### Q-2 — Inspect WorkItem model during authoring
Spec-writer (or implementer during build) must inspect the current `WorkItemEntity` / `WorkItemType` enum in `architecture-model-service`:

- **If** the enum natively supports `initiative | epic | feature | story`: direct 1:1 mapping for save-to-backlog. No runtime mapping table needed.
- **If** missing values: add them via a **NEW Liquibase changeset** as part of this spec. Per `feedback_liquibase_immutable_changesets.md`, never edit applied changesets — only add new ones. No comment-only edits to existing changesets.

**No runtime mapping table** in v1 either way. Either the enum supports the values natively, or we extend it.

#### Q-14 — Four separate sibling JSONB columns on `generated_migration_books_of_work`
- `generation_inputs_json` (nullable) — snapshot of the inputs used (Product Definition refs, architecture refs, mapping refs, finding refs, options).
- `generation_summary_json` (nullable) — counts + coverage stats produced by the LLM/generator.
- `quality_assessment_json` (nullable) — per-level rubric scores + rationale.
- `book_of_work_json` (nullable) — the full hierarchy (initiatives → epics → features → stories) including per-item metadata, confidence, readiness, workstream, etc.

All four are nullable so partial drafts and recovery scenarios are representable.

#### Q-6 — Always create a NEW draft row on regenerate
- Regenerate creates a new row.
- The previous active draft for the same `(projectId, currentArchitectureId, targetArchitectureId)` tuple is automatically moved to `status='archived'`.
- List view defaults to showing **active drafts only** with a "show archived" toggle.

This guarantees history is preserved without bloating the default view and removes mutation-conflict surface area.

### Save-to-Backlog Behaviour

#### Q-5 — Per-item commit with per-item `saveState` updates
- Each item save executes in its **own transaction**.
- On success: item flips to `saveState='saved'`.
- On failure: `saveState='failed'` + populate `error_message` on that item.
- Re-running save-to-backlog is **idempotent**: items already in `saveState='saved'` are skipped. The user can resume after partial failure without manual cleanup.
- Whole-batch save = orchestration loop over per-item commits; not a single mega-transaction.

#### Q-8 — Save filter thresholds
- `high_confidence_only` → admit only items with `confidence === 'high'`. Medium/low excluded.
- `ready_for_spec_only` → admit only items with `readiness === 'ready_for_spec'`.
- **Parent-inclusion rule**: if a child (story/feature/epic) passes the filter, its ancestor chain (feature → epic → initiative) is **auto-included** even if those ancestors would not pass the filter on their own. Work items need their hierarchy; orphaned stories are not useful in the backlog.

#### Q-10 — Tag prefix conflict: idempotent additive
- Same tag already present on the target work item → no-op (do not duplicate).
- Different tag with the same prefix already present → add the new tag alongside it; do not remove or overwrite.
- Never remove or overwrite existing tags under any circumstance.

This keeps saves safe to retry and avoids destroying user-curated tagging.

#### Q-16 — `saveState` persistence semantics
- During the review session, `saveState` lives in **frontend state only**.
- Persists to the draft's `book_of_work_json` on either:
  - (a) explicit "Save draft" PUT from the review workspace, or
  - (b) save-to-backlog call (which writes back the post-save states).
- UI surfaces an **"unsaved review changes" indicator** when frontend state has diverged from persisted draft state.

### LLM + Token Budget

#### Q-4 — Reuse Phase 2 token-cap helper
- Reuse the Phase 2 token-capping helper (spec-writer locates exact module).
- Soft cap **~120k tokens** for assembled context.
- **Truncation order** (when over budget):
  1. Drop oldest discovery evidence first.
  2. Compress API baseline detail to summaries.
  3. Compress mapping rationale text.
- **Always retained**, never truncated:
  - Product Definition
  - Current Architecture entity list
  - Target Architecture entity list
  - All mappings between current and target
  - Discovery Findings — IDs always retained even if bodies are dropped (so the LLM can reference them)
- **If still over budget after the truncation cascade**: fail loudly with a clear error message naming what overflowed. Do **not** silently truncate any of the always-retained items.

### Vocabulary

#### Q-7 — 14 workstream values
The 13 enumerated in `raw-idea.md` plus `unknown` as a sentinel value (total 14).

Prompt instructs the LLM:
- Use `unknown` **only** when no other workstream applies.
- Never use `unknown` as a guess or hedge.

UI filter surfaces `unknown` so the reviewer can find and reclassify those items.

### UX

#### Q-15 — Single synchronous LLM call with scripted progress markers
- One synchronous LLM call from gateway. No token streaming.
- Frontend "generation progress" uses **scripted client-side stage markers** that flip as the gateway request lifecycle progresses:
  - "Loading context..."
  - "Calling generator..."
  - "Validating schema..."
  - "Saving draft..."
- These markers are derived from gateway response milestones (or simple time-bucket scripting), not from real LLM token-stream events.

#### Q-18 — Surface in existing PM task menu
- New entry in the existing PM task menu labelled **"Create Migration Delivery Plan"**.
- Match the grouping/style of existing PM tasks (spec-writer inspects current PM menu to confirm grouping convention).
- Add a sibling entry **"Migration Delivery Plans"** that opens the draft list view (active drafts by default, with "show archived" toggle per Q-6).

### Auth

#### Q-17 — Match `product-manager--backlog` gating verbatim
Whatever auth/role gating the existing `product-manager--backlog` task uses, reuse exactly. Do not introduce any new role concept, new permission flag, or new gating layer in this spec.

### Tests

#### Q-9 — One new comprehensive PM-flow fixture
- Build a single new fixture representing a small realistic migration scenario:
  - A monolith service split into **2 target services**
  - Plus **1 data migration**
  - Plus **1 contract change**
  - Plus **2 unresolved findings**
- Fixture **cites** the Phase 1, Phase 2, and Phase 3 reference fixtures it draws from, but is **purpose-built** for the PM flow (not reused verbatim from another phase).
- Location: under this spec's `planning/visuals/` directory.
- Suggested filename: `fixture-migration-delivery-plan-scenario.json` (spec-writer may refine the exact name during authoring).

## Existing Code Reuse Pointers

The user did not supply explicit paths, but shaping identified these closest precedents. The spec-writer must reference these during authoring:

- **PM task config + prompt + structured-response shape**:
  - `gateway/src/config/tasks/product-manager--backlog.json`
  - `gateway/src/config/tasks/product-manager--roadmap.json`
  - Plus the corresponding `*.prompt.ts` files alongside them.

- **AMS project-scoped artifact controller / entity / service pattern** (most recent strong reference):
  - `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryRunController.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiscoveryRunEntity.java`
  - `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryRunService.java`
  - Use this trio as the structural template for the new `MigrationBookOfWork*` controller/entity/service set.

- **Migration Discovery Context resolver** (reuse verbatim):
  - `gateway/src/services/contextResolvers.ts`

- **Save-back into hierarchical persistence — closest precedent for per-item-commit + saveState + idempotent retry**:
  - `mcp-server/src/services/candidateSaveBackService.ts`
  - Spec-writer may borrow logic/patterns from here, but the actual persistence path in this spec remains **gateway → AMS direct REST** per Q-3 (not via MCP).

- **Frontend review workspace pattern — hierarchy tree with badges + item drawer**:
  - Whichever of these exists in the current codebase is the closest precedent: Discovery Findings review surface, or the `api-migration-validation-service` review UI introduced in recent commits.
  - Spec-writer inspects both and picks the closer match for the review workspace UX.

## Visual Assets

**NONE supplied.**

The user did not provide mockups, wireframes, or screenshots for any surface in this spec:
- Generation wizard
- Review workspace
- Hierarchy tree
- Item drawer
- Save-to-backlog confirmation dialog
- Draft list view

Spec-writer and implementers work from the textual descriptions in `raw-idea.md` plus these shaping notes. Frontend implementers should lean on the existing PM task UX patterns and the review-workspace precedent (per the pointer above) for visual consistency.

`planning/visuals/` confirmed empty at shaping time.

## Outstanding Items

None. All Q-1 through Q-18 resolved. Shaping pass complete.
