-- ============================================================================
-- Make actor_hint nullable on process_activities
-- Process activities created from the Excel/MCP save pipeline may not have
-- an actor hint value. Allow NULL to support this use case.
-- ============================================================================

ALTER TABLE process_activities ALTER COLUMN actor_hint DROP NOT NULL;
