-- 134-api-behaviour-baseline-items.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Each row freezes one accepted (capture, operation, scenario) triple as part
-- of a saved baseline. Rather than referencing the live capture row, the
-- request/response bodies are copied into request_json/response_json so a
-- baseline remains a stable artefact even if the source session is later
-- deleted.
--
-- ON DELETE CASCADE on baseline_id ensures items vanish when a baseline is
-- deleted. capture_id, scenario_id, operation_id are logical references for
-- traceability only.
--
-- NEW changeset only -- never edit applied changesets (<= 133).

CREATE TABLE api_behaviour_baseline_items (
  id              UUID PRIMARY KEY,
  baseline_id     UUID NOT NULL,
  capture_id      UUID NOT NULL,
  operation_id    UUID NOT NULL,
  scenario_id     UUID NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  scenario_name   TEXT NOT NULL,
  request_json    JSONB NOT NULL,
  response_status INT NOT NULL,
  response_json   JSONB NOT NULL,
  business_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_baseline_item_baseline
    FOREIGN KEY (baseline_id) REFERENCES api_behaviour_baselines(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_baseline_item_baseline
  ON api_behaviour_baseline_items (baseline_id);

COMMENT ON TABLE api_behaviour_baseline_items IS
  'Per-baseline frozen capture rows. Request/response copied (not referenced) so the baseline is stable even if the source capture session is deleted. ON DELETE CASCADE on baseline_id.';
COMMENT ON COLUMN api_behaviour_baseline_items.request_json IS
  'Pre-redacted request body snapshot copied from the source capture row at save-time.';
COMMENT ON COLUMN api_behaviour_baseline_items.response_json IS
  'Pre-redacted response body snapshot copied from the source capture row at save-time.';
