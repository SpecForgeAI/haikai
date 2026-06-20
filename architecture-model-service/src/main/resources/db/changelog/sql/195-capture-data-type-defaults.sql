-- 195-capture-data-type-defaults.sql
-- Spec: Capture data-type format defaults (2026-06-20) -- Task Group 1 (AMS field).
--
-- Adds ONE new nullable JSONB column to api_behaviour_capture_sessions holding
-- the operator's per-data-type format defaults as a plain JSON map. The capture
-- wizard's new "Data-type formats" step pre-fills a Col-4 default per discovered
-- data type (date, datetime, decimal, numeric_id, ...) from real code/contract
-- evidence; the operator confirms/overrides it; the confirmed map is persisted
-- here and fed to the capture LLM (in api-migration-validation-service's
-- captureSessionOrchestrator.ts) as a SEPARATE "try-this-first" prompt block
-- (NOT an OAS override) so it stops mis-formatting values and burning attempts.
--
--   api_behaviour_capture_sessions (1 new nullable column):
--     - data_type_defaults_json  JSONB NULL -- a plain map category -> format
--       string, e.g. { "date": "dd-MMM-yyyy", "datetime": "...", "enum": null }.
--       Semantics: a NON-NULL string value = the operator default for that data
--       type; a NULL value = an explicit "no default" (the LLM gets NO nudge for
--       that data type -> it falls back to the contract / its own judgment); an
--       ABSENT key = untouched / never-decided. The map VALUES are deliberately
--       nullable and a null value is MEANINGFUL -- it MUST survive the JSONB
--       round-trip (it is NOT dropped or coerced to a string).
--       Snake_case wire (AMS default -- NO @CamelCaseWire). Map<String,String> /
--       @Type(JsonType) on the Java side, mirroring the sibling
--       coverage_summary_json / oas_spec_refs_json / auth_config_redacted_json
--       JSONB columns on this entity. Per-session, per-data-type only -- NO
--       per-endpoint / per-field override in v1.
--       NULL = no defaults recorded (the valid empty state; e.g. the step was
--       auto-skipped because no classifiable data types were discovered).
--
-- New nullable column, reference type, NO backfill: existing capture session
-- rows are untouched and read back with data_type_defaults_json null. No
-- @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 194
-- (194-endpoint-request-contract.sql) is the highest on disk at build time; this
-- registers AFTER it in db.changelog-master.yaml. Column-only ALTER -> the
-- not-columnExists precondition idiom (mirrors 189 / 194).

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN data_type_defaults_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.data_type_defaults_json IS
  'Operator-confirmed per-data-type format defaults for the capture run: a plain map category -> format string, e.g. { "date": "dd-MMM-yyyy", "enum": null }. A non-null string = the operator default for that data type; a null value = an explicit "no default" (the capture LLM gets no nudge for that type); an absent key = untouched. The map values are deliberately nullable and a null value is meaningful (it survives the round-trip). Confirmed in the capture wizard "Data-type formats" step and fed to the capture LLM (api-migration-validation-service captureSessionOrchestrator) as a separate prompt block, NOT an OAS override. Per-session, per-data-type only. Snake_case wire (AMS default). NULL = no defaults recorded (valid empty state; no backfill). Spec: Capture data-type format defaults (2026-06-20) -- Task Group 1.';
