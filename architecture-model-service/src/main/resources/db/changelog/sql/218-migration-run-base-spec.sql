-- 218-migration-run-base-spec.sql
-- Run-branch chaining (2026-08-06)
--
-- Sequential migration runs previously branched EVERY spec's worktree from
-- pristine default -- spec 12 could not see spec 1's code, shared files
-- add/add-conflicted at assembly, and specs re-invented each other's
-- scaffolding. The gateway driver now chains each dispatch off the last GOOD
-- spec's branch. Within a run the base derives from the run-items themselves
-- (the last successfully implemented/deployed item's spec_name); ACROSS runs
-- (a "Start Stage 2" that must continue Stage 1's unmerged work) the chosen
-- base is resolved once at run creation and persisted here:
--
--   * base_spec -> the spec name whose feature/<base_spec>[--<folder>]
--                  branch(es) form the base for this run's FIRST dispatch.
--                  NULL = start fresh from the default branch (operator chose
--                  "start from main" at the Start-stage dialog, or no prior
--                  run exists). Persisted so retries, resume-from-failure and
--                  the boot-recovery sweep re-derive the same base after a
--                  gateway restart.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 217 are not edited.

ALTER TABLE migration_execution_run
  ADD COLUMN base_spec TEXT NULL;

COMMENT ON COLUMN migration_execution_run.base_spec IS
  'Run-branch chaining (2026-08-06): spec name whose feature branch(es) form the base ref for this run''s first dispatch. NULL = base off the default branch. Resolved at run creation (cross-run stage chaining); within-run chaining derives from the run-items.';
