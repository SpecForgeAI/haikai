-- 153-migration-story-spec-generations-quality-scoring.sql
-- Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` (introduced by changeset 140,
-- already extended by changesets 141, 146, 149, 150) with the four columns
-- that drive the new deterministic rules-based quality score:
--
--   * quality_score             -- SMALLINT, nullable, CHECK 0..100.
--                                  Composite 0-100 score (weighted average of
--                                  the five sub-dimensions) computed at
--                                  persist time by SpecQualityScorer. NULL
--                                  when the row is insufficient_context or
--                                  failed (skip-scoring rule) or when the
--                                  row pre-dates this deploy (caught up by
--                                  the bulk recompute endpoint).
--   * quality_grade             -- VARCHAR(1), nullable, CHECK IN
--                                  ('A','B','C','D','F'). Letter-grade band
--                                  derived from quality_score using the
--                                  pinned thresholds (A >= 85, B 70-84,
--                                  C 55-69, D 40-54, F < 40). NULL whenever
--                                  quality_score is NULL.
--   * quality_dimensions_json   -- JSONB, nullable, holds a list of
--                                  { dimension, score, reason } per the
--                                  five sub-dimensions (completeness,
--                                  ac_measurability, implementation_concreteness,
--                                  evidence_density, sibling_parent_alignment).
--                                  NULL whenever quality_score is NULL.
--   * previous_quality_score    -- SMALLINT, nullable, CHECK 0..100. Single
--                                  immediately-previous score captured when
--                                  an existing row is overwritten by persistOne.
--                                  Drives the drawer delta chip; we keep ONE
--                                  prior value only, no full history table.
--                                  NULL on first-time scoring.
--
-- All four columns are NULLABLE by design:
--   - existing rows pre-deploy carry NULL until the bulk-recompute catch-up
--     runs (the deploy-day affordance);
--   - rows with status=insufficient_context or status=failed legitimately
--     carry NULL because scoring is skipped for them (per spec: do NOT
--     compute zero, that would falsely lump these in with F-graded specs
--     that DO have content).
--
-- Boxed entity-side mapping (Integer / String / List<Map<String,Object>>)
-- per project_primitive_double_dto_overwrite.md: a primitive int / boolean
-- would silently default to 0 / false on a Jackson PATCH that omits the
-- field, and could wipe a previously-set score.
--
-- The CHECK constraints are the source of truth for the score range and the
-- grade vocabulary. Service-layer code mirrors them cooperatively but the
-- database is authoritative.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 152 are not edited.

ALTER TABLE migration_story_spec_generations
  ADD COLUMN quality_score            SMALLINT  NULL,
  ADD COLUMN quality_grade            VARCHAR(1) NULL,
  ADD COLUMN quality_dimensions_json  JSONB     NULL,
  ADD COLUMN previous_quality_score   SMALLINT  NULL;

ALTER TABLE migration_story_spec_generations
  ADD CONSTRAINT chk_msg_quality_score
    CHECK (quality_score IS NULL OR (quality_score BETWEEN 0 AND 100));

ALTER TABLE migration_story_spec_generations
  ADD CONSTRAINT chk_msg_quality_grade
    CHECK (quality_grade IS NULL OR quality_grade IN ('A', 'B', 'C', 'D', 'F'));

ALTER TABLE migration_story_spec_generations
  ADD CONSTRAINT chk_msg_previous_quality_score
    CHECK (previous_quality_score IS NULL OR (previous_quality_score BETWEEN 0 AND 100));

COMMENT ON COLUMN migration_story_spec_generations.quality_score IS
  'Composite 0-100 quality score (weighted average of the five sub-dimensions: completeness 30, ac_measurability 25, implementation_concreteness 20, evidence_density 15, sibling_parent_alignment 10) computed at persist time by SpecQualityScorer. NULL when status is insufficient_context / failed (scoring skipped) or when the row pre-dates this deploy. Boxed Integer on the entity. CHECK chk_msg_quality_score enforces the 0-100 range. Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.quality_grade IS
  'Letter-grade band (A/B/C/D/F) derived from quality_score using pinned thresholds A >= 85, B 70-84, C 55-69, D 40-54, F < 40. NULL whenever quality_score is NULL. Drives the hierarchy grade chip and the dashboard grade filter. CHECK chk_msg_quality_grade enforces the vocabulary. Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.quality_dimensions_json IS
  'List of { dimension, score, reason } maps -- one per sub-dimension -- produced by SpecQualityScorer. Rendered in the drawer Quality breakdown section. NULL whenever quality_score is NULL. Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.previous_quality_score IS
  'Single immediately-previous quality_score captured at overwrite time (no full history table). Drives the drawer delta chip when the derived letter grade changes. NULL on first-time scoring. CHECK chk_msg_previous_quality_score enforces the 0-100 range. Spec: Spec Quality Scoring (2026-05-20) -- Task Group 1.';
