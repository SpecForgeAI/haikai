-- 210: data_parity_reports (Data-Tier Oracle Program, Spec P).
-- The AMVS data-parity run persists its per-table verdict report here; the
-- migrate gate reads the LATEST row per (project, architecture) FAIL-CLOSED
-- (no report => data_parity_unverified blocks execution).
CREATE TABLE data_parity_reports (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    architecture_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL,
    migration_pair VARCHAR(128),
    ruleset_version INT,
    report_json JSONB NOT NULL
);

CREATE INDEX idx_data_parity_reports_latest
    ON data_parity_reports (project_id, architecture_id, created_at DESC);
