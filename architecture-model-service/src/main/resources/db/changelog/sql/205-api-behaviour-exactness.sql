-- ============================================================================
-- 205: API Behaviour exactness columns (Spec 2026-07-06-j — Parity Exactness
-- & First-Class SOAP, Code-Tier Oracle Program).
--
--   * api_behaviour_baseline_items.response_body_raw — the response body's
--     RAW TEXT exactly as received on the wire (post-redaction), enabling the
--     STRICT comparison profile's byte-level verdicts. Nullable, NO backfill:
--     null means "raw unavailable" and strict verdicts degrade VISIBLY to the
--     raw_unavailable marker (never a false "exact"). Excluded from the
--     baseline content hash so every existing baseline hashes unchanged.
--
--   * api_behaviour_diffs.comparison_profile — 'standard' | 'strict' chosen at
--     diff-creation time. Nullable; null reads as 'standard' (today's
--     semantics, zero regression).
--
-- NEW changeset only — never edit applied changesets (<= 204).
-- ============================================================================

ALTER TABLE api_behaviour_baseline_items
    ADD COLUMN IF NOT EXISTS response_body_raw TEXT;

-- Captures carry the raw FIRST (the validation service persists it at
-- capture time, redaction-clean only); save-as-baseline copies it onto the
-- frozen baseline item server-side.
ALTER TABLE api_behaviour_captures
    ADD COLUMN IF NOT EXISTS response_body_raw TEXT;

ALTER TABLE api_behaviour_diffs
    ADD COLUMN IF NOT EXISTS comparison_profile TEXT;
