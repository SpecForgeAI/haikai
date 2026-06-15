-- ============================================================================
-- Spec 2026-01-11: Data Movement Interface Schema Extension
-- ============================================================================
-- This migration adds new columns to the data_movements table:
-- - interface_with_schema_id: FK to interfaces.id (optional, XOR with data_entity_point_id)
-- - bi_directional: Boolean flag for bi-directional movement
-- - Makes data_entity_point_id nullable (was NOT NULL)
-- ============================================================================

-- Make data_entity_point_id nullable (XOR with interface_with_schema_id)
ALTER TABLE data_movements ALTER COLUMN data_entity_point_id DROP NOT NULL;

-- Add interface_with_schema_id column
ALTER TABLE data_movements ADD COLUMN IF NOT EXISTS interface_with_schema_id VARCHAR(255);

-- Add bi_directional column with default false
ALTER TABLE data_movements ADD COLUMN IF NOT EXISTS bi_directional BOOLEAN DEFAULT FALSE;

-- Add index for interface_with_schema_id FK lookups
CREATE INDEX IF NOT EXISTS idx_data_movements_interface_with_schema_id
    ON data_movements (interface_with_schema_id);

-- Add comment for documentation
COMMENT ON COLUMN data_movements.interface_with_schema_id IS 'FK to interfaces.id. XOR with data_entity_point_id - exactly one must be set.';
COMMENT ON COLUMN data_movements.bi_directional IS 'Flag indicating if data flows in both directions between source and target.';
COMMENT ON COLUMN data_movements.data_entity_point_id IS 'FK to data_entity_points.id. XOR with interface_with_schema_id - exactly one must be set.';
