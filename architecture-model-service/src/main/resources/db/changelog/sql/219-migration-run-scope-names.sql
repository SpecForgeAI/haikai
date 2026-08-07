-- 219-migration-run-scope-names.sql
-- Boot-recovery discovery scope names (2026-08-07, gold-standard campaign C3)
--
-- The gateway's boot-recovery sweep was INERT: its default in-flight-run
-- discovery returned an empty set because AMS had no cross-project "list
-- in-flight runs" endpoint, so a gateway restart stranded any mid-segment
-- migration run forever (status dispatching, no timer, no callback coming).
-- The new GET /api/migration-execution-runs/in-flight endpoint powers the
-- sweep — but the driver needs the workspace scope NAMES the run was created
-- under (company/project strings), which the project UUID alone cannot
-- provide at boot:
--
--   * company -> workspace company name the run was created under
--   * project -> workspace project name the run was created under
--
-- Both set once at run creation by the gateway driver; never PATCHed.
-- Nullable: rows created before this changeset carry NULL and the discovery
-- consumer skips them with a warning (they predate recoverability; the
-- operator resumes those from the UI).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 218 are not edited.

ALTER TABLE migration_execution_run
  ADD COLUMN company TEXT NULL;

ALTER TABLE migration_execution_run
  ADD COLUMN project TEXT NULL;

COMMENT ON COLUMN migration_execution_run.company IS
  'Workspace company NAME the run was created under (2026-08-07): scope key for the gateway boot-recovery sweep''s cross-project in-flight discovery. Set at creation; never PATCHed. NULL on pre-219 rows.';

COMMENT ON COLUMN migration_execution_run.project IS
  'Workspace project NAME the run was created under (2026-08-07): scope key for the gateway boot-recovery sweep''s cross-project in-flight discovery. Set at creation; never PATCHed. NULL on pre-219 rows.';
