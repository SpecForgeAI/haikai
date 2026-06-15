-- ============================================================================
-- Data Entity Point FK Columns Backfill Migration
-- ============================================================================
-- This migration backfills the new FK columns for existing rows that were created
-- before the dual-write logic was implemented.
--
-- The migration is idempotent - safe to run multiple times without causing errors
-- or creating duplicate updates (uses WHERE clause to skip already-populated rows).
--
-- ID Generation Convention (consistent with DataEntityPointEnsureService and
-- migration 021-data-entity-points-backfill):
-- - Logical entities: "dep_log_" + entityId
-- - Physical entities: "dep_phy_" + entityId
--
-- Prerequisites:
-- - Migration 020-data-entity-points must have created the data_entity_points table
-- - Migration 021-data-entity-points-backfill must have populated data_entity_points
-- - Migration 022-data-entity-point-fk-columns must have added the new columns
--
-- Spec: Add Data Entity Point FK Columns to Logical ER and Data Movements
-- Task Group 1: Database Migrations for FK Columns
-- ============================================================================

-- ============================================================================
-- BACKFILL logical_data_entity_relationships.from_data_entity_point_id
-- ============================================================================
-- For LOGICAL_ENTITY: set from_data_entity_point_id = 'dep_log_' || from_ref_id
-- For PHYSICAL_ENTITY: set from_data_entity_point_id = 'dep_phy_' || from_ref_id
-- Only update rows where from_data_entity_point_id IS NULL (idempotent)

-- Backfill from_data_entity_point_id for LOGICAL_ENTITY
UPDATE logical_data_entity_relationships
SET from_data_entity_point_id = 'dep_log_' || from_ref_id
WHERE from_ref_kind = 'LOGICAL_ENTITY'
  AND from_ref_id IS NOT NULL
  AND from_data_entity_point_id IS NULL;

-- Backfill from_data_entity_point_id for PHYSICAL_ENTITY
UPDATE logical_data_entity_relationships
SET from_data_entity_point_id = 'dep_phy_' || from_ref_id
WHERE from_ref_kind = 'PHYSICAL_ENTITY'
  AND from_ref_id IS NOT NULL
  AND from_data_entity_point_id IS NULL;

-- ============================================================================
-- BACKFILL logical_data_entity_relationships.to_data_entity_point_id
-- ============================================================================
-- For LOGICAL_ENTITY: set to_data_entity_point_id = 'dep_log_' || to_ref_id
-- For PHYSICAL_ENTITY: set to_data_entity_point_id = 'dep_phy_' || to_ref_id
-- Only update rows where to_data_entity_point_id IS NULL (idempotent)

-- Backfill to_data_entity_point_id for LOGICAL_ENTITY
UPDATE logical_data_entity_relationships
SET to_data_entity_point_id = 'dep_log_' || to_ref_id
WHERE to_ref_kind = 'LOGICAL_ENTITY'
  AND to_ref_id IS NOT NULL
  AND to_data_entity_point_id IS NULL;

-- Backfill to_data_entity_point_id for PHYSICAL_ENTITY
UPDATE logical_data_entity_relationships
SET to_data_entity_point_id = 'dep_phy_' || to_ref_id
WHERE to_ref_kind = 'PHYSICAL_ENTITY'
  AND to_ref_id IS NOT NULL
  AND to_data_entity_point_id IS NULL;

-- ============================================================================
-- BACKFILL data_movements.data_entity_point_id
-- ============================================================================
-- data_entity_id always references a logical entity (per existing schema design)
-- Set data_entity_point_id = 'dep_log_' || data_entity_id
-- Only update rows where data_entity_point_id IS NULL (idempotent)

UPDATE data_movements
SET data_entity_point_id = 'dep_log_' || data_entity_id
WHERE data_entity_id IS NOT NULL
  AND data_entity_point_id IS NULL;
