-- 177-db-migration-pack-file-kind-translation.sql
-- Spec: LLM-Assisted DB Object Translation Drafts (T-SQL -> PL/pgSQL) with
--       Judge Verification (2026-06-11) -- Task Group 2
--
-- Extends the `chk_dmpf_file_kind` CHECK on `db_migration_pack_files` with a
-- SEVENTH kind, `translation` -- used ONLY for emitted APPROVED-translation
-- file rows (`translations/<kind>.<schema>.<object>.sql` plus the
-- consolidated 050-translations changelog section). Unapproved drafts NEVER
-- become file rows; they live in db_migration_pack_translations only.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable -- `173-db-migration-pack-files.sql` (which created the original
-- 6-kind constraint) is NOT edited; the constraint is dropped and re-created
-- here in a NEW changeset.

ALTER TABLE db_migration_pack_files
  DROP CONSTRAINT IF EXISTS chk_dmpf_file_kind;

ALTER TABLE db_migration_pack_files
  ADD CONSTRAINT chk_dmpf_file_kind CHECK (file_kind IN
    ('liquibase_master','liquibase_changeset','bulk_load_script','incremental_script','manifest','readme','translation'));

COMMENT ON COLUMN db_migration_pack_files.file_kind IS
  'Discrete bucket: liquibase_master | liquibase_changeset | bulk_load_script | incremental_script | manifest | readme | translation. Enforced by chk_dmpf_file_kind (extended by changeset 177). translation rows are emitted approved translations ONLY.';
