-- ============================================================================
-- Library Backend Foundation: relax application_points.target_type CHECK
-- Spec: 2026-05-05-library-backend-foundation
--
-- DROPS the existing CHECK constraint chk_application_point_target_type
-- (defined in changeset 016 as IN ('SERVICE','CLASS','METHOD')) and re-creates
-- it to admit the new LIBRARY value. Existing rows are unaffected; existing
-- target types continue to work unchanged.
--
-- The constraint name is preserved verbatim to match changeset 016. Idempotency
-- is provided at the changeset level by the master changelog preCondition (a
-- check against the constraint definition's value list).
-- ============================================================================

ALTER TABLE application_points
    DROP CONSTRAINT chk_application_point_target_type;

ALTER TABLE application_points
    ADD CONSTRAINT chk_application_point_target_type
    CHECK (target_type IS NULL OR target_type IN ('SERVICE', 'CLASS', 'METHOD', 'LIBRARY'));
