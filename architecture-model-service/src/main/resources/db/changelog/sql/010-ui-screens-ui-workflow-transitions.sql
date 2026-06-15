-- ============================================================================
-- Task Group 1: Add UIScreen and UIWorkflowTransition entities for UI Architecture
-- UIScreens represent routes/pages in the Application Architecture domain
-- UIWorkflowTransitions represent navigation flows between screens
-- ============================================================================

-- ============================================================================
-- UI_SCREENS TABLE
-- ============================================================================

CREATE TABLE ui_screens (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  route              TEXT NOT NULL,
  description        TEXT
);

-- ============================================================================
-- UI_WORKFLOW_TRANSITIONS TABLE
-- ============================================================================

CREATE TABLE ui_workflow_transitions (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  source_screen_id     TEXT NOT NULL REFERENCES ui_screens(id),  -- NO cascade delete
  target_screen_id     TEXT NOT NULL REFERENCES ui_screens(id),  -- NO cascade delete
  trigger              TEXT,
  guard                TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_ui_screens_model_file ON ui_screens(model_file_id);
CREATE INDEX idx_ui_workflow_transitions_model_file ON ui_workflow_transitions(model_file_id);
CREATE INDEX idx_ui_workflow_transitions_source ON ui_workflow_transitions(source_screen_id);
CREATE INDEX idx_ui_workflow_transitions_target ON ui_workflow_transitions(target_screen_id);
