# Specification: Missing Input Resolver Flow

## Goal
Replace the read-only "missing inputs" section on the Migration Delivery Dashboard story drawer with a structured resolver workflow so users can resolve API-contract / mapping / target-element gaps in place, cross-story bulk apply via a single OAS or mapping upload, and explicitly retry shape-spec generation once everything is resolved.

## User Stories
- As a product / migration owner, I want each `insufficient_context` story to show structured, actionable resolvers for every missing input so I can fix the gap from the story drawer without leaving the dashboard.
- As a product / migration owner, I want one OAS/WSDL upload (or mapping bundle) to resolve the same missing-input key across every story that needs it so I can clear ten stories with one action and a preview-then-confirm safety check.
- As a product / migration owner, I want the dashboard to surface a "Ready to retry: N" card with both a direct "Retry all" button and a click-to-list affordance so I can decide whether to fire the batch immediately or inspect the affected stories first.

## Specific Requirements

**Stable missing-input key + structured keys column**
- Add new nullable JSONB column `missing_input_keys_json` (List<String>) on `migration_story_spec_generations` via a new Liquibase changeset (additive, NOT an edit of an applied changeset per `feedback_liquibase_immutable_changesets.md`).
- The gateway populates `missing_input_keys_json` at spec-emit time whenever the response is `insufficient_context`, in parallel with the existing free-form `missing_inputs_json`.
- Key algorithm: `truncate(SHA-256(input_type + "|" + canonical_descriptor), 16 hex chars)`. Deterministic and case-insensitive across emit time and upload time.
- Canonical descriptor per type, all lowercased and trimmed before hashing:
  - `api_contract`: `service_name + "::" + operation_name`.
  - `mapping`: `source_element_id + "->" + target_element_id`.
  - `target_element`: `target_element_logical_name`.
- Implemented in a new AMS Java util `MissingInputKeyHasher` plus a small mirror in the gateway shape-spec response handler so both sides emit identical keys (covered by a parity test).
- Items in `missing_inputs_json` that do not match a v1 type (decisions / behaviour baselines / etc.) get NO key entry and surface read-only with "out of v1 scope" hint on the resolver panel.

**Resolutions persistence (new AMS table)**
- New table `missing_input_resolutions` columns: `id` (UUID PK), `project_id` (UUID NOT NULL, indexed), `missing_input_key` (varchar(16) NOT NULL, indexed), `missing_input_type` (varchar(32) NOT NULL), `resolution_payload_json` (JSONB), `resolved_at` (TIMESTAMPTZ NOT NULL), `resolved_by` (varchar(128) NOT NULL), `soft_deleted` (BOOLEAN NOT NULL default false), `soft_deleted_at` (TIMESTAMPTZ NULL), `soft_deleted_by` (varchar(128) NULL), `created_at`, `updated_at`.
- Composite unique constraint `(project_id, missing_input_key) WHERE soft_deleted = false` so the active resolution per key is unique while audit history of resets is preserved.
- Composite index `(project_id, missing_input_key, soft_deleted)` to keep the cross-story matching query fast.
- All boxed reference types on the entity per `project_primitive_double_dto_overwrite.md`.
- Payload shape per type: `api_contract` = `{ contractBlobId, filename, format: 'oas'|'wsdl', operationsCount }`; `mapping` = `{ sourceElementId, targetElementId, mappingRefId }` (FK to a newly created `ArchitectureElementMappingEntity` row); `target_element` = `{ targetElementId }` (FK to the element created via the target-architecture authoring workspace).

**AMS endpoints**
- `POST /api/projects/{projectId}/missing-input-resolutions` body `{ missingInputKey, missingInputType, resolutionPayload }` -> creates an active resolution, computes affected spec ids (every row whose `missing_input_keys_json` contains the key), returns `{ resolutionId, affectedSpecIds[] }`.
- `POST /api/projects/{projectId}/missing-input-resolutions/bulk` body `{ uploads: [{ kind, filename, base64Payload }], commit: boolean }` -> for OAS / WSDL / mapping bundles: parses the upload, enumerates the operations / mapping pairs, hashes a key per item, looks up active missing keys for the project, and returns `{ resolutions: [{ key, missingInputType, descriptor, affectedSpecIds[] }], previewOnly: boolean }`. When `commit=true` the resolutions are inserted in a single transaction; when omitted/false the call is preview-only (no writes).
- `DELETE /api/projects/{projectId}/missing-input-resolutions/{id}` -> soft-delete (sets `soft_deleted=true`, stamps `soft_deleted_at`/`soft_deleted_by`), runs the cascade (next requirement), returns `{ affectedSpecIds[] }`.
- `GET /api/projects/{projectId}/missing-input-resolutions` -> list active resolutions (filterable by `?type=` and `?missingInputKey=`).
- `GET /api/projects/{projectId}/spec-generations/ready-to-retry` -> returns `{ count, specGenerationIds[], stories: [{ workItemId, title, totalKeys, resolvedKeys }] }` where every entry in `missing_input_keys_json` has an active (non-soft-deleted) resolution.
- `POST /api/projects/{projectId}/spec-generations/retry-batch` body `{ workItemIds[] }` -> delegates to the existing gateway batch handler (next requirement); never invoked unless every targeted spec is in the ready-to-retry set.

**Soft-delete cascade + needs-regeneration semantics**
- Reuse the existing `stale` BOOLEAN column on `migration_story_spec_generations` (changeset 146) as the single staleness flag, and ADD a new nullable `stale_reason` column (varchar(32)) via a new additive changeset so the dashboard / drawer can distinguish "target-arch changed" from "missing input un-resolved". Justification: a single boolean keeps the dashboard count query (`idx_msg_project_stale`) fast, the existing regeneration flow already clears `stale` on success, and a reason code is cheaper than a parallel flag plus index.
- Reason vocabulary: `target_architecture_changed` (Spec 2026-05-20-target-architecture-authoring-flow), `resolution_reset` (this spec). Stored only when `stale=true`; cleared together with `stale` on successful regeneration.
- Cascade on soft-delete: find every spec whose `missing_input_keys_json` contains the soft-deleted key; for each, if `status='generated'` or `'generated_with_warnings'`, flip `status` back to `insufficient_context` and set `stale=true`, `stale_reason='resolution_reset'`, `stale_marked_at=now()`; if status is already `insufficient_context` leave status unchanged but still set the stale fields so the audit trail is complete.
- Each cascaded spec write is an audit event (existing AMS audit pattern); the response of `DELETE` returns the full `affectedSpecIds[]` so the UI can refresh the badge without a second round-trip.

**Gateway proxy + retry batch orchestration**
- New gateway routes proxy 1:1 to the new AMS endpoints (single-resolve, bulk, list, delete, ready-to-retry, retry-batch). No new LLM tasks in v1.
- The retry-batch route runs through the existing `runShapeSpecGenerationBatch` handler with `targetWorkItemIds = body.workItemIds` and `regenerateAll = true`; the handler is unchanged.
- Token cost preview: reuse the existing `POST /api/migration-shape-spec/cost-preview` endpoint from Spec 2026-05-19. The frontend gates the preview on `workItemIds.length >= 5 OR estimatedTokens > 50000` (single-story retries skip the preview entirely; the threshold is a constant in the frontend, no new env var in v1).
- The bulk-upload route relays the file body (size-capped at the existing gateway upload limit) to AMS where the parse + hash happens, so the gateway stays stateless for this flow.

**Resolver panel inside the story drawer**
- Replace the current read-only "Missing inputs" subsection in `MigrationDeliveryStoryDrawer.tsx` with the new resolver panel.
- Top-of-panel "What to do next" banner reading `recommendedNextAction` from the existing spec-generation DTO (already populated by `specGenerationResponseValidator.ts`); banner is the visual emphasis element of the panel.
- Group missing-input rows by type (collapsible groups): `api_contract`, `mapping`, `target_element`, then a final read-only `out_of_v1` group. Group default-expanded when it contains any unresolved row; default-collapsed once fully resolved.
- Sort within each group: unresolved before resolved; descriptor alphabetically as tiebreaker. Across groups follow the type order above.
- Per-row resolver UI by type: `api_contract` = inline file-upload widget (OAS/WSDL) with paste-text fallback; `mapping` = single-pair inline mapping editor (source / target / transform); `target_element` = deep-link button "Open target architecture workspace" that navigates to the route from Spec 2026-05-20-target-architecture-authoring-flow with the missing logical name pre-filled.
- "X of Y resolved" badge in the drawer header, computed from `missing_input_keys_json.length` vs count of those keys that have active resolutions.
- Resolution audit display per resolved row: `resolved_at` + `resolved_by`, with a "Reset" link that calls the soft-delete endpoint (confirm modal lists the cascade impact count).
- "Retry generation" button at the bottom of the panel: disabled (with hover tooltip "All inputs must be resolved before retrying") until every row is resolved. No "retry anyway" override in v1.

**Dashboard "Ready to retry" card + bulk-resolve entry point**
- New summary card in `MigrationDeliverySummaryCards.tsx` showing `count` from `GET .../spec-generations/ready-to-retry`. Card body: the integer count, a primary "Retry all" button, and a secondary text link "View ready stories" that opens a filtered list (existing dashboard hierarchy tree filtered by `workItemId IN readyList`). Both behaviours coexist.
- "Retry all" runs the threshold gate: when `count >= 5 OR estimatedTokens > 50000`, open the cost preview modal first; otherwise fire immediately.
- New "Bulk resolve" button at the top of the dashboard (positioned next to the "Ready to retry" card) opens the bulk-resolve modal: accept one OAS / WSDL / mapping-bundle file, call the bulk endpoint with `commit=false`, render the preview table (one row per `{ key, affectedSpecIds.length, descriptor }`), then commit on confirm. Always show the preview, even for a single-key resolution, before any write.
- Existing summary cards stay; the new card sits adjacent to the existing stale-specs card so the two "actionable" counts cluster together.

**Cross-spec coupling with target-architecture-authoring-flow**
- The `stale` field added by changeset 146 is shared. This spec adds the discriminating `stale_reason` so dashboard surfaces can label the chip ("stale: target arch changed" vs "stale: input resolution reset").
- The deep-link from the resolver panel to the target-architecture workspace passes the `target_element_logical_name` as a query param; the workspace creates the element, which writes the target arch, which (after debounce) fires `mark-stale` with `reason=target_architecture_changed`. Once a target element exists, the user explicitly creates a `missing_input_resolutions` row of type `target_element` from the drawer (NOT auto-created on element save -- keeps the resolver flow's "user clicks resolve" contract intact).
- AppShell model cache: any mapping-resolution write must dispatch `LOAD_MODEL` for the project's architecture so the inline mapping editor's source/target picker reflects the new mapping immediately per `project_appshell_model_cache.md`.

**Testing**
- AMS: repository + service tests for resolutions CRUD, soft-delete cascade (status transitions + stale flag + reason), key-hash determinism + case-insensitivity, bulk preview-vs-commit branching, ready-to-retry query correctness (every key in `missing_input_keys_json` must have an active resolution).
- AMS: Liquibase H2 / Postgres pattern (same as `ArchitectureCloneService` tests) for both new changesets.
- Gateway: jest tests for proxy routes (status code passthrough + body shape), threshold-gate for cost preview, parity test asserting AMS Java hasher and gateway hasher produce identical keys for canonical inputs.
- Frontend: Vitest tests for the resolver panel (grouped/collapsible layout, sort order, "X of Y" badge, banner placement, retry-button enablement), bulk-resolve modal (preview before commit, confirm fires commit=true), ready-to-retry card (count + Retry all button + click-to-list), Reset action confirm modal with cascade count. Mock `architectureModelClient` with `jest.requireActual` spread.

**Out-of-v1 read-only handling**
- Missing inputs of types other than `api_contract` / `mapping` / `target_element` (decisions, baselines, etc.) appear in the resolver panel under the `out_of_v1` group, with a non-actionable badge "Out of v1 scope -- track in <related-spec-name>" and a link to the related workspace where it exists (epic-decisions panel for decisions).
- These rows are NEVER counted in the "X of Y resolved" denominator and NEVER block the Retry button -- because `missing_input_keys_json` only ever contains v1-type keys, ready-to-retry computation naturally ignores them.

## Existing Code to Leverage

**`MigrationStorySpecGenerationEntity` + `migration_story_spec_generations` table**
- Already carries `missing_inputs_json`, `stale`, `stale_marked_at`, status vocabulary, audit fields, and the boxed-type pattern.
- Add `missing_input_keys_json` and `stale_reason` here via two new additive changesets; do not edit applied changesets per `feedback_liquibase_immutable_changesets.md`.
- Reuse the existing `idx_msg_project_stale` index for dashboard count queries.

**`MigrationDeliveryStoryDrawer.tsx`**
- Already renders a Missing-inputs section (Addition C) plus header chips, parent path, pass-2 diff surfaces.
- Replace the read-only Missing-inputs subsection with the resolver panel; keep header/chip/diff sections untouched so cross-story injection surfaces remain intact.
- The drawer already accepts a `needsAttentionItem` with `missingInputs[]`; extend the prop shape to also carry the per-row resolution state (or fetch it via a new hook), and reuse the existing scroll/overflow behaviour.

**`MigrationDeliverySummaryCards.tsx` + dashboard stale card**
- Pattern is established (stale-specs card from target-arch spec). Add the "Ready to retry" card alongside it using the same card component, with the additional primary action button.

**Gateway `runShapeSpecGenerationBatch` + `migrationShapeSpecCostPreview` route**
- Retry-batch reuses `runShapeSpecGenerationBatch(targetWorkItemIds, regenerateAll=true)` -- no fork.
- Cost preview reuses `POST /api/migration-shape-spec/cost-preview` from Spec 2026-05-19; the frontend gates display behind the `count >= 5 OR tokens > 50000` threshold.

**`ArchitectureElementMappingEntity` + service**
- The mapping resolver writes through the existing service; we do not duplicate mapping persistence. The `missing_input_resolutions.resolution_payload_json.mappingRefId` is an FK to the created row, so removing the resolution does not delete the mapping (mapping deletion is its own user action).

## Out of Scope
- LLM-driven free-text resolution co-pilot (deferred to a Wave 2 follow-up).
- Resolving missing decisions in this flow (epic-decisions panel already covers captured decisions; richer decision resolution is a follow-up).
- Resolving missing API behaviour baselines (existing `api-migration-validation-service` flow remains the source; integration is a separate task).
- Auto-regenerating specs without an explicit user click (token-cost safety; user must press Retry).
- Multi-user concurrent resolution conflict resolution (e.g., two users uploading different OAS for the same key simultaneously).
- Approval / sign-off workflow on resolutions.
- Multi-pair mapping workspace (single-pair inline editor only in v1; richer multi-pair UX is a follow-up).
- "Retry anyway" override that bypasses the all-resolved precondition.
- Auto-regenerate-on-new-findings reconciliation loop (Wave 2 #11).
