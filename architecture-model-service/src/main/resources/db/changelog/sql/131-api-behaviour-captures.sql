-- 131-api-behaviour-captures.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Per-attempt request/response capture rows. The execute_http_request tool
-- writes one row per attempt (up to 3 retries per scenario per spec). Reviewer
-- accept/reject toggles `accepted`. Successful accepted captures become the
-- evidence base for saved baselines.
--
-- All persisted JSON columns are pre-redacted by the new service's
-- `src/services/redactor.ts` -- secret values must never appear in this table.
--
-- Numeric columns (attempt_number, response_status, duration_ms) are nullable
-- where the request never completed. The Java DTOs map them to BOXED Integer
-- to preserve null through PATCH (see project_primitive_double_dto_overwrite.md).
--
-- ON DELETE CASCADE on session_id keeps the cascade tree from the session root;
-- scenario_id and operation_id are logical references only (cascade comes via
-- session).
--
-- NEW changeset only -- never edit applied changesets (<= 130).

CREATE TABLE api_behaviour_captures (
  id                              UUID PRIMARY KEY,
  session_id                      UUID NOT NULL,
  scenario_id                     UUID NOT NULL,
  operation_id                    UUID NOT NULL,
  attempt_number                  INT NOT NULL DEFAULT 1,
  request_method                  TEXT NOT NULL,
  request_url_redacted            TEXT NOT NULL,
  request_path                    TEXT NOT NULL,
  request_query_json              JSONB,
  request_headers_redacted_json   JSONB,
  request_body_json               JSONB,
  response_status                 INT,
  response_headers_redacted_json  JSONB,
  response_body_json              JSONB,
  duration_ms                     INT,
  error_type                      TEXT,
  error_message                   TEXT,
  captured_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted                        BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_at                     TIMESTAMPTZ,
  reviewer_notes                  TEXT,
  CONSTRAINT fk_api_behaviour_capture_session
    FOREIGN KEY (session_id) REFERENCES api_behaviour_capture_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_capture_session
  ON api_behaviour_captures (session_id);
CREATE INDEX idx_api_behaviour_capture_scenario
  ON api_behaviour_captures (scenario_id);
CREATE INDEX idx_api_behaviour_capture_operation
  ON api_behaviour_captures (operation_id);

COMMENT ON TABLE api_behaviour_captures IS
  'Per-attempt request/response captures. Up to 3 retries per scenario. All JSON columns pre-redacted by the new service. Reviewer accept/reject toggles `accepted`.';
COMMENT ON COLUMN api_behaviour_captures.attempt_number IS
  '1-indexed attempt counter (1, 2, 3 max per scenario per spec).';
COMMENT ON COLUMN api_behaviour_captures.request_url_redacted IS
  'Fully-resolved request URL with any token/secret query params redacted.';
COMMENT ON COLUMN api_behaviour_captures.error_type IS
  'Optional taxonomy: timeout, connection_refused, http_error, redaction_warning, etc.';
COMMENT ON COLUMN api_behaviour_captures.accepted IS
  'Reviewer flag. Only accepted captures are eligible to land in baseline_items on save-as-baseline.';
