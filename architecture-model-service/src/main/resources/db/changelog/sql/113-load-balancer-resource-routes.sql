-- ============================================================================
-- Infrastructure Domain Relationship: Load Balancer Routes To Resource (R3)
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Polymorphic target: target_infrastructure_point_id can reference any
-- infrastructure entity (compute resource, compute cluster, deployment unit,
-- infrastructure resource, etc. -- caller's choice). The optional listener_id
-- ties the route to a specific listener on the load balancer; when null the
-- route applies at load-balancer level.
-- ============================================================================

CREATE TABLE load_balancer_resource_routes (
  id                                TEXT PRIMARY KEY,
  model_file_id                     TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  load_balancer_id                  TEXT NOT NULL REFERENCES load_balancers(id),         -- NO ACTION (cross-entity FK)
  listener_id                       TEXT REFERENCES listeners(id),                       -- NO ACTION (cross-entity FK; nullable)
  target_infrastructure_point_id    TEXT NOT NULL REFERENCES infrastructure_points(id),  -- NO ACTION (R3 polymorphic target)
  environment_id                    TEXT NOT NULL REFERENCES environments(id),           -- NO ACTION (Q7: kept on every relationship)
  protocol                          TEXT,
  target_port                       INTEGER,
  host_name                         TEXT,
  path_pattern                      TEXT,
  routing_type                      TEXT,
  weight                            INTEGER,
  health_check_path                 TEXT,
  tags                              TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_load_balancer_resource_routes_model_file ON load_balancer_resource_routes(model_file_id);
