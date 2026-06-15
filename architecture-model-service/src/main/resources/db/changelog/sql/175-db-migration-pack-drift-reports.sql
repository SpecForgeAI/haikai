-- 175-db-migration-pack-drift-reports.sql
-- Spec: Source-Grade DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)
--       with Schema Verification (2026-06-11) -- Task Group 1
--
-- Introduces `db_migration_pack_drift_reports` -- the APPEND-ONLY history of
-- schema verification runs (the DB sibling of the API drift report). Each
-- verify run scans the TARGET Postgres database, diffs it against the pack
-- manifest expected-schema JSON, and APPENDS one row here. Rows are never
-- updated or overwritten (audit trail, settled Q6); per-area re-verification
-- appends additional rows scoped by scan_scope_json.
--
-- Columns:
--   * pack_id         -> FK to db_migration_packs ON DELETE CASCADE. History
--                        survives regeneration (the pack row is updated in
--                        place, same id).
--   * scan_scope_json -> the area filter for the run (schemas/tables); NULL
--                        means a full-scope scan.
--   * match_count / missing_count / mismatch_count
--                     -> per-object classification summary. Boxed Integer in
--                        the JPA entity / DTO per
--                        project_primitive_double_dto_overwrite.md.
--   * report_json     -> the full per-object classification report including
--                        mismatch property detail and the informational
--                        unexpected_in_target section.
--   * source          -> free text producer tag: in_tool now. Designed so a
--                        future external implementation+verification service
--                        callback can append per-area runs without a schema
--                        change (integration itself out of scope).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 174 are not edited.

CREATE TABLE db_migration_pack_drift_reports (
  id               UUID PRIMARY KEY,
  pack_id          UUID NOT NULL,
  scan_scope_json  JSONB NULL,
  match_count      INTEGER NULL,
  missing_count    INTEGER NULL,
  mismatch_count   INTEGER NULL,
  report_json      JSONB NULL,
  source           TEXT NULL DEFAULT 'in_tool',
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_dmpdr_pack
    FOREIGN KEY (pack_id) REFERENCES db_migration_packs(id) ON DELETE CASCADE
);

CREATE INDEX idx_dmpdr_pack_created
  ON db_migration_pack_drift_reports (pack_id, created_at);

COMMENT ON TABLE db_migration_pack_drift_reports IS
  'Append-only history of schema verification (drift) runs per pack. Rows are never updated; per-area re-verifications append additional rows. source is free text (in_tool now) so a future external verification service can append runs without schema change. Spec: DB Schema and Data Migration Pack (2026-06-11), Task Group 1.';

COMMENT ON COLUMN db_migration_pack_drift_reports.scan_scope_json IS
  'Area filter for the run (schemas/tables). NULL means full scope.';

COMMENT ON COLUMN db_migration_pack_drift_reports.report_json IS
  'Full per-object classification report: match | missing | mismatch with structured property detail, plus the informational unexpected_in_target section.';

COMMENT ON COLUMN db_migration_pack_drift_reports.source IS
  'Free-text producer tag. in_tool for verify runs from the gateway; future external callbacks may append their own tag.';
