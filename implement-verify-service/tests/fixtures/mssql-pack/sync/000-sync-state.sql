-- sync/000-sync-state.sql
-- High-water state for the DAILY one-way incremental sync (side-by-side
-- running until swap-over). One row per synced table; the runner reads
-- the stored high-water, applies the table's incremental script with
-- :last_high_water bound to it, and advances the row on success.
-- Idempotence: re-running with no source changes applies nothing.

CREATE TABLE IF NOT EXISTS haikai_sync_state (
  table_name   text PRIMARY KEY,
  high_water   text,          -- bigint-safe verbatim high-water (identity or timestamp)
  last_run_at  timestamptz,
  last_status  text           -- ok | drift | error
);
