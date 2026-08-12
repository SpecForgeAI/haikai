-- 222: data_migration_reports (2026-08-12, the parity-report sibling).
-- The AMVS data-migration (bulk load) run persists its per-table load report
-- here so an incomplete load is DIAGNOSABLE after the fact: the report body
-- carries every table's status + loaded/source counts + the VERBATIM failure
-- reason (driver/Postgres error text), instead of being inferred from row
-- counts. Latest row per (project, architecture) is the read, mirroring
-- data_parity_reports (210).
CREATE TABLE data_migration_reports (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    architecture_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL,
    migration_pair VARCHAR(128),
    ruleset_version INT,
    tables_total INT,
    tables_loaded INT,
    tables_mismatched INT,
    tables_unverifiable INT,
    rows_loaded BIGINT,
    report_json JSONB NOT NULL
);

CREATE INDEX idx_data_migration_reports_latest
    ON data_migration_reports (project_id, architecture_id, created_at DESC);
