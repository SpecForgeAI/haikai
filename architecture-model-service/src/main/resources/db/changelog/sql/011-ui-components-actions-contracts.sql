-- ============================================================================
-- Task Group 1: Add UIComponent, UIAction, UIContract entities for UI Architecture
-- Phase 1 Increment 2: UI_SCREEN Diagram Type + UIComponent/UIAction/UIContract
--
-- UIContract: Defines API contracts for UI actions
-- UIComponent: Reusable UI component definitions
-- UIAction: User interactions with triggers and effects
-- ============================================================================

-- ============================================================================
-- UI_CONTRACTS TABLE
-- First: No FK dependencies from new tables
-- ============================================================================

CREATE TABLE ui_contracts (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  contract_type        TEXT NOT NULL,
  operation_ref        TEXT,
  request_schema_ref   TEXT,
  response_schema_ref  TEXT,
  bindings_json        JSONB
);

-- ============================================================================
-- UI_COMPONENTS TABLE
-- Second: No FK dependencies from new tables
-- ============================================================================

CREATE TABLE ui_components (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  component_type     TEXT NOT NULL,
  description        TEXT,
  domain             TEXT DEFAULT 'APPLICATION',
  props_schema_json  JSONB
);

-- ============================================================================
-- UI_ACTIONS TABLE
-- Third: Has FKs to ui_screens, ui_components, ui_contracts
-- ============================================================================

CREATE TABLE ui_actions (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  trigger_type       TEXT NOT NULL,
  owner_screen_id    TEXT REFERENCES ui_screens(id),
  owner_component_id TEXT REFERENCES ui_components(id),
  effect_type        TEXT NOT NULL,
  description        TEXT,
  contract_id        TEXT REFERENCES ui_contracts(id),
  -- XOR constraint: exactly one of owner_screen_id or owner_component_id must be non-null
  CONSTRAINT ui_actions_owner_xor CHECK (
    (owner_screen_id IS NOT NULL AND owner_component_id IS NULL) OR
    (owner_screen_id IS NULL AND owner_component_id IS NOT NULL)
  )
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

-- ui_contracts indexes
CREATE INDEX idx_ui_contracts_model_file ON ui_contracts(model_file_id);

-- ui_components indexes
CREATE INDEX idx_ui_components_model_file ON ui_components(model_file_id);

-- ui_actions indexes
CREATE INDEX idx_ui_actions_model_file ON ui_actions(model_file_id);
CREATE INDEX idx_ui_actions_owner_screen ON ui_actions(owner_screen_id);
CREATE INDEX idx_ui_actions_owner_component ON ui_actions(owner_component_id);
CREATE INDEX idx_ui_actions_contract ON ui_actions(contract_id);
