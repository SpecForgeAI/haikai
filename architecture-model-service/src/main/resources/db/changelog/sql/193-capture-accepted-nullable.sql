-- 193-capture-accepted-nullable.sql
-- Spec: Capture-Review Reviewer Column Bug Fix (2026-06-19)
--
-- A freshly-captured api_behaviour_captures row previously defaulted to
-- accepted = FALSE, so the capture-review "Reviewer" column rendered the row as
-- "rejected" before any human or auto review had ever touched it. The correct
-- pre-review state is UN-REVIEWED (NULL -> blank in the UI), distinct from an
-- explicit reviewer rejection (FALSE).
--
-- This changeset makes accepted nullable defaulting NULL:
--   * DROP DEFAULT  -> new rows no longer auto-populate FALSE.
--   * DROP NOT NULL -> NULL (un-reviewed) becomes a valid persisted state.
--
-- NO backfill: existing FALSE rows are intentionally left as-is (they were
-- written under the old contract; we do not retro-classify them as un-reviewed).
--
-- Eligibility for save-as-baseline (findBySessionIdAndAcceptedTrueOrderByCapturedAtAsc)
-- continues to match accepted = TRUE only, so NULL is correctly treated as
-- NOT-accepted (NULL <> TRUE).
--
-- NEW changeset only -- never edit applied changesets (<= 192).

ALTER TABLE api_behaviour_captures ALTER COLUMN accepted DROP DEFAULT;
ALTER TABLE api_behaviour_captures ALTER COLUMN accepted DROP NOT NULL;

COMMENT ON COLUMN api_behaviour_captures.accepted IS
  'Reviewer flag. NULL = un-reviewed (blank in UI; the default state for a freshly-captured row until the canonical-capture pass or a human reviewer sets it). TRUE = accepted, FALSE = explicitly rejected. Only TRUE captures are eligible to land in baseline_items on save-as-baseline (NULL is treated as NOT-accepted).';
