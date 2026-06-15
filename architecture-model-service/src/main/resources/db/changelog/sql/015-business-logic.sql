-- ============================================================================
-- Task Group 1: Add BusinessLogic entity and ApplicationPointBusinessLogic join table
-- BusinessLogic represents reusable business rules and logic in the Behavioural domain
-- ApplicationPointBusinessLogic links Business Logic to Application Points (many-to-many)
-- ============================================================================

-- ============================================================================
-- BUSINESS_LOGICS TABLE
-- ============================================================================

CREATE TABLE business_logics (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  type_text          TEXT,
  description_md     TEXT,
  tags               TEXT,
  valid_from         TEXT,
  valid_to           TEXT
);

-- ============================================================================
-- APPLICATION_POINT_BUSINESS_LOGICS TABLE (Join Table)
-- ============================================================================

CREATE TABLE application_point_business_logics (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  application_point_id  TEXT NOT NULL REFERENCES application_points(id) ON DELETE CASCADE,
  business_logic_id     TEXT NOT NULL REFERENCES business_logics(id) ON DELETE CASCADE,
  description           TEXT,
  tags                  TEXT,
  valid_from            TEXT,
  valid_to              TEXT,
  CONSTRAINT uq_app_point_business_logic UNIQUE (application_point_id, business_logic_id)
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_business_logics_model_file ON business_logics(model_file_id);
CREATE INDEX idx_app_point_business_logics_model_file ON application_point_business_logics(model_file_id);
CREATE INDEX idx_app_point_business_logics_app_point ON application_point_business_logics(application_point_id);
CREATE INDEX idx_app_point_business_logics_business_logic ON application_point_business_logics(business_logic_id);
