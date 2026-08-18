-- 225: Log-replay corpus persistence (Capture-State Discipline & Log-Replay
-- program, Spec 5, 2026-08-18). Application logs are mined (discovery-service
-- runtime-evidence extraction) into a REPLAY CORPUS: the useful, deduplicated
-- real-world requests that reconciliation round 2 live-replays against both
-- current and target at S0. Logs supply REQUESTS ONLY -- logged responses are
-- never oracles (they describe production state at logging time, not S0).
--
-- Two tables:
--   log_replay_corpus       -- one row per extraction (project, architecture,
--                              source file), carrying the honest FUNNEL
--                              (lines -> parsed -> matched -> useful) as JSON
--   log_replay_corpus_item  -- the deduplicated useful requests; request
--                              payload is OPAQUE JSON (headers/query/body),
--                              replay-critical fields are structured columns
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable -- this is a NEW changeset (224 is the highest sequential on disk
-- at build time); changesets <= 224 are not edited.

CREATE TABLE IF NOT EXISTS log_replay_corpus (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    architecture_id UUID NOT NULL,
    file_name TEXT NULL,
    status TEXT NOT NULL DEFAULT 'staged',
    funnel_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_log_replay_corpus_project_arch
    ON log_replay_corpus (project_id, architecture_id);

CREATE TABLE IF NOT EXISTS log_replay_corpus_item (
    id UUID PRIMARY KEY,
    corpus_id UUID NOT NULL,
    project_id UUID NOT NULL,
    method TEXT NOT NULL,
    path_template TEXT NOT NULL,
    concrete_path TEXT NOT NULL,
    request_json JSONB NULL,
    response_status INTEGER NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    richness TEXT NOT NULL,
    matched_endpoint_id UUID NULL,
    source_file_name TEXT NULL,
    line_number INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_replay_corpus_item_corpus
    ON log_replay_corpus_item (corpus_id);

CREATE INDEX IF NOT EXISTS idx_log_replay_corpus_item_template
    ON log_replay_corpus_item (corpus_id, method, path_template);
