-- 129-api-behaviour-operations.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Inventory of OAS operations parsed for a single capture session. Populated by
-- the new service's POST /capture-sessions/{id}/parse-oas action. Each row is
-- one HTTP method+path pair from the dereferenced OAS document(s).
--
-- Selection vs. execution gating:
--   included         -> user-toggle in wizard step 4 (defaults: TRUE for safe
--                       verbs, FALSE for mutating verbs when
--                       mutating_calls_confirmed = FALSE on the session).
--   safe_to_execute  -> server-set boolean: TRUE for GET/HEAD/OPTIONS, plus
--                       PUT/POST/PATCH/DELETE only if the parent session has
--                       mutating_calls_confirmed = TRUE.
--
-- The execute_http_request tool gates on (included = TRUE AND safe_to_execute = TRUE).
--
-- ON DELETE CASCADE on session_id ensures inventory is removed with the parent.
-- NEW changeset only -- never edit applied changesets (<= 128).

CREATE TABLE api_behaviour_operations (
  id                       UUID PRIMARY KEY,
  session_id               UUID NOT NULL,
  operation_id             TEXT,
  method                   TEXT NOT NULL,
  path                     TEXT NOT NULL,
  summary                  TEXT,
  description              TEXT,
  included                 BOOLEAN NOT NULL DEFAULT TRUE,
  safe_to_execute          BOOLEAN NOT NULL DEFAULT FALSE,
  request_schema_json      JSONB,
  response_schema_json     JSONB,
  oas_operation_json       JSONB NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_operation_session
    FOREIGN KEY (session_id) REFERENCES api_behaviour_capture_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_operation_session
  ON api_behaviour_operations (session_id);

COMMENT ON TABLE api_behaviour_operations IS
  'Per-session inventory of OAS operations. One row per HTTP method+path. Populated by parse-oas action. ON DELETE CASCADE on session_id.';
COMMENT ON COLUMN api_behaviour_operations.included IS
  'User toggle from wizard step 4. Defaults TRUE for safe verbs and for mutating verbs when the session''s mutating_calls_confirmed = TRUE; otherwise FALSE.';
COMMENT ON COLUMN api_behaviour_operations.safe_to_execute IS
  'Server-set guard. TRUE for GET/HEAD/OPTIONS and for PUT/POST/PATCH/DELETE only when the session''s mutating_calls_confirmed = TRUE. The execute_http_request tool ANDs this with included.';
COMMENT ON COLUMN api_behaviour_operations.oas_operation_json IS
  'The dereferenced OAS Operation Object verbatim (parameters, request body, responses, etc.).';
