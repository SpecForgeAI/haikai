-- ============================================================================
-- 207: Mutating-endpoint state deltas (Spec 2026-07-06-n — Code-Tier Oracle
-- Program).
--
-- For WRITE endpoints the oracle is response parity AND state parity: the
-- validation service snapshots the endpoint's committed effect tables before
-- and after a mutating call and persists the delta. Captures carry it first;
-- save-as-baseline copies it onto the frozen item server-side (the raw-body
-- precedent, changeset 205). Nullable, NO backfill: null = "state not
-- captured" and the reconcile verdict degrades VISIBLY to state_unverified —
-- never a silent pass.
--
-- NEW changeset only — never edit applied changesets (<= 206).
-- ============================================================================

ALTER TABLE api_behaviour_captures
    ADD COLUMN IF NOT EXISTS state_delta_json JSONB;

ALTER TABLE api_behaviour_baseline_items
    ADD COLUMN IF NOT EXISTS state_delta_json JSONB;
