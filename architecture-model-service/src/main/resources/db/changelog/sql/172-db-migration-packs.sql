-- 172-db-migration-packs.sql
-- Spec: Source-Grade DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)
--       with Schema Verification (2026-06-11) -- Task Group 1
--
-- Introduces `db_migration_packs` -- the root row of the DB migration pack
-- persistence stack. Each row is the ONE active pack for a
-- (project_id, architecture_id) pair: regeneration updates the row IN PLACE
-- (same id) so pack-scoped decisions and drift-report history survive by
-- pack id. Enforced by the unique index uq_dmp_project_architecture.
--
-- Modeled on the text/JSONB artifact precedents (139-generated-migration-
-- books-of-work.sql / 140-migration-story-spec-generations.sql): no files on
-- disk, no binary store; the zip is assembled on demand from the sibling
-- db_migration_pack_files rows (changeset 173).
--
-- Columns:
--   * status              -> 'generated' | 'stale' (chk_dmp_status). 'stale'
--                            is set when the input snapshot hash drifts or a
--                            pack decision is resolved. NEVER auto-regenerated;
--                            Regenerate is an explicit user action.
--   * stale_reason        -> human-readable reason the pack went stale.
--   * input_snapshot_hash -> SHA-256 of the canonically-serialized generation
--                            inputs (committed physical model + findings +
--                            db.* captured decisions + resolved pack
--                            decisions). The staleness comparator.
--   * generated_at        -> timestamp of the last (re)generation.
--   * work_item_id        -> nullable TEXT link to the user-chosen DB epic in
--                            the book of work (picked once in the pack UI; no
--                            naming-convention magic). Survives regeneration.
--   * translated_count / skipped_count / flagged_count
--                         -> the coverage ledger summary. Every discovered
--                            table/column lands in exactly one bucket. Boxed
--                            Integer in the JPA entity / DTO so a sparse PATCH
--                            never silently wipes them to 0 (per
--                            project_primitive_double_dto_overwrite.md).
--   * seed_margin         -> pack-level margin added to captured sequence /
--                            identity high-water marks in the sequences-seed
--                            changeset. Boxed Long for the same PATCH reason.
--   * manifest_json       -> the pack manifest (coverage ledger + provenance,
--                            phase ordering, delta-key strategies,
--                            requires_translation_spec_2 listings, and the
--                            expected-schema JSON used by the drift diff).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 171 are not edited.

CREATE TABLE db_migration_packs (
  id                   UUID PRIMARY KEY,
  project_id           UUID NOT NULL,
  architecture_id      UUID NOT NULL,
  status               VARCHAR(32) NOT NULL DEFAULT 'generated',
  stale_reason         TEXT NULL,
  input_snapshot_hash  TEXT NULL,
  generated_at         TIMESTAMP WITH TIME ZONE NULL,
  work_item_id         TEXT NULL,
  translated_count     INTEGER NULL,
  skipped_count        INTEGER NULL,
  flagged_count        INTEGER NULL,
  seed_margin          BIGINT NULL,
  manifest_json        JSONB NULL,
  created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dmp_status CHECK (status IN ('generated','stale'))
);

CREATE UNIQUE INDEX uq_dmp_project_architecture
  ON db_migration_packs (project_id, architecture_id);

CREATE INDEX idx_dmp_project_id
  ON db_migration_packs (project_id);

COMMENT ON TABLE db_migration_packs IS
  'Root row of the DB schema + data migration pack (Sybase ASE to PostgreSQL). One active pack per (project_id, architecture_id); regeneration updates the row in place so decisions and drift history survive by pack id. Spec: DB Schema and Data Migration Pack (2026-06-11), Task Group 1.';

COMMENT ON COLUMN db_migration_packs.status IS
  'Lifecycle status: generated | stale. Enforced by chk_dmp_status. stale is set on input snapshot hash drift or pack-decision resolution; regeneration is always an explicit user action.';

COMMENT ON COLUMN db_migration_packs.input_snapshot_hash IS
  'SHA-256 of the canonically-serialized generation inputs. Recomputed by the gateway staleness check and compared to detect drift.';

COMMENT ON COLUMN db_migration_packs.work_item_id IS
  'Nullable text id of the user-chosen DB epic book-of-work item. Set via PATCH; preserved across regeneration.';

COMMENT ON COLUMN db_migration_packs.seed_margin IS
  'Pack-level margin added to captured high-water marks when seeding sequences/identities. Boxed Long in the entity/DTO so sparse PATCHes preserve null.';

COMMENT ON COLUMN db_migration_packs.manifest_json IS
  'Pack manifest: coverage ledger with per-object provenance, phase ordering, delta-key strategies, requires-translation listings, and the expected-schema JSON consumed by the verification diff.';
