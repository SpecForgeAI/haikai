-- ============================================================================
-- Task Group 1: Add Data Entity Points table
-- Data Entity Points act as polymorphic reference wrappers for Logical and
-- Physical Data Entities, enabling future relationship tables to point to
-- either entity type through a single foreign key.
-- ============================================================================

-- ============================================================================
-- DATA_ENTITY_POINTS TABLE
-- ============================================================================

CREATE TABLE data_entity_points (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  point_kind           TEXT NOT NULL,
  logical_entity_id    TEXT REFERENCES logical_data_entities(id),
  physical_entity_id   TEXT REFERENCES physical_data_entities(id),
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT,

  -- CHECK constraint: point_kind must be one of the allowed values
  CONSTRAINT chk_data_entity_points_point_kind
    CHECK (point_kind IN ('LOGICAL_ENTITY', 'PHYSICAL_ENTITY')),

  -- CHECK constraint: exactly one FK must be set
  CONSTRAINT chk_data_entity_points_exactly_one_fk
    CHECK (
      (logical_entity_id IS NOT NULL AND physical_entity_id IS NULL) OR
      (logical_entity_id IS NULL AND physical_entity_id IS NOT NULL)
    )
);

-- ============================================================================
-- UNIQUE PARTIAL INDEXES for determinism
-- These ensure no duplicate mappings for the same entity within a model file
-- ============================================================================

CREATE UNIQUE INDEX idx_data_entity_points_logical
  ON data_entity_points(model_file_id, logical_entity_id)
  WHERE logical_entity_id IS NOT NULL;

CREATE UNIQUE INDEX idx_data_entity_points_physical
  ON data_entity_points(model_file_id, physical_entity_id)
  WHERE physical_entity_id IS NOT NULL;

-- ============================================================================
-- PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX idx_data_entity_points_model_file
  ON data_entity_points(model_file_id);

CREATE INDEX idx_data_entity_points_logical_entity
  ON data_entity_points(logical_entity_id);

CREATE INDEX idx_data_entity_points_physical_entity
  ON data_entity_points(physical_entity_id);
