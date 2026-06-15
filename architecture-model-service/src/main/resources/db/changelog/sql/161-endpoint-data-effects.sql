-- ============================================================================
-- Endpoint->Data-Effect Call Graph for Discovery (Spec: 2026-05-29) -- Task Group 1
--
-- New DEDICATED relationship table endpoint_data_effects: one first-class,
-- reviewable edge per (endpoint, data-entity) pair describing which data
-- entity an inbound HTTP endpoint reads/writes.
--
-- Modelled on 015-business-logic.sql (TEXT PK + model_file_id FK ON DELETE
-- CASCADE + temporal validity columns). The data-entity side is referenced via
-- the dep_log_<entityId> / dep_phy_<entityId> data-entity-point convention
-- (NOT a raw entity FK) -- so data_entity_point_id is a plain TEXT column with
-- no FK, exactly like interface_logical_entities.data_entity_point_id.
--
-- path_metadata_json is JSONB: the structured ordered hop list (each hop = FQN
-- + method signature), the operation hint (insert/update/delete/select), and
-- the transactional flag -- so a future call-tree UI needs no schema
-- migration. confidence is DOUBLE PRECISION (boxed Double in the JPA
-- entity/DTO) so PATCH preserves null per
-- project_primitive_double_dto_overwrite.md.
-- ============================================================================

CREATE TABLE endpoint_data_effects (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  endpoint_id           TEXT NOT NULL,
  data_entity_point_id  TEXT NOT NULL,
  access_mode           TEXT,
  path_metadata_json    JSONB,
  confidence            DOUBLE PRECISION,
  description           TEXT,
  tags                  TEXT,
  valid_from            TEXT,
  valid_to              TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_endpoint_data_effects_model_file ON endpoint_data_effects(model_file_id);
CREATE INDEX idx_endpoint_data_effects_endpoint ON endpoint_data_effects(endpoint_id);
