-- ============================================================================
-- Infrastructure Domain Relationship: Resource Subnet Hostings (R1)
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Polymorphic source: infrastructure_point_id can reference any infrastructure
-- entity that can be subnet-hosted (compute resource, load balancer,
-- infrastructure resource, etc. -- caller's choice). Allowed point_kind values
-- at this relationship are documentation-only; the per-row CHECK on
-- infrastructure_points already enforces correctness at the point level.
-- ============================================================================

CREATE TABLE resource_subnet_hostings (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  infrastructure_point_id  TEXT NOT NULL REFERENCES infrastructure_points(id),   -- NO ACTION (cross-entity FK)
  subnet_id                TEXT NOT NULL REFERENCES subnets(id),                 -- NO ACTION (cross-entity FK)
  environment_id           TEXT NOT NULL REFERENCES environments(id),            -- NO ACTION (Q7: kept on every relationship)
  relationship_role        TEXT,
  primary_ip               TEXT,
  private_ip               TEXT,
  public_ip                TEXT,
  evidence_source          TEXT,
  confidence               DECIMAL(4,3),                                         -- Q4: nullable, no DB CHECK
  tags                     TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_resource_subnet_hostings_model_file ON resource_subnet_hostings(model_file_id);
