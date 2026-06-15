-- 178-capture-session-scope-and-coverage-override.sql
-- Spec: Model-Seeded Capture Inventory -- Guaranteed Operation-Capture
-- Completeness (2026-06-11) -- Task Group 1
--
-- Makes the committed architecture-model endpoint set the
-- enumerator-of-record for capture sessions:
--
--   api_behaviour_capture_sessions:
--     - scope_interface_ids_json JSONB NULL -- the persisted interface scope
--       (array of Interface ids selected in wizard Step 1 / parse-oas).
--       NULL = whole-architecture scope (ad-hoc upload sessions, legacy
--       sessions) -- nothing silently absent.
--     - coverage_override_justification TEXT NULL -- the user-supplied
--       justification persisted when Start is explicitly overridden while
--       in-scope endpoints are unaccounted.
--     - coverage_override_unaccounted_count INTEGER NULL -- the unaccounted
--       endpoint count AT OVERRIDE TIME (audit record; boxed Integer on the
--       Java side per project_primitive_double_dto_overwrite.md).
--     - coverage_override_at TIMESTAMPTZ NULL -- override timestamp.
--
--   api_behaviour_operations:
--     - exclusion_reason TEXT NULL -- the reason recorded when an in-scope
--       committed endpoint is explicitly EXCLUDED from capture (the row is
--       persisted with included = false + this reason; persistence IS the
--       accounting record -- an excluded-with-reason row still ACCOUNTS for
--       its endpoint in the reconciliation).
--
-- All columns nullable, no backfill: completed/active sessions and existing
-- baselines are untouched and render normally with the new fields null (no
-- retroactive gating -- accepted D3/D8).
--
-- NEW changeset only -- never edit applied changesets (<= 177) per
-- feedback_liquibase_immutable_changesets.md.

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN scope_interface_ids_json JSONB NULL;
ALTER TABLE api_behaviour_capture_sessions ADD COLUMN coverage_override_justification TEXT NULL;
ALTER TABLE api_behaviour_capture_sessions ADD COLUMN coverage_override_unaccounted_count INTEGER NULL;
ALTER TABLE api_behaviour_capture_sessions ADD COLUMN coverage_override_at TIMESTAMPTZ NULL;

ALTER TABLE api_behaviour_operations ADD COLUMN exclusion_reason TEXT NULL;

COMMENT ON COLUMN api_behaviour_capture_sessions.scope_interface_ids_json IS
  'Persisted interface scope for inventory reconciliation (JSON array of Interface ids). NULL = whole-architecture scope. Written by parse-oas (interface-selected branch) and by the reconciliation endpoint when persist_scope=true. Spec: Model-Seeded Capture Inventory (2026-06-11).';

COMMENT ON COLUMN api_behaviour_capture_sessions.coverage_override_justification IS
  'Justification persisted when session Start is explicitly overridden while in-scope committed endpoints are unaccounted. NULL = no override. Spec: Model-Seeded Capture Inventory (2026-06-11).';

COMMENT ON COLUMN api_behaviour_capture_sessions.coverage_override_unaccounted_count IS
  'Unaccounted in-scope endpoint count at override time (audit). NULL = no override. Boxed Integer on the Java side -- PATCH-mutable numerics must never be primitive.';

COMMENT ON COLUMN api_behaviour_capture_sessions.coverage_override_at IS
  'Timestamp of the Start coverage override. NULL = no override.';

COMMENT ON COLUMN api_behaviour_operations.exclusion_reason IS
  'Reason an in-scope committed endpoint was explicitly EXCLUDED from capture (row persisted with included=false + this reason). An excluded-with-reason row still ACCOUNTS for its endpoint in inventory reconciliation. Spec: Model-Seeded Capture Inventory (2026-06-11).';
