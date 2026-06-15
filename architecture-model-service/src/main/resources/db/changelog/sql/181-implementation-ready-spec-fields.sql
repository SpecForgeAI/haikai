-- 181-implementation-ready-spec-fields.sql
-- Spec: Implementation-Ready Migration Spec Generation (2026-06-14, Spec 1 of 4)
--       -- Task Group 1
--
-- Adds two new nullable JSONB columns to migration_story_spec_generations so
-- the enriched migration shape-spec generator can persist an
-- implementation-ready test pack and forward-only endpoint-coverage groundwork:
--
--   migration_story_spec_generations (2 new nullable columns):
--     - structured_tests_json JSONB NULL -- the structured unit/functional
--       test pack. Array of { title, description, type } where type is one of
--       'unit' | 'functional' (integration / E2E are EXCLUDED -- Spec 2).
--       Maps 1:1 to a TestDefinition so it can populate
--       latestTestPlannerResponse.testPlan on the Implement screen AND render
--       inline into generated_spec_text. List<Map<String,Object>> / @Type(JsonType)
--       on the Java side, mirroring the existing warnings_json /
--       quality_dimensions_json sibling-JSONB idiom on this entity. NULL when
--       no structured tests are present (failed / insufficient_context rows).
--     - covered_endpoint_ids JSONB NULL -- forward-only groundwork (D9): the
--       model EndpointEntity UUIDs this story migrates, best-effort grounded in
--       the already-resolved migration context. EMPTY array for non-endpoint
--       stories (DB schema build, DB data migration, other-service code,
--       infra); never fabricated. List<String> / @Type(JsonType) on the Java
--       side, mirroring decisions_json / evidence_refs_json. NOT consumed by
--       any v1 feature -- captured now so a future break-cause classification
--       feature needs no story-side backfill.
--
-- Both columns nullable, boxed reference types, no backfill: existing
-- spec-generation rows are untouched and read back with the new fields null.
-- No @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets (<= 180) per
-- feedback_liquibase_immutable_changesets.md.

ALTER TABLE migration_story_spec_generations ADD COLUMN structured_tests_json jsonb NULL;
ALTER TABLE migration_story_spec_generations ADD COLUMN covered_endpoint_ids jsonb NULL;

COMMENT ON COLUMN migration_story_spec_generations.structured_tests_json IS
  'Structured unit/functional test pack: array of { title, description, type } with type in (unit, functional) -- integration/E2E excluded (Spec 2). Maps 1:1 to TestDefinition for latestTestPlannerResponse.testPlan and renders inline into generated_spec_text. NULL for failed / insufficient_context rows. Spec: Implementation-Ready Migration Spec Generation (2026-06-14).';

COMMENT ON COLUMN migration_story_spec_generations.covered_endpoint_ids IS
  'Forward-only groundwork (D9): model EndpointEntity UUIDs this story migrates, grounded in the already-resolved migration context. EMPTY array for non-endpoint stories (DB schema / data migration / other-service / infra); never fabricated. NOT consumed in v1 -- captured so a future break-cause feature needs no story-side backfill. Spec: Implementation-Ready Migration Spec Generation (2026-06-14).';
