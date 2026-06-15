-- ============================================================================
-- Migration 045: Add delivery_team_id to work_item
-- Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
--
-- Adds an optional delivery_team_id FK column to the work_item table,
-- allowing work items to be associated with a delivery team.
-- ON DELETE SET NULL ensures work items remain intact if the team is deleted.
-- ============================================================================

-- Add nullable delivery_team_id column
ALTER TABLE work_item ADD COLUMN delivery_team_id UUID NULL;

-- FK constraint: delivery_team_id references delivery_teams(id) with SET NULL on delete
ALTER TABLE work_item
  ADD CONSTRAINT fk_work_item_delivery_team
  FOREIGN KEY (delivery_team_id) REFERENCES delivery_teams(id) ON DELETE SET NULL;

-- Index on delivery_team_id for efficient lookups
CREATE INDEX idx_work_item_delivery_team_id ON work_item(delivery_team_id);
