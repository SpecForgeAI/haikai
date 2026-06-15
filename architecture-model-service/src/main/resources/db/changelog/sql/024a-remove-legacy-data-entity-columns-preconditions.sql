-- ============================================================================
-- Migration 024a: Remove Legacy Data Entity Columns - Precondition Checks
-- ============================================================================
-- This migration contains precondition checks that verify all point-id columns
-- are populated before proceeding with schema modifications.
--
-- PRECONDITIONS:
-- - All point-id columns must be populated (no NULL values)
-- - Migration will fail fast with clear error if preconditions not met
--
-- Prerequisites:
-- - Migration 020-data-entity-points must have created the data_entity_points table
-- - Migration 021-data-entity-points-backfill must have populated data_entity_points
-- - Migration 022-data-entity-point-fk-columns must have added the new columns
-- - Migration 023-data-entity-point-fk-backfill must have backfilled the new columns
--
-- NOTE: Uses DO $$ ... END $$; and Liquibase endDelimiter $$; to avoid splitting
-- DO blocks at internal semicolons.
--
-- Spec: Remove Legacy Data Entity Relationship Columns
-- ============================================================================

-- ============================================================================
-- PRECONDITION CHECK 1: Verify no NULL from_data_entity_point_id values
-- ============================================================================
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM logical_data_entity_relationships
    WHERE from_data_entity_point_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION 'Migration precondition failed: % row(s) in logical_data_entity_relationships have NULL from_data_entity_point_id. Run backfill migration first.', null_count;
    END IF;
END $$;

-- ============================================================================
-- PRECONDITION CHECK 2: Verify no NULL to_data_entity_point_id values
-- ============================================================================
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM logical_data_entity_relationships
    WHERE to_data_entity_point_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION 'Migration precondition failed: % row(s) in logical_data_entity_relationships have NULL to_data_entity_point_id. Run backfill migration first.', null_count;
    END IF;
END $$;

-- ============================================================================
-- PRECONDITION CHECK 3: Verify no NULL data_entity_point_id values in data_movements
-- ============================================================================
DO $$
DECLARE
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM data_movements
    WHERE data_entity_point_id IS NULL;

    IF null_count > 0 THEN
        RAISE EXCEPTION 'Migration precondition failed: % row(s) in data_movements have NULL data_entity_point_id. Run backfill migration first.', null_count;
    END IF;
END $$;
