-- 157-api-behaviour-capture-sessions-kind.sql
-- Spec: API Test Harness — Target-Side Capture (2026-05-25) -- Task Group 1
--
-- Adds a `kind` discriminator + a `source_baseline_id` FK to
-- `api_behaviour_capture_sessions` so a target-side replay session can be
-- distinguished from the existing current-state capture session and can
-- record which source baseline it is replaying.
--
-- Allowed `kind` values (validated at service layer):
--   current  -- LLM-driven current-state capture session
--   target   -- replay session driven by targetReplayRunner.ts
--
-- Existing rows pick up `kind='current'` via the DEFAULT clause; NULL
-- `source_baseline_id` is the correct legacy value (no current-state
-- session has a source baseline).
--
-- FK pairing invariant (validated at service layer):
--   * kind='target' MUST have source_baseline_id non-null
--   * kind='current' MUST have source_baseline_id null
--
-- ON DELETE SET NULL: a target session keeps existing as a historical record
-- if the source baseline it replayed is later deleted. The session row
-- carries enough redacted config to be inspected post-hoc.
--
-- Partial index on source_baseline_id WHERE NOT NULL keeps the index small
-- since most sessions are current and don't reference a source baseline.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 156 are not edited.

ALTER TABLE api_behaviour_capture_sessions
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'current';

ALTER TABLE api_behaviour_capture_sessions
  ADD COLUMN source_baseline_id UUID NULL
  REFERENCES api_behaviour_baselines(id) ON DELETE SET NULL;

CREATE INDEX api_behaviour_capture_sessions_source_idx
  ON api_behaviour_capture_sessions(source_baseline_id)
  WHERE source_baseline_id IS NOT NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.kind IS
  'Discriminator. Valid values: current (LLM-driven current-state capture), target (replay against a target URL via targetReplayRunner.ts). Validated at service layer.';
COMMENT ON COLUMN api_behaviour_capture_sessions.source_baseline_id IS
  'FK from a target session at the source current-state baseline it is replaying. MUST be non-null when kind=target, MUST be null when kind=current (service-layer invariant). ON DELETE SET NULL: target session survives source baseline deletion as a historical record.';
