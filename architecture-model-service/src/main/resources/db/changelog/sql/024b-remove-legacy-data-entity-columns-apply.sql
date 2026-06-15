-- ============================================================================
-- Migration 024b: Remove Legacy Data Entity Columns - Schema Modifications
-- ============================================================================
-- This migration finalizes the Data Entity Point migration by:
-- 1. Enforcing NOT NULL constraints on point-id columns
-- 2. Dropping legacy constraints from logical_data_entity_relationships
-- 3. Dropping legacy columns from logical_data_entity_relationships
-- 4. Dropping legacy FK constraint from data_movements
-- 5. Dropping legacy column from data_movements
--
-- PREREQUISITES:
-- - Migration 024a precondition checks must have passed
-- - All point-id columns must be populated (no NULL values)
--
-- Spec: Remove Legacy Data Entity Relationship Columns
-- ============================================================================

-- ============================================================================
-- STEP 1: Add NOT NULL constraints to point-id columns
-- ============================================================================
-- These columns are now the canonical references and must always be populated

ALTER TABLE logical_data_entity_relationships
ALTER COLUMN from_data_entity_point_id SET NOT NULL;

ALTER TABLE logical_data_entity_relationships
ALTER COLUMN to_data_entity_point_id SET NOT NULL;

ALTER TABLE data_movements
ALTER COLUMN data_entity_point_id SET NOT NULL;

-- ============================================================================
-- STEP 2: Drop legacy pairwise constraints from logical_data_entity_relationships
-- These constraints enforced that from_ref_kind/from_ref_id and to_ref_kind/to_ref_id
-- were either both set or both null. They are no longer needed.
-- ============================================================================

ALTER TABLE logical_data_entity_relationships
DROP CONSTRAINT IF EXISTS chk_from_ref_pairwise;

ALTER TABLE logical_data_entity_relationships
DROP CONSTRAINT IF EXISTS chk_to_ref_pairwise;

-- ============================================================================
-- STEP 3: Drop legacy enum constraints from logical_data_entity_relationships
-- These constraints enforced valid values for from_ref_kind and to_ref_kind.
-- ============================================================================

ALTER TABLE logical_data_entity_relationships
DROP CONSTRAINT IF EXISTS chk_from_ref_kind_enum;

ALTER TABLE logical_data_entity_relationships
DROP CONSTRAINT IF EXISTS chk_to_ref_kind_enum;

-- ============================================================================
-- STEP 4: Drop legacy columns from logical_data_entity_relationships
-- ============================================================================
-- Columns being dropped: from_ref_kind, from_ref_id, to_ref_kind, to_ref_id

ALTER TABLE logical_data_entity_relationships
DROP COLUMN IF EXISTS from_ref_kind;

ALTER TABLE logical_data_entity_relationships
DROP COLUMN IF EXISTS from_ref_id;

ALTER TABLE logical_data_entity_relationships
DROP COLUMN IF EXISTS to_ref_kind;

ALTER TABLE logical_data_entity_relationships
DROP COLUMN IF EXISTS to_ref_id;

-- ============================================================================
-- STEP 5: Drop legacy FK constraint from data_movements
-- ============================================================================
-- This FK referenced logical_data_entities.id via the data_entity_id column

ALTER TABLE data_movements
DROP CONSTRAINT IF EXISTS fk_data_movements_entity;

-- ============================================================================
-- STEP 6: Drop legacy column from data_movements
-- ============================================================================

ALTER TABLE data_movements
DROP COLUMN IF EXISTS data_entity_id;
