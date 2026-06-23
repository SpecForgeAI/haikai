-- 196-capture-behaviour-semantics-config.sql
-- Spec: Semantics-aware API Behaviour Baseline coverage (2026-06-23) -- Task
--       Group 4 (config-persistence seam, AMS additive field).
--
-- Adds ONE new nullable JSONB column to api_behaviour_capture_sessions holding
-- the operator's per-API response-semantics config as a structured JSON object.
-- The capture wizard's new "Response semantics" step lets the operator confirm
-- or override how a legacy (non-REST-conventional) API maps an observed HTTP
-- status + response body to a coverage bucket; the confirmed config is persisted
-- here and read by the validation service (api-migration-validation-service's
-- captureSessionOrchestrator.ts), which feeds it into classifyObservedBehaviour
-- so "covered" reflects this API's real contract instead of REST conventions.
--
--   api_behaviour_capture_sessions (1 new nullable column):
--     - behaviour_semantics_config_json  JSONB NULL -- a structured object
--       mirroring the validation service's ResponseSemanticsConfig: optional
--       statusBucketOverride (status -> bucket), notFoundMarkers /
--       badRequestMarkers (marker-vocabulary overrides), and a fiveXxIsBadInput
--       flag. ALL fields optional. A wholly-null column (or absent field) means
--       "use the built-in default vocabulary" -- the valid empty state.
--       Snake_case wire (AMS default -- NO @CamelCaseWire; TS clients are
--       snake_case). Map<String,Object> / @Type(JsonType) on the Java side,
--       mirroring the sibling data_type_defaults_json / coverage_summary_json /
--       oas_spec_refs_json JSONB columns on this entity. Per-session only.
--       NULL = no config recorded (the valid empty state; e.g. the step was
--       left at "(use built-in defaults)").
--
-- New nullable column, reference type, NO backfill, FORWARD-ONLY: existing
-- capture session rows are untouched and read back with
-- behaviour_semantics_config_json null. No @PrePersist defaulting needed --
-- null is the valid empty state ("built-in defaults").
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 195
-- (195-capture-data-type-defaults.sql) is the highest on disk at build time;
-- this registers AFTER it in db.changelog-master.yaml. Column-only ALTER -> the
-- not-columnExists precondition idiom (mirrors 189 / 194 / 195).

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN behaviour_semantics_config_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.behaviour_semantics_config_json IS
  'Operator-confirmed per-API response-semantics config for the capture run: a structured JSON object mirroring the validation service ResponseSemanticsConfig (optional statusBucketOverride, notFoundMarkers / badRequestMarkers vocabulary overrides, fiveXxIsBadInput flag). Steers how the capture scorer maps an observed status + response body to a coverage bucket for a legacy API that violates REST conventions. Confirmed in the capture wizard "Response semantics" step and read by the validation service (captureSessionOrchestrator), which feeds it into classifyObservedBehaviour. Per-session only. Snake_case wire (AMS default). NULL = no config recorded = use the built-in default vocabulary (valid empty state; forward-only, no backfill). Spec: Semantics-aware API Behaviour Baseline coverage (2026-06-23) -- Task Group 4.';
