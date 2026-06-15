-- Spec: Log-based Discovery Enrichment (Increment 14)
-- Task Group 1: EvidenceAtom and Candidate Schema Extensions
--
-- Adds log enrichment fields to the discovery_evidence and discovery_candidate tables:
-- - discovery_evidence.source: identifies whether the evidence atom came from code or log analysis
-- - discovery_evidence.log_origin: JSONB metadata about the log file origin (filePath, lineStart, lineEnd, timestamp, occurrenceCount)
-- - discovery_candidate.log_enrichment: JSONB metadata summarizing log enrichment (enriched, logAtomCount, signalSummary)
--
-- All new columns are nullable for backward compatibility.
-- Existing code-derived atoms continue to work unchanged (null source treated as 'code').

-- Add source column to discovery_evidence (nullable TEXT)
ALTER TABLE discovery_evidence
    ADD COLUMN IF NOT EXISTS source TEXT;

-- Add log_origin column to discovery_evidence (nullable JSONB)
ALTER TABLE discovery_evidence
    ADD COLUMN IF NOT EXISTS log_origin JSONB;

-- Add log_enrichment column to discovery_candidate (nullable JSONB)
ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS log_enrichment JSONB;

-- Composite index on (run_id, source) for querying log-sourced atoms efficiently
CREATE INDEX IF NOT EXISTS idx_discovery_evidence_run_id_source
    ON discovery_evidence (run_id, source);

-- Column documentation
COMMENT ON COLUMN discovery_evidence.source IS 'Identifies the origin of the evidence atom. Valid values: code (or NULL, treated as code), log. Nullable for backward compatibility with pre-existing code-derived atoms. Spec: Log-based Discovery Enrichment (Increment 14).';
COMMENT ON COLUMN discovery_evidence.log_origin IS 'JSONB metadata about the log file origin for log-sourced atoms. Contains filePath, lineStart, lineEnd, optional timestamp, and optional occurrenceCount. Nullable for code-sourced atoms. Spec: Log-based Discovery Enrichment (Increment 14).';
COMMENT ON COLUMN discovery_candidate.log_enrichment IS 'JSONB metadata summarizing log enrichment for this candidate. Contains enriched (boolean), logAtomCount (number), signalSummary (string). Nullable for candidates without log enrichment. Spec: Log-based Discovery Enrichment (Increment 14).';
