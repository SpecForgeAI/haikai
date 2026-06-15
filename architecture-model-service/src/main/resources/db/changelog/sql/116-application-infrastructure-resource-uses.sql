-- ============================================================================
-- Cross-Domain Relationship: Application Infrastructure Resource Uses (XR3)
-- Spec: 2026-05-05-infrastructure-cross-domain-integration
-- Wires an Application/Service (via application_points) to an Infrastructure
-- Resource (bucket, queue, topic, cache, secret store, scheduler, registry,
-- CDN, etc.). environment_id is nullable on all 4 cross-domain relationships.
-- ============================================================================

CREATE TABLE application_infrastructure_resource_uses (
  id                            TEXT PRIMARY KEY,
  model_file_id                 TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id          TEXT NOT NULL REFERENCES application_points(id),         -- NO ACTION (cross-entity FK)
  infrastructure_resource_id    TEXT NOT NULL REFERENCES infrastructure_resources(id),   -- NO ACTION (cross-entity FK)
  environment_id                TEXT REFERENCES environments(id),                        -- NO ACTION (Q7: nullable on cross-domain rels)
  dependency_type               TEXT,
  protocol                      TEXT,
  endpoint_or_topic             TEXT,
  access_mode                   TEXT,
  evidence_source               TEXT,
  confidence                    DECIMAL(4,3),                                            -- nullable, no DB CHECK
  description                   TEXT NOT NULL,
  tags                          TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_application_infrastructure_resource_uses_model_file ON application_infrastructure_resource_uses(model_file_id);
