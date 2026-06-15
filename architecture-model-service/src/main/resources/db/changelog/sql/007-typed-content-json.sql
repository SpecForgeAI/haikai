-- ============================================================================
-- Task Group 1: Add typed_content_json Column to Diagrams Table
-- Stores type-specific content (Sequence, ER, Activity, State) as JSONB
-- Column is nullable for General diagrams which have no typed content
-- ============================================================================

-- ============================================================================
-- ADD TYPED_CONTENT_JSON COLUMN
-- ============================================================================

ALTER TABLE diagrams ADD COLUMN typed_content_json JSONB NULL;

-- ============================================================================
-- GIN INDEX for JSONB querying
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_diagrams_typed_content_json ON diagrams USING gin (typed_content_json);
