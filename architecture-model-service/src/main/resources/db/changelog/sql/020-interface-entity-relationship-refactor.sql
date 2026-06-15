-- ============================================================================
-- Migration: Interface Entity Relationship Refactor
-- Spec 2026-01-11: Interface Entity Relationship Refactor
--
-- Changes:
-- 1. Add data_entity_point_id column to interface_logical_entities
-- 2. Migrate existing logical_entity_id values to data_entity_point_id format
-- 3. Drop the legacy logical_entity_id column
--
-- The dataEntityPointId uses the same format as DataMovements:
-- - dep_log_<entityId> for logical entities
-- - dep_phy_<entityId> for physical entities
--
-- Backward compatibility:
-- - Existing logical_entity_id values are migrated to dep_log_<entityId> format
-- ============================================================================

-- Step 1: Add the new data_entity_point_id column (nullable initially for migration)
ALTER TABLE interface_logical_entities
ADD COLUMN IF NOT EXISTS data_entity_point_id VARCHAR(255);

-- Step 2: Migrate existing logical_entity_id to data_entity_point_id format
-- Format: dep_log_<logical_entity_id>
UPDATE interface_logical_entities
SET data_entity_point_id = CONCAT('dep_log_', logical_entity_id)
WHERE data_entity_point_id IS NULL AND logical_entity_id IS NOT NULL;

-- Step 3: Set data_entity_point_id to NOT NULL after migration
ALTER TABLE interface_logical_entities
ALTER COLUMN data_entity_point_id SET NOT NULL;

-- Step 4: Drop the legacy logical_entity_id column
ALTER TABLE interface_logical_entities
DROP COLUMN IF EXISTS logical_entity_id;

-- Add comment documenting the change
COMMENT ON COLUMN interface_logical_entities.data_entity_point_id IS
'Data Entity Point ID for unified Logical/Physical entity selection. Format: dep_log_<entityId> or dep_phy_<entityId>. Spec 2026-01-11.';
