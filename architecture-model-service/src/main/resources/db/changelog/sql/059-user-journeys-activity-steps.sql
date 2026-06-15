-- ============================================================================
-- Task Group 1: Add UserJourney and ActivityStep entities for Business Architecture
-- UserJourneys model how specific users experience end-to-end business flows
-- ActivitySteps represent ordered steps within a journey, linking to existing
-- ProcessActivities, BusinessUsers, and Applications
-- ============================================================================

-- ============================================================================
-- USER_JOURNEYS TABLE
-- ============================================================================

CREATE TABLE user_journeys (
  id                          TEXT PRIMARY KEY,
  model_file_id               TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  description                 TEXT,
  tags                        TEXT,
  primary_business_user_id    TEXT REFERENCES business_users(id),       -- NO ACTION (cross-entity FK)
  parent_business_process_id  TEXT REFERENCES business_processes(id)    -- NO ACTION (cross-entity FK)
);

-- ============================================================================
-- ACTIVITY_STEPS TABLE
-- ============================================================================

CREATE TABLE activity_steps (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  user_journey_id       TEXT NOT NULL REFERENCES user_journeys(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  tags                  TEXT,
  sequence_order        INTEGER,
  process_activity_id   TEXT NOT NULL REFERENCES process_activities(id),   -- NO ACTION (cross-entity FK)
  business_user_id      TEXT NOT NULL REFERENCES business_users(id),       -- NO ACTION (cross-entity FK)
  application_id        TEXT NOT NULL REFERENCES applications(id)          -- NO ACTION (cross-entity FK)
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_user_journeys_model_file ON user_journeys(model_file_id);
CREATE INDEX idx_activity_steps_model_file ON activity_steps(model_file_id);
CREATE INDEX idx_activity_steps_user_journey ON activity_steps(user_journey_id);
