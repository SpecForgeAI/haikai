-- ============================================================================
-- Task Group 1: Add Class and Method entities to Application Architecture Domain
-- Classes represent software classes within the Application Architecture
-- Methods represent behavioral interfaces owned by Classes
-- ============================================================================

-- ============================================================================
-- CLASSES TABLE
-- ============================================================================

CREATE TABLE classes (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  namespace          TEXT,
  owned_by_ref_kind  TEXT,  -- Application, ApplicationComponent, Service, Interface
  owned_by_ref_id    TEXT
);

-- ============================================================================
-- METHODS TABLE
-- ============================================================================

CREATE TABLE methods (
  id               TEXT PRIMARY KEY,
  model_file_id    TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  parameters_json  JSONB,
  returns_json     JSONB,
  throws_json      JSONB
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_classes_model_file ON classes(model_file_id);
CREATE INDEX idx_methods_model_file ON methods(model_file_id);
CREATE INDEX idx_methods_class ON methods(class_id);
