-- ============================================================================
-- Cross-Domain Relationship: Application Load Balancer Exposures (XR4)
-- Spec: 2026-05-05-infrastructure-cross-domain-integration
-- Wires an Application/Service (via application_points) to a Load Balancer
-- with an optional drill-down to a specific Listener. The Q2 endpoint shape is
-- load_balancer_id NOT NULL + listener_id NULL (NOT polymorphic, NOT
-- both-nullable). target_port is INTEGER at the DB level even though the grid
-- presents it as numeric-as-text per spec 4 precedent.
-- environment_id is nullable on all 4 cross-domain relationships (Q7).
-- ============================================================================

CREATE TABLE application_load_balancer_exposures (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id     TEXT NOT NULL REFERENCES application_points(id),    -- NO ACTION (cross-entity FK)
  load_balancer_id         TEXT NOT NULL REFERENCES load_balancers(id),        -- NO ACTION (cross-entity FK)
  listener_id              TEXT REFERENCES listeners(id),                      -- NO ACTION (optional drill-down)
  environment_id           TEXT REFERENCES environments(id),                   -- NO ACTION (Q7: nullable on cross-domain rels)
  host_name                TEXT,
  path_pattern             TEXT,
  protocol                 TEXT,
  target_port              INTEGER,
  exposure                 TEXT,
  evidence_source          TEXT,
  confidence               DECIMAL(4,3),                                       -- nullable, no DB CHECK
  description              TEXT NOT NULL,
  tags                     TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_application_load_balancer_exposures_model_file ON application_load_balancer_exposures(model_file_id);
