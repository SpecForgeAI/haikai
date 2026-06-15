-- ============================================================================
-- Migration 016: Application Point Targeting
-- Spec: Expand Application Points to Reference Service/Class/Method
--
-- Adds target_type and target_ref_id columns to application_points table
-- to enable precise targeting of Service, Class, or Method entities.
-- ============================================================================

-- Add target_type column (VARCHAR(16) to hold SERVICE, CLASS, or METHOD)
ALTER TABLE application_points ADD COLUMN target_type VARCHAR(16);

-- Add target_ref_id column (VARCHAR(255) to hold the referenced entity ID)
ALTER TABLE application_points ADD COLUMN target_ref_id VARCHAR(255);

-- Add check constraint to ensure target_type is one of the valid values
ALTER TABLE application_points ADD CONSTRAINT chk_application_point_target_type
    CHECK (target_type IS NULL OR target_type IN ('SERVICE', 'CLASS', 'METHOD'));

-- Add index on target_ref_id for query performance
CREATE INDEX idx_application_points_target_ref_id ON application_points(target_ref_id);

-- ============================================================================
-- Data Migration: Backward Compatibility
-- Set existing rows to target_type='SERVICE' and copy service_id to target_ref_id
-- ============================================================================

-- Update existing rows with service_id to use SERVICE as target_type
UPDATE application_points
SET target_type = 'SERVICE',
    target_ref_id = service_id
WHERE service_id IS NOT NULL AND service_id != '';

-- For rows without service_id, leave target_type and target_ref_id as NULL
-- This allows backward compatibility with existing data
