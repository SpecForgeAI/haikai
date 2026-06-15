-- ============================================================================
-- Migration 044: Delivery Teams Table
-- Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
--
-- Introduces a new DeliveryTeam entity scoped to a project.
-- Each project can have multiple delivery teams (internal or external).
-- ============================================================================

-- ============================================================================
-- DELIVERY TEAMS TABLE
-- Stores delivery teams per project with a type (INTERNAL/EXTERNAL).
-- ============================================================================

CREATE TABLE delivery_teams (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  description  TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK constraint: project_id references project(id) with cascade delete
ALTER TABLE delivery_teams
  ADD CONSTRAINT fk_delivery_teams_project
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;

-- Composite UNIQUE constraint on (project_id, name)
ALTER TABLE delivery_teams
  ADD CONSTRAINT uq_delivery_teams_project_name UNIQUE (project_id, name);

-- Index on project_id for efficient lookups
CREATE INDEX idx_delivery_teams_project_id ON delivery_teams(project_id);
