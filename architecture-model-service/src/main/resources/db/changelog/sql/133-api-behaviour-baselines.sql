-- 133-api-behaviour-baselines.sql
-- Spec: API Behaviour Baseline Capture Service (2026-05-15) -- Task Group 1
--
-- A saved baseline is the durable artifact produced from accepted captures.
-- It carries summary counts plus a status (draft / active / archived) and
-- references the originating capture session via session_id.
--
-- Note that capture sessions cascade-delete their child rows but the saved
-- baseline rows survive a session deletion -- the FK to session is retained
-- as a soft reference rather than a CASCADE so historical baselines outlive
-- the throwaway capture session.
--
-- status valid values (validated at service layer):
--   draft | active | archived
--
-- accepted_capture_count and operation_count are denormalised summary metrics;
-- typed as INT in DB and BOXED Integer in DTO so PATCH preserves null.
--
-- NEW changeset only -- never edit applied changesets (<= 132).

CREATE TABLE api_behaviour_baselines (
  id                          UUID PRIMARY KEY,
  project_id                  UUID NOT NULL,
  architecture_id             UUID NOT NULL,
  session_id                  UUID NOT NULL,
  name                        TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'draft',
  accepted_capture_count      INT,
  operation_count             INT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_behaviour_baseline_project
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_behaviour_baseline_session
    FOREIGN KEY (session_id) REFERENCES api_behaviour_capture_sessions(id)
);

CREATE INDEX idx_api_behaviour_baseline_proj_arch_status
  ON api_behaviour_baselines (project_id, architecture_id, status);

COMMENT ON TABLE api_behaviour_baselines IS
  'Saved baseline header. Survives capture session deletion (no CASCADE on session_id) so historical baselines outlive throwaway sessions. Cascade is only on project deletion.';
COMMENT ON COLUMN api_behaviour_baselines.status IS
  'Valid values: draft (created but not yet activated), active (the current evidence-of-record), archived (superseded but retained).';
