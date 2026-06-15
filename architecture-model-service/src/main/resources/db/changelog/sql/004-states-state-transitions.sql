-- ============================================================================
-- Task Group 1: Add State and StateTransition entities to Behavioural Architecture Domain
-- States represent lifecycle stages of business or system entities (Initial, Normal, Final)
-- StateTransitions represent transitions between states with triggers, guards, and effects
-- ============================================================================

-- ============================================================================
-- STATES TABLE
-- ============================================================================

CREATE TABLE states (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT,
  state_kind         TEXT NOT NULL,  -- Initial, Normal, Final
  owner_ref_kind     TEXT,           -- Polymorphic reference type (optional)
  owner_ref_id       TEXT            -- Polymorphic reference id (optional)
);

-- ============================================================================
-- STATE_TRANSITIONS TABLE
-- ============================================================================

CREATE TABLE state_transitions (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  from_state_id        TEXT NOT NULL REFERENCES states(id),  -- NO cascade delete
  to_state_id          TEXT NOT NULL REFERENCES states(id),  -- NO cascade delete
  order_index          INTEGER,
  description          TEXT,
  -- Trigger fields (required, one-of: ref pair OR label)
  trigger_ref_kind     TEXT,          -- Event | Method
  trigger_ref_id       TEXT,
  trigger_label_text   TEXT,
  -- Guard fields (optional, one-of: ref pair OR expression)
  guard_ref_kind       TEXT,          -- Method
  guard_ref_id         TEXT,
  guard_expression     TEXT,
  -- Effect fields (optional, one-of: ref pair OR label)
  effect_ref_kind      TEXT,          -- Method
  effect_ref_id        TEXT,
  effect_label_text    TEXT
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_states_model_file ON states(model_file_id);
CREATE INDEX idx_state_transitions_model_file ON state_transitions(model_file_id);
CREATE INDEX idx_state_transitions_from_state ON state_transitions(from_state_id);
CREATE INDEX idx_state_transitions_to_state ON state_transitions(to_state_id);
