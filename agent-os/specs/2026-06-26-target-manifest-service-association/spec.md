# Specification: Target Manifest → Service Association (Foreign Key)

## Goal
Replace the brittle free-text "Target module / service tag" on the target dependency-manifest upload with a required Service picker, and persist a real foreign key (`target_service_element_id`) from each `target_manifest_artifacts` row to a specific target-state Application-domain `services` element — the data-model foundation for precise scaffold-story homing and future multi-codebase support.

## User Stories
- As an architect uploading a target `pom.xml` / `package.json`, I want to pick the exact target Service it belongs to (not type a free-text tag) so the manifest is reliably bound to the codebase that builds that service.
- As a downstream consumer (a later book-of-work scaffold spec), I want a durable FK from the manifest to its Service so I can home the scaffold under the right epic without re-parsing tags.

## Specific Requirements

**FR1 — Service picker (frontend)**
- In `ManifestUploadPanel.tsx`, replace the per-manifest free-text tag `<input>` (`:318-331`) with a required Service `<select>` per selected manifest.
- Source the option list from the draft target architecture's services already in the workspace: `ArchitectConversationTab.tsx` (`model.metaModel.entities.services`, `:287`) — pass a new `services` prop (`{ id, name, repoSubfolder }[]`) into the panel at the mount site (`:1384`). The `elements-inventory` `services` (`{id,name}`) fetch is the equivalent source where the full model is not on hand.
- Extend `SelectedManifest` (`targetManifestApi.ts:177`) with `targetServiceElementId: string`; replace `updateTag` with an `onServiceChange(index, serviceId)` handler that also sets the derived `tag` (see FR5).
- Replace `allManifestsTagged` (`targetManifestApi.ts:222`) / `canSubmit` (`ManifestUploadPanel.tsx:212`) gating so submit is blocked until every selected manifest has a chosen service (non-empty `targetServiceElementId`).
- The picker is per-manifest and orthogonal to the existing whole-panel mutual-exclusivity with the "Manually Answer Target State" box (`disabledReason` / `onActiveChange` untouched).
- `uploadTargetManifests` (`targetManifestApi.ts:244`) sends a new `serviceIdsByFilename` JSON map alongside `tagsByFilename` in the multipart body.

**FR2 — FK column + changeset 202 (AMS)**
- Add nullable `target_service_element_id UUID` to `target_manifest_artifacts` via new `db/changelog/sql/202-target-manifest-service-element.sql`, mirroring `201-target-manifest-tier2-facts.sql` exactly (`ALTER TABLE ... ADD COLUMN`, `COMMENT ON COLUMN`, no backfill).
- Register changeset `202` in `db.changelog-master.yaml` directly after `201` using the `not: columnExists` precondition idiom with `onFail: MARK_RAN` / `onError: HALT` (the same block shape as the 201 changeset, `:4675-4691`).
- Mirror the column on `TargetManifestArtifactEntity.java` as `@Column(name = "target_service_element_id") private UUID targetServiceElementId;` (nullable; no `@Builder.Default`).
- The existing `(project_id, target_architecture_id, tag)` latest-flip key and all indexes are unchanged; no new FK constraint (elements are soft-deleted, see FR6).

**FR3 — Wire + route threading (gateway + AMS DTOs)**
- AMS: add `targetServiceElementId` (UUID) to `TargetManifestArtifactInput.java` and `TargetManifestArtifactDto.java` (snake_case wire → `target_service_element_id`; no `@CamelCaseWire`); thread it through `TargetManifestArtifactService` persist and `TargetManifestArtifactDto.fromEntity`.
- Gateway: add `target_service_element_id: string | null` to `TargetManifestArtifactInput` and `TargetManifestArtifactWire` (`targetManifestArtifactsClient.ts:63,89`); map it in `toTargetManifestArtifactInput` (`targetManifestArtifactsClient.ts:319`).
- Gateway route `targetManifestUpload.ts`: parse `serviceIdsByFilename` (parallel to the existing `tags` / `tagsByFilename` seam, `resolveTagsFromBody` / `pickTag`), carry the service id onto each `ConfirmedManifestArtifact` (`manifestHandoffs.ts`), and into the persisted payload.

**FR4 — Ownership validation**
- At the AMS write (`TargetManifestArtifactService` persist, reached via `TargetManifestArtifactController` / `PersistTargetManifestArtifactsRequest`), validate each `target_service_element_id` resolves to a `services` element that belongs to the path `targetArchitectureId` and is not archived.
- Reject the write with a 4xx (validation error) when the service id is unknown, archived, or belongs to a different architecture — do not silently persist a dangling FK.

**FR5 — moduleDir derivation (preserve file placement)**
- The persisted `tag` (the latest-flip key AND the producer's placement key) is now derived from the chosen Service rather than typed: `repo_subfolder` when present, else a slugified Service `name` (lowercase, non-alphanumeric runs → single hyphen, trimmed). Derive it in the frontend from the in-memory Service (it carries `repoSubfolder`) when setting `SelectedManifest.tag`.
- The free-text tag is fully replaced (not kept as an optional override).
- `migrationSeedBuildFilesProducer.ts` `buildConventionServiceModuleMapping` (`tag → { moduleDir: tag }`, `:88-106`, `layout: 'monorepo'`) stays unchanged — because the persisted `tag` now equals the derived moduleDir, file placement is preserved with no producer change.

**FR6 — Logical FK cleanup**
- On soft-delete (`archived`) of the chosen `services` element, null the dependent `target_manifest_artifacts.target_service_element_id` (logical cascade — there is no physical FK because elements are archived, not hard-deleted).
- Soft-deleting / abandoning the draft target architecture leaves its per-draft manifests inert (no read path), so no extra action is required there beyond the per-draft scoping already in place; cleanup focuses on the service-element archive path.

**FR7 — Verification**
- Frontend: verify the `ManifestUploadPanel` / `targetManifestApi` changes with Vitest in isolation (the whole-repo tsc/lint baseline is pre-existingly red).
- Gateway: Jest tests for `serviceIdsByFilename` parsing/threading and `toTargetManifestArtifactInput` mapping.
- AMS: JUnit for the entity/DTO round-trip + ownership validation, plus a changeset test mirroring `TargetManifestArtifactsTier2FactsChangesetTest.java` (asserting the `target_service_element_id` column applies and is a clean MARK_RAN no-op on re-run).

## Visual Design
No visual assets were provided (`planning/visuals/` is empty). The free-text tag input being replaced is documented at `ManifestUploadPanel.tsx:318-331`.

## Existing Code to Leverage

**`201-target-manifest-tier2-facts.sql` + its changelog registration (`db.changelog-master.yaml:4675-4691`)**
- The exact additive `ADD COLUMN` + nullable + no-backfill migration pattern and the `not: columnExists` / `MARK_RAN` precondition block to mirror for changeset `202`.

**`tier2_facts` threading (entity → DTO → wire → route)**
- `TargetManifestArtifactEntity.tier2Facts`, `TargetManifestArtifactInput.tier2Facts`, the gateway `Tier2FactWire` types, and `toTargetManifestArtifactInput` show the end-to-end additive field path to replicate for `target_service_element_id`.

**`tags` / `tagsByFilename` / `pickTag` upload seam (`targetManifestUpload.ts`, `targetManifestApi.ts:256-266`)**
- The existing per-file tag wire seam to extend with a parallel `serviceIdsByFilename` map (no new endpoint).

**`repo_subfolder` on `ServiceEntity` / `ServiceDto` (`ServiceEntity.java:49`, `ServiceDto.java:41`)**
- Discovery's monorepo-scoping field, reused to derive `moduleDir` for the persisted `tag`.

**`model.metaModel.entities.services` in `ArchitectConversationTab.tsx:287`**
- The draft target architecture's services (full `Service` objects, incl. `repoSubfolder`) are already in the workspace — reuse to populate the picker and derive the tag without a new fetch.

## Out of Scope
- Multi-codebase / multi-manifest binding (multiple manifests each bound to a different service) and the target-state UI changes it would require.
- The book-of-work scaffold-story consumption of this FK (a later spec).
- Any change to the `(project_id, target_architecture_id, tag)` latest-flip key or to the Tier-2 free-facts (`tier2_facts`) feature.
- Backfilling `target_service_element_id` for existing manifest rows (they remain null).
- "Follow the service across a re-suggest" rebinding behaviour (the FK lives within one draft's lifetime).
- Listing `applications` or `application_components` in the picker (only `services`).
- Adding a physical DB foreign-key constraint (cleanup is logical, since elements are soft-deleted via `archived`).
