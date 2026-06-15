-- 174-db-migration-pack-decisions.sql
-- Spec: Source-Grade DB Schema + Data Migration Pack (Sybase ASE -> PostgreSQL)
--       with Schema Verification (2026-06-11) -- Task Group 1
--
-- Introduces `db_migration_pack_decisions` -- the PACK-SCOPED needs_decision
-- queue (settled Q2: NOT target_state_captured_decisions; decisions are
-- versioned with the pack and cleanly regenerable; mirroring into captured
-- decisions is explicitly out of scope).
--
-- Decision lifecycle is the regeneration loop: the deterministic generator
-- NEVER guesses an ambiguous mapping -- it emits a decision keyed by a STABLE
-- decision_key (object identity + question kind, e.g.
-- type_mapping:dbo.orders.rowver). Regeneration upserts by decision_key so a
-- resolved decision RE-LINKS to the new flagged object instead of
-- duplicating, and its resolution feeds back into the next generation run.
--
-- Columns:
--   * pack_id         -> FK to db_migration_packs ON DELETE CASCADE. Survives
--                        regeneration (the pack row is updated in place).
--   * decision_key    -> stable identity; UNIQUE per pack
--                        (uq_dmpd_pack_decision_key).
--   * object_ref      -> human-readable schema/table/column reference.
--   * category        -> type_mapping | computed_column | collation |
--                        delta_key | other (chk_dmpd_category).
--   * question        -> the concrete question the generator could not answer
--                        deterministically.
--   * options_json    -> the concrete options offered (JSONB array).
--   * resolution_json -> the chosen resolution payload; persisted on resolve.
--   * status          -> open | resolved (chk_dmpd_status). Resolving also
--                        marks the owning pack stale (service layer) and
--                        enables explicit Regenerate.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 173 are not edited.

CREATE TABLE db_migration_pack_decisions (
  id               UUID PRIMARY KEY,
  pack_id          UUID NOT NULL,
  decision_key     TEXT NOT NULL,
  object_ref       TEXT NULL,
  category         VARCHAR(32) NOT NULL,
  question         TEXT NULL,
  options_json     JSONB NULL,
  resolution_json  JSONB NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'open',
  resolved_at      TIMESTAMP WITH TIME ZONE NULL,
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_dmpd_category CHECK (category IN
    ('type_mapping','computed_column','collation','delta_key','other')),
  CONSTRAINT chk_dmpd_status CHECK (status IN ('open','resolved')),
  CONSTRAINT fk_dmpd_pack
    FOREIGN KEY (pack_id) REFERENCES db_migration_packs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_dmpd_pack_decision_key
  ON db_migration_pack_decisions (pack_id, decision_key);

CREATE INDEX idx_dmpd_pack_status
  ON db_migration_pack_decisions (pack_id, status);

COMMENT ON TABLE db_migration_pack_decisions IS
  'Pack-scoped needs_decision queue. decision_key is a stable function of object identity + question kind, unique per pack, so regeneration re-links resolved decisions instead of duplicating. Resolving marks the pack stale; resolutions feed back into the next explicit regeneration. Spec: DB Schema and Data Migration Pack (2026-06-11), Task Group 1.';

COMMENT ON COLUMN db_migration_pack_decisions.decision_key IS
  'Stable object identity + question kind (e.g. type_mapping:dbo.orders.rowver). Unique per pack via uq_dmpd_pack_decision_key; upserts re-link rather than duplicate.';

COMMENT ON COLUMN db_migration_pack_decisions.category IS
  'Discrete bucket: type_mapping | computed_column | collation | delta_key | other. Enforced by chk_dmpd_category.';

COMMENT ON COLUMN db_migration_pack_decisions.status IS
  'open | resolved. Enforced by chk_dmpd_status. resolved_at and resolution_json are stamped when the decision is resolved.';
