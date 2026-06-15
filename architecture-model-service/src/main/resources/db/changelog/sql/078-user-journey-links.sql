-- ============================================================================
-- User Journey Links Table
-- Spec: User Journey Links Meta-Model Foundation
-- Introduces a first-class Business Architecture relationship for directed
-- connections between User Journeys (e.g., PRECEDES, DEPENDS_ON, TRIGGERS).
-- Managed through the existing whole-model load/save cycle.
-- ============================================================================

CREATE TABLE user_journey_links (
  id                          TEXT PRIMARY KEY,
  model_file_id               TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  source_user_journey_id      TEXT NOT NULL REFERENCES user_journeys(id),           -- NO ACTION (cross-entity FK)
  target_user_journey_id      TEXT NOT NULL REFERENCES user_journeys(id),           -- NO ACTION (cross-entity FK)
  relationship_type           TEXT NOT NULL,
  label                       TEXT,
  description                 TEXT,
  tags                        TEXT,
  CONSTRAINT chk_no_self_link CHECK (source_user_journey_id <> target_user_journey_id),
  CONSTRAINT uq_user_journey_link UNIQUE (source_user_journey_id, target_user_journey_id, relationship_type, label)
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_user_journey_links_model_file ON user_journey_links(model_file_id);
CREATE INDEX idx_user_journey_links_source ON user_journey_links(source_user_journey_id);
CREATE INDEX idx_user_journey_links_target ON user_journey_links(target_user_journey_id);
