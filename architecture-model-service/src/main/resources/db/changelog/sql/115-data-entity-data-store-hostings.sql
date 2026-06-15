-- ============================================================================
-- Cross-Domain Relationship: Data Entity Data Store Hostings (XR2)
-- Spec: 2026-05-05-infrastructure-cross-domain-integration
-- Wires a Data Entity (via data_entity_points) to a Data Store Instance.
-- environment_id is nullable on all 4 cross-domain relationships (Q7).
-- ============================================================================

CREATE TABLE data_entity_data_store_hostings (
  id                          TEXT PRIMARY KEY,
  model_file_id               TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  data_entity_point_id        TEXT NOT NULL REFERENCES data_entity_points(id),   -- NO ACTION (cross-entity FK)
  data_store_instance_id      TEXT NOT NULL REFERENCES data_store_instances(id), -- NO ACTION (cross-entity FK)
  environment_id              TEXT REFERENCES environments(id),                  -- NO ACTION (Q7: nullable on cross-domain rels)
  database_name               TEXT,
  schema_name                 TEXT,
  table_or_collection_name    TEXT,
  hosting_role                TEXT,
  evidence_source             TEXT,
  confidence                  DECIMAL(4,3),                                      -- nullable, no DB CHECK
  description                 TEXT NOT NULL,
  tags                        TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_data_entity_data_store_hostings_model_file ON data_entity_data_store_hostings(model_file_id);
