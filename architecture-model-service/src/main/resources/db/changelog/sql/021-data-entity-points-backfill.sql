-- ============================================================================
-- Data Entity Points Backfill Migration
-- ============================================================================
-- This migration backfills Data Entity Points for all existing Logical and
-- Physical Data Entities that do not already have corresponding points.
--
-- This ensures backward compatibility after deploying Iteration 2 of the
-- Data Entity Point feature.
--
-- The migration is idempotent - safe to run multiple times without creating
-- duplicate points.
--
-- ID Generation Convention:
-- - Logical entities: "dep_log_" + logicalEntityId
-- - Physical entities: "dep_phy_" + physicalEntityId
--
-- Spec: Data Entity Point Backfill and Legacy Snapshot Compatibility
-- Task Group 1: Liquibase Migration Backfill
-- ============================================================================

-- ============================================================================
-- BACKFILL LOGICAL ENTITY POINTS
-- ============================================================================
-- Insert Data Entity Points for all Logical Data Entities that do not already
-- have a corresponding point in the data_entity_points table.
-- Uses INSERT INTO ... SELECT ... WHERE NOT EXISTS pattern for idempotency.
-- ============================================================================

INSERT INTO data_entity_points (
    id,
    model_file_id,
    point_kind,
    logical_entity_id,
    physical_entity_id,
    description,
    tags,
    valid_from,
    valid_to
)
SELECT
    'dep_log_' || lde.id,
    lde.model_file_id,
    'LOGICAL_ENTITY',
    lde.id,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
FROM logical_data_entities lde
WHERE NOT EXISTS (
    SELECT 1 FROM data_entity_points dep
    WHERE dep.model_file_id = lde.model_file_id
      AND dep.logical_entity_id = lde.id
);

-- ============================================================================
-- BACKFILL PHYSICAL ENTITY POINTS
-- ============================================================================
-- Insert Data Entity Points for all Physical Data Entities that do not already
-- have a corresponding point in the data_entity_points table.
-- Uses INSERT INTO ... SELECT ... WHERE NOT EXISTS pattern for idempotency.
-- ============================================================================

INSERT INTO data_entity_points (
    id,
    model_file_id,
    point_kind,
    logical_entity_id,
    physical_entity_id,
    description,
    tags,
    valid_from,
    valid_to
)
SELECT
    'dep_phy_' || pde.id,
    pde.model_file_id,
    'PHYSICAL_ENTITY',
    NULL,
    pde.id,
    NULL,
    NULL,
    NULL,
    NULL
FROM physical_data_entities pde
WHERE NOT EXISTS (
    SELECT 1 FROM data_entity_points dep
    WHERE dep.model_file_id = pde.model_file_id
      AND dep.physical_entity_id = pde.id
);
