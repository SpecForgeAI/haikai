-- ============================================================================
-- Task Group 1: Add Activity, ActivityFlow, and ActivityPartition entities
-- to Behavioural Architecture Domain
-- Activities represent nodes/actions in UML-style activity diagrams
-- ActivityFlows represent control and data flows between activities
-- ActivityPartitions represent swimlane partitions for organizing activities
-- ============================================================================

-- ============================================================================
-- ACTIVITIES TABLE
-- ============================================================================

CREATE TABLE activities (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  activity_kind      TEXT NOT NULL  -- Initial, Action, Decision, Merge, Final
);

-- ============================================================================
-- ACTIVITY_FLOWS TABLE
-- ============================================================================

CREATE TABLE activity_flows (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  from_activity_id      TEXT NOT NULL REFERENCES activities(id),  -- NO cascade delete - RESTRICT
  to_activity_id        TEXT NOT NULL REFERENCES activities(id),  -- NO cascade delete - RESTRICT
  -- Trigger fields (optional, one-of: ref pair OR label text)
  trigger_ref_kind      TEXT,          -- Event | Method
  trigger_ref_id        TEXT,
  trigger_label_text    TEXT,
  -- Condition fields (optional, one-of: ref pair OR expression)
  condition_ref_kind    TEXT,          -- Method
  condition_ref_id      TEXT,
  condition_expression  TEXT,
  -- Additional fields
  flow_kind             TEXT NOT NULL, -- Control | Data
  order_index           INTEGER,
  description           TEXT
);

-- ============================================================================
-- ACTIVITY_PARTITIONS TABLE
-- ============================================================================

CREATE TABLE activity_partitions (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT,           -- Optional if ref_kind/ref_id is set
  ref_kind           TEXT,           -- BusinessUser, Application, ApplicationComponent, Service, Interface, Class
  ref_id             TEXT,
  order_index        INTEGER,
  description        TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_activities_model_file ON activities(model_file_id);
CREATE INDEX idx_activity_flows_model_file ON activity_flows(model_file_id);
CREATE INDEX idx_activity_flows_from_activity ON activity_flows(from_activity_id);
CREATE INDEX idx_activity_flows_to_activity ON activity_flows(to_activity_id);
CREATE INDEX idx_activity_partitions_model_file ON activity_partitions(model_file_id);
