-- 159-api-behaviour-diff-items.sql
-- Spec: API Test Harness — Diff Engine (2026-05-25) -- Task Group 1
--
-- Per-scenario diff classification rows persisted by diffRunner.ts. Each row
-- captures one (method, path, scenario_name) comparison between the source
-- and target baselines.
--
-- Classification taxonomy (validated at service layer, no DB enum):
--
--   status_classification (NOT NULL):
--     * status_match     -- source/target response codes match
--     * status_drift     -- response codes differ (any 2xx/4xx/5xx mismatch)
--     * source_only      -- source has an item, target has none
--     * target_only      -- forward-compat; should not appear in v1
--
--   body_classification (NULL when source_only / target_only -- no pair):
--     * body_match          -- deep equality after wrapper unwrap
--     * body_shape_drift    -- key sets differ OR leaf type changes
--     * body_value_drift    -- same shape, different leaf values (info-only)
--
-- source_baseline_item_id / target_baseline_item_id are LOGICAL references
-- (no FK constraint). They point at api_behaviour_baseline_items but the
-- diff outlives item-level edits (a baseline item delete shouldn't cascade
-- into wiping the diff item -- the diff_item still reads as a historical
-- artefact). Leaving them as plain UUID columns avoids the cascade
-- complexity and matches the existing capture_id/operation_id soft-reference
-- pattern on api_behaviour_baseline_items.
--
-- body_diff_json: JSONB structure produced by jsonShapeComparator.ts. The
-- shape is a flat map keyed by JSON pointer ("/foo/bar/0/baz") with values
-- carrying the per-path classification (key_added | key_removed |
-- type_changed | value_changed) plus the differing source / target leaf
-- values. NULL when status_classification is source_only / target_only.
--
-- source_response_status / target_response_status are BOXED Integer in the
-- JPA entity / DTO so PATCH preserves null per
-- project_primitive_double_dto_overwrite.md (a missing JSON field must NOT
-- silently wipe to 0).
--
-- Foreign keys:
--   * diff_id → api_behaviour_diffs(id) ON DELETE CASCADE
-- The CASCADE on diff_id closes the cleanup loop: deleting a source baseline
-- CASCADEs to api_behaviour_diffs (changeset 158) which in turn CASCADEs
-- here. Recompute also uses an explicit deleteByDiffId() to wipe prior rows
-- before inserting new ones.
--
-- Indexes:
--   * (diff_id)              -- primary listing path for the Drift report tab
--   * (diff_id, method, path) -- secondary index for ordered retrieval
--
-- NEW changeset only -- never edit applied changesets (<= 158) per
-- feedback_liquibase_immutable_changesets.md.

CREATE TABLE api_behaviour_diff_items (
  id                            UUID PRIMARY KEY,
  diff_id                       UUID NOT NULL,
  method                        TEXT NOT NULL,
  path                          TEXT NOT NULL,
  scenario_name                 TEXT NOT NULL,
  source_baseline_item_id       UUID,
  target_baseline_item_id       UUID,
  status_classification         TEXT NOT NULL,
  body_classification           TEXT,
  source_response_status        INT,
  target_response_status        INT,
  body_diff_json                JSONB,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_diff_item_diff
    FOREIGN KEY (diff_id) REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE
);

CREATE INDEX api_behaviour_diff_items_diff_idx
  ON api_behaviour_diff_items (diff_id);

CREATE INDEX api_behaviour_diff_items_method_path_idx
  ON api_behaviour_diff_items (diff_id, method, path);

COMMENT ON TABLE api_behaviour_diff_items IS
  'Per-scenario diff row produced by jsonShapeComparator.ts. status_classification + body_classification carry the discrete buckets; body_diff_json carries the per-path annotation map. CASCADE off api_behaviour_diffs.id.';
COMMENT ON COLUMN api_behaviour_diff_items.status_classification IS
  'Discrete bucket. Valid values: status_match | status_drift | source_only | target_only. Validated at service layer.';
COMMENT ON COLUMN api_behaviour_diff_items.body_classification IS
  'Discrete bucket. Valid values: body_match | body_shape_drift | body_value_drift. NULL when status_classification is source_only / target_only (no pair to body-compare). Validated at service layer.';
COMMENT ON COLUMN api_behaviour_diff_items.source_baseline_item_id IS
  'Logical reference (no FK constraint) at api_behaviour_baseline_items. The diff outlives item-level edits; soft reference matches the existing capture_id/operation_id pattern.';
COMMENT ON COLUMN api_behaviour_diff_items.target_baseline_item_id IS
  'Logical reference (no FK constraint) at api_behaviour_baseline_items. See source_baseline_item_id.';
COMMENT ON COLUMN api_behaviour_diff_items.body_diff_json IS
  'Flat JSON-pointer-keyed map produced by jsonShapeComparator.ts. NULL when no pair (source_only / target_only).';
COMMENT ON COLUMN api_behaviour_diff_items.notes IS
  'Free-text reason carried on source_only / target_only rows. Common values: mutating_skipped | transport_failure | no_paired_target.';
