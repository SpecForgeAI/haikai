-- ============================================================================
-- Work Item Implement Context Table
-- Stores the selected architecture entities and diagrams for each work item's
-- Implement context, enabling persistence across browser sessions and devices.
-- ============================================================================

-- ============================================================================
-- WORK_ITEM_IMPLEMENT_CONTEXT TABLE
-- ============================================================================

CREATE TABLE work_item_implement_context (
  id                     UUID PRIMARY KEY,
  project_id             TEXT NOT NULL,
  work_item_id           UUID NOT NULL,
  selected_entity_ids    JSONB DEFAULT '[]'::jsonb,
  selected_diagram_ids   JSONB DEFAULT '[]'::jsonb,
  created_at             TIMESTAMP,
  updated_at             TIMESTAMP,
  CONSTRAINT uq_work_item_implement_context UNIQUE (project_id, work_item_id)
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_work_item_implement_context_project ON work_item_implement_context(project_id);
CREATE INDEX idx_work_item_implement_context_work_item ON work_item_implement_context(work_item_id);
