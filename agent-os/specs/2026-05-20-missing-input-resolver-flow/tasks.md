# Task Breakdown: Missing Input Resolver Flow

## Overview
Total Task Groups: 8

This breakdown sequences foundation work (database schema + stable-key algorithm) ahead of any service code that consumes them, then layers AMS service/endpoints, gateway proxy + threshold gating, and the frontend resolver UI on top. A final cross-cutting test-gap pass closes coverage at the seams (parity test, soft-delete cascade end-to-end, bulk preview-then-commit).

## Task List

### Foundation Layer (Database + Stable-Key Algorithm)

#### Task Group 1: Liquibase changesets and stable-key hasher
**Dependencies:** None

- [x] 1.0 Complete foundation: schema migrations + stable-key util
  - [x] 1.1 Write 2-8 focused tests for the foundation
    - JUnit test: `MissingInputKeyHasher` produces deterministic 16-hex-char SHA-256 for identical inputs
    - JUnit test: hasher is case-insensitive and whitespace-trimmed across all three canonical descriptors (`api_contract`, `mapping`, `target_element`)
    - JUnit test (H2 + Postgres pattern, mirror `ArchitectureCloneService` test setup): Liquibase changesets apply cleanly and create the new table + columns with the expected unique constraint and indexes
    - Limit to 2-8 focused tests; skip exhaustive descriptor-permutation coverage
  - [x] 1.2 Author new additive Liquibase changeset for `missing_input_resolutions` table
    - Columns: `id` (UUID PK), `project_id` (UUID NOT NULL), `missing_input_key` (varchar(16) NOT NULL), `missing_input_type` (varchar(32) NOT NULL), `resolution_payload_json` (JSONB), `resolved_at` (TIMESTAMPTZ NOT NULL), `resolved_by` (varchar(128) NOT NULL), `soft_deleted` (BOOLEAN NOT NULL default false), `soft_deleted_at` (TIMESTAMPTZ NULL), `soft_deleted_by` (varchar(128) NULL), `created_at`, `updated_at`
    - Composite unique index `(project_id, missing_input_key) WHERE soft_deleted = false`
    - Composite lookup index `(project_id, missing_input_key, soft_deleted)`
    - NEW changeset file only -- do NOT edit any applied changeset (per `feedback_liquibase_immutable_changesets.md`)
  - [x] 1.3 Author additive Liquibase changeset for `missing_input_keys_json` column on `migration_story_spec_generations`
    - Type JSONB, nullable
    - NEW changeset file
  - [x] 1.4 Author additive Liquibase changeset for `stale_reason` column on `migration_story_spec_generations`
    - Type varchar(32), nullable
    - Vocabulary documented in changeset comment: `target_architecture_changed`, `resolution_reset`
    - NEW changeset file; reuse existing `stale` boolean from changeset 146
  - [x] 1.5 Register all three new changesets in `db.changelog-master.yaml` in dependency order
  - [x] 1.6 Implement `MissingInputKeyHasher` Java util in AMS
    - Public static `hash(String inputType, String canonicalDescriptor)` -> 16-char hex
    - Public static helpers `canonicaliseApiContract(serviceName, operationName)`, `canonicaliseMapping(sourceId, targetId)`, `canonicaliseTargetElement(logicalName)` -- all lowercase + trim
    - SHA-256 then truncate to 16 hex chars
  - [x] 1.7 Ensure foundation tests pass
    - Run ONLY the 2-8 tests written in 1.1
    - Verify migrations run on both H2 and Postgres
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- All three new changesets register and apply without checksum errors
- `MissingInputKeyHasher` produces identical output for identical (case-normalised, trimmed) inputs

---

### AMS Persistence + Service Layer

#### Task Group 2: Entity, repository, and resolution CRUD service
**Dependencies:** Task Group 1

- [x] 2.0 Complete AMS persistence + resolution CRUD
  - [x] 2.1 Write 2-8 focused tests for resolution persistence + CRUD
    - JUnit test: create resolution persists with all boxed reference types and is found by `(projectId, missingInputKey, soft_deleted=false)`
    - JUnit test: listing active resolutions filters out soft-deleted rows; filterable by `?type=` and `?missingInputKey=`
    - JUnit test: soft-delete sets `soft_deleted=true` + stamps `soft_deleted_at` / `soft_deleted_by` without removing the row
    - JUnit test: composite unique constraint blocks a second active resolution for the same (projectId, key) but allows insert after a soft-delete
    - Limit to 2-8 focused tests
  - [x] 2.2 Create `MissingInputResolutionEntity` with all boxed reference types
    - Per `project_primitive_double_dto_overwrite.md`: Boolean (not boolean), Long (not long), Double (not double)
    - JPA mapping to the new table
  - [x] 2.3 Create `MissingInputResolutionRepository`
    - Spring Data JPA finders for active-by-project, active-by-(project,key), by-id-including-soft-deleted (audit history)
  - [x] 2.4 Create `MissingInputResolutionService`
    - `create(projectId, key, type, payload, resolvedBy)` -> persists + returns entity
    - `list(projectId, optionalType, optionalKey)` -> active only
    - `softDelete(resolutionId, deletedBy)` -> stamps soft-delete fields; cascade hook is wired in Task Group 3
  - [x] 2.5 Extend `MigrationStorySpecGenerationEntity` with `missingInputKeysJson` (List<String>) and `staleReason` (String) fields
    - Map to the JSONB / varchar columns from Task Group 1
    - All reference types remain boxed
  - [x] 2.6 Ensure persistence + CRUD tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Active resolutions are uniquely keyed by (projectId, missingInputKey)
- Soft-delete preserves audit history

---

#### Task Group 3: Cross-story matcher + soft-delete cascade + spec-emit integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete cross-story matching, cascade, and spec-emit-time key population
  - [x] 3.1 Write 2-8 focused tests for matcher + cascade + emit integration
    - JUnit test: `ready-to-retry` query returns only specs where EVERY key in `missing_input_keys_json` has an active resolution (partial coverage -> NOT ready)
    - JUnit test: soft-deleting a resolution flips dependent specs whose `missing_input_keys_json` contains the key back to `insufficient_context`, sets `stale=true`, `stale_reason='resolution_reset'`, `stale_marked_at=now()`
    - JUnit test: a spec already at `insufficient_context` stays at that status but still gets stale fields stamped (audit trail)
    - JUnit test: spec-emit integration -- when AMS persists an `insufficient_context` spec result, the structured `missing_inputs_json` is hashed into `missing_input_keys_json` (v1-type entries only; out-of-v1 entries produce no key)
    - JUnit test: bulk preview vs commit -- `commit=false` returns affected spec ids without inserting; `commit=true` inserts resolutions in one transaction
    - Limit to 2-8 focused tests
  - [x] 3.2 Implement `MissingInputCrossStoryMatcherService`
    - `findReadyToRetry(projectId)` -> list of `{ specGenerationId, workItemId, title, totalKeys, resolvedKeys }` filtered to fully-covered specs only
    - `findAffectedSpecs(projectId, missingInputKey)` -> spec ids containing that key in `missing_input_keys_json`
  - [x] 3.3 Implement soft-delete cascade in `MissingInputResolutionService.softDelete(...)`
    - After flipping `soft_deleted=true`, call matcher to find affected specs
    - For each affected spec: if status is `generated` or `generated_with_warnings`, flip to `insufficient_context`; always set `stale=true`, `stale_reason='resolution_reset'`, `stale_marked_at=now()`
    - Emit existing AMS audit events per cascaded spec
    - Return `affectedSpecIds[]`
  - [x] 3.4 Implement spec-emit-time key population
    - Hook into the existing AMS persistence path for `MigrationStorySpecGenerationEntity` (where the gateway writes `insufficient_context` results)
    - Map structured `missing_inputs_json` entries to keys via `MissingInputKeyHasher`:
      - Type `api_contract` -> hash of canonicalised `(service_name, operation_name)`
      - Type `mapping` -> hash of canonicalised `(source_element_id, target_element_id)`
      - Type `target_element` -> hash of canonicalised `target_element_logical_name`
      - Other types -> NO key entry (will surface as out-of-v1 read-only)
    - Persist into `missing_input_keys_json`
  - [x] 3.5 Implement `MissingInputResolutionBulkService`
    - `bulkResolve(projectId, uploads, commit, resolvedBy)` -> parses each upload (OAS / WSDL / mapping bundle), enumerates items, hashes per item, intersects with the project's active missing keys, returns `{ resolutions: [{ key, missingInputType, descriptor, affectedSpecIds[] }], previewOnly: !commit }`
    - When `commit=true` insert all resolutions in one transaction
  - [x] 3.6 Ensure cascade + matcher + emit tests pass
    - Run ONLY the 2-8 tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass
- Soft-delete cascade is atomic and audit-logged
- Bulk preview never writes; bulk commit writes in one transaction
- `ready-to-retry` requires ALL of a spec's keys to be resolved

---

### AMS Endpoint Layer

#### Task Group 4: AMS REST endpoints
**Dependencies:** Task Group 3

- [x] 4.0 Complete AMS endpoints for resolutions and retry orchestration
  - [x] 4.1 Write 2-8 focused tests for the endpoints
    - Controller test: `POST /api/projects/{projectId}/missing-input-resolutions` returns 201 with `{ resolutionId, affectedSpecIds[] }`
    - Controller test: `POST .../missing-input-resolutions/bulk` with `commit=false` returns preview structure without writes; `commit=true` writes
    - Controller test: `DELETE .../missing-input-resolutions/{id}` returns `{ affectedSpecIds[] }` and the entity is soft-deleted
    - Controller test: `GET .../spec-generations/ready-to-retry` returns `{ count, specGenerationIds[], stories[] }` matching only fully-resolved specs
    - Controller test: `POST .../spec-generations/retry-batch` 4xx-s if any targeted spec is NOT in the ready-to-retry set
    - Limit to 2-8 focused tests
  - [x] 4.2 Implement `MissingInputResolutionController`
    - `POST /api/projects/{projectId}/missing-input-resolutions` -- body `{ missingInputKey, missingInputType, resolutionPayload }`, returns `{ resolutionId, affectedSpecIds[] }`
    - `POST /api/projects/{projectId}/missing-input-resolutions/bulk` -- body `{ uploads: [{ kind, filename, base64Payload }], commit }`, returns bulk-resolve response
    - `DELETE /api/projects/{projectId}/missing-input-resolutions/{id}` -- soft-delete + cascade, returns `{ affectedSpecIds[] }`
    - `GET /api/projects/{projectId}/missing-input-resolutions` -- list active, filterable by `?type=` and `?missingInputKey=`
  - [x] 4.3 Implement `SpecGenerationRetryController` (or extend existing controller)
    - `GET /api/projects/{projectId}/spec-generations/ready-to-retry`
    - `POST /api/projects/{projectId}/spec-generations/retry-batch` -- body `{ workItemIds[] }`; precondition-checks every targeted spec is ready-to-retry; delegates downstream (gateway orchestrates the actual batch run)
  - [x] 4.4 Wire DTOs with boxed reference types only
  - [x] 4.5 Ensure endpoint tests pass
    - Run ONLY the 2-8 tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass
- All six endpoints respond with the contracted shapes
- Retry-batch refuses targets not in the ready-to-retry set

---

### Gateway Layer

#### Task Group 5: Gateway proxy routes + retry orchestration + cost-preview gating
**Dependencies:** Task Group 4

- [x] 5.0 Complete gateway proxy + retry batch wiring
  - [x] 5.1 Write 2-8 focused tests for the gateway routes (Jest)
    - Jest test: each new proxy route forwards status + body to AMS (single-resolve, bulk, list, delete, ready-to-retry)
    - Jest test: retry-batch route invokes existing `runShapeSpecGenerationBatch` with `targetWorkItemIds = body.workItemIds` and `regenerateAll = true`
    - Jest test: PARITY -- gateway hasher (mirror of AMS `MissingInputKeyHasher`) produces the same 16-hex output as AMS for canonical inputs for all three types
    - Jest test: cost-preview threshold gate -- `workItemIds.length >= 5 OR estimatedTokens > 50000` triggers preview; smaller batches skip it
    - Mock `architectureModelClient` with `jest.requireActual` spread pattern per memory rules
    - Limit to 2-8 focused tests
  - [x] 5.2 Add gateway proxy routes 1:1 to the new AMS endpoints
    - Single-resolve, bulk, list, delete, ready-to-retry
    - Pass file payloads through; bulk parse + hash stays server-side in AMS
  - [x] 5.3 Implement retry-batch route handler
    - Validates ready-to-retry membership (defence in depth; AMS also enforces)
    - Delegates to existing `runShapeSpecGenerationBatch(targetWorkItemIds, regenerateAll=true)` from Spec 2026-05-19; do NOT fork the handler
  - [x] 5.4 Implement gateway-side `missingInputKeyHasher.ts` mirror
    - Same algorithm, lowercased + trimmed canonical descriptors, SHA-256 truncated to 16 hex
    - Used by the cost-preview gating + any frontend-driven preview hashing (frontend imports from gateway if needed)
  - [x] 5.5 Wire cost-preview threshold gate
    - Constant in frontend: `5 stories OR >50000 tokens`
    - Gateway provides the existing `POST /api/migration-shape-spec/cost-preview` response unchanged
  - [x] 5.6 Ensure gateway tests pass
    - Run ONLY the 2-8 tests written in 5.1
    - Verify proxy + retry-batch + parity all pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass
- Gateway hasher and AMS hasher produce IDENTICAL keys (parity test green)
- Retry-batch route reuses existing batch handler with `regenerateAll=true`
- Threshold gating logic matches spec (>=5 OR >50k)

---

### Frontend Layer

#### Task Group 6: Frontend API client + story drawer resolver panel
**Dependencies:** Task Group 5

- [x] 6.0 Complete API client + story-drawer resolver panel
  - [x] 6.1 Write 2-8 focused tests for the resolver panel (Vitest)
    - Vitest test: panel renders grouped-collapsible structure in the prescribed order (api_contract -> mapping -> target_element -> out_of_v1)
    - Vitest test: groups default-expanded when they contain unresolved rows; default-collapsed when fully resolved
    - Vitest test: sort order -- unresolved before resolved, then descriptor alphabetical
    - Vitest test: "X of Y resolved" badge reflects active resolutions vs `missing_input_keys_json.length`
    - Vitest test: Retry button is disabled until X equals Y, hover tooltip shown
    - Vitest test: "What to do next" banner renders at top of panel from `recommendedNextAction`
    - Mock `architectureModelClient` with `jest.requireActual` spread pattern
    - Limit to 2-8 focused tests
  - [x] 6.2 Add frontend API client for missing-input-resolutions
    - `createResolution`, `listResolutions`, `deleteResolution` (soft-delete + cascade), `bulkResolvePreview`, `bulkResolveCommit`, `fetchReadyToRetry`, `retryBatch`
    - All types use boxed equivalents in TS (no implicit primitives where they could be missing)
  - [x] 6.3 Replace the read-only "Missing inputs" subsection in `MigrationDeliveryStoryDrawer.tsx` with the new resolver panel
    - Keep header chips, parent path, pass-2 diff surfaces untouched
    - Extend the prop shape (or add a new hook) to fetch per-row resolution state
  - [x] 6.4 Implement the "What to do next" banner at the top of the panel
    - Reads from existing `recommendedNextAction` field on the spec-generation DTO
    - Primary visual emphasis element of the panel
  - [x] 6.5 Implement grouped-collapsible resolver rows
    - Group by type: `api_contract`, `mapping`, `target_element`, then `out_of_v1`
    - Default-expanded on unresolved content; collapsed when fully resolved
    - Sort within group: unresolved first, then descriptor alphabetically
  - [x] 6.6 Implement per-type resolver row components
    - `ApiContractResolverRow`: inline OAS/WSDL file-upload widget with paste-text fallback
    - `MappingResolverRow`: single-pair inline mapping editor (source / target / transform); after save, dispatch `LOAD_MODEL` per `project_appshell_model_cache.md`
    - `TargetElementResolverRow`: deep-link button "Open target architecture workspace" with `target_element_logical_name` as query param; user explicitly creates the `target_element` resolution from the drawer after element creation
    - Out-of-v1 rows: read-only with "Out of v1 scope -- track in <related-spec-name>" badge
  - [x] 6.7 Implement "X of Y resolved" header badge + Reset action per resolution row
    - Reset action opens confirm modal with cascade-impact count, then calls delete endpoint
    - Audit display: `resolved_at` + `resolved_by` inline on resolved rows
  - [x] 6.8 Implement Retry generation button at panel bottom
    - Disabled until X equals Y; hover tooltip "All inputs must be resolved before retrying"
    - On click: if `count >= 5 OR estimatedTokens > 50000`, open cost-preview modal first; else fire retry directly
  - [x] 6.9 Ensure resolver-panel tests pass
    - Run ONLY the 2-8 tests written in 6.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass
- Resolver panel replaces the read-only missing-inputs section without disturbing other drawer regions
- Per-type resolvers work end-to-end against gateway routes
- Mapping resolution dispatches `LOAD_MODEL` so picker reflects the new mapping immediately

---

#### Task Group 7: Dashboard "Ready to retry" card + bulk-resolve modal
**Dependencies:** Task Group 6

- [x] 7.0 Complete dashboard surfaces for ready-to-retry and bulk resolve
  - [x] 7.1 Write 2-8 focused tests for the dashboard surfaces (Vitest)
    - Vitest test: "Ready to retry: N" card renders the count + primary "Retry all" button + secondary "View ready stories" link
    - Vitest test: clicking "View ready stories" filters the hierarchy tree by `workItemId IN readyList`
    - Vitest test: "Retry all" triggers cost-preview modal when threshold met; fires immediately otherwise
    - Vitest test: bulk-resolve modal calls preview (`commit=false`) on upload, renders affected-spec list, then commits (`commit=true`) on confirm
    - Vitest test: bulk-resolve ALWAYS shows the preview, even for a single-key resolution
    - Limit to 2-8 focused tests
  - [x] 7.2 Add "Ready to retry" card to `MigrationDeliverySummaryCards.tsx`
    - Reuse existing summary-card component (same pattern as stale-specs card)
    - Position adjacent to the stale-specs card
    - Show integer count from `GET .../spec-generations/ready-to-retry`
    - Primary "Retry all" button + secondary "View ready stories" link -- both behaviours coexist
  - [x] 7.3 Implement filtered list view triggered by "View ready stories"
    - Filters existing dashboard hierarchy tree by `workItemId IN readyList`
    - Returns to full tree on filter clear
  - [x] 7.4 Implement "Retry all" handler with threshold gate
    - When `count >= 5 OR estimatedTokens > 50000`: open cost-preview modal first, then fire on confirm
    - Otherwise: fire `retry-batch` immediately
  - [x] 7.5 Implement "Bulk resolve" button at the TOP of the dashboard
    - Positioned next to the "Ready to retry" card
    - Opens the bulk-resolve modal
  - [x] 7.6 Implement bulk-resolve modal
    - Accept one file (OAS / WSDL / mapping bundle)
    - On upload: call bulk endpoint with `commit=false`, render preview table (one row per `{ key, affectedSpecIds.length, descriptor }`)
    - Confirm button commits with `commit=true`; cancel discards
    - Always show preview before any write -- even single-key resolutions
  - [x] 7.7 Display "stale: target arch changed" vs "stale: input resolution reset" chip variants
    - Read `staleReason` from the spec-generation DTO
    - Labels per spec
  - [x] 7.8 Ensure dashboard tests pass
    - Run ONLY the 2-8 tests written in 7.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass
- Both card behaviours (Retry all + View ready stories) work
- Bulk-resolve modal preview-then-commit flow runs end-to-end
- Stale chip differentiates the two reasons

---

### Cross-Cutting Test Review

#### Task Group 8: Test review and gap analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2-8 tests written by foundation (Task 1.1)
    - Review the 2-8 tests written by AMS persistence (Task 2.1)
    - Review the 2-8 tests written by AMS cascade + matcher (Task 3.1)
    - Review the 2-8 tests written by AMS endpoints (Task 4.1)
    - Review the 2-8 tests written by gateway (Task 5.1)
    - Review the 2-8 tests written by resolver panel (Task 6.1)
    - Review the 2-8 tests written by dashboard (Task 7.1)
    - Approximate total existing tests: 14-56
  - [x] 8.2 Analyse gaps focused on this spec's feature only
    - End-to-end workflow gaps (resolver-create -> ready-to-retry -> retry-batch -> regeneration outcome)
    - Soft-delete cascade interaction with multi-key specs (deleting one resolution flips dependent specs even if other resolutions remain -- verify the "ALL keys required" rule is enforced in the cascade direction)
    - Bulk preview-vs-commit transactional integrity (no partial writes on commit failure)
    - Out-of-v1 read-only types do NOT enter `missing_input_keys_json` and do NOT block Retry
    - Stale-chip differentiation (`target_architecture_changed` vs `resolution_reset`) renders correctly
    - Focus only on this spec's feature -- do not audit application-wide coverage
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Prioritise integration-style tests over unit gaps
    - Skip edge cases / performance / accessibility unless business-critical
    - Examples worth considering (pick highest-value, max 10 total):
      - End-to-end: resolve api_contract -> ready-to-retry list grows -> retry-batch succeeds -> spec moves off `insufficient_context`
      - End-to-end: bulk upload resolves N keys across M stories in one transaction -> Reset on one resolution flips its dependent specs back without touching the others
      - Concurrency-aware soft-delete cascade audit (each cascaded spec gets one audit row)
      - Out-of-v1 missing inputs render under the `out_of_v1` group and are excluded from "X of Y" denominator
      - Parity proven end-to-end: AMS-emitted key matches gateway-computed key for the same canonical inputs in a real round-trip
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 24-66 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical end-to-end workflows for this spec are covered
- No more than 10 additional tests added in 8.3
- Testing scoped exclusively to this spec's feature surface

---

## Execution Order

Recommended implementation sequence (sequential groups must finish before their dependents; independent groups inside a layer can parallelise where noted):

1. **Foundation Layer** -- Task Group 1 (changesets + hasher)
2. **AMS Persistence + Service Layer** -- Task Group 2, then Task Group 3 (3 depends on 2's entity + repo)
3. **AMS Endpoint Layer** -- Task Group 4
4. **Gateway Layer** -- Task Group 5
5. **Frontend Layer** -- Task Group 6, then Task Group 7 (7 can start in parallel with the second half of 6 once the API client lands, but the dashboard "stale chip variants" depend on the DTO surface from 6)
6. **Cross-Cutting Test Review** -- Task Group 8

## Sequencing Notes

- **Spec-emit key population happens AMS-side (Task 3.4)** -- the gateway sends the structured `missing_inputs_json` free-form and AMS hashes them server-side. Owning the algorithm in AMS keeps the canonical source of truth single. The gateway-side mirror in Task 5.4 exists only for the cost-preview gating path + the parity test in 5.1; it never writes keys to persistence.
- **"Ready-to-retry" rule** -- a spec is ready ONLY when every key in its `missing_input_keys_json` has an active resolution. Soft-deleting any one of those resolutions immediately removes the spec from ready-to-retry and triggers the cascade (status revert + stale flag + reason).
- **Reused, NOT forked**: `runShapeSpecGenerationBatch` (gateway), `POST /api/migration-shape-spec/cost-preview` (gateway), `idx_msg_project_stale` (AMS), `stale` boolean (changeset 146), `ArchitectureElementMappingEntity` (AMS), AMS audit event pattern, summary-card component, story-drawer header/chip/diff regions.
- **Cross-spec coupling** -- both this spec and `2026-05-20-target-architecture-authoring-flow` write to `MigrationStorySpecGenerationEntity`. All additions are via NEW Liquibase changesets; no edits to applied changesets per `feedback_liquibase_immutable_changesets.md`.
- **AppShell model cache** -- mapping resolutions must dispatch `LOAD_MODEL` for the project's architecture so the inline mapping editor's source/target picker reflects the new mapping immediately (per `project_appshell_model_cache.md`).
- **Boxed types only** on all DTOs that participate in PATCH semantics per `project_primitive_double_dto_overwrite.md`.
