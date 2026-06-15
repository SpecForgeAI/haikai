-- 126-discovery-run-service-id-set-null.sql
-- Spec: Discovery Run Robustness (2026-05-11) -- Section 2
--
-- Change discovery_run.service_id FK action from the implicit RESTRICT
-- (inherited from changeset 081) to ON DELETE SET NULL so that deleting
-- a `services` row no longer raises an FK violation on its dependent
-- discovery_run rows. Preserves DEFERRABLE INITIALLY DEFERRED semantics
-- (added by changeset 082) so the ModelService.saveModel
-- DELETE-ALL -> re-INSERT-ALL cycle continues to work without firing
-- the check inside the transaction.
--
-- Per project memory (feedback_liquibase_immutable_changesets): applied
-- Liquibase changesets are immutable. Changesets 081 and 082 are NOT
-- edited; this NEW changeset 126 supersedes their FK action via a
-- DROP + re-ADD.
--
-- The column is already nullable (changeset 081 declared it without
-- NOT NULL), so no ALTER COLUMN ... DROP NOT NULL is required.
-- Companion identity-snapshot data lives on config_snapshot.serviceIdentitySnapshot
-- and is written at run-create time in DiscoveryRunService.createRun.

ALTER TABLE discovery_run DROP CONSTRAINT IF EXISTS discovery_run_service_id_fkey;

ALTER TABLE discovery_run
  ADD CONSTRAINT discovery_run_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES services(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
