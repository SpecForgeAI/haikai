# Raw Idea — Spec 4: Target Manifest → Service Association (Foreign Key)

> Spec 4 of an extended target-state initiative. Follows the three completed/committed
> 2026-06-26 specs (versioned-answer UX, comprehensive manifest auto-answer + Tier-2
> facts, decisions-file import). Most scope was agreed in prior discussion and is marked
> **LOCKED** below; shaping should confirm those quickly and focus on the **RESIDUAL
> QUESTIONS**.

## Problem

Today an uploaded target dependency manifest (`pom.xml` / `package.json`) is associated
with a target codebase only via a **free-text "Target module / service tag"** field
(`ManifestUploadPanel.tsx:318-331`), used by convention as a monorepo module directory
(`migrationSeedBuildFilesProducer.ts` — `mapping[tag] = { moduleDir: tag }`). There is
**no real foreign key** from a manifest to a specific target-state Service. This is
brittle (typos, no validation) and provides no reliable way to know which deployable
codebase a manifest belongs to.

## Goal

Replace the free-text tag with a **required Service picker** at manifest upload, and
persist a real **foreign key** from the manifest artifact to the chosen target-state
Service. This is the data-model foundation that (a) lets the migration-plan "scaffold"
story (a later book-of-work spec) home precisely under the epic that builds that service,
and (b) makes future multi-codebase support straightforward without re-touching the UI.

## What "Service" means (confirmed)

The canonical **Application-domain `services` entity** — Architecture & Design →
Application → Services; AMS `services` table; `ArchitectureElementInventoryService`
`entry("services","Services")`. These are the deployable (micro)service codebases.

## LOCKED design (from prior discussion — confirm, do not re-derive)

- **Service picker** in `ManifestUploadPanel`, replacing the per-manifest free-text tag
  input. Source: the draft target architecture's `elements-inventory` `services` list
  (`{id, name}`) — already fetched for the selected draft.
- **Foreign key** on the manifest artifact: composite `(target_architecture_id,
  target_service_element_id)`. Add `target_service_element_id` as a **new nullable
  column** on `target_manifest_artifacts` via a **new Liquibase changeset (202)**,
  mirroring how changeset `201-target-manifest-tier2-facts.sql` added `tier2_facts`. The
  existing `(project_id, target_architecture_id, tag)` latest-flip key is **unchanged**.
  Thread the new id through `TargetManifestArtifactInput` / `Wire` +
  `toTargetManifestArtifactInput` + the gateway upload route.
- **Ownership validation** at upload: the chosen service element must belong to the path
  `targetArchitectureId`.
- **Logical ON-DELETE cleanup**: soft-deleting the draft target architecture (or the
  service element) tidies the manifest FK (elements are soft-deleted via `archived`, not
  hard-deleted — so this is logical, not a physical cascade).
- **Preserve file placement**: the seed-build-files producer places files via
  `tag → moduleDir`. Derive the module directory from the picked Service (name /
  repo_subfolder) so placement is preserved when the free-text tag is replaced.
- **Scope: single manifest / single target service** for now. Multi-codebase (multiple
  manifests each bound to a different service) and the target-state UI changes that
  binding requires are **deferred** — the FK is the foundation that makes them
  straightforward later.

## ID stability (verified)

"Suggest target state" synchronously persists the draft target architecture + its
`services` with durable UUIDs. **Promote preserves ids** (state flip, no reinsert), so an
FK captured against the draft survives promotion. **Re-suggest** forks a new draft with
new ids; manifests are already per-draft, so the FK lives within one draft's lifetime
(cleanup-on-soft-delete handles abandonment).

## Coexistence with the just-shipped 2026-06-26 specs (delta-checked)

- The "Manually Answer Target State" box is a **separate** component
  (`DecisionsFileUploadPanel`) mounted above `ManifestUploadPanel`; mutual-exclusivity is
  a **whole-panel submit disable** and is **orthogonal** to the per-manifest Service
  picker.
- Spec 2 added a Tier-2 "free facts" section below the auto-answered list and a
  `tier2_facts JSONB` column (changeset 201) — both untouched by this spec; changeset 202
  mirrors 201's additive pattern.

## RESIDUAL QUESTIONS (the focus of shaping)

1. Fully **replace** the free-text tag and derive module-dir from the service
   (recommended), or **keep** the tag as a co-existing optional override?
2. Picker lists **only `services`** (deployable microservices), not
   applications/application_components — correct?
3. `target_service_element_id` **nullable**, existing manifests left null (no backfill),
   UI-**required** going forward — correct?
4. Ownership validation **+** logical ON-DELETE cleanup as described — correct?
5. Confirm **single-manifest/single-service** scope; **no** "follow the service across a
   re-suggest" behaviour.

## Existing code to reference

- `frontend/src/components/targetState/architectConversation/ManifestUploadPanel.tsx`
  (tag input `:318-331`; auto-answer + Tier-2 sections `:402-464`);
  `ArchitectConversationTab.tsx` (panel mounting + mutual-exclusivity `:1369,:1384`).
- `gateway/src/routes/targetManifestUpload.ts` (route; `tags[]` / `tagsByFilename`;
  `pickTag`; `toTargetManifestArtifactInput:319-336`);
  `gateway/src/services/targetManifestArtifactsClient.ts:58-104` (wire).
- AMS `TargetManifestArtifactEntity.java:77-178`; `199-target-manifest-artifacts.sql`;
  `201-target-manifest-tier2-facts.sql` (mirror for changeset 202).
- Services list: `frontend/src/api/architecturesApi.ts:534` (`getElementsInventory`);
  AMS `ArchitectureElementInventoryService:442`.
- ID lifecycle: `SuggestFromCurrentService` (persists services with ids);
  `TargetArchitecturePromoteService:151-162` (promote preserves ids).
- File placement to preserve: `migrationSeedBuildFilesProducer.ts:88-106`
  (`tag → moduleDir`).

## Out of scope

- Multi-codebase / multi-manifest binding + the target-state UI changes for it.
- The book-of-work scaffold-story consumption of this FK (a later spec).
- Any change to the `(project_id, target_architecture_id, tag)` key or to Tier-2 facts.
