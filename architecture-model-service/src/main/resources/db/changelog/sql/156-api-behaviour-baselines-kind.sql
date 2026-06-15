-- 156-api-behaviour-baselines-kind.sql
-- Spec: API Test Harness — Target-Side Capture (2026-05-25) -- Task Group 1
--
-- Adds a `kind` discriminator + a `paired_with_baseline_id` self-FK to
-- `api_behaviour_baselines` so a target-side baseline produced by replaying
-- an existing current-state baseline against a target URL can point back at
-- its source.
--
-- Allowed `kind` values (validated at service layer — no DB enum, matches
-- existing AMS convention for status discriminators):
--   current  -- baseline produced by the LLM-driven current-state loop
--   target   -- baseline produced by the replay loop against a target URL
--
-- Existing rows pick up `kind='current'` via the DEFAULT clause; no separate
-- backfill changeset needed. NULL `paired_with_baseline_id` is also the
-- correct legacy value for every pre-migration row (they are all current).
--
-- FK pairing invariant (validated at service layer):
--   * kind='target' MUST have paired_with_baseline_id non-null
--   * kind='current' MUST have paired_with_baseline_id null
--
-- ON DELETE SET NULL on the self-FK keeps the target baseline alive if the
-- source is deleted -- the row simply unmoors. The diff engine in Spec #5
-- can then surface "source removed" as a finding rather than the target
-- baseline disappearing silently.
--
-- Partial index on paired_with_baseline_id WHERE NOT NULL keeps the index
-- small (most baselines are current and don't carry a pairing). The lookup
-- pattern is "find target baselines paired with this source" which always
-- filters for non-null.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 155 are not edited.

ALTER TABLE api_behaviour_baselines
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'current';

ALTER TABLE api_behaviour_baselines
  ADD COLUMN paired_with_baseline_id UUID NULL
  REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL;

CREATE INDEX api_behaviour_baselines_paired_idx
  ON api_behaviour_baselines(paired_with_baseline_id)
  WHERE paired_with_baseline_id IS NOT NULL;

COMMENT ON COLUMN api_behaviour_baselines.kind IS
  'Discriminator. Valid values: current (LLM-driven current-state capture), target (replay against a target URL). Validated at service layer.';
COMMENT ON COLUMN api_behaviour_baselines.paired_with_baseline_id IS
  'Self-FK from a target baseline back at the source current-state baseline it was replayed from. MUST be non-null when kind=target, MUST be null when kind=current (service-layer invariant). ON DELETE SET NULL: target baseline survives source deletion as an unmoored row.';
