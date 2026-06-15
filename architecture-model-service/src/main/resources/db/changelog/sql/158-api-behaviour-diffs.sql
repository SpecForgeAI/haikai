-- 158-api-behaviour-diffs.sql
-- Spec: API Test Harness — Diff Engine (2026-05-25) -- Task Group 1
--
-- A row per (source_baseline, target_baseline) diff computation. AMS is the
-- system-of-record only; the deterministic diff computation itself lives in
-- api-migration-validation-service/src/services/diffRunner.ts.
--
-- The diff has lifecycle status: computing | completed | failed.
--   * computing: runner is in flight (or just got created and hasn't started)
--   * completed: runner finished; summary counts + computed_at populated
--   * failed:    runner errored; error_message populated
--
-- Six summary count columns (matched_count + 5 drift counts) are populated
-- on transition to 'completed'. They are typed as INT in the DB and BOXED
-- Integer in the JPA entity / DTO so PATCH preserves null per
-- project_primitive_double_dto_overwrite.md (a missing JSON field must NOT
-- silently wipe to 0).
--
-- Foreign keys:
--   * project_id          → project(id)                     ON DELETE CASCADE
--   * source_baseline_id  → api_behaviour_baselines(id)     ON DELETE CASCADE
--   * target_baseline_id  → api_behaviour_baselines(id)     ON DELETE CASCADE
-- Cascade-on-delete ensures that deleting the source baseline removes the
-- diff (and its diff_items via the CASCADE on api_behaviour_diff_items.diff_id
-- → api_behaviour_diffs.id in changeset 159). The target baseline keeps the
-- diff alive until either side is deleted. UI surfaces the empty state when
-- the source has been deleted (Spec #5 Task Group 5).
--
-- UNIQUE (source_baseline_id, target_baseline_id) gives the diff runner free
-- "find existing diff for this pair" semantics (used to detect recompute
-- targets vs new-diff creation). It also doubles as a guard against
-- accidental duplicate diff rows for the same pair.
--
-- Service-layer FK-pairing invariant (Task Group 2 enforces):
--   * source_baseline_id MUST point at a kind='current' baseline
--   * target_baseline_id MUST point at a kind='target' baseline whose
--     paired_with_baseline_id equals source_baseline_id
-- These invariants are NOT enforced at the DB level (matches the existing
-- AMS convention for status discriminators -- service-layer string checks).
--
-- NEW changeset only -- never edit applied changesets (<= 157) per
-- feedback_liquibase_immutable_changesets.md.

CREATE TABLE api_behaviour_diffs (
  id                            UUID PRIMARY KEY,
  project_id                    UUID NOT NULL,
  architecture_id               UUID NOT NULL,
  source_baseline_id            UUID NOT NULL,
  target_baseline_id            UUID NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'computing',
  matched_count                 INT,
  status_drift_count            INT,
  body_shape_drift_count        INT,
  body_value_drift_count        INT,
  source_only_count             INT,
  target_only_count             INT,
  source_baseline_updated_at    TIMESTAMPTZ,
  target_baseline_updated_at    TIMESTAMPTZ,
  computed_at                   TIMESTAMPTZ,
  error_message                 TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_diff_project
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_behaviour_diff_source
    FOREIGN KEY (source_baseline_id) REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_behaviour_diff_target
    FOREIGN KEY (target_baseline_id) REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE,
  CONSTRAINT api_behaviour_diffs_pair_unique
    UNIQUE (source_baseline_id, target_baseline_id)
);

CREATE INDEX api_behaviour_diffs_target_idx
  ON api_behaviour_diffs (target_baseline_id);

CREATE INDEX api_behaviour_diffs_source_idx
  ON api_behaviour_diffs (source_baseline_id);

COMMENT ON TABLE api_behaviour_diffs IS
  'Per-pair (source_baseline, target_baseline) diff header. System-of-record for the deterministic JSON-shape diff computed by api-migration-validation-service. CASCADE on source-deletion removes the diff + its items; the target baseline survives unmoored (per Spec #4 ON DELETE SET NULL on paired_with_baseline_id).';
COMMENT ON COLUMN api_behaviour_diffs.status IS
  'Lifecycle. Valid values: computing (runner in flight or just-created) | completed (summary counts populated) | failed (error_message populated). Validated at service layer.';
COMMENT ON COLUMN api_behaviour_diffs.matched_count IS
  'Count of paired (source, target) items classified as status_match + body_match. Boxed Integer in DTO so PATCH preserves null.';
COMMENT ON COLUMN api_behaviour_diffs.status_drift_count IS
  'Count of paired items where source_response_status != target_response_status. Boxed Integer in DTO so PATCH preserves null.';
COMMENT ON COLUMN api_behaviour_diffs.body_shape_drift_count IS
  'Count of paired items classified as body_shape_drift (key sets differ OR leaf type changes). Shape wins over value if any key/type drift exists.';
COMMENT ON COLUMN api_behaviour_diffs.body_value_drift_count IS
  'Count of paired items classified as body_value_drift (same shape, different leaf values). Informational, not a defect.';
COMMENT ON COLUMN api_behaviour_diffs.source_only_count IS
  'Count of source items with no paired target (notes carry the reason: mutating_skipped | transport_failure | no_paired_target).';
COMMENT ON COLUMN api_behaviour_diffs.target_only_count IS
  'Count of target items with no paired source. Forward-compat -- v1 should not produce this since replay is source-driven.';
