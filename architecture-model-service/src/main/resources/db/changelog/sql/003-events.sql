-- ============================================================================
-- Task Group 1: Add Event entity to Behavioural Architecture Domain
-- Events represent occurrences of interest that trigger actions or state changes
-- ============================================================================

-- ============================================================================
-- EVENTS TABLE
-- ============================================================================

CREATE TABLE events (
  id                     TEXT PRIMARY KEY,
  model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  description            TEXT,
  source_ref_kind        TEXT,  -- BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class
  source_ref_id          TEXT,
  payload_ref_kind       TEXT,  -- LogicalEntity
  payload_ref_id         TEXT,
  payload_primitive_type TEXT,  -- string, number, integer, boolean, date, datetime, uuid
  tags                   TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_events_model_file ON events(model_file_id);
