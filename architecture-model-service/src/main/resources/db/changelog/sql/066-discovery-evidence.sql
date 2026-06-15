-- Spec: Phase 1a Universal Evidence Extraction (Increment 6)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_evidence table for storing individual evidence atoms
-- extracted during Phase 1a universal extraction. Each atom is scoped to a
-- discovery run and traceable to a specific repo, file, and extraction type.
--
-- Columns:
-- - id: UUID primary key (deterministic hash-based, for idempotency)
-- - run_id: UUID FK to discovery_run.id (ON DELETE CASCADE, NOT NULL)
-- - repo_url: Source repository URL (TEXT NOT NULL)
-- - file_path: Relative file path within the repo (TEXT NOT NULL)
-- - type: Evidence atom type (file_structure, symbol, string_pattern)
-- - data: Type-specific JSONB payload
-- - extracted_at: Timestamp of extraction
--
-- Indexes:
-- - Non-unique index on run_id (retrieve all evidence for a run)
-- - Composite index on (run_id, type) (filtered queries by atom type)

CREATE TABLE IF NOT EXISTS discovery_evidence (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    repo_url TEXT NOT NULL,
    file_path TEXT NOT NULL,
    type TEXT NOT NULL,
    data JSONB NOT NULL,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_evidence_run FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE
);

-- Non-unique index on run_id for efficient retrieval of all evidence atoms for a run
CREATE INDEX IF NOT EXISTS idx_discovery_evidence_run_id
    ON discovery_evidence (run_id);

-- Composite index on (run_id, type) for filtered queries by atom type
CREATE INDEX IF NOT EXISTS idx_discovery_evidence_run_id_type
    ON discovery_evidence (run_id, type);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_evidence IS 'Stores individual evidence atoms extracted during Phase 1a universal extraction. Each atom is scoped to a discovery run and traceable to a specific repo, file, and extraction type. Spec: Phase 1a Universal Evidence Extraction (Increment 6).';
COMMENT ON COLUMN discovery_evidence.run_id IS 'FK to discovery_run.id. ON DELETE CASCADE ensures atoms are removed when the parent run is deleted.';
COMMENT ON COLUMN discovery_evidence.type IS 'Evidence atom type. Valid values: file_structure, symbol, string_pattern.';
COMMENT ON COLUMN discovery_evidence.data IS 'Type-specific JSONB payload. Shape depends on atom type: file_structure has { relativePath, extension, sizeBytes, lineCount }; symbol has { name, kind, line, scope, language }; string_pattern has { patternName, matchedText, line, contextSnippet }.';
COMMENT ON COLUMN discovery_evidence.extracted_at IS 'Timestamp of when this evidence atom was extracted.';
