-- ============================================================================
-- Structured Selections for Work Item Implement Context
-- Adds JSONB columns for structured entity and diagram selections with bundle_type and depth.
-- Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
-- ============================================================================

-- Add selected_entity_selections column
-- Stores array of { entity_type, entity_id, bundle_type, depth? } objects
ALTER TABLE work_item_implement_context
ADD COLUMN IF NOT EXISTS selected_entity_selections JSONB DEFAULT '[]'::jsonb;

-- Add selected_diagram_selections column
-- Stores array of { diagram_id, bundle_type } objects
ALTER TABLE work_item_implement_context
ADD COLUMN IF NOT EXISTS selected_diagram_selections JSONB DEFAULT '[]'::jsonb;
