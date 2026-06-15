-- Spec: Phase 0 Persistence Contract (Increment 2)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_config table for storing structured Phase 0 discovery
-- configuration as JSONB, with one-per-project upsert semantics.
--
-- Columns:
-- - id: UUID primary key (server-generated)
-- - project_id: Project UUID (FK to project, NOT NULL, ON DELETE CASCADE)
-- - config_payload: Structured discovery config JSON stored as JSONB
-- - status: Lifecycle status (DRAFT, COMPLETE)
-- - created_at: Timestamp of creation (immutable)
-- - updated_at: Timestamp of last update
--
-- Indexes:
-- - Unique index on project_id for one-per-project upsert support

CREATE TABLE IF NOT EXISTS discovery_config (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    config_payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_config_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

-- Unique index on project_id for one-per-project upsert semantics
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_config_project_id
    ON discovery_config (project_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_config IS 'Stores structured Phase 0 discovery configuration as JSONB with one-per-project upsert semantics. Config covers repo scope, repo-to-application mappings, tech hints, exclusions, and notes. Spec: Phase 0 Persistence Contract (Increment 2).';
COMMENT ON COLUMN discovery_config.config_payload IS 'Machine-readable JSON document covering repos, repoApplicationMappings, techHints, exclusions, and notes/ambiguities. Stored as JSONB for future queryability.';
COMMENT ON COLUMN discovery_config.status IS 'Lifecycle status of the discovery config. Valid values: DRAFT (in-progress), COMPLETE (ready for downstream consumption).';
