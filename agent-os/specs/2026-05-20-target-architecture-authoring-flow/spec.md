# Specification: Target Architecture Authoring Flow

## Goal
Add an interactive authoring surface for the target-state architecture so users can seed (clone / blank / template), edit, draft, and promote a target architecture from the project workspace, with downstream shape-specs flagged stale on each active-target change. Closes the "user direction -> Target State Architecture" arrow on the migration macro diagram by replacing today's import-only target with a curated, table-driven editor that drives better focused-context for shape-spec generation.

## User Stories
- As a product / migration owner, I want to seed a target architecture by cloning the current one and edit it row-by-row in a table so I can shape the desired end-state without leaving the project workspace.
- As a product / migration owner, I want to keep multiple named drafts and promote one to active in a single confirmed click so I can compare alternatives without losing prior work.
- As a product / migration owner, I want the migration delivery dashboard to tell me which shape-specs are now stale because the active target changed so I can decide which to regenerate.

## Specific Requirements

**AMS schema additions (new Liquibase changeset, immutable per project memory)**
- Add `draft_state` VARCHAR on `architecture` table with CHECK in (`active`, `draft`); default `active` on insert. Backfill existing rows to `active`.
- Add `kind` VARCHAR on `architecture` table with CHECK in (`current`, `target`); default `current` so existing rows backfill cleanly. The existing imported target row (if any) is migrated to `kind='target'` by an idempotent backfill that detects it via the existing import metadata.
- Add `provenance` VARCHAR and `decommissioning_status` VARCHAR on each architecture element table that participates in the table editor (component / API / data entity / infrastructure element supertype). Vocabularies: `cloned-from` / `imported` / `user-authored` / `llm-suggested` and `not-applicable` / `proposed` / `decommissioned`. Both nullable, with CHECK constraints; default values set only on insert.
- Add `stale` BOOLEAN and `stale_marked_at` TIMESTAMPTZ to `migration_story_spec_generations`. Both nullable so PATCH semantics preserve null per `project_primitive_double_dto_overwrite.md`. New index on `(project_id, stale)` for dashboard count.
- All new fields are boxed reference types on the JPA entity (`Boolean`, `Instant`); no Java primitives.
- One new changeset file per change. Never edit applied Liquibase changesets per `feedback_liquibase_immutable_changesets.md`.

**AMS endpoints**
- `POST /api/projects/{projectId}/target-architectures/seed` with body `{ mode: 'clone-current' | 'blank' | 'from-template', templateId? }` -- creates a new `kind='target'`, `draft_state='draft'` architecture. `clone-current` reuses `ArchitectureCloneService` to copy elements and stamps each element `provenance='cloned-from'`; `blank` creates an empty architecture; `from-template` is wired to accept a `templateId` but in v1 returns 501 unless a template registry exists (out of scope for build).
- `POST /api/projects/{projectId}/target-architectures/{targetArchId}/promote` -- transitions the draft to `draft_state='active'`. Prior active target is moved to `draft_state='draft'` and renamed (suffixed with " (superseded YYYY-MM-DD)") so history survives via the existing AMS audit trail. Returns the impact preview (count of specs that will be marked stale) computed BEFORE the transition so the UI confirm modal can render it.
- `DELETE /api/projects/{projectId}/target-architectures/{targetArchId}` -- soft-deletes (sets `archived=true`); rejects 409 if `draft_state='active'`.
- `GET /api/projects/{projectId}/target-architectures` -- lists every `kind='target'` row (active + drafts), sorted active-first then most-recent.
- `GET /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements` -- returns every current-architecture element that has no row in `architecture_element_mappings` pointing at the active target. Powers the unmapped-elements panel.
- `POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest` with body `{ targetElementId, targetElementSnapshot }` -- proxies the LLM hint call (gateway is the LLM orchestrator) and returns up to three candidate current-element mappings ranked by score. Read-only; never mutates.
- `POST /api/projects/{projectId}/specs/mark-stale` with body `{ activeTargetArchId, changedElementIds[] }` -- finds every `MigrationStorySpecGenerationEntity` whose `focused_context_refs_json` cites any of `changedElementIds` (or any mapping touching those elements) and sets `stale=true`, `stale_marked_at=now()`. Idempotent.

**Stale-flag trigger semantics**
- Fires on every successful `promote` call (always, regardless of element changes).
- Fires on every save to the active target architecture, debounced server-side: a window of N seconds of inactivity (target: 5s, configurable per project memory `project_appshell_model_cache.md` rules but fixed in v1) collapses a burst into a single `mark-stale` invocation.
- Draft edits NEVER fire stale-mark. The trigger is gated on `draft_state='active'`.
- "Affected specs" = any row whose `focused_context_refs_json.architecture_element_ids` (or transitively `mapping_refs`) intersects the changed-element set. Active-target writes record the touched element ids and pass them to `mark-stale`.

**Decommissioning semantics**
- `decommissioning_status` is target-side only. Current architecture has no decommissioning field of its own.
- "Decommissioned in target" annotation on a current-architecture element is DERIVED at read time: an element is shown as decommissioned-in-target if (a) it has no mapping to any element on the active target, OR (b) every mapping it has points at a target element whose `decommissioning_status='decommissioned'`.
- "Mark decommissioned" action from the unmapped-elements panel writes a NEW target-side row with `provenance='user-authored'`, `decommissioning_status='decommissioned'`, plus an `architecture_element_mappings` row from the current element to the new target row (`mapping_type='decommissioned'`).

**Seeding modes**
- `clone-current`: deep-clones every element from the current architecture, sets each element's `provenance='cloned-from'` with a back-reference to the source element id, and auto-creates `mapping_type='equivalent'` rows in `architecture_element_mappings` with `confidence=1.0` and `createdByTask='target-arch-seed-clone'`. Reuses `ArchitectureCloneService.cloneArchitecture` -- do not write a parallel clone path.
- `blank`: creates the target row only. No elements, no mappings. Provenance is irrelevant.
- `from-template`: scaffolded but returns 501 in v1 (template registry deferred). The endpoint contract is shipped so the frontend can render the option as disabled with an explanatory tooltip.

**Gateway extensions**
- New task `product-manager--suggest-target-architecture` in `gateway/src/routes/chatV2.ts` (mirrors the `product-manager--roadmap` / `product-manager--backlog` pattern). One-shot, non-conversational: assembles a focused-context bundle (current architecture + discovery findings + mappings + API baselines), calls the LLM with a fixed token envelope, parses the structured response into a draft architecture payload, and POSTs `target-architectures/seed` (mode=blank) followed by element inserts, each stamped `provenance='llm-suggested'`.
- New mapping-suggest LLM call wired into `gateway/src/routes/architectures.ts` (small, fast prompt; bounded payload).
- New proxy routes for every AMS endpoint above, following the existing pass-through pattern used for `selective-copy/preflight` and `selective-copy/commit`.
- Active-target debounce buffer lives in the gateway proxy (server-side, in-memory, keyed by `(projectId, activeTargetArchId)`); not in AMS. AMS-side `mark-stale` is the durable write.

**Frontend authoring workspace**
- New top-level tab on the project / architecture workspace ("Target Architecture") peer to the existing current-architecture view; same component is reachable from a prominent "Author target" button on the project dashboard. NOT nested under the current-architecture view.
- Workspace renders four panels: (1) drafts list (left), (2) table editor for the selected architecture (centre, rows per element type with inline editing), (3) unmapped-current-elements warning panel (right), (4) read-only diagram view rendered from the existing diagram pipeline below the table.
- Add-new-element button on each row group opens an inline expansion (NOT a modal) with the mapping picker (`replaces current element X` / `brand-new` / `no current equivalent`) plus an LLM hint chip the user can accept; saves only after the mapping choice is made.
- "Suggest target architecture from current" button on the drafts panel calls the new LLM task and opens the resulting draft.
- "Promote to active" button on a draft opens a single confirm modal that surfaces the impact preview ("This will mark N specs stale") fetched from `promote` (dry-run flag) before the user confirms. One-click confirm; no undo toast; no wizard.
- AppShell model cache invalidation: every successful target-architecture mutation MUST dispatch `LOAD_MODEL` (same-arch) or invalidate cache (cross-arch) per `project_appshell_model_cache.md`, otherwise the table will render stale.

**Frontend compare view**
- Stacked-rows table only: each row is a (current element, target element) pair grouped by element type, with provenance + decommissioning columns on the target side and a "mapping" column in the middle.
- NO visual side-by-side diagrams. Deferred entirely per confirmed decision Q6.

**Migration delivery dashboard integration**
- New summary card in `MigrationDeliverySummaryCards.tsx` showing stale-spec count (queries `migration_story_spec_generations WHERE stale=true`).
- Existing `MigrationDeliveryNeedsAttentionPanel.tsx` filter chip set extended with a "Stale (target arch changed)" filter.
- "Regenerate stale specs" action (user-triggered, NEVER auto): invokes the existing batch generation entrypoint pre-filtered to `stale=true`. On successful regeneration the entity's `stale` clears.

**Prompts**
- `suggest-target-architecture` prompt: input = current architecture summary + discovery findings + active mappings; output = JSON schema with rows per element type (component / api / data entity / infra) plus per-row provenance reasoning. Fixed token envelope chosen at implementation time (no UI knob; deferred per Q9).
- `mapping-suggest` prompt: input = target element snapshot + current architecture element index (id+name+type only, bounded); output = top-3 candidate current-element ids with confidence + one-sentence rationale.

**Testing**
- AMS: repository + service tests for seed (clone / blank / 501 template), promote (with prior-active rename + impact-preview count), delete (active-rejection), mark-stale (intersection logic), unmapped-current-elements (LEFT JOIN correctness). Reuse the Liquibase H2 / Postgres test pattern already used by `ArchitectureCloneService`.
- Gateway: proxy tests modelled on `multiArchitectureSelectiveCopyProxy.test.ts`. New tests for the suggest-target task (mocked LLM, parse-then-POST), mapping-suggest (mocked LLM, bounded payload), and the active-target debounce (fake timers).
- Frontend: Vitest tests for the table editor inline expansion, the promote-confirm modal (asserts the impact-preview line), the drafts list (auto-name format), the unmapped-elements panel (mark-decommissioned writes target row + mapping), the stale-count card. Mock `architectureModelClient` with `jest.requireActual` spread.

**Success criteria / acceptance**
- Each of the 10 working assumptions in `planning/requirements.md` is covered by at least one requirement above (table editor / seed-clone-default / mapping-on-add / single-active-many-drafts / unmapped-panel / stale-flag / one-shot LLM suggest / kind+provenance+decommissioning_status / diagram reuse + compare / in-place edit of imported target as v1 seed).
- Each of the 10 confirmed product decisions in `planning/clarifying-answers.md` is mapped to a concrete requirement (workspace placement / debounced stale on active save / full-draft LLM output / inline-expansion mapping picker / target-side decommissioning + derived current annotation / table-only compare view / single-confirm promote modal with impact preview / auto-named inline-editable drafts / fixed token envelope / no audit panel).
- All three seeding modes round-trip end-to-end (clone produces N=current elements + N mappings; blank produces 0; from-template returns 501 with a clean UI degradation).
- Promote-to-active modal shows a non-zero impact preview when any covered spec exists, and the preview number matches the actual stale-marked count after confirm.
- Active-target debounce: 5 saves within 5s produce exactly 1 `mark-stale` call.
- Draft edits never mark any spec stale (regression test).

## Existing Code to Leverage

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java`**
- Provides `cloneArchitecture(projectId, sourceId, name, description, ...)` returning an `ArchitectureDto`. Reuse verbatim for seed-clone mode.
- Already handles transactional FK rewiring across every element table; do not reimplement.
- Extend with a thin wrapper that stamps `provenance='cloned-from'` on copied elements and auto-creates `architecture_element_mappings` rows.

**`architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`**
- Selective-copy preflight + commit endpoints under `/{targetArchitectureId}/selective-copy/...` show the established controller pattern for project-scoped, target-architecture-scoped writes. Mirror this pattern for the new `/target-architectures/...` endpoints.
- 409 / 422 envelope conventions (`duplicate_name`, `same_architecture`) define the error shape the new endpoints should reuse.

**`architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ArchitectureElementMappingEntity.java`**
- Existing mappings table with `mapping_type`, `confidence` (boxed `Double`), `createdByTask`, unique constraint on the pair. Seed-clone writes `mapping_type='equivalent'`, `createdByTask='target-arch-seed-clone'`, `confidence=1.0`. Decommissioning writes `mapping_type='decommissioned'`, `createdByTask='unmapped-panel-mark-decom'`.

**`gateway/src/routes/architectures.ts` (selective-copy proxy block, ~line 537-600)**
- Pass-through proxy pattern: receive frontend body, forward to AMS, return AMS response unchanged. Copy this shape for `target-architectures/seed`, `/promote`, the GET endpoints, and `mapping-suggest`.

**`gateway/src/routes/chatV2.ts` (`product-manager--roadmap` / `product-manager--backlog` task blocks)**
- Established pattern for a one-shot, non-conversational PM LLM task: build focused-context bundle, call LLM with bounded budget, parse JSON response, POST to AMS for persistence. The new `product-manager--suggest-target-architecture` follows this pattern exactly.

## Out of Scope
- Drag-drop visual diagram editor for the target architecture.
- LLM-conversational / continuous co-pilot architecture authoring (this spec is one-shot suggest only).
- Git-style branching or merging of architectures.
- Auto-regeneration of stale shape-specs (user-triggered only via the existing batch dashboard).
- Wave 2 #8 Claude Code handoff (separate spec).
- Wave 2 #5 dependency hints (separate spec).
- Multi-user concurrent edit resolution on the target architecture.
- Approval / sign-off workflow for promote-to-active (single confirmed click in v1).
- Visual side-by-side diagram comparison (deferred entirely; table-only in v1).
- Per-project configurable LLM input budget (fixed envelope in v1; UI knob deferred).
- Dedicated audit-trail / history panel in the authoring workspace (existing AMS audit only in v1).
