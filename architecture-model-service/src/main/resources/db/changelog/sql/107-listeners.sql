-- ============================================================================
-- Infrastructure Domain: Listeners Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Listeners attach a protocol/port/host/path-pattern to a load balancer (or
-- directly to a compute resource). A1 decision: compute_resource_id is a
-- direct typed FK to compute_resources -- NOT polymorphic via
-- InfrastructurePoint. Polymorphic routing targets are handled by R3
-- (load_balancer_resource_routes.target_infrastructure_point_id).
-- ============================================================================

CREATE TABLE listeners (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT,
  environment_id           TEXT NOT NULL REFERENCES environments(id),         -- NO ACTION (cross-entity FK)
  load_balancer_id         TEXT REFERENCES load_balancers(id),                -- NO ACTION (cross-entity FK)
  compute_resource_id      TEXT REFERENCES compute_resources(id),             -- NO ACTION (cross-entity FK; A1 direct typed FK)
  protocol                 TEXT,
  port                     INTEGER,
  host_name                TEXT,
  path_pattern             TEXT,
  exposure                 TEXT,
  is_public                BOOLEAN,
  certificate_reference    TEXT,
  external_id              TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_listeners_model_file ON listeners(model_file_id);
