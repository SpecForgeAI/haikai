-- 180-implementation-init-and-repo-map.sql
-- Spec: Implementation-Service Init and Integration Repair (2026-06-12) -- Task Group 1
--
-- Persistence for the external implementation/verification service's
-- POST /projects/init workspace registration and the implementation git
-- outcome of orchestration jobs:
--
--   project (3 new nullable columns):
--     - implementation_init_success BOOLEAN NULL -- whether POST /projects/init
--       succeeded for this project. NULL = init never attempted. Boxed Boolean
--       on the Java side per project_primitive_double_dto_overwrite.md
--       (PATCH-mutable boolean must never be primitive).
--     - implementation_mode TEXT NULL -- overall mode from ProjectInitResponse
--       ('brownfield' | 'greenfield' | 'polyrepo').
--     - implementation_project_dir TEXT NULL -- product workspace root path
--       (parent of all repo sub-dirs) from ProjectInitResponse.project_dir.
--
--   project_implementation_repos (NEW table): one row per repo in the
--   workspace repo map (folder -> git URL). Replaced wholesale by the
--   gateway's full-map sync (external service is the source of truth for
--   what is cloned -- drift auto-sync target).
--
--   work_item (3 new nullable columns): the implementation git outcome
--   surfaced from JobDetailResponse.result on job completion:
--     - implementation_branch TEXT NULL -- feature branch name
--     - implementation_pr_url TEXT NULL -- pull request URL
--     - implementation_logs_url TEXT NULL -- job logs URL
--
-- All columns nullable, no backfill: existing projects/work items are
-- untouched (the Implementation gate + Edit-project modal is the conversion
-- path for existing projects -- no backfill job).
--
-- NEW changeset only -- never edit applied changesets (<= 179) per
-- feedback_liquibase_immutable_changesets.md.

ALTER TABLE project ADD COLUMN implementation_init_success BOOLEAN NULL;
ALTER TABLE project ADD COLUMN implementation_mode TEXT NULL;
ALTER TABLE project ADD COLUMN implementation_project_dir TEXT NULL;

CREATE TABLE project_implementation_repos (
  id             UUID PRIMARY KEY,
  project_id     UUID NOT NULL,
  folder         TEXT NOT NULL,
  git_url        TEXT NOT NULL,
  workspace_dir  TEXT NULL,
  mode           TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_implementation_repos_project
    FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  CONSTRAINT uq_project_implementation_repos_project_folder
    UNIQUE (project_id, folder)
);

CREATE INDEX idx_project_implementation_repos_project_id
  ON project_implementation_repos(project_id);

ALTER TABLE work_item ADD COLUMN implementation_branch TEXT NULL;
ALTER TABLE work_item ADD COLUMN implementation_pr_url TEXT NULL;
ALTER TABLE work_item ADD COLUMN implementation_logs_url TEXT NULL;

COMMENT ON COLUMN project.implementation_init_success IS
  'Whether external POST /projects/init succeeded for this project. NULL = never attempted, FALSE = attempted and failed (project still created), TRUE = workspace registered. Spec: Implementation-Service Init and Integration Repair (2026-06-12).';

COMMENT ON COLUMN project.implementation_mode IS
  'Overall workspace mode from ProjectInitResponse: brownfield | greenfield | polyrepo. NULL until init succeeds.';

COMMENT ON COLUMN project.implementation_project_dir IS
  'Product workspace root directory (parent of all repo sub-dirs) from ProjectInitResponse.project_dir. NULL until init succeeds.';

COMMENT ON TABLE project_implementation_repos IS
  'Workspace repo map (folder -> git URL) for the external implementation service. Replaced wholesale on gateway sync; the external service is the source of truth for what is cloned. Spec: Implementation-Service Init and Integration Repair (2026-06-12).';

COMMENT ON COLUMN project_implementation_repos.folder IS
  'Folder alias for the repo (sub-directory under the product workspace root). Must match ^[a-z0-9][a-z0-9._-]*$ (validated client- and gateway-side).';

COMMENT ON COLUMN project_implementation_repos.workspace_dir IS
  'Absolute path to the cloned sub-directory (RepoInitResult.dir). NULL when not yet known.';

COMMENT ON COLUMN project_implementation_repos.mode IS
  'Per-repo detected mode from init: brownfield | greenfield. NULL when not yet known.';

COMMENT ON COLUMN work_item.implementation_branch IS
  'Feature branch produced by the implementation job for this work item (extracted defensively from JobDetailResponse.result). Spec: Implementation-Service Init and Integration Repair (2026-06-12).';

COMMENT ON COLUMN work_item.implementation_pr_url IS
  'Pull request URL produced by the implementation job for this work item.';

COMMENT ON COLUMN work_item.implementation_logs_url IS
  'Logs URL of the implementation job for this work item (JobDetailResponse.logs_url).';
