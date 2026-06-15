-- ============================================================================
-- Task Group 1: Logical ER Meta-Model Upgrade
-- Upgrades logical_data_entity_relationships to support:
-- 1. UML-style relationship semantics (cardinality + relationship type enums)
-- 2. Polymorphic endpoints (LogicalEntity and/or PhysicalEntity)
-- ============================================================================

-- ============================================================================
-- STEP 1: Rename column relationship_type to cardinality
-- ============================================================================

ALTER TABLE logical_data_entity_relationships RENAME COLUMN relationship_type TO cardinality;

ALTER TABLE logical_data_entity_relationships ALTER COLUMN cardinality DROP NOT NULL;

-- ============================================================================
-- STEP 1b: Normalize legacy cardinality values
-- Maps various legacy formats to canonical enum strings
-- Unknown values become NULL to satisfy CHECK constraint
-- ============================================================================

UPDATE logical_data_entity_relationships
SET cardinality =
  CASE
    WHEN cardinality IS NULL THEN NULL
    WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_ONE','ONE-TO-ONE','ONE TO ONE','1:1','1-1','1..1') THEN 'ONE_TO_ONE'
    WHEN UPPER(TRIM(cardinality)) IN ('ONE_TO_MANY','ONE-TO-MANY','ONE TO MANY','1:M','1..*','1..N','ONE_TO_MANY ') THEN 'ONE_TO_MANY'
    WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_ONE','MANY-TO-ONE','MANY TO ONE','M:1','*..1','N..1') THEN 'MANY_TO_ONE'
    WHEN UPPER(TRIM(cardinality)) IN ('MANY_TO_MANY','MANY-TO-MANY','MANY TO MANY','M:M','*..*','N..N') THEN 'MANY_TO_MANY'
    ELSE NULL
  END;

-- ============================================================================
-- STEP 2: Add new columns for polymorphic endpoints and relationship type
-- ============================================================================

ALTER TABLE logical_data_entity_relationships ADD COLUMN from_ref_kind TEXT;
ALTER TABLE logical_data_entity_relationships ADD COLUMN from_ref_id TEXT;
ALTER TABLE logical_data_entity_relationships ADD COLUMN to_ref_kind TEXT;
ALTER TABLE logical_data_entity_relationships ADD COLUMN to_ref_id TEXT;
ALTER TABLE logical_data_entity_relationships ADD COLUMN relationship TEXT;

-- ============================================================================
-- STEP 3: Migrate existing data to polymorphic refs
-- Set from_ref_kind = 'LOGICAL_ENTITY', from_ref_id = source_entity_id
-- Set to_ref_kind = 'LOGICAL_ENTITY', to_ref_id = target_entity_id
-- ============================================================================

UPDATE logical_data_entity_relationships
SET from_ref_kind = 'LOGICAL_ENTITY',
    from_ref_id = source_entity_id,
    to_ref_kind = 'LOGICAL_ENTITY',
    to_ref_id = target_entity_id;

-- ============================================================================
-- STEP 4: Drop legacy foreign key constraints (if they exist)
-- Note: PostgreSQL requires dropping constraints before columns
-- ============================================================================

ALTER TABLE logical_data_entity_relationships DROP CONSTRAINT IF EXISTS logical_data_entity_relationships_source_entity_id_fkey;
ALTER TABLE logical_data_entity_relationships DROP CONSTRAINT IF EXISTS logical_data_entity_relationships_target_entity_id_fkey;

-- ============================================================================
-- STEP 5: Drop legacy columns
-- ============================================================================

ALTER TABLE logical_data_entity_relationships DROP COLUMN source_entity_id;
ALTER TABLE logical_data_entity_relationships DROP COLUMN target_entity_id;

-- ============================================================================
-- STEP 6: Add CHECK constraints for enum values
-- ============================================================================

-- Cardinality enum: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_cardinality_enum
CHECK (cardinality IS NULL OR cardinality IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'MANY_TO_MANY'));

-- Relationship enum: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_relationship_enum
CHECK (relationship IS NULL OR relationship IN ('GENERALIZATION', 'REALIZATION', 'COMPOSITION', 'AGGREGATION', 'ASSOCIATION', 'DEPENDENCY'));

-- Endpoint Kind enum for from_ref_kind: LOGICAL_ENTITY, PHYSICAL_ENTITY
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_from_ref_kind_enum
CHECK (from_ref_kind IS NULL OR from_ref_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY'));

-- Endpoint Kind enum for to_ref_kind: LOGICAL_ENTITY, PHYSICAL_ENTITY
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_to_ref_kind_enum
CHECK (to_ref_kind IS NULL OR to_ref_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY'));

-- ============================================================================
-- STEP 7: Add pairwise null/non-null CHECK constraints
-- If ref_kind is set, ref_id must be set (and vice versa)
-- ============================================================================

-- from_ref_kind and from_ref_id must both be set or both be null
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_from_ref_pairwise
CHECK ((from_ref_kind IS NULL AND from_ref_id IS NULL) OR (from_ref_kind IS NOT NULL AND from_ref_id IS NOT NULL));

-- to_ref_kind and to_ref_id must both be set or both be null
ALTER TABLE logical_data_entity_relationships
ADD CONSTRAINT chk_to_ref_pairwise
CHECK ((to_ref_kind IS NULL AND to_ref_id IS NULL) OR (to_ref_kind IS NOT NULL AND to_ref_id IS NOT NULL));
