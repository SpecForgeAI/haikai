-- 204-db-migration-pack-file-kind-sync.sql
-- Spec: 2026-07-02-d Side-by-Side Sync & Reconciliation Pack
--       (Persistence-Tier Oracle Program)
--
-- Extends the `chk_dmpf_file_kind` CHECK on `db_migration_pack_files` with
-- three side-by-side operation kinds:
--   sync_runner           -- the rerunnable daily incremental sync runner +
--                            its high-water state DDL
--   reconciliation_script -- per-run source/target reconciliation queries +
--                            the drift-report builder
--   cutover_runbook       -- the swap-over runbook (final delta, sequence
--                            seeding, job re-homing, verification)
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable -- 173 (original 6-kind constraint) and 177 (7th kind) are NOT
-- edited; the constraint is dropped and re-created here in a NEW changeset.

ALTER TABLE db_migration_pack_files
  DROP CONSTRAINT IF EXISTS chk_dmpf_file_kind;

ALTER TABLE db_migration_pack_files
  ADD CONSTRAINT chk_dmpf_file_kind CHECK (file_kind IN
    ('liquibase_master','liquibase_changeset','bulk_load_script','incremental_script','manifest','readme','translation','sync_runner','reconciliation_script','cutover_runbook'));

COMMENT ON COLUMN db_migration_pack_files.file_kind IS
  'Discrete bucket: liquibase_master | liquibase_changeset | bulk_load_script | incremental_script | manifest | readme | translation | sync_runner | reconciliation_script | cutover_runbook. Enforced by chk_dmpf_file_kind (extended by changesets 177 and 204).';
