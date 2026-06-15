-- Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
-- Task Group 1: Liquibase Migration and JPA Entity
--
-- Creates the temporary_diagrams table for storing LLM-generated diagram payloads
-- as JSONB snapshots, enabling durable persistence and retrieval of temporary
-- architecture diagrams prior to conversion to native diagram format.
--
-- Columns:
-- - id: UUID primary key (server-generated)
-- - project_id: Project UUID (FK to project, NOT NULL, ON DELETE CASCADE)
-- - temporary_diagram_id: Client/LLM-provided diagram identifier (TEXT, NOT NULL)
-- - diagram_payload: Full TemporaryArchitectureDiagram JSON stored as JSONB
-- - created_at: Timestamp of creation (immutable)
-- - updated_at: Timestamp of last update
--
-- Indexes:
-- - Unique composite index on (project_id, temporary_diagram_id) for upsert support
-- - Index on project_id for efficient project-level queries

CREATE TABLE IF NOT EXISTS temporary_diagrams (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    temporary_diagram_id TEXT NOT NULL,
    diagram_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_temp_diagram_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

-- Unique composite index for upsert by project_id + temporary_diagram_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_diagram_project_diagram_id
    ON temporary_diagrams (project_id, temporary_diagram_id);

-- Index on project_id for efficient project-level queries
CREATE INDEX IF NOT EXISTS idx_temp_diagram_project_id
    ON temporary_diagrams (project_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE temporary_diagrams IS 'Stores LLM-generated temporary architecture diagram payloads as JSONB snapshots. Diagrams are persisted with upsert semantics by (project_id, temporary_diagram_id). Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams.';
COMMENT ON COLUMN temporary_diagrams.temporary_diagram_id IS 'Client/LLM-provided diagram identifier used as the external-facing ID. Combined with project_id forms the unique composite key for upsert operations.';
COMMENT ON COLUMN temporary_diagrams.diagram_payload IS 'Full TemporaryArchitectureDiagram JSON payload including nodes, edges, groups, and metadata. Stored as JSONB for future queryability.';
