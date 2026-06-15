-- ============================================================================
-- UI Characteristics Table
-- Spec: UI Characteristics
--
-- Captures business features and UI/UX/technical characteristics associated
-- with frontend UIs, linked to Application Points.
--
-- Fields:
-- - id: Primary key identifier
-- - model_file_id: FK to model_files with CASCADE delete
-- - ui_id: Reference to ApplicationPoint.id (Application, App Component, or Service)
-- - type: Enum (business_feature, ui_capability, interaction_complexity, technical_shape)
-- - key: Optional free text with type-dependent autocomplete suggestions
-- - name: Required name for the characteristic
-- - description: Optional description
-- - evidence: Optional evidence/notes text
-- ============================================================================

CREATE TABLE ui_characteristics (
  id              TEXT PRIMARY KEY,
  model_file_id   TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  ui_id           TEXT NOT NULL,
  type            TEXT NOT NULL,
  key             TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  evidence        TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

-- Index for efficient lookup by model file
CREATE INDEX idx_ui_characteristics_model_file ON ui_characteristics(model_file_id);

-- Index for efficient lookup by UI (Application Point)
CREATE INDEX idx_ui_characteristics_ui_id ON ui_characteristics(ui_id);
