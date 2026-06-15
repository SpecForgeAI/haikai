-- ============================================================================
-- Cross-Domain Relationship: Application Compute Deployments (XR1)
-- Spec: 2026-05-05-infrastructure-cross-domain-integration
-- Wires an Application/Service (via application_points) to a Compute Resource
-- with an optional drill-down to a specific Deployment Unit. environment_id is
-- nullable on all 4 cross-domain relationships (Q7) -- differs from spec 1's
-- NOT NULL choice on Infra-internal relationships.
-- ============================================================================

CREATE TABLE application_compute_deployments (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id     TEXT NOT NULL REFERENCES application_points(id),    -- NO ACTION (cross-entity FK)
  compute_resource_id      TEXT NOT NULL REFERENCES compute_resources(id),     -- NO ACTION (cross-entity FK)
  deployment_unit_id       TEXT REFERENCES deployment_units(id),               -- NO ACTION (optional drill-down)
  environment_id           TEXT REFERENCES environments(id),                   -- NO ACTION (Q7: nullable on cross-domain rels)
  deployment_role          TEXT,
  runtime_name             TEXT,
  runtime_version          TEXT,
  evidence_source          TEXT,
  confidence               DECIMAL(4,3),                                       -- nullable, no DB CHECK
  description              TEXT NOT NULL,
  tags                     TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_application_compute_deployments_model_file ON application_compute_deployments(model_file_id);
