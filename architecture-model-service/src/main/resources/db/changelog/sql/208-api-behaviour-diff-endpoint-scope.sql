-- ============================================================================
-- 208: API Behaviour diff endpoint scope (Spec 2026-07-06-i — Parity Verify
-- Loop & Execution Gates, Code-Tier Oracle Program).
--
-- A SCOPED replay/diff (per-story parity verify, Spec F's affected-consumer
-- revalidation, baseline drift checks) must be AUDITABLE: a scoped-clean diff
-- must never masquerade as full-surface-clean. The scope rides the diff row:
--
--   endpoint_scope_json  { keys: ["METHOD /path/template", ...] | null,
--                          purpose: 'parity' | 'drift_check' | ... }
--
-- NULL (every pre-existing row; every wizard-initiated full diff) means the
-- diff covers the FULL baseline surface — today's semantics, no backfill.
-- The gateway's closure gate requires an UNSCOPED clean diff and rejects a
-- scoped one by reading this column.
-- ============================================================================

ALTER TABLE api_behaviour_diffs
    ADD COLUMN IF NOT EXISTS endpoint_scope_json JSONB;
