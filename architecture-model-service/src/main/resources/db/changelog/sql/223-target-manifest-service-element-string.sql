-- 223-target-manifest-service-element-string.sql
-- Fix (2026-08-14): target_manifest_artifacts.target_service_element_id was
-- typed UUID, but target-state Application-domain `services` element ids are
-- STRINGS (e.g. `svc-msk7s63i-x72go` -- ServiceEntity's primary key is String).
--
-- Live consequence: every manifest upload with a bound service (the panel
-- REQUIRES the binding) failed Jackson deserialization at the AMS write
-- (HTTP 400 "Required request body is missing or malformed"), so the
-- confirmed-manifest store never held a single row and the migration plan's
-- application-scaffold story could never be created. The archive cascade had
-- the same inversion (it skipped non-UUID ids as "cannot be a FK").
--
-- This changeset retypes the column to VARCHAR(255) to match the referenced
-- element ids. Existing rows: the column has always been NULL (no write ever
-- succeeded with a non-null value -- that is the bug), so the USING cast is a
-- formality. Still a LOGICAL FK only (no physical constraint; referenced
-- elements are soft-deleted).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable -- this is a NEW changeset (222 is the highest sequential on disk
-- at build time); changesets <= 222 are not edited.

ALTER TABLE target_manifest_artifacts
  ALTER COLUMN target_service_element_id TYPE VARCHAR(255)
  USING target_service_element_id::text;

COMMENT ON COLUMN target_manifest_artifacts.target_service_element_id IS
  'Logical foreign key (STRING -- services element ids are not UUIDs, e.g. svc-<slug>) to the target-state Application-domain `services` element this manifest is bound to. NO physical FK constraint (referenced elements are soft-deleted; cleanup is logical -- nulled on archive). Validated at write to belong to the path target_architecture_id and be non-archived. Nullable; legacy rows read back null. Retyped from UUID by changeset 223 (2026-08-14): the UUID type rejected every real element id at the wire, so no bound manifest ever persisted.';
