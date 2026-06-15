-- ============================================================================
-- Infrastructure Domain Relationship: Deployment Unit Runs On Compute (R2)
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Polymorphic compute target: compute_infrastructure_point_id can reference an
-- InfrastructurePoint whose kind is COMPUTE_RESOURCE or COMPUTE_CLUSTER (A2).
-- The relationship-level allowed-kinds (COMPUTE_RESOURCE | COMPUTE_CLUSTER) is
-- documentation-only -- it is NOT enforced by an additional DB CHECK in this
-- spec (the existing exactly-one-FK CHECK on infrastructure_points already
-- guarantees correctness at the point row level).
--
-- This is the ONLY JSONB column introduced by this spec: runtime_config is
-- structured key/value config that benefits from native JSONB query/index
-- support. All other "tags/metadata: object/map" fields continue to use the
-- existing TEXT tags convention (Q5).
-- ============================================================================

CREATE TABLE deployment_unit_compute_resources (
  id                                   TEXT PRIMARY KEY,
  model_file_id                        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  deployment_unit_id                   TEXT NOT NULL REFERENCES deployment_units(id),         -- NO ACTION (cross-entity FK)
  compute_infrastructure_point_id      TEXT NOT NULL REFERENCES infrastructure_points(id),    -- NO ACTION (A2 polymorphic compute target)
  environment_id                       TEXT NOT NULL REFERENCES environments(id),             -- NO ACTION (Q7: kept on every relationship)
  version                              TEXT,
  runtime_config                       JSONB,                                                 -- Q5: only JSONB column in this spec
  desired_instances                    INTEGER,
  min_instances                        INTEGER,
  max_instances                        INTEGER,
  deployment_status                    TEXT,
  evidence_source                      TEXT,
  confidence                           DECIMAL(4,3),                                          -- Q4: nullable, no DB CHECK
  tags                                 TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_deployment_unit_compute_resources_model_file ON deployment_unit_compute_resources(model_file_id);
