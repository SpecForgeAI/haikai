-- 143-project-spec-generation-config.sql
-- Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
--       (2026-05-20) -- Task Group 9
--
-- Adds three per-project configuration columns on the `project` table to drive
-- the bounded two-pass shape-spec generator:
--
--   * per_story_context_token_cap   -- INTEGER, nullable, DB DEFAULT 24000.
--                                      Maximum tokens spent on per-story
--                                      content (focused context, evidence
--                                      refs, findings) when assembling the
--                                      LLM payload. Mirrors the default in
--                                      BudgetMetaTracker.DEFAULT_PER_STORY_TOKEN_CAP.
--   * cross_story_context_token_cap -- INTEGER, nullable, DB DEFAULT 12000.
--                                      Maximum tokens spent on cross-story
--                                      content (sibling summaries, workstream
--                                      context) on pass 2. Mirrors the default
--                                      in BudgetMetaTracker.DEFAULT_CROSS_STORY_TOKEN_CAP.
--   * auto_run_pass_2               -- BOOLEAN, nullable, DB DEFAULT TRUE.
--                                      Per-project default for whether the
--                                      gateway should automatically run pass 2
--                                      after pass 1 completes during a batch
--                                      Generate-all. The per-batch toggle in
--                                      the Generate-all dialog defaults to this
--                                      value; setting it to false leaves a
--                                      manual "Regenerate with sibling context"
--                                      action.
--
-- All three columns are nullable so the entity exposes them as BOXED reference
-- types (Integer / Boolean) per project_primitive_double_dto_overwrite.md.
-- Jackson maps a missing JSON field on a PATCH to the primitive default (0 /
-- false) which would silently wipe an explicit user setting -- boxed fields
-- plus null-guarded update handlers protect against this. The DB DEFAULT
-- clauses are what give existing rows the documented fallback values without a
-- separate backfill statement: any column added with a DEFAULT is also
-- back-filled by Postgres at ALTER TABLE time (since Postgres 11 this is a
-- metadata-only operation and does not rewrite the table).
--
-- The AMS resolver (MigrationSpecContextResolver) reads these caps from the
-- project row before constructing BudgetMetaTracker; if a value is null (which
-- should not happen given the DB DEFAULTs but is defensively handled) the
-- tracker falls back to its compile-time DEFAULT_*_TOKEN_CAP constants. This
-- mirrors the two-layer defaulting posture used elsewhere in the codebase.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; the earlier project changesets
-- (013-project-table, 027-project-hierarchy, 053-project-repo-url) are not
-- edited.

ALTER TABLE project
  ADD COLUMN per_story_context_token_cap   INTEGER NULL DEFAULT 24000,
  ADD COLUMN cross_story_context_token_cap INTEGER NULL DEFAULT 12000,
  ADD COLUMN auto_run_pass_2               BOOLEAN NULL DEFAULT TRUE;

COMMENT ON COLUMN project.per_story_context_token_cap IS
  'Per-project cap on tokens spent on per-story content (focused context, evidence refs, findings) when assembling each shape-spec generation payload. Default 24000 (mirrors BudgetMetaTracker.DEFAULT_PER_STORY_TOKEN_CAP). Boxed Integer on the entity so PATCH preserves null per project_primitive_double_dto_overwrite. Spec: Cross-Story Context Injection (2026-05-20) -- Task Group 9.';

COMMENT ON COLUMN project.cross_story_context_token_cap IS
  'Per-project cap on tokens spent on cross-story content (sibling summaries, workstream context) when assembling each pass-2 shape-spec generation payload. Default 12000 (mirrors BudgetMetaTracker.DEFAULT_CROSS_STORY_TOKEN_CAP). Boxed Integer on the entity. Spec: Cross-Story Context Injection (2026-05-20) -- Task Group 9.';

COMMENT ON COLUMN project.auto_run_pass_2 IS
  'Per-project default for whether the gateway should automatically run pass 2 after pass 1 completes during a batch Generate-all. Default TRUE. The per-batch toggle in the Generate-all dialog defaults to this value; setting it to false leaves a manual "Regenerate with sibling context" action. Boxed Boolean on the entity. Spec: Cross-Story Context Injection (2026-05-20) -- Task Group 9.';
