-- 128-api-behaviour-capture-sessions.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Root table for API behaviour capture sessions. Each row tracks one configured /
-- in-flight / completed run of the LLM-guided capture loop against a single
-- non-prod current-state API.
--
-- Status lifecycle (validated at the service layer):
--   draft      -> wizard step 1-4, secrets not yet supplied
--   configured -> wizard committed, secrets in service memory, ready to start
--   running    -> orchestrator executing scenarios
--   completed  -> all scenarios attempted, terminal
--   failed     -> aborted (e.g. secrets_lost_during_run), terminal
--   cancelled  -> user-cancelled, terminal
--
-- Secrets policy (see spec): plaintext auth credentials and DB passwords are
-- NEVER persisted here. The *_redacted_json columns hold only structural shape
-- (auth_type, header names with values omitted, base URL, db host/port/db,
-- schema, username). Plaintext lives in the new service's in-memory
-- `secretsStore` only while status is `configured` or `running`; purged on
-- terminal status. Restart loses secrets — UI re-prompt or marks `running`
-- sessions `failed` with `error_message='secrets_lost_during_run'`.
--
-- Per project memory (feedback_liquibase_immutable_changesets): applied
-- changesets are immutable. This is a NEW changeset only; changesets <= 127
-- are not edited.

CREATE TABLE api_behaviour_capture_sessions (
  id                              UUID PRIMARY KEY,
  project_id                      UUID NOT NULL,
  architecture_id                 UUID NOT NULL,
  name                            TEXT,
  status                          TEXT NOT NULL DEFAULT 'draft',
  environment_name                TEXT,
  api_base_url                    TEXT,
  auth_type                       TEXT,
  auth_config_redacted_json       JSONB,
  default_headers_redacted_json   JSONB,
  oas_spec_refs_json              JSONB,
  db_config_redacted_json         JSONB,
  mutating_calls_confirmed        BOOLEAN NOT NULL DEFAULT FALSE,
  started_at                      TIMESTAMPTZ,
  completed_at                    TIMESTAMPTZ,
  error_message                   TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_capture_session_project
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_capture_session_proj_arch_status
  ON api_behaviour_capture_sessions (project_id, architecture_id, status);

COMMENT ON TABLE api_behaviour_capture_sessions IS
  'Root table for the API behaviour capture loop. One row per configured / in-flight / terminal run against a non-prod current-state API. Secrets never persisted -- redacted JSONB only. Spec: API Behaviour Baseline Capture Service (2026-05-15).';
COMMENT ON COLUMN api_behaviour_capture_sessions.status IS
  'Lifecycle. Valid values: draft (wizard in progress), configured (secrets bundle held in-memory, ready to start), running (orchestrator executing), completed (terminal -- all scenarios attempted), failed (terminal -- aborted, see error_message), cancelled (terminal -- user-cancelled).';
COMMENT ON COLUMN api_behaviour_capture_sessions.auth_config_redacted_json IS
  'Auth shape with secrets stripped. Plaintext credentials live only in the new service in-memory secretsStore while status is configured or running.';
COMMENT ON COLUMN api_behaviour_capture_sessions.default_headers_redacted_json IS
  'Default request headers with secret values redacted (header names retained, values stripped to placeholder).';
COMMENT ON COLUMN api_behaviour_capture_sessions.oas_spec_refs_json IS
  'List of OAS source refs: existing Interface ids selected in step 1 and/or ad-hoc upload metadata. Raw OAS bytes are NOT persisted here.';
COMMENT ON COLUMN api_behaviour_capture_sessions.db_config_redacted_json IS
  'Optional DB sampling config (host/port/db/schema/username + dbType + allowlists). Password NEVER persisted; lives in secretsStore only.';
COMMENT ON COLUMN api_behaviour_capture_sessions.mutating_calls_confirmed IS
  'Per-session confirmation that mutating verbs (PUT/POST/PATCH/DELETE) are allowed. Toggleable in wizard while status is draft; locked once status moves to configured.';
COMMENT ON COLUMN api_behaviour_capture_sessions.error_message IS
  'Terminal-failure detail. Notable value: secrets_lost_during_run (set by startup reconciliation when a session was running at process restart).';
