-- ============================================================================
-- Data Entity Point FK Columns Migration
-- ============================================================================
-- This migration adds new foreign key columns to logical_data_entity_relationships
-- and data_movements tables that reference data_entity_points(id).
--
-- These columns support dual-write/dual-read compatibility, allowing both legacy
-- fields (from_ref_kind/from_ref_id, to_ref_kind/to_ref_id, data_entity_id) and
-- new point-id fields to coexist during transition.
--
-- ID Generation Convention (consistent with DataEntityPointEnsureService):
-- - Logical entities: "dep_log_" + logicalEntityId
-- - Physical entities: "dep_phy_" + physicalEntityId
--
-- Spec: Add Data Entity Point FK Columns to Logical ER and Data Movements
-- Task Group 1: Database Migrations for FK Columns
-- ============================================================================

-- ============================================================================
-- STEP 1: Add from_data_entity_point_id column to logical_data_entity_relationships
-- ============================================================================
-- Nullable column to support dual-write (existing rows will have NULL until backfilled)
-- References data_entity_points(id) for the "from" side of the relationship

ALTER TABLE logical_data_entity_relationships
ADD COLUMN from_data_entity_point_id TEXT;

ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT fk_lder_from_data_entity_point
FOREIGN KEY (from_data_entity_point_id) REFERENCES data_entity_points(id);

-- ============================================================================
-- STEP 2: Add to_data_entity_point_id column to logical_data_entity_relationships
-- ============================================================================
-- Nullable column to support dual-write (existing rows will have NULL until backfilled)
-- References data_entity_points(id) for the "to" side of the relationship

ALTER TABLE logical_data_entity_relationships
ADD COLUMN to_data_entity_point_id TEXT;

ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT fk_lder_to_data_entity_point
FOREIGN KEY (to_data_entity_point_id) REFERENCES data_entity_points(id);

-- ============================================================================
-- STEP 3: Add data_entity_point_id column to data_movements
-- ============================================================================
-- Nullable column to support dual-write (existing rows will have NULL until backfilled)
-- References data_entity_points(id) for the data entity being moved

ALTER TABLE data_movements
ADD COLUMN data_entity_point_id TEXT;

ALTER TABLE data_movements
ADD CONSTRAINT fk_dm_data_entity_point
FOREIGN KEY (data_entity_point_id) REFERENCES data_entity_points(id);

-- ============================================================================
-- STEP 4: Add indexes for query performance
-- ============================================================================
-- Indexes on the new FK columns to optimize joins and lookups

CREATE INDEX idx_lder_from_dep_id
ON logical_data_entity_relationships(from_data_entity_point_id);

CREATE INDEX idx_lder_to_dep_id
ON logical_data_entity_relationships(to_data_entity_point_id);

CREATE INDEX idx_dm_dep_id
ON data_movements(data_entity_point_id);
