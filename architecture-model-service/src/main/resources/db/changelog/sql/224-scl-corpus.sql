-- 224: SCL corpus persistence (Structural Contract Language) (2026-08-18).
-- The tool mines legacy codebases into SCL contracts (behaviour tables /
-- shape contracts / boundary contracts / fragments) stored as OPAQUE JSON;
-- AMS is the store. Body JSON is NEVER parsed by AMS -- persisted and served
-- verbatim, mirroring the config_snapshot / report_json precedent.
--
-- Three tables:
--   scl_scan              -- one row per mining run over a (project, architecture)
--   scl_contract          -- the mined contracts, unique per (scan_id, contract_key)
--   scl_reachability_item -- unresolved-reachability worklist per scan
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable -- this is a NEW changeset (223 is the highest sequential on disk
-- at build time); changesets <= 223 are not edited.

CREATE TABLE IF NOT EXISTS scl_scan (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    architecture_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    stats_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_scl_scan_project_arch
    ON scl_scan (project_id, architecture_id);

CREATE TABLE IF NOT EXISTS scl_contract (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    architecture_id UUID NOT NULL,
    scan_id UUID NOT NULL,
    contract_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    source_path TEXT NULL,
    source_symbol TEXT NULL,
    content_hash TEXT NOT NULL,
    fan_in INTEGER NOT NULL DEFAULT 0,
    roots_json JSONB NULL,
    body_json JSONB NOT NULL,
    gloss_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scl_contract_scan_key
    ON scl_contract (scan_id, contract_key);

CREATE INDEX IF NOT EXISTS idx_scl_contract_project_arch
    ON scl_contract (project_id, architecture_id);

CREATE INDEX IF NOT EXISTS idx_scl_contract_scan_kind
    ON scl_contract (scan_id, kind);

CREATE INDEX IF NOT EXISTS idx_scl_contract_scan_fan_in
    ON scl_contract (scan_id, fan_in);

CREATE TABLE IF NOT EXISTS scl_reachability_item (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    scan_id UUID NOT NULL,
    source_path TEXT NOT NULL,
    symbol TEXT NULL,
    signals_json JSONB NULL,
    disposition TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_scl_reachability_item_scan
    ON scl_reachability_item (scan_id);
