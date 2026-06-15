-- 169-discovery-run-degraded.sql
-- Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
--
-- Adds two nullable columns to the discovery_run table to persist the advisory
-- run-integrity "degraded" signal computed by the discovery-service pipeline:
--   - `degraded`          BOOLEAN NULL -- TRUE when the run COMPLETED but the
--                         captured model may be partial/incomplete.
--   - `degraded_reasons`  TEXT    NULL -- JSON-encoded string[] of the reasons
--                         the flag tripped (e.g. ["scanner_failed",
--                         "files_failed", "method_cap_hit"]), surfaced verbatim.
--
-- This signal rides ALONGSIDE the existing `status` column's `COMPLETED` value
-- -- it is NOT a new terminal status enum value and does NOT touch the
-- discovery-service `validateStatusTransition` state machine. It is advisory
-- only; a degraded run still COMPLETES.
--
-- Mirrors the 085-discovery-run-warnings.sql precedent exactly: nullable, no
-- backfill (legacy rows remain valid with NULL), and TEXT (not JSONB) for the
-- JSON-encoded reasons array to match the existing portability pattern. The
-- architecture-model-service does not parse the reasons array server-side; it
-- is persisted and surfaced verbatim on the DTO, exactly like `warnings`.

ALTER TABLE discovery_run ADD COLUMN degraded BOOLEAN NULL;
ALTER TABLE discovery_run ADD COLUMN degraded_reasons TEXT NULL;
