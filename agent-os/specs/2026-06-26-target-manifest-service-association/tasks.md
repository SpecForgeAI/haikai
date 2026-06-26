# Task Breakdown: Target Manifest → Service Association (Foreign Key)

## Overview
Total Tasks: 5 task groups

This feature spans four tiers. Implement in dependency order: AMS data-model foundation (changeset 202 + entity + DTO/Input) → AMS ownership validation + logical FK cleanup → gateway wire/route threading → frontend Service picker + submit gating. Each tier ends by running ONLY its own newly written tests (the whole-repo frontend tsc/lint baseline is pre-existingly red; verify in isolation).

## Task List

### AMS Data Layer

#### Task Group 1: Changeset 202 + Entity + DTO/Input Foundation
**Dependencies:** None

- [x] 1.0 Complete the AMS data-model foundation for `target_service_element_id`
  - [x] 1.1 Write 2-8 focused tests for the changeset + entity/DTO round-trip
    - Add `TargetManifestArtifactServiceElementChangesetTest.java` mirroring `TargetManifestArtifactsTier2FactsChangesetTest.java`: assert changeset `202` applies and the `target_service_element_id` column exists, and that a re-run is a clean `MARK_RAN` no-op
    - Add 1-2 entity/DTO round-trip tests: `targetServiceElementId` persists on `TargetManifestArtifactEntity` and survives `TargetManifestArtifactDto.fromEntity`
    - Limit to 2-8 highly focused tests; skip exhaustive coverage
  - [x] 1.2 Create `db/changelog/sql/202-target-manifest-service-element.sql`
    - Mirror `201-target-manifest-tier2-facts.sql` exactly: `ALTER TABLE target_manifest_artifacts ADD COLUMN target_service_element_id UUID`, nullable, no backfill
    - Add `COMMENT ON COLUMN` describing the FK to a target-state `services` element
  - [x] 1.3 Register changeset `202` in `db.changelog-master.yaml`
    - Insert directly after `201` using the `not: columnExists` precondition idiom with `onFail: MARK_RAN` / `onError: HALT` (same block shape as the 201 changeset at `:4675-4691`)
  - [x] 1.4 Mirror the column on `TargetManifestArtifactEntity.java`
    - Add `@Column(name = "target_service_element_id") private UUID targetServiceElementId;` (nullable, NO `@Builder.Default`)
    - Leave the `(project_id, target_architecture_id, tag)` latest-flip key and all indexes unchanged; no physical FK constraint
  - [x] 1.5 Add `targetServiceElementId` (UUID) to `TargetManifestArtifactInput.java` and `TargetManifestArtifactDto.java`
    - snake_case wire → `target_service_element_id`; NO `@CamelCaseWire` (AMS default snake_case applies)
    - Thread it through `TargetManifestArtifactService` persist and `TargetManifestArtifactDto.fromEntity`
  - [x] 1.6 Ensure AMS data-layer tests pass
    - Run ONLY the 2-8 tests written in 1.1 (changeset test + entity/DTO round-trip)
    - Verify changeset 202 applies and is a MARK_RAN no-op on re-run
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass
- Changeset 202 applies the nullable column and re-runs cleanly (MARK_RAN)
- `targetServiceElementId` round-trips entity → DTO and Input → persist
- Latest-flip key, indexes, and Tier-2 facts feature untouched

### AMS Validation Layer

#### Task Group 2: Ownership Validation + Logical FK Cleanup
**Dependencies:** Task Group 1

- [x] 2.0 Complete AMS ownership validation and soft-delete cleanup
  - [x] 2.1 Write 2-8 focused tests for ownership validation + cleanup
    - Valid case: a `target_service_element_id` belonging to the path `targetArchitectureId` (not archived) persists
    - Reject cases: unknown id, archived element, and element belonging to a different architecture each yield a 4xx validation error (no dangling FK persisted)
    - Cleanup case: archiving the chosen `services` element nulls dependent `target_manifest_artifacts.target_service_element_id`
    - Limit to 2-8 highly focused tests
  - [x] 2.2 Add ownership validation at the `TargetManifestArtifactService` persist path
    - Reached via `TargetManifestArtifactController` / `PersistTargetManifestArtifactsRequest`
    - For each `target_service_element_id`, validate it resolves to a `services` element that belongs to the path `targetArchitectureId` and is not archived
    - Reject with a 4xx validation error when unknown, archived, or cross-architecture — never silently persist a dangling FK
  - [x] 2.3 Implement logical FK cleanup on service-element archive
    - On soft-delete (`archived`) of a chosen `services` element, null the dependent `target_manifest_artifacts.target_service_element_id` (logical cascade; no physical FK because elements are archived, not hard-deleted)
    - No extra action for draft-architecture soft-delete/abandonment beyond existing per-draft scoping (per-draft manifests are inert with no read path)
  - [x] 2.4 Ensure AMS validation-layer tests pass
    - Run ONLY the 2-8 tests written in 2.1
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass
- Unknown / archived / cross-architecture service ids are rejected with a 4xx
- Valid in-architecture, non-archived service ids persist
- Archiving a service element nulls dependent manifest FKs

### Gateway Layer

#### Task Group 3: Wire Types + Upload Route Threading
**Dependencies:** Task Group 1

- [x] 3.0 Complete gateway wire + route threading for `serviceIdsByFilename`
  - [x] 3.1 Write 2-8 focused Jest tests
    - `serviceIdsByFilename` parsing/threading in `targetManifestUpload.ts` (parallel to the `tags` / `tagsByFilename` / `pickTag` seam): the per-file service id is carried onto each `ConfirmedManifestArtifact` and into the persisted payload
    - `toTargetManifestArtifactInput` maps `target_service_element_id` correctly (including null)
    - Limit to 2-8 highly focused tests
  - [x] 3.2 Extend wire types in `targetManifestArtifactsClient.ts`
    - Add `target_service_element_id: string | null` to `TargetManifestArtifactInput` (`:63`) and `TargetManifestArtifactWire` (`:89`)
    - Map it in `toTargetManifestArtifactInput` (`:319`)
  - [x] 3.3 Thread the service id through the upload route `targetManifestUpload.ts`
    - Parse `serviceIdsByFilename` parallel to the existing `tagsByFilename` / `resolveTagsFromBody` / `pickTag` seam (no new endpoint)
    - Carry the resolved service id onto each `ConfirmedManifestArtifact` (`manifestHandoffs.ts`) and into the persisted payload
  - [x] 3.4 Confirm `migrationSeedBuildFilesProducer.ts` needs no change
    - `buildConventionServiceModuleMapping` (`tag → { moduleDir: tag }`, `:88-106`, `layout: 'monorepo'`) stays unchanged: since the persisted `tag` now equals the derived moduleDir, file placement is preserved
  - [x] 3.5 Ensure gateway tests pass
    - Run ONLY the 2-8 Jest tests written in 3.1
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 Jest tests written in 3.1 pass
- `serviceIdsByFilename` is parsed and threaded onto each artifact and the persisted payload
- `toTargetManifestArtifactInput` maps `target_service_element_id` (and null)
- `migrationSeedBuildFilesProducer.ts` is unchanged and file placement is preserved

### Frontend Layer

#### Task Group 4: Service Picker + Derived Tag + Submit Gating
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete the frontend Service picker
  - [x] 4.1 Write 2-8 focused Vitest tests (run in isolation)
    - Picker renders one `<select>` per selected manifest from the `services` prop
    - Choosing a service sets `targetServiceElementId` and derives `tag` (`repoSubfolder` when present, else slugified `name`)
    - Submit is blocked until every selected manifest has a non-empty `targetServiceElementId`
    - `uploadTargetManifests` includes `serviceIdsByFilename` in the multipart body
    - Limit to 2-8 highly focused tests; verify in isolation (whole-repo tsc/lint baseline is red)
  - [x] 4.2 Extend `SelectedManifest` and handlers in `targetManifestApi.ts`
    - Add `targetServiceElementId: string` to `SelectedManifest` (`:177`)
    - Replace `updateTag` with `onServiceChange(index, serviceId)` that also sets the derived `tag` (FR5 derivation)
  - [x] 4.3 Implement the slugified-name derivation helper (FR5)
    - `moduleDir`/`tag` = `repo_subfolder` when present, else slugified Service `name` (lowercase, non-alphanumeric runs → single hyphen, trimmed)
    - Derive from the in-memory Service (which carries `repoSubfolder`)
  - [x] 4.4 Replace the free-text tag input with the Service `<select>` in `ManifestUploadPanel.tsx`
    - Replace the per-manifest free-text input (`:318-331`) with a required Service `<select>` per selected manifest
    - Add a new `services` prop `{ id, name, repoSubfolder }[]`; keep the picker per-manifest and orthogonal to the whole-panel mutual-exclusivity with "Manually Answer Target State" (`disabledReason` / `onActiveChange` untouched)
    - Free-text tag is fully replaced (no optional override)
  - [x] 4.5 Wire the `services` prop at the mount site in `ArchitectConversationTab.tsx`
    - Pass `model.metaModel.entities.services` (`:287`) into the panel at the mount site (`:1384`); use `elements-inventory` `services` (`{id,name}`) as the equivalent source where the full model is not on hand
  - [x] 4.6 Replace submit gating
    - Replace `allManifestsTagged` (`targetManifestApi.ts:222`) / `canSubmit` (`ManifestUploadPanel.tsx:212`) so submit is blocked until every selected manifest has a non-empty `targetServiceElementId`
  - [x] 4.7 Send `serviceIdsByFilename` in the upload
    - `uploadTargetManifests` (`targetManifestApi.ts:244`) sends a new `serviceIdsByFilename` JSON map alongside `tagsByFilename` in the multipart body
  - [x] 4.8 Ensure frontend tests pass (in isolation)
    - Run ONLY the 2-8 Vitest tests written in 4.1, in isolation (do NOT run whole-repo tsc/lint)
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 Vitest tests written in 4.1 pass in isolation
- The Service picker replaces the free-text tag and is required per manifest
- `tag` is derived (`repo_subfolder` else slugified `name`); submit is gated on a chosen service
- `serviceIdsByFilename` is sent in the upload body; mutual-exclusivity with the manual-answer box is unchanged

### Testing

#### Task Group 5: Cross-Tier Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - AMS changeset + entity/DTO round-trip (1.1) and ownership/cleanup (2.1)
    - Gateway parsing/threading + mapping (3.1)
    - Frontend picker + gating (4.1)
    - Total existing tests: approximately 8-32
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end gaps in the upload → persist → FK path (picker selection → `serviceIdsByFilename` → ownership-validated persist → derived `tag`/moduleDir placement)
    - Do NOT assess entire-application coverage; focus only on this spec's requirements
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Fill only critical integration/end-to-end gaps (e.g., picker-derived tag preserves moduleDir placement; rejected service id surfaces a 4xx to the gateway/UI)
    - Skip edge cases, performance, and accessibility unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests from 1.1, 2.1, 3.1, 4.1 (frontend in isolation), and 5.3
    - Expected total: approximately 18-42 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 total)
- Critical upload → persist → FK workflow for this feature is covered
- No more than 10 additional tests added
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence:
1. AMS Data Layer — changeset 202 + entity + DTO/Input (Task Group 1)
2. AMS Validation Layer — ownership validation + logical FK cleanup (Task Group 2)
3. Gateway Layer — wire types + upload route threading (Task Group 3)
4. Frontend Layer — Service picker + derived tag + submit gating (Task Group 4)
5. Cross-Tier Test Review & Gap Analysis (Task Group 5)
