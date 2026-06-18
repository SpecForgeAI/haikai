-- 189-capture-coverage-summary.sql
-- Spec: Oracle Coverage Scoring (2026-06-17) -- Task Group 1 (AMS field).
--
-- Adds ONE new nullable JSONB column to api_behaviour_capture_sessions holding
-- the whole coverage summary as plain JSON. The summary measures how thoroughly
-- each capture session's baseline pins the behaviour it set out to capture: the
-- single-source coverage scorer (in api-migration-validation-service's
-- captureSessionOrchestrator.ts) consumes the EXACT GeneratedScenario[] emitted
-- by defaultScenarioSet (the rubric) and the EXACT selectCanonicalCapture
-- decision, so generation and scoring cannot drift. It is written ONCE on the
-- existing completion PATCH (patchCaptureSession at the end of
-- orchestrateCaptureSession), beside scenarios_attempted/completed/errored.
--
--   api_behaviour_capture_sessions (1 new nullable column):
--     - coverage_summary_json  JSONB NULL -- the whole coverage summary shaped
--       { overall_score, dimensions_total, dimensions_achieved,
--         per_endpoint: [{ operation_id, method, path, score,
--           dimensions: [{ name, type, expected_status, achieved,
--             canonical_capture_id|null, reason|null }] }],
--         auth_coverage: { achieved, representative_operation_id|null,
--           probes: [{ name, expected, achieved, observed_status|null,
--             reason|null }] } }.
--       Snake_case wire (AMS default -- NO @CamelCaseWire). Map<String,Object> /
--       @Type(JsonType) on the Java side, mirroring the sibling oas_spec_refs_json
--       / auth_config_redacted_json JSONB columns on this entity. Designed so a
--       later spec (baseline integrity & provenance, Spec C) can read
--       overall_score + per-endpoint dimensions/reasons off the session and stamp
--       it onto the immutable baseline.
--       NULL = coverage NOT recorded (legacy / pre-fix sessions). The frontend
--       renders a null/absent summary gracefully as "coverage not recorded".
--
-- New nullable column, reference type, NO backfill: existing capture session
-- rows are untouched and read back with coverage_summary_json null. No
-- @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 188
-- (188-capture-volatile-paths.sql) is the highest on disk at build time; this
-- registers AFTER it in db.changelog-master.yaml. Column-only ALTER -> the
-- not-columnExists precondition idiom (mirrors 187 / 188).

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN coverage_summary_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.coverage_summary_json IS
  'Coverage summary measuring how thoroughly the capture session pins the behaviour it set out to capture: { overall_score, dimensions_total, dimensions_achieved, per_endpoint: [{ operation_id, method, path, score, dimensions: [{ name, type, expected_status, achieved, canonical_capture_id|null, reason|null }] }], auth_coverage: { achieved, representative_operation_id|null, probes: [{ name, expected, achieved, observed_status|null, reason|null }] } }. Written ONCE on the completion PATCH by the single-source scorer (api-migration-validation-service captureSessionOrchestrator) which reads the same GeneratedScenario[] as generation so the rubric cannot drift. Snake_case wire (AMS default). NULL = coverage not recorded (legacy / pre-fix sessions). Spec: Oracle Coverage Scoring (2026-06-17) -- Task Group 1.';
