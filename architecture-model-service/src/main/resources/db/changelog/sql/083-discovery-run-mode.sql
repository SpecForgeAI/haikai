-- 083-discovery-run-mode.sql
-- Spec: V3 Discovery Pipeline Foundation
--
-- Adds a nullable `mode` column to the discovery_run table to persist the
-- computed V3 pipeline tier (A/B/C) for each run.
--   - 'A' = language pack + framework pack match
--   - 'B' = language pack match only
--   - 'C' = neither match
--
-- The column is nullable so existing rows (pre-V3) remain valid and new
-- rows that do not compute a tier can still be inserted safely.

ALTER TABLE discovery_run ADD COLUMN mode VARCHAR(1) NULL;
