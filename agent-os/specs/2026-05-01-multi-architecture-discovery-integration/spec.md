# Specification: Discovery Service `architectureId` Integration (Spec #4)

## Goal
Bind every Discovery run to exactly one architecture for life — picked explicitly by the user at run start, propagated through every Discovery endpoint and every save-back to architecture-model-service, and surfaced through a URL-filtered run list, a detail-page chip, and an explicit save-back confirmation modal.

## User Stories
- As an architect, I want to pick the target architecture at the moment I start a discovery run so that I always know exactly which architecture the run will write into for its entire lifetime.
- As an architect viewing `/projects/X/architectures/A/...`, I want the discovery run list to show only runs targeting architecture A so that runs from parallel architectures (e.g. current-state vs target-state) don't clutter my view.
- As an architect promoting candidates and relationships from a discovery run into the canonical model, I want a confirmation modal naming the target architecture and item counts so that I can never accidentally save against the wrong architecture.

## Specific Requirements

**Always-explicit architecture picker at run start**
- `StartDiscoveryRunConfirmModal.tsx` always embeds an architecture picker, even when the project has only one non-archived architecture (no conditional hide).
- New component `frontend/src/components/Discovery/ArchitectureRunTargetPicker.tsx`: lists `architectures.filter(a => !a.archived)` from `ArchitectureContext`, oldest-first (matching spec #1's Default-resolution order and spec #2's selector ordering).
- Picker is pre-selected with the URL's active architecture via `useActiveArchitectureId()` (spec #2); user may pick a different one — the picker is the source of truth for run start, **not** the URL active id.
- When exactly one architecture exists, the picker is rendered disabled (visible for confirmation, no choice to make).
- One-line confirmation copy beneath the select: `Run will be locked to this architecture for its entire lifetime.`
- The picked `architectureId` becomes part of the run-start request payload and is bound to the run for life.

**URL-filtered run list (no list-row chip)**
- Discovery run list components read `useActiveArchitectureId()` and pass it to the list API call, which embeds it in the path segment.
- Backend list endpoints filter by `architectureId` in the `WHERE` clause; runs targeting other architectures are not returned.
- Run-list rows do **not** show the architecture name (the list is implicitly filtered — showing it would be redundant noise).
- Switching architecture via the spec #2 top-bar selector swaps the URL `:architectureId` segment and the list re-renders against the new architecture's runs.

**Detail-page architecture chip (only here)**
- The run detail page header shows a read-only chip: `Architecture: <name>`.
- Reuse the closed-state pill styling from `ArchitectureSelector.tsx` (spec #2) — read-only variant, no dropdown.
- The chip name is resolved client-side from the `ArchitectureContext.architectures` list using the run's stored `architectureId`.

**Silent backfill of pre-existing runs to project Default**
- Liquibase changeset `093-add-architecture-id-to-discovery-runs.sql`: add nullable `architecture_id UUID` column to `discovery_runs`.
- Liquibase changeset `094-backfill-discovery-runs-architecture-id.sql`: `UPDATE discovery_runs SET architecture_id = project_id` — exploits spec #1's deterministic-Default convention (`architecture.id = project.id` for each project's auto-created `Default`); add a precondition assertion that every project has a `Default` architecture row before the update runs.
- Liquibase changeset `095-discovery-runs-architecture-id-not-null-fk.sql`: enforce `NOT NULL`, add foreign key to `architecture(id)`, add composite `(project_id, architecture_id)` index.
- Register all three in `db.changelog-master.yaml`. Never edit applied changesets 087–092 — new files only (project memory rule).
- No banner, no "legacy" tag, no per-run notice anywhere in the UI.

**Explicit save-back confirmation modal**
- New component `frontend/src/components/Discovery/SaveBackConfirmModal.tsx`, modelled on `ArchiveArchitectureConfirmModal.tsx` (spec #3).
- Body: `Save <N> candidates and <M> relationships to architecture '<name>'?` — counts and architecture name resolved from the run state.
- Confirm button label: `Save to <name>`. Cancel button + Esc dismiss available. Confirm disabled while in flight.
- Save-back writes are blocked until the user confirms; on confirm, the discovery-service performs the promotion against the run's bound `architectureId` only.

**`architecture_id` column lives only on `discovery_runs`**
- Children (`discovery_evidence`, `discovery_relationships`, `discovery_clusters`, `discovery_candidates`, `discovery_decision_tasks`) inherit the architecture via their `run_id` FK — no column added to child tables.
- Backend list endpoints for child entities filter via JOIN: `WHERE run_id IN (SELECT id FROM discovery_runs WHERE project_id = ? AND architecture_id = ?)`.
- Single source of truth — no risk of children drifting to a different architecture from their parent run.

**URL shape — hard cutover to path-segment**
- All Discovery endpoints become `/api/projects/{projectId}/architectures/{architectureId}/discovery/...` — mirrors spec #1's Bucket A convention and spec #2's frontend mirror-backend pattern.
- Applies to `discovery-service` routes AND `architecture-model-service` `Discovery*Controller` endpoints AND gateway proxy routes — all in lockstep.
- Forgetting `:architectureId` produces a 404 (no fallback / no default-resolution at the controller layer).
- No back-compat shims — every call site is updated together.

**discovery-service runtime binding**
- `runManager.ts` stores `architectureId` per run; reads from the run-start payload and persists alongside other run state.
- `archModelClient.ts`: every entity-fetch call (including spec #1's three already-updated helpers for services / applications / app_components) reads the run's stored `architectureId` instead of resolving via the per-run cached helper.
- Spec #1's `resolveDefaultArchitectureId` helper is **kept** as a fallback only for code paths without a run context (likely zero remain after this spec) — must not regress its existing tests.
- Save-back code paths read the same stored `architectureId` and write only to that architecture in architecture-model-service.
- **Constraint:** only edit `discovery-service/src/**` when no discovery run is active — `tsx watch` auto-reloads kill in-flight runs (project memory rule).

**LLM persona system-prompt injection (bound mode)**
- The Discovery persona definition is updated to declare it operates in **bound-by-system-prompt** mode (per the design note's save-target resolution decision).
- At conversation start, `discovery-service` injects `Architecture: <name> (id: <architectureId>)` into the system prompt.
- The persona never asks the user to confirm save target — the `architectureId` is bound up front and the LLM treats it as authoritative for the entire conversation.
- No data migration for existing LLM threads — forward-only change; existing threads keep their original prompts (threads remain project-scoped per spec #1).

**Backend controller / service / repository propagation**
- Every `Discovery*Controller.java` in `architecture-model-service` adds `{architectureId}` path variable; services and repositories accept and filter by it.
- `DiscoveryRunEntity.java` gains `architectureId UUID` field.
- For child entities filtering by run, the architecture filter is applied via JOIN to `discovery_runs` (no direct column on children).
- Gateway proxies in `gateway/src/routes/` for discovery embed `:architectureId` and forward downstream.

## Existing Code to Leverage

**Spec #1's `discovery-service/src/services/archModelClient.ts` updated entity-fetch helpers**
- Three helpers (services / applications / app_components) already accept `architectureId` and resolve via per-run cached helper.
- This spec replaces the silent-default resolution with a direct read of the run's stored `architectureId` — helpers' signatures stay; only the source of the id changes.
- Existing tests stay green; the cached `resolveDefaultArchitectureId` helper remains for non-run paths.

**Spec #2's `ArchitectureContext`, `useActiveArchitectureId()`, and `ArchitectureSelector` pill styling**
- Picker pre-selection reads `useActiveArchitectureId()`; run-list filtering reads the same hook.
- Detail-page chip reuses `ArchitectureSelector` closed-state pill visual as a read-only variant.
- `architectures` list (with `archived` flag) consumed by the picker for the non-archived oldest-first ordering.

**Spec #3's `ArchiveArchitectureConfirmModal.tsx`**
- Confirmation modal shell pattern: warning copy, secondary Cancel + destructive primary action button, Esc-to-dismiss, click-outside-to-close, primary disabled while in flight.
- `SaveBackConfirmModal` mirrors this shell with item-count copy and the `Save to <name>` confirm button.

**Liquibase changeset numbering 087–092 already applied; pattern from changesets 020–024 / 087–091**
- Multi-step nullable-column → backfill → NOT NULL + FK pattern is the template for changesets 093 / 094 / 095.
- One changeset per concern for granular rollback.
- Spec #1's deterministic-Default rule (`architecture.id = project.id`) makes the backfill `UPDATE discovery_runs SET architecture_id = project_id` correct without joins.

**Spec #1's Bucket A controller pattern (`/api/.../projects/{projectId}/architectures/{architectureId}/...`)**
- Path-variable propagation through controller → service → repository, with the architecture filter applied alongside `projectId` in the `WHERE` clause.
- 404-on-missing-segment behaviour (no silent fallback) is the same shape Discovery controllers adopt here.

## Out of Scope
- LLM persona save-target resolution for non-Discovery contexts (`clarify-at-save` mode) — deferred to spec #5.
- Full clone (duplicate architecture A into new B) — deferred to spec #6.
- Selective cross-architecture copy — deferred to spec #7.
- Comparison / diffing UI and unarchive UI — deferred indefinitely.
- Per-architecture access control — not in V1.
- Cross-architecture run replay, mid-flight re-targeting, or multi-architecture writes from a single run — locked out by design (one run → one architecture for life).
- Surfacing pre-existing runs as "legacy" or with a migration banner — silent backfill instead.
- Showing the architecture name on run-list rows — implicit URL filter makes it redundant noise.
- Adding `architecture_id` columns to discovery child tables (evidence, relationships, clusters, candidates, decision-tasks) — they inherit via `run_id` FK only.
- Back-compat shims for the old project-only Discovery URL shape — hard cutover, every call site updated in lockstep.
