-- 132-api-behaviour-diagnostics.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Per-session diagnostic notes emitted by the orchestrator and tools. Useful
-- for debugging which scenarios failed, why an endpoint was skipped, why the
-- LLM loop hit its hard limit, etc.
--
-- diagnostic_type valid values (validated at service layer):
--   failed_request | auth_failure | db_sample_failure | llm_generation_failure |
--   redaction_warning | endpoint_skipped | retry_exhausted
--
-- operation_id and scenario_id are nullable: a diagnostic may apply to the
-- whole session (e.g. auth_failure on the test-api-connection probe) and not
-- be tied to a specific operation/scenario.
--
-- ON DELETE CASCADE on session_id.
--
-- NEW changeset only -- never edit applied changesets (<= 131).

CREATE TABLE api_behaviour_diagnostics (
  id                UUID PRIMARY KEY,
  session_id        UUID NOT NULL,
  operation_id      UUID,
  scenario_id       UUID,
  diagnostic_type   TEXT NOT NULL,
  message           TEXT NOT NULL,
  detail_json       JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_diagnostic_session
    FOREIGN KEY (session_id) REFERENCES api_behaviour_capture_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_diagnostic_session
  ON api_behaviour_diagnostics (session_id);

COMMENT ON TABLE api_behaviour_diagnostics IS
  'Per-session diagnostic notes from orchestrator and tools. ON DELETE CASCADE on session_id.';
COMMENT ON COLUMN api_behaviour_diagnostics.diagnostic_type IS
  'Valid values: failed_request, auth_failure, db_sample_failure, llm_generation_failure, redaction_warning, endpoint_skipped, retry_exhausted.';
COMMENT ON COLUMN api_behaviour_diagnostics.detail_json IS
  'Optional structured detail bag (e.g. response status, error code, llm round count). Must be pre-redacted.';
