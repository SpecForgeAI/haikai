-- 202-target-manifest-service-element.sql
-- Spec: Target Manifest -> Service Association (Foreign Key) (2026-06-26) --
--       Task Group 1 (FR2).
--
-- Adds the target_service_element_id UUID column to target_manifest_artifacts so
-- each confirmed manifest carries a durable LOGICAL foreign key to a specific
-- target-state Application-domain `services` element (the codebase that builds
-- that service). This replaces the brittle free-text "Target module / service
-- tag" association on new uploads and is the data-model foundation for precise
-- scaffold-story homing and future multi-codebase support.
--
-- LOGICAL FK only -- there is NO physical DB foreign-key constraint, because the
-- referenced `services` elements are SOFT-deleted (archived), not hard-deleted;
-- cleanup is logical (the dependent column is nulled on archive). The existing
-- (project_id, target_architecture_id, tag) latest-flip key and all indexes are
-- unchanged.
--
-- NULLABLE, no backfill: existing rows read it back null (legacy manifests remain
-- unbound; the field is UI-required going forward for new uploads only).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only (201 is the highest sequential on disk
-- at build time); changesets <= 201 are not edited. Registered AFTER 201 in
-- db.changelog-master.yaml with the not-columnExists precondition idiom
-- (onFail MARK_RAN) so a re-run is a clean no-op (mirrors 201 / 200 / 195 / 198).

ALTER TABLE target_manifest_artifacts
  ADD COLUMN target_service_element_id UUID;

COMMENT ON COLUMN target_manifest_artifacts.target_service_element_id IS
  'Logical foreign key to the target-state Application-domain `services` element (id) that this manifest is bound to -- the codebase that builds that service. Replaces the free-text tag association on new uploads. NO physical FK constraint (referenced elements are soft-deleted / archived, not hard-deleted; cleanup is logical -- nulled on archive). Validated at write to belong to the path target_architecture_id and be non-archived. Nullable; legacy rows read back null. Spec: Target Manifest -> Service Association (Foreign Key) (2026-06-26).';
