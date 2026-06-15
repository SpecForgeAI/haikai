-- 137-discovery-runs-kind.sql
-- Spec: Database Discovery Packs (Sybase + PostgreSQL)
--       (2026-05-16) -- Task Group 1
--
-- Adds a `discovery_kind` discriminator column to `discovery_run` so the same
-- table can carry both code-based discovery runs (existing) and database-based
-- discovery runs (new in this spec). Future "combined" runs (mixing code + DB
-- sources) are reserved by allowed value but NOT emitted in v1.
--
-- Allowed values: 'code' | 'database' | 'combined'.
-- Default: 'code' (existing rows backfill to 'code' via the column DEFAULT;
-- the explicit UPDATE below is defensive against any pre-existing row that
-- somehow ended up with NULL before the NOT NULL constraint applied).
--
-- IMPORTANT: this column is DISTINCT from the existing `mode` column
-- ('A'|'B'|'C', the V3 pipeline tier). Do NOT conflate. `mode` describes
-- HOW the run is computed; `discovery_kind` describes WHAT the run sees.
--
-- Indexing: a single-column btree index on discovery_kind so the run-list
-- views can cheaply filter by kind. The most selective queries will combine
-- (project_id, architecture_id, discovery_kind) -- the existing composite
-- index on (project_id, architecture_id) plus this index lets Postgres
-- bitmap-AND when needed without forcing a new composite.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 136 are not edited.

ALTER TABLE discovery_run
  ADD COLUMN discovery_kind VARCHAR(32) NOT NULL DEFAULT 'code';

-- Defensive explicit backfill. The DEFAULT clause above already populates
-- every existing row; this UPDATE is a no-op in practice but documents the
-- intent that ALL existing runs are 'code' runs (per spec D3).
UPDATE discovery_run SET discovery_kind = 'code' WHERE discovery_kind IS NULL;

CREATE INDEX idx_discovery_run_discovery_kind
  ON discovery_run (discovery_kind);

COMMENT ON COLUMN discovery_run.discovery_kind IS
  'Source kind of the run. v1 values: code, database, combined. ''combined'' is reserved for a future spec and not emitted in v1. Distinct from the existing `mode` column (A/B/C V3 pipeline tier). Spec: Database Discovery Packs (2026-05-16).';
