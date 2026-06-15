-- Spec: Implement Context Include Relationships and Propagate to Planner Payload
-- Add relationship selection columns to work_item_implement_context table
-- These columns store user-selected relationships for inclusion in planner context

ALTER TABLE work_item_implement_context
    ADD COLUMN IF NOT EXISTS selected_relationship_ids JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS selected_relationship_selections JSONB DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN work_item_implement_context.selected_relationship_ids IS 'Array of selected relationship IDs in format relationshipType::relationshipId';
COMMENT ON COLUMN work_item_implement_context.selected_relationship_selections IS 'Array of RelationshipSelection objects with relationship_type, relationship_id, label';
