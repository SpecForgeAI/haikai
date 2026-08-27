-- 227-capture-tuning.sql
-- Spec: state-discipline remediation Item #5 / S-1 (2026-08-27) -- per-session
-- capture tuning.
--
-- Adds ONE new nullable JSONB column to api_behaviour_capture_sessions holding
-- operator overrides for capture knobs the wizard's "Capture tuning" section
-- collects: { llm_tool_call_timeout_ms, max_response_body_bytes }. The
-- validation service reads it at session start and falls back to its env
-- defaults for any absent key. NULL = no tuning recorded (legacy sessions,
-- untouched semantics). Snake_case wire (AMS default -- NO @CamelCaseWire).

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN capture_tuning_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.capture_tuning_json IS
  'Per-session capture tuning overrides collected by the wizard (state-discipline remediation Item #5/S-1, 2026-08-27): { llm_tool_call_timeout_ms, max_response_body_bytes }. NULL = use the validation service env defaults.';
