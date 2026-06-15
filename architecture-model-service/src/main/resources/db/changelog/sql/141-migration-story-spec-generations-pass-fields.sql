-- 141-migration-story-spec-generations-pass-fields.sql
-- Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
--       (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` (introduced by changeset 140) with
-- the cross-story / two-pass columns required by the new bounded two-pass loop:
--
--   * generation_pass            -- SMALLINT, NOT NULL DEFAULT 1, CHECK 1..2.
--                                   Pass-1 rows carry 1; pass-2 rows carry 2.
--                                   Hard cap at 2 is enforced both at the
--                                   gateway handler boundary and via this
--                                   CHECK constraint.
--   * pass1_spec_text            -- TEXT, nullable. Snapshot of pass-1 output
--                                   for diffing in the UI. Pass-1 rows write
--                                   pass1_spec_text = generated_spec_text; pass-2
--                                   rows write the prior-row snapshot.
--   * pass2_changes_summary      -- TEXT, nullable. LLM-generated "what changed
--                                   and why" blurb shown above the diff on
--                                   pass-2 outputs.
--   * budget_meta_json           -- JSONB, nullable. Mirrors the resolver's
--                                   `budget_meta` for the actually-executed
--                                   call: { used_tokens, max_tokens,
--                                   trimmed: { sibling_specs_dropped,
--                                   evidence_refs_dropped } }.
--   * no_meaningful_change       -- BOOLEAN, nullable. True when pass-2 output
--                                   is byte-equivalent to pass-1 after
--                                   normalized whitespace compare.
--   * decisions_json             -- JSONB, nullable. Parser-extracted decisions
--                                   from generated_spec_text at write time.
--   * interfaces_json            -- JSONB, nullable. Parser-extracted interfaces.
--   * assumptions_json           -- JSONB, nullable. Parser-extracted assumptions.
--
-- All new boolean / numeric fields are nullable so the AMS entity exposes them
-- as boxed reference types (Integer / Boolean) and PATCH semantics preserve
-- existing values when a DTO omits a field (project_primitive_double_dto_overwrite).
-- The lone exception is `generation_pass`, which has a sensible NOT NULL
-- DEFAULT 1 because every persisted row must belong to a pass, but the entity
-- still maps it as boxed Integer to match the rest of the family.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changeset 140 is not edited.

ALTER TABLE migration_story_spec_generations
  ADD COLUMN generation_pass        SMALLINT  NOT NULL DEFAULT 1,
  ADD COLUMN pass1_spec_text        TEXT      NULL,
  ADD COLUMN pass2_changes_summary  TEXT      NULL,
  ADD COLUMN budget_meta_json       JSONB     NULL,
  ADD COLUMN no_meaningful_change   BOOLEAN   NULL,
  ADD COLUMN decisions_json         JSONB     NULL,
  ADD COLUMN interfaces_json        JSONB     NULL,
  ADD COLUMN assumptions_json       JSONB     NULL;

ALTER TABLE migration_story_spec_generations
  ADD CONSTRAINT chk_msg_generation_pass
  CHECK (generation_pass IN (1, 2));

COMMENT ON COLUMN migration_story_spec_generations.generation_pass IS
  'Two-pass loop position. Allowed values 1 (pass-1, no sibling context) or 2 (pass-2, sibling-aware). Enforced by chk_msg_generation_pass. Hard cap at 2 is also enforced at the gateway handler boundary (Cross-Story Context Injection spec, Task Group 5).';

COMMENT ON COLUMN migration_story_spec_generations.pass1_spec_text IS
  'Snapshot of the pass-1 generated_spec_text used to drive the inline diff view in the UI. Pass-1 rows write pass1_spec_text = generated_spec_text; pass-2 rows carry the prior-row snapshot. Nullable for failed / insufficient_context / skipped_blocked rows where no pass-1 text was produced.';

COMMENT ON COLUMN migration_story_spec_generations.pass2_changes_summary IS
  'LLM-generated "what changed and why" blurb rendered above the inline diff for pass-2 outputs. Cites the sibling spec / epic decision that caused each change. Nullable on pass-1 rows.';

COMMENT ON COLUMN migration_story_spec_generations.budget_meta_json IS
  'Mirrors the resolver budget_meta for the actually-executed call: { used_tokens, max_tokens, trimmed: { sibling_specs_dropped, evidence_refs_dropped } }. Persisted per row so the post-batch summary view can recover per-pass cost actuals.';

COMMENT ON COLUMN migration_story_spec_generations.no_meaningful_change IS
  'True when pass-2 output is byte-equivalent to pass-1 after normalized whitespace compare. Drives the "Pass 2: no meaningful change" badge in the story drawer (spec acceptance signal 10). Boxed Boolean on the entity so PATCH preserves null.';

COMMENT ON COLUMN migration_story_spec_generations.decisions_json IS
  'Parser-extracted decisions[] from generated_spec_text at write time. Single canonical source for sibling-summary content; the context resolver reads this column directly rather than re-parsing spec text at request time. Nullable when parser yields empty extraction (a warning is appended to warnings_json with kind=parser_missing_heading).';

COMMENT ON COLUMN migration_story_spec_generations.interfaces_json IS
  'Parser-extracted interfaces[] from generated_spec_text at write time. Read directly by buildSiblingSummaries(...). Nullable when parser yields empty extraction.';

COMMENT ON COLUMN migration_story_spec_generations.assumptions_json IS
  'Parser-extracted assumptions[] from generated_spec_text at write time. Read directly by buildSiblingSummaries(...). Nullable when parser yields empty extraction.';
