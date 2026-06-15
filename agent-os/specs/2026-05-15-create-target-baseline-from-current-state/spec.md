# Specification: Create Target Baseline from Current State

## Goal
Add an append-only "create target baseline" workflow that copies selected architecture elements from a source architecture into a target architecture and persists explicit cross-architecture element mappings, by extending the existing selective-copy pipeline (`ArchitectureSelectiveCopyService` and `SelectiveCopyWizardModal`) rather than reimplementing copy. The persisted mappings become the foundation for future migration-planning workflows.

## User Stories
- As an architect, I want to copy selected current-state elements into a target architecture and have the system automatically record that each new target element is equivalent to its source counterpart, so I can establish a Target State baseline without manually creating mapping rows.
- As an architect, I want to review, edit, delete, and manually add cross-architecture mappings after a copy, so I can correct equivalences, mark renamed/replaced/split/merged relationships, and capture rationale notes.
- As an architect re-opening a project later, I want to query persisted current-to-target mappings via API, so future migration-planning, backlog-generation, and parity-checking flows can reference exact source and target architecture elements.

## Specific Requirements

**Reuse existing selective-copy pipeline; do not reimplement copy**
- All entity/relationship copy goes through `ArchitectureSelectiveCopyService` (`architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java`); this spec adds mapping persistence on top, never a parallel copy path.
- All wizard UI goes through `SelectiveCopyWizardModal` (`frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx`); this spec adds an `autoMap` checkbox and a Mapping Review step appended to the existing pick/resolve/commit flow.
- Append-only semantics, smart cascading auto-include, and skip/overwrite/duplicate conflict resolution carry over from the existing implementation unchanged.
- Diagrams remain excluded from copy (already excluded by the existing service); no diagram work in v1.

**New AMS persistence: `architecture_element_mappings` table and JPA entity**
- Required columns: `id` (UUID PK), `project_id`, `source_architecture_id`, `target_architecture_id`, `source_element_type` (text), `source_element_id` (text), `target_element_type` (text), `target_element_id` (text), `mapping_type` (text), `status` (text), `created_by_task` (text), `created_at` (timestamp), `updated_at` (timestamp).
- Optional columns: `notes` (text, nullable), `confidence` (double, nullable — boxed `Double` on the entity to avoid the PATCH-wipe-to-zero issue documented in `feedback`/`project_primitive_double_dto_overwrite.md`).
- `source_element_type` / `target_element_type` are free-text strings holding the existing in-scope table/entity type name (matches the `discovery_candidate_entity_mapping.entity_type` pattern). No element-type registry in v1.
- Unique constraint on `(project_id, source_architecture_id, target_architecture_id, source_element_type, source_element_id, target_element_type, target_element_id, mapping_type)` to prevent duplicate active rows; rejected rows can stay in the table but the unique constraint applies to all rows in v1.
- Indexes on `(project_id, source_architecture_id, target_architecture_id)` and `(project_id, source_element_id)` and `(project_id, target_element_id)` for the search filters.
- Liquibase: add a NEW changeset file at `architecture-model-service/src/main/resources/db/changelog/sql/127-architecture-element-mappings.sql` and register it in `db.changelog-master.yaml`. Do not edit changeset 126 or earlier.
- JPA entity mirrors `DiscoveryCandidateEntityMappingEntity` (Lombok `@Entity`/`@Builder`/`@Getter`/`@Setter`, `@Table` with `@Index`, `@PrePersist` for `createdAt`, plus `@PreUpdate` for `updatedAt`).

**Allowed enum-like values (stored as text, validated at the service layer)**
- `mapping_type` v1: `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required`. `retired` and `new_in_target` are deferred to v2.
- `status` v1: `confirmed`, `proposed`, `needs_review`, `rejected`.
- `created_by_task` documented v1 values (free-text column): `selective-copy-with-auto-map`, `mapping-review-modal-add`, `mapping-review-modal-edit`.
- Auto-map defaults: `mapping_type=equivalent`, `status=confirmed`, `confidence=1.0`, `created_by_task=selective-copy-with-auto-map`.
- Manual-add defaults: `confidence=null` (1.0 is reserved for system-asserted equivalence from auto-map), `created_by_task=mapping-review-modal-add`; user picks `mapping_type` and `status`.

**Single transactional boundary for copy + auto-map**
- Add an `autoMap` boolean to `SelectiveCopyCommitRequest` (default `false` for backward compatibility). When `true`, the existing `commit` method (still `@Transactional`) inserts the mapping rows immediately after walking the in-scope tables, before returning. Alternative if backward compatibility on the existing endpoint is preferred: add a sibling `commitAndMap` method that calls into the same private writer and adds the mapping inserts under the same `@Transactional` boundary.
- Mapping inserts must observe the same `sourceId -> newTargetId` map produced by the cascading walk; one mapping row is written per element actually copied (skipped, overwritten-without-ID-change, and out-of-scope rows do not produce mappings; `duplicate` rows produce a mapping from the source element to the new duplicate target id).
- A failure in any mapping insert rolls back the entire copy (atomic property carried over from the existing service).
- `SelectiveCopyCommitResponse` gains an additional `createdMappingCount` field (default 0 when `autoMap=false`).

**New AMS controller: `ArchitectureElementMappingController` (mirrors `DiscoveryCandidateEntityMappingService` CRUD pattern)**
- `GET /api/projects/{projectId}/architecture-mappings` — query params: `sourceArchitectureId`, `targetArchitectureId`, `sourceElementType`, `targetElementType`, `mappingType`, `status`, `q` (free-text search across source/target element ids and notes). Returns `ArchitectureElementMappingDto[]`.
- `POST /api/projects/{projectId}/architecture-mappings` — body: `CreateArchitectureElementMappingRequest`. Returns `201` with the created `ArchitectureElementMappingDto`. Validates uniqueness (returns `422 {code: "duplicate_mapping"}` on conflict) and that source/target architecture ids differ.
- `PUT /api/projects/{projectId}/architecture-mappings/{mappingId}` — body: `UpdateArchitectureElementMappingRequest` (mutable fields: `mappingType`, `status`, `notes`, `confidence`; `created_by_task` set server-side to `mapping-review-modal-edit`). Returns `200` with the updated DTO.
- `DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}` — hard delete in v1. Returns `204`.
- Validation rules: `project_id`, both architecture ids, both element type+id, `mapping_type`, `status` all required; `mapping_type` and `status` must be in the v1 allowed lists; `source_architecture_id != target_architecture_id`; both architectures must belong to the path `projectId` (re-uses `validateArchitectures` pattern from `ArchitectureSelectiveCopyService`).

**Gateway proxy surface (no business logic)**
- Mirror the existing selective-copy proxy pattern in `gateway/src/routes/architectures.ts`. Add five proxy routes that forward to AMS verbatim with `emitUpstreamError` for status/body pass-through:
  - `GET /api/projects/:projectId/architecture-mappings`
  - `POST /api/projects/:projectId/architecture-mappings`
  - `PUT /api/projects/:projectId/architecture-mappings/:mappingId`
  - `DELETE /api/projects/:projectId/architecture-mappings/:mappingId`
- The existing `POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/commit` proxy gains no new route; it transparently forwards the new `autoMap` flag and the new `createdMappingCount` response field because both layers pass the body verbatim.
- Add typed wrappers in `gateway/src/services/architectureModelClient.ts`: `listArchitectureMappings`, `createArchitectureMapping`, `updateArchitectureMapping`, `deleteArchitectureMapping`.

**Frontend: extend `SelectiveCopyWizardModal` with `autoMap` and Mapping Review**
- Add an `autoMap` checkbox to step 2 (review/resolve), default checked, label "Automatically map copied elements as equivalent (recommended)". Persist the value into the commit request body.
- Stepper changes from 3 steps to 4 steps: `1. Pick elements` → `2. Review & resolve` → `3. Commit` → `4. Review mappings` (the last step only renders when the commit succeeded with `autoMap=true` OR when the user explicitly opens the review from the success toast/`ManageArchitecturesModal`).
- After the commit returns, the wizard does NOT close immediately when `autoMap=true`. Instead it transitions into the Mapping Review step (in-modal), seeded with the freshly-fetched mapping list for the (source, target) pair.
- Closing/cancelling the Mapping Review step (Cancel button, X, Esc, click-outside) MUST NOT roll back the copy or the auto-created mappings; the toast remains the existing success copy and an additional "N mappings created" segment when applicable.
- Helper text on the autoMap checkbox: "This is append-only. We will create new target elements and mapping rows; existing target elements are never overwritten."

**Frontend: Mapping Review UI (new in-wizard step + standalone re-entry)**
- Table columns: source element name, source element type, target element name, target element type, mapping type (dropdown), status (dropdown), confidence (numeric or em-dash if null), notes (inline editable text), actions (Save/Delete).
- Filters above the table: source element type, target element type, mapping type, status, free-text search.
- Manual add row: pickers constrained to the current source and target architecture's element inventory (reuse `getElementsInventory` already used by `SelectiveCopyElementPicker`); mapping_type dropdown; status dropdown; notes; confidence input pre-filled blank; Save calls `createArchitectureMapping`.
- Edit/delete call `updateArchitectureMapping` / `deleteArchitectureMapping`. Each successful mutation re-fetches the list (no AppShell cache layer for mapping list per shaping decision).
- Element-name lookup: resolve element ids to display names by joining against the existing `ElementInventoryResponse` for each architecture; if a name cannot be resolved, fall back to the raw id with the type prefix.

**Frontend: entry-point in `ManageArchitecturesModal`**
- Add a per-row "Create Target Baseline" action button next to the existing per-row "Copy from..." button. Clicking it opens `SelectiveCopyWizardModal` with the row as `source`, the active architecture as `target`, AND the `autoMap` checkbox defaulted to `true` (existing "Copy from..." button continues to default `autoMap` to `false` so plain selective-copy users see no behavioural change).
- The button is disabled with the same tooltip as "Copy from..." when the row is the active architecture.
- No persona-task system integration in v1 (deferred per shaping).

**Frontend: AppShell cache invalidation after copy + auto-map**
- After a successful commit (regardless of `autoMap`), the wizard already calls `refreshArchitectures()`. Extend that path so it also refreshes the target architecture's model:
  - If the target architecture id equals `activeArchitectureId`: call `loadModelByProjectId(projectId, targetArchitectureId)` and dispatch `LOAD_MODEL` (same pattern documented in `project_appshell_model_cache.md`).
  - If the target architecture id is NOT active: call a new `invalidateArchitectureModelCache(architectureId: string)` callback exposed by `ArchitectureContext` that deletes the entry from AppShell's `cacheRef` (`frontend/src/App.tsx`). Wire the callback through context props.
- No source-side cache invalidation in v1 (mapping list is fetched fresh from AMS on every open per shaping decision).

**Frontend: API client functions in `architecturesApi.ts`**
- New typed exports: `listArchitectureMappings`, `createArchitectureMapping`, `updateArchitectureMapping`, `deleteArchitectureMapping`.
- New typed `autoMap` field on the existing `SelectiveCopyCommitRequest` interface; new `createdMappingCount` field on `SelectiveCopyCommitResponse`.
- All new functions throw `ArchitecturesApiError` on non-2xx so the modal can branch on `body.code` (e.g. `duplicate_mapping`).

## Existing Code to Leverage

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java`**
- Existing `@Transactional` `commit(UUID projectId, UUID targetArchitectureId, SelectiveCopyCommitRequest request)` is the integration site for mapping inserts; the spec extends this method (or adds a sibling `commitAndMap` calling shared private helpers) and reuses its `validateArchitectures`, cascading walk, FK rewire map, and per-element resolution logic verbatim.
- The existing in-scope table list (`ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER`) supplies the element-type strings that populate `source_element_type` / `target_element_type` — no new registry.

**`architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoveryCandidateEntityMappingService.java` + `DiscoveryCandidateEntityMappingEntity.java`**
- Mirror this entity/service/repository/controller pattern for `ArchitectureElementMappingEntity`, `ArchitectureElementMappingService`, `ArchitectureElementMappingRepository`, `ArchitectureElementMappingController`. Same Lombok shape, same `@PrePersist` timestamp pattern, same `@Transactional`/`@Transactional(readOnly = true)` split.

**`architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureController.java`**
- Existing `@RequestMapping("/api/projects/{projectId}/architectures")` controller is the reference shape for the new `ArchitectureElementMappingController` (use `@RequestMapping("/api/projects/{projectId}/architecture-mappings")`). Reuse the same `@PathVariable UUID projectId` pattern and the `selectiveCopyCommit` handler shape for the body-shape-changed `commit` endpoint.

**`gateway/src/routes/architectures.ts` (lines 485-595)**
- The selective-copy proxy block is the verbatim template for the five new mapping proxy routes — copy the `emitUpstreamError` pattern, the `getModelServiceUrl()` URL construction, and the typed-client delegation.

**`frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx`**
- The 3-step wizard is extended to 4 steps; reuse the `inFlightRef` token pattern, `describeApiError` helper, `mergeAutoIncluded` selection seeding, and `buildSuccessToast` helper. The new Mapping Review step is rendered inside the same `styles.content` container with new footer buttons (Close, Add manual mapping).

## Out of Scope
- Diagram copy and rendering of copied diagrams (existing service already excludes; no v1 work).
- Mapping types beyond `equivalent`, `renamed`, `replaced_by`, `split`, `merged`, `manual_review_required` (`retired` and `new_in_target` deferred to v2; both source and target endpoints are required in v1).
- Bulk mapping import (spreadsheet/CSV/JSON file upload).
- Automatic semantic diff between independently created architectures.
- Mapping-driven impact analysis (downstream consumer; this spec only persists the data).
- Migration Delivery Plan generation, API Behaviour Examples task, data migration execution, OpenAPI generation, shape-spec generation for generated backlog items.
- Persona-task system integration for the entry point (button lives in `ManageArchitecturesModal` only).
- Formal element-type registry; v1 stores the existing in-scope table/entity type strings free-text.
- Optional metadata columns not in the reduced field set (`created_by`, `updated_by`, `mapping_group_id`, `metadata_json`).
- Source-side AppShell model cache invalidation (the source architecture is unchanged by an append-only copy).
- Confirm-gate semantics on Mapping Review (it is post-commit; close/cancel does NOT roll back the copy or auto-mappings).
