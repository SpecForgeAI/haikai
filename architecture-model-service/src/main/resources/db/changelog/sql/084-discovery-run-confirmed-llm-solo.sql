-- 084-discovery-run-confirmed-llm-solo.sql
-- Spec: V3 Tier UX
--
-- Adds a `confirmed_llm_solo` boolean column to the discovery_run table to persist
-- the explicit LLM-solo opt-in decision for Tier C (llm-solo) runs.
--
-- When TRUE, the operator explicitly acknowledged the Tier C warnings and
-- confirmed they want to proceed with an LLM-only discovery run
-- (i.e. posted `confirmLlmSolo: true` through the discovery-service gate).
--
-- Legacy rows default to FALSE (no explicit opt-in recorded).
-- The column is NOT NULL with a default so migration applies cleanly without backfill.

ALTER TABLE discovery_run ADD COLUMN confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE;
