-- 221-db-pack-decision-surrogate-pk-category.sql
-- Surrogate-PK target fix (2026-08-08): tables with no source primary key
-- get ONE pack-wide decision offering the "modern DBA" fix — a target-only
-- BIGINT GENERATED ALWAYS AS IDENTITY primary key per no-PK table (column
-- and key are flagged isSurrogate in the expected schema, so bulk load /
-- parity / incremental sync deliberately never read or key on them) — or an
-- explicit leave_without_pk that keeps the no_primary_keys finding on its
-- accept/known-gap path.
--
-- chk_dmpd_category gains the 'surrogate_pk' bucket. Per
-- feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable — 174/220 are NOT edited; drop and re-create here in a NEW
-- changeset (the 177 idiom).

ALTER TABLE db_migration_pack_decisions
  DROP CONSTRAINT IF EXISTS chk_dmpd_category;

ALTER TABLE db_migration_pack_decisions
  ADD CONSTRAINT chk_dmpd_category CHECK (category IN
    ('type_mapping','computed_column','collation','delta_key','pk_composition','surrogate_pk','other'));

COMMENT ON COLUMN db_migration_pack_decisions.category IS
  'Discrete bucket: type_mapping | computed_column | collation | delta_key | pk_composition | surrogate_pk | other. Enforced by chk_dmpd_category (extended by changeset 221).';
