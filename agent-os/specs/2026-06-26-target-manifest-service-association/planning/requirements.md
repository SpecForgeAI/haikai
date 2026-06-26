# Spec Requirements: Target Manifest → Service Association (Foreign Key)

## Initial Description

Replace the brittle free-text "Target module / service tag" on the target dependency-manifest upload with a **required Service picker**, and persist a real **foreign key** from the manifest artifact (`target_manifest_artifacts`) to a specific target-state **Service** element (Application-domain `services`). This is the data-model foundation that (a) lets the migration-plan "scaffold" story (a later book-of-work spec) home precisely under the epic that builds that service, and (b) makes future multi-codebase support straightforward without re-touching the UI. Full agreed context in `planning/raw-idea.md`.

Scope is **single-manifest / single-service** for now; multi-codebase binding is deferred. Most scope was agreed in prior discussion (the raw idea's LOCKED section); shaping confirmed it and resolved the residual questions below.

## Requirements Discussion

### First Round Questions

**Q1 (confirm locked — UI):** Core UI change = a **required Service picker** in `ManifestUploadPanel` replacing the per-manifest free-text "Target module / service tag" input, sourced from the already-fetched draft target architecture's `elements-inventory` `services` list (`{id, name}`)?
**Answer:** Correct.

**Q2 (confirm locked — persistence):** A **new nullable column `target_service_element_id`** on `target_manifest_artifacts`, added via a **new Liquibase changeset 202** (mirroring 201's additive pattern), threaded through `TargetManifestArtifactInput`/`Wire` + `toTargetManifestArtifactInput` + the gateway upload route, with the existing `(project_id, target_architecture_id, tag)` latest-flip key left **completely unchanged**?
**Answer:** Correct.

**Q3 (residual — replace vs keep tag; moduleDir source):** Fully **replace** the free-text tag (not keep it as an override), and derive the monorepo `moduleDir` from the picked Service?
**Answer:** Correct — going with the recommendation. `moduleDir` is derived from the Service's **`repo_subfolder`** when present, else a **slugified Service `name`**. (The `services` entity already carries `repo_subfolder`, used by discovery for monorepo scoping.)

**Q4 (residual — picker scope):** The picker lists **only `services`** (deployable microservices), not `applications` or `application_components`?
**Answer:** Correct.

**Q5 (residual — nullability/backfill):** `target_service_element_id` is **nullable**, **existing manifests are left null** (no backfill / no data migration), and the field is **UI-required going forward** for new uploads?
**Answer:** Correct.

**Q6 (residual — validation + cleanup):** At upload, the chosen service element must belong to the path `targetArchitectureId` (**ownership validation**); soft-deleting the draft target architecture or the service element performs a **logical** FK cleanup (elements are soft-deleted via `archived`, not hard-deleted)?
**Answer:** Correct.

**Q7 (residual — scope guard):** **Single-manifest / single-service** scope for now, with **no** "follow the service across a re-suggest" behaviour (the FK lives within one draft's lifetime; cleanup-on-soft-delete handles abandonment); multi-codebase binding deferred?
**Answer:** Correct.

**Q8 (exclusions):** Anything else to explicitly exclude beyond the listed items?
**Answer:** No — the listed out-of-scope items are complete.

### Existing Code to Reference

User confirmed the reference set in `planning/raw-idea.md` is correct (no additional references). Key files:

- **Frontend:** `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx` (tag input `:318-331`; auto-answer + Tier-2 sections `:402-464`); `ArchitectConversationTab.tsx` (panel mounting + whole-panel mutual-exclusivity `:1369,:1384`); `frontend/src/api/architecturesApi.ts:534` (`getElementsInventory` → `services` `{id,name}`); `frontend/src/api/targetManifestApi.ts` (wire mirror).
- **Gateway:** `gateway/src/routes/targetManifestUpload.ts` (route; `tags[]` / `tagsByFilename`; `pickTag`; `toTargetManifestArtifactInput:319-336`); `gateway/src/services/targetManifestArtifactsClient.ts:58-104` (wire types — note Tier-2 `tier2_facts?` already added here).
- **AMS:** `TargetManifestArtifactEntity.java:77-178`; `db/changelog/sql/199-target-manifest-artifacts.sql`; `db/changelog/sql/201-target-manifest-tier2-facts.sql` (the additive pattern to mirror for changeset **202**); `ArchitectureElementInventoryService:442` (`entry("services","Services")`); the `services` entity (carries `repo_subfolder`).
- **ID lifecycle:** `SuggestFromCurrentService` (persists `services` with durable UUIDs at suggest); `TargetArchitecturePromoteService:151-162` (promote is a state flip — ids preserved).
- **File placement to preserve:** `gateway/src/services/migrationSeedBuildFilesProducer.ts:88-106` (`tag → moduleDir`, `layout: monorepo`).

### Follow-up Questions

None — all first-round questions were answered/confirmed.

## Visual Assets

### Files Provided:
No visual assets provided (mandatory `planning/visuals/` check returned no files). The current `ManifestUploadPanel` tag input being replaced is documented by file:line in the references above.

## Requirements Summary

### Functional Requirements

- **FR1 — Service picker (frontend).** Replace the per-manifest free-text "Target module / service tag" input in `ManifestUploadPanel` with a **required** Service `<select>` populated from the selected draft target architecture's `elements-inventory` `services` (`{id, name}`), which the workspace already fetches. The picker is **per-manifest**; it is orthogonal to the whole-panel mutual-exclusivity with the "Manually Answer Target State" box.
- **FR2 — FK column + changeset 202 (AMS).** Add nullable `target_service_element_id` (UUID) to `target_manifest_artifacts` via new Liquibase changeset `202`, mirroring `201-target-manifest-tier2-facts.sql` (`ADD COLUMN`, `MARK_RAN` precondition, no backfill). The `(project_id, target_architecture_id, tag)` latest-flip key is unchanged. Mirror the column on `TargetManifestArtifactEntity`.
- **FR3 — Wire + route threading (gateway + AMS DTOs).** Thread `target_service_element_id` through `TargetManifestArtifactInput` / `TargetManifestArtifactWire` + `toTargetManifestArtifactInput` (`targetManifestUpload.ts`) and the upload request, replacing the `tag`-only association on new uploads.
- **FR4 — Ownership validation.** At upload, validate the chosen `target_service_element_id` belongs to the path `targetArchitectureId` (reject otherwise). 
- **FR5 — moduleDir derivation (preserve file placement).** The seed-build-files producer's `tag → moduleDir` must keep working: derive `moduleDir` from the picked Service's `repo_subfolder` when present, else a slugified Service `name`. The free-text `tag` is fully replaced (not kept as an override).
- **FR6 — Logical FK cleanup.** On soft-delete (`archived`) of the draft target architecture or the service element, clean up / null the dependent manifest FK (logical cascade, since deletes are soft).

### Reusability Opportunities

- Changeset `201-target-manifest-tier2-facts.sql` is the exact additive migration pattern to mirror for `202`.
- The `elements-inventory` `services` fetch is already wired in the target-state workspace — reuse it for the picker (no new endpoint).
- The existing `updateTag` / `tags[]` / `tagsByFilename` upload seam is the wire path to extend with the service id.
- `repo_subfolder` on the `services` entity reuses discovery's monorepo-scoping field for `moduleDir`.

### Scope Boundaries

**In Scope:**
- Required Service picker replacing the free-text tag (single service per manifest).
- Nullable `target_service_element_id` FK column (changeset 202) + entity/DTO/wire/route threading.
- Ownership validation + logical FK cleanup on soft-delete.
- `moduleDir` derived from `repo_subfolder` (else slugified name); file placement preserved.

**Out of Scope:**
- Multi-codebase / multi-manifest binding and the target-state UI changes it requires (deferred).
- The book-of-work scaffold-story consumption of this FK (a later spec).
- Any change to the `(project_id, target_architecture_id, tag)` key or to Tier-2 free facts.
- Backfilling `target_service_element_id` for existing manifests.
- "Follow the service across a re-suggest" behaviour.

### Technical Considerations

- **Wire format:** follow the touched module's convention — AMS defaults to snake_case; the target-manifest wire types already in `targetManifestArtifactsClient.ts` define the shape to extend additively. No change to the captured-decisions data plane.
- **ID stability:** suggest persists `services` with durable UUIDs; promote preserves them (state flip); re-suggest forks a new draft (new ids) — the FK is per-draft by construction, so no cross-draft rebinding is needed.
- **Coexistence:** the recently shipped Tier-2 free-facts (`tier2_facts` column / panel section) and decisions-file-import ("Manually Answer Target State" box + whole-panel mutual-exclusivity) are untouched; the Service picker is per-manifest and additive.
- **Verification:** the whole-repo frontend tsc/lint baseline is pre-existingly red — verify this feature in isolation. Gateway tests use Jest; frontend uses Vitest; AMS uses JUnit + a changeset/migration test (mirror the `201` changeset test).
