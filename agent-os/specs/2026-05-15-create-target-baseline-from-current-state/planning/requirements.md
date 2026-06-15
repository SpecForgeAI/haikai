# Spec Requirements: Create Target Baseline from Current State

## Initial Description

From `planning/raw-idea.md`:

**Feature name:** Architect — Create Target Baseline from Current State

**Feature summary:** Add a generic architecture copy-and-map workflow that allows a tool user to copy selected architecture entities and relationships from a source architecture (typically Current State) into a target architecture (typically Target State), and automatically create explicit cross-architecture mappings between the original source elements and the newly copied target elements.

This is a prerequisite for future migration-planning workflows, where the system needs to understand that a source/current architecture element is equivalent to, replaced by, renamed as, split into, merged into, or otherwise related to a target-state architecture element.

**Primary user:** Architect persona / tool user working inside a project with at least two architectures.

**Business goal:** Allow users to create a Target State Architecture baseline from an existing Current State Architecture and persist traceable current-to-target element mappings, so later migration planning, backlog generation, data migration, API parity, and test-pack planning can reference exact source and target architecture elements.

(Full raw idea retained in `raw-idea.md`.)

## Requirements Discussion

### First Round Questions

**Q1: Scope reduction.** Should we re-scope v1 to reuse the existing `ArchitectureSelectiveCopyService` + `SelectiveCopyWizardModal` flow rather than implement a new copy pipeline? The new work would then be "selective-copy commit + create mappings + mapping review UI", not a reimplementation of copy logic.
**Answer:** Yes — re-scope v1 to reuse the existing `ArchitectureSelectiveCopyService` + `SelectiveCopyWizardModal` flow. The new work is "selective-copy commit + create mappings + mapping review UI", not a reimplementation of copy logic.

**Q2: Persistence ownership.** AMS owns mapping persistence (JPA entity, repository, service, controller, Liquibase migration, CRUD/search endpoints) and Gateway only proxies the AMS APIs — confirm?
**Answer:** Confirmed — AMS owns mapping persistence, JPA entity, repository, service, controller, Liquibase migration, and CRUD/search endpoints. Gateway only proxies the AMS APIs.

**Q3: Entry-point placement.** Place the "Create Target Baseline" entry point in `ManageArchitecturesModal` alongside existing clone/copy actions, and skip persona-task system integration for v1?
**Answer:** Agree — place "Create Target Baseline" in `ManageArchitecturesModal` alongside existing clone/copy actions. Do not add to the persona task system for v1.

**Q4: Modal strategy.** Extend the existing `SelectiveCopyWizardModal` with an `autoMap` checkbox + a follow-up Mapping Review step (option a), rather than introducing a new modal that wraps it (option b)?
**Answer:** Prefer option (a) — extend the existing `SelectiveCopyWizardModal` with an `autoMap` checkbox and follow-up Mapping Review step.

**Q5: Cache invalidation.** Should the AppShell per-(project,architecture) model cache invalidation fix ship as part of this spec, or be tracked separately?
**Answer:** Ship the fix in this spec. After copy + auto-map, reload the active target architecture if it is active; otherwise invalidate the cached model for the target architecture.

**Q6: Transactional boundary.** Cover copy + mapping creation under a single AMS `@Transactional` boundary (either by extending `ArchitectureSelectiveCopyService.commit` or adding a sibling `commitAndMap`)?
**Answer:** Confirmed — copy + mapping creation covered by a single AMS `@Transactional` boundary, either by extending `ArchitectureSelectiveCopyService.commit` or adding a sibling `commitAndMap`.

**Q7: Element-type registry.** Hardcode `source_element_type` / `target_element_type` initially using the existing in-scope table/entity type string, and defer a formal element-type registry until there is a second consumer?
**Answer:** Agree — hardcode initially using the existing in-scope table/entity type string as `source_element_type` / `target_element_type`. Defer a formal element-type registry until there is a second consumer.

**Q8: Field set.** Reduce the v1 `architecture_element_mappings` field set to a smaller required core (id, project_id, source/target arch ids, source/target element type+id, mapping_type, status, created_by_task, created_at, updated_at) with `notes` and `confidence` optional — drop `created_by`, `updated_by`, `mapping_group_id`, `metadata_json` from v1?
**Answer:** Agree — reduced v1 field set:
- Required: `id`, `project_id`, `source_architecture_id`, `target_architecture_id`, `source_element_type`, `source_element_id`, `target_element_type`, `target_element_id`, `mapping_type`, `status`, `created_by_task`, `created_at`, `updated_at`.
- Optional: `notes`, `confidence`.

**Q9: `new_in_target` / `retired`.** Defer mappings without a source element (`new_in_target`) or without a target element (`retired`) to v2, so v1 always requires both endpoints?
**Answer:** Confirmed — defer to v2. V1 mappings require both source and target element references.

**Q10: `created_by_task` field.** Treat `created_by_task` as a free-text discriminator with documented values rather than a strict enum, with initial values `selective-copy-with-auto-map`, `mapping-review-modal-add`, `mapping-review-modal-edit`?
**Answer:** Free-text discriminator with documented values: `selective-copy-with-auto-map`, `mapping-review-modal-add`, `mapping-review-modal-edit`.

**Q11: Out of scope for v1.** Confirm v1 explicitly excludes: diagram copy; mapping types beyond `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required`; `retired` and `new_in_target`; bulk mapping import; automatic semantic diff; mapping-driven impact analysis.
**Answer:** Confirmed — no diagram copy, no mapping types beyond `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required`, no `retired` or `new_in_target`, no bulk mapping import, no automatic semantic diff, no mapping-driven impact analysis.

### Existing Code to Reference

**Similar Features Identified (from user answers):**
- `ArchitectureSelectiveCopyService` — existing AMS service to be reused/extended for copy + mapping commit. Candidate sites: extend `commit` or add sibling `commitAndMap` under one `@Transactional` boundary.
- `SelectiveCopyWizardModal` — existing frontend wizard to be extended with `autoMap` checkbox + Mapping Review follow-up step.
- `ManageArchitecturesModal` — existing modal where the "Create Target Baseline" entry point will live alongside clone/copy actions.
- AppShell per-(project, architecture) in-memory model cache — see `project_appshell_model_cache.md` memory note. After copy + auto-map, dispatch LOAD_MODEL if target arch is active, else invalidate the cached model for the target architecture.

### Follow-up Questions

**Follow-up 1: Mapping Review closure semantics.** Mapping Review opens after copy + auto-map have already been committed in the same transaction. Closing or cancelling the Mapping Review modal must NOT roll back the copy or the auto-created mappings — Mapping Review is a post-commit edit surface, not a confirm gate. Confirm?
**Answer:** Confirmed — copy + auto-map are already committed when Mapping Review opens. Mapping Review is a post-commit edit surface, not a confirm gate. Closing/cancelling the review modal must NOT roll back the copy or auto-created mappings.

**Follow-up 2: Source-side cache invalidation.** No source-side AppShell model cache invalidation needed for v1 — Mapping Review fetches mapping lists fresh from AMS via the new search endpoint and does not rely on the AppShell model cache for the source architecture. Confirm?
**Answer:** Confirmed — no source-side cache invalidation needed for v1. Mapping lists are fetched fresh from AMS and do not rely on the AppShell model cache.

**Follow-up 3: Manual-add `confidence` default.** When a user manually adds a mapping via the Mapping Review modal, default `confidence` to `null`. Reserve `confidence=1.0` for mappings created automatically by the copy + auto-map step. Confirm?
**Answer:** Confirmed — manual adds default `confidence` to `null`. `confidence=1.0` is reserved for mappings created automatically by copy + auto-map.

## Visual Assets

### Files Provided:
None. Bash check of `planning/visuals/` returned no `.png/.jpg/.jpeg/.gif/.svg/.pdf` files.

### Visual Insights:
N/A.

## Requirements Summary

### Functional Requirements

**Backend (AMS-owned):**
- New JPA entity `ArchitectureElementMapping` + Liquibase changeset for `architecture_element_mappings` table.
- Required columns: `id`, `project_id`, `source_architecture_id`, `target_architecture_id`, `source_element_type`, `source_element_id`, `target_element_type`, `target_element_id`, `mapping_type`, `status`, `created_by_task`, `created_at`, `updated_at`.
- Optional columns: `notes`, `confidence`.
- `mapping_type` allowed values for v1: `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required`.
- `status` allowed values: `confirmed`, `proposed`, `needs_review`, `rejected`.
- v1 default for auto-created mappings: `mapping_type=equivalent`, `status=confirmed`, `confidence=1.0`, `created_by_task=selective-copy-with-auto-map`.
- v1 default for manually added mappings via Mapping Review: `confidence=null`, `created_by_task=mapping-review-modal-add` (mapping_type and status chosen by user). `confidence=1.0` is reserved for the auto-mapped path.
- Constraint: `source_architecture_id != target_architecture_id`; both belong to same `project_id`; both source and target element references required (no `new_in_target` / `retired` in v1); prevent duplicate active mappings on `(project_id, source_arch, target_arch, source_type, source_id, target_type, target_id, mapping_type)`.
- Repository + service + controller for CRUD/search:
  - `GET /api/projects/{projectId}/architecture-mappings` (with query params)
  - `POST /api/projects/{projectId}/architecture-mappings`
  - `PUT /api/projects/{projectId}/architecture-mappings/{mappingId}`
  - `DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}`
- Copy + map orchestration: extend `ArchitectureSelectiveCopyService.commit` (or add sibling `commitAndMap`) so that the existing copy flow plus mapping inserts happen under one `@Transactional` boundary.
- `source_element_type` / `target_element_type` populated from the existing in-scope entity/table type string. No new element-type registry in v1.

**Gateway:**
- Proxy endpoints for the AMS mapping CRUD/search and the copy+map endpoint. No new business logic.

**Frontend:**
- Extend `SelectiveCopyWizardModal`:
  - Add `autoMap` checkbox (default checked).
  - Wire commit call to the new copy+map AMS path via Gateway.
  - On success, open the Mapping Review step.
- Mapping Review modal/step:
  - Opens AFTER the copy + auto-map transaction has committed. It is a post-commit edit surface, NOT a confirm gate.
  - Closing or cancelling the modal must NOT roll back the copy or the auto-created mappings; users can re-open the review later via the same architecture pair without re-running the copy.
  - Mapping list is fetched fresh from AMS via `GET /api/projects/{projectId}/architecture-mappings` on open and on refresh; the modal does NOT rely on the AppShell per-architecture model cache.
  - Table columns: source element, source element type, target element, target element type, mapping type, status, confidence, notes.
  - Actions: edit mapping type / status / notes; delete; manually add mapping.
  - Filters: domain, element type, mapping type, status, search by source/target name.
  - `created_by_task` set to `mapping-review-modal-add` for new manual rows or `mapping-review-modal-edit` for edits.
  - Manual-add confidence defaults to `null` (user can set a value, but the form does not pre-fill 1.0).
- Entry point: place "Create Target Baseline" action in `ManageArchitecturesModal` alongside existing clone/copy actions. No persona-task integration for v1.
- AppShell cache invalidation: after copy + auto-map, dispatch `LOAD_MODEL` for the target architecture if it is the currently active architecture; otherwise invalidate the cached model for the target architecture so the next activation refetches. No source-side cache invalidation is required in v1.

**Validation:**
- Source and target architecture both required; must differ; must be in same project.
- At least one domain/entity group selected (existing wizard validation).
- Diagrams excluded message visible.

### Reusability Opportunities

- Reuse `ArchitectureSelectiveCopyService` for entity/relationship copy logic; extend rather than reimplement.
- Reuse `SelectiveCopyWizardModal` UI; add `autoMap` checkbox + Mapping Review follow-up step.
- Reuse existing architecture selectors and `ManageArchitecturesModal` entry-point pattern.
- Reuse existing element-type strings (no new registry).
- Reuse the AppShell model cache invalidation pattern documented in `project_appshell_model_cache.md` for the target architecture only.

### Scope Boundaries

**In Scope (v1):**
- New `architecture_element_mappings` table + JPA entity in AMS with the reduced field set above.
- AMS CRUD/search endpoints for mappings, plus a transactional copy+map orchestration that reuses `ArchitectureSelectiveCopyService`.
- Gateway proxies for the new AMS endpoints.
- Extension of `SelectiveCopyWizardModal` to add `autoMap` and a Mapping Review step.
- Mapping Review UI: list (fetched fresh from AMS), filter, edit type/status/notes, delete, manually add (manual-add confidence defaults to null).
- Mapping Review opens post-commit; close/cancel does not roll back the copy or auto-mappings.
- Entry point in `ManageArchitecturesModal`.
- AppShell model-cache invalidation/reload for the target architecture post-copy (no source-side cache work).
- Append-only copy semantics (existing wizard behaviour).
- Mapping types in v1: `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required`.

**Out of Scope (v1):**
- Diagram copy and rendering of copied diagrams.
- `retired` and `new_in_target` mapping shapes (both endpoints required in v1).
- Mapping types beyond the v1 list above.
- Deep merge / overwrite of existing target entities (append-only only).
- Bulk mapping import.
- Automatic semantic diff between independently created architectures.
- Mapping-driven impact analysis.
- Migration Delivery Plan generation, API Behaviour Examples, data migration execution, OAS generation, shape-spec generation for generated backlog items.
- Persona-task system integration for the entry point.
- Formal element-type registry.
- Optional metadata fields not in the reduced field set (`created_by`, `updated_by`, `mapping_group_id`, `metadata_json`).
- Source-side AppShell model cache invalidation.
- Confirm-gate semantics on Mapping Review (it is post-commit, not a gate).

### Technical Considerations

- **Persistence ownership:** AMS owns mapping persistence end-to-end; Gateway is a thin proxy.
- **Transactional boundary:** Copy + mapping inserts must succeed or fail atomically; preferred path is to extend `ArchitectureSelectiveCopyService.commit`, alternative is a sibling `commitAndMap`. Mapping Review runs strictly after this transaction commits; its lifecycle is independent of copy commit.
- **Element type strings:** Source/target element type columns store the existing in-scope entity/table type string. No new registry, no enum, just the existing values used in the copy wizard.
- **`created_by_task` discriminator:** Free-text column with documented v1 values: `selective-copy-with-auto-map`, `mapping-review-modal-add`, `mapping-review-modal-edit`.
- **Cache coherence:** Backend-side mapping creation bypasses the frontend dispatch path, so the spec must explicitly handle the AppShell per-(project, architecture) model cache for the TARGET architecture only (LOAD_MODEL on active target arch, otherwise cache invalidation) per the existing pattern in `project_appshell_model_cache.md`. Source architecture cache requires no action in v1; mapping lists are fetched fresh from AMS.
- **Liquibase:** New changeset file (do not edit applied changesets) for the `architecture_element_mappings` table + indexes for the duplicate-mapping uniqueness check and common search filters.
- **Duplicate prevention:** Unique constraint or pre-insert check on `(project_id, source_arch, target_arch, source_type, source_id, target_type, target_id, mapping_type)` for active (non-rejected) rows.
- **Confidence column:** Boxed numeric type (e.g. `Double`) to allow null and avoid PATCH wipe-to-zero (see `project_primitive_double_dto_overwrite.md` lesson). Auto-mapped rows set `1.0`; manual-add rows default to `null` unless the user supplies a value.
