-- 173-db-migration-pack-files.sql
-- Spec: Source-Grade DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)
--       with Schema Verification (2026-06-11) -- Task Group 1
--
-- Introduces `db_migration_pack_files` -- one row per generated pack file
-- (Liquibase changelogs, bulk/incremental data scripts, manifest, readme).
-- All generated content persists as TEXT rows; the download zip is assembled
-- on demand with file_path as the zip entry path. NO filesystem artifacts at
-- any point (research finding 2 / Q1).
--
-- Columns:
--   * pack_id    -> FK to db_migration_packs ON DELETE CASCADE. Regeneration
--                   REPLACES the file set wholesale (delete + insert) while
--                   the pack row itself is updated in place.
--   * file_path  -> relative path inside the zip, e.g.
--                   liquibase/changesets/010-tables/dbo.orders.sql
--   * file_kind  -> liquibase_master | liquibase_changeset | bulk_load_script
--                   | incremental_script | manifest | readme
--                   (chk_dmpf_file_kind).
--   * content    -> the full file text. Checksum-stable for unchanged objects:
--                   regeneration over identical inputs is byte-identical.
--   * sort_order -> deterministic ordering inside the pack (FK-topological
--                   table order for changesets/scripts). Boxed Integer in the
--                   JPA entity per project_primitive_double_dto_overwrite.md.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 172 are not edited.

CREATE TABLE db_migration_pack_files (
  id          UUID PRIMARY KEY,
  pack_id     UUID NOT NULL,
  file_path   TEXT NOT NULL,
  file_kind   VARCHAR(32) NOT NULL,
  content     TEXT NULL,
  sort_order  INTEGER NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dmpf_file_kind CHECK (file_kind IN
    ('liquibase_master','liquibase_changeset','bulk_load_script','incremental_script','manifest','readme')),
  CONSTRAINT fk_dmpf_pack
    FOREIGN KEY (pack_id) REFERENCES db_migration_packs(id) ON DELETE CASCADE
);

CREATE INDEX idx_dmpf_pack_sort
  ON db_migration_pack_files (pack_id, sort_order);

COMMENT ON TABLE db_migration_pack_files IS
  'Generated pack files as text rows (no filesystem, no binary store). file_path is the zip entry path; the download zip is assembled on demand. Replaced wholesale on regeneration. Spec: DB Schema and Data Migration Pack (2026-06-11), Task Group 1.';

COMMENT ON COLUMN db_migration_pack_files.file_kind IS
  'Discrete bucket: liquibase_master | liquibase_changeset | bulk_load_script | incremental_script | manifest | readme. Enforced by chk_dmpf_file_kind.';

COMMENT ON COLUMN db_migration_pack_files.sort_order IS
  'Deterministic ordering inside the pack (FK-topological for table changesets and bulk scripts). Boxed Integer in the entity/DTO so sparse updates preserve null.';
