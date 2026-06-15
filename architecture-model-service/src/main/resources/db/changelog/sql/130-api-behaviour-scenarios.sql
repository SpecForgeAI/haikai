-- 130-api-behaviour-scenarios.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- Per-operation scenarios proposed by the LLM (or seeded from OAS examples /
-- DB samples / user edits). Each scenario describes a single intended request
-- shape; the captures table records actual execution attempts against it.
--
-- scenario_type valid values (validated at service layer):
--   happy_path | not_found | validation_error | empty_result |
--   boundary_value | auth_error | business_edge_case | generated_candidate
--
-- generation_source valid values (validated at service layer):
--   oas_example | db_sample | llm_generated | llm_refined | user_edited
--
-- status valid values (validated at service layer):
--   draft | executed_success | executed_error | accepted | rejected | needs_review
--
-- ON DELETE CASCADE on session_id ensures scenarios disappear with the parent
-- session. operation_id is a logical reference to api_behaviour_operations.id;
-- the parent session FK alone provides the cascade -- a separate operation FK
-- with CASCADE would create an ambiguous deletion path.
--
-- NEW changeset only -- never edit applied changesets (<= 129).

CREATE TABLE api_behaviour_scenarios (
  id                              UUID PRIMARY KEY,
  session_id                      UUID NOT NULL,
  operation_id                    UUID NOT NULL,
  scenario_name                   TEXT NOT NULL,
  scenario_type                   TEXT NOT NULL DEFAULT 'happy_path',
  status                          TEXT NOT NULL DEFAULT 'draft',
  generation_source               TEXT NOT NULL DEFAULT 'llm_generated',
  request_method                  TEXT NOT NULL,
  request_path                    TEXT NOT NULL,
  request_query_json              JSONB,
  request_headers_redacted_json   JSONB,
  request_body_json               JSONB,
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_scenario_session
    FOREIGN KEY (session_id) REFERENCES api_behaviour_capture_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_behaviour_scenario_session
  ON api_behaviour_scenarios (session_id);
CREATE INDEX idx_api_behaviour_scenario_operation
  ON api_behaviour_scenarios (operation_id);

COMMENT ON TABLE api_behaviour_scenarios IS
  'Per-operation scenarios proposed by the LLM or seeded from OAS examples / DB samples / user edits. ON DELETE CASCADE on session_id.';
COMMENT ON COLUMN api_behaviour_scenarios.scenario_type IS
  'Categorical hint for LLM and reviewer. Valid values: happy_path, not_found, validation_error, empty_result, boundary_value, auth_error, business_edge_case, generated_candidate.';
COMMENT ON COLUMN api_behaviour_scenarios.status IS
  'Lifecycle: draft (proposed, not executed), executed_success / executed_error (after capture loop), accepted / rejected / needs_review (after Test Engineer review).';
COMMENT ON COLUMN api_behaviour_scenarios.generation_source IS
  'Provenance: oas_example, db_sample, llm_generated, llm_refined, user_edited.';
COMMENT ON COLUMN api_behaviour_scenarios.request_headers_redacted_json IS
  'Header set with secret values redacted -- header NAMES retained, values stripped.';
