-- 149-migration-story-spec-generations-missing-input-keys-json.sql
-- Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` (introduced by changeset 140,
-- already extended by changesets 141, 146) with a new nullable JSONB column
-- `missing_input_keys_json` carrying the list of stable missing-input keys
-- (16-hex-char SHA-256 truncations) produced at spec-emit time when the row's
-- status is `insufficient_context`.
--
-- Semantics:
--   * NULL          -- no keys (either status != insufficient_context, or all
--                      surfaced missing_inputs[] items were out-of-v1 types).
--   * [..., ..., .] -- one entry per v1-type missing input (api_contract /
--                      mapping / target_element). Out-of-v1 types never
--                      produce a key and never appear here.
--
-- Why a parallel column rather than a derived view over missing_inputs_json:
--   * Cross-story matcher needs to filter on key membership (`WHERE key IN
--     missing_input_keys_json`) for the ready-to-retry query; storing the
--     hashed keys alongside avoids per-row JSON-walking at query time.
--   * The unhashed `missing_inputs_json` is kept for UI display (it carries
--     the human-readable service / operation / element names); the new column
--     is the machine-friendly index. Both are written by AMS at emit time.
--
-- Boxed entity-side mapping: List<String> via JsonType per
-- project_primitive_double_dto_overwrite.md.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 148 are not edited.

ALTER TABLE migration_story_spec_generations
  ADD COLUMN missing_input_keys_json JSONB NULL;

COMMENT ON COLUMN migration_story_spec_generations.missing_input_keys_json IS
  'List<String> of stable 16-hex-char missing-input keys produced by MissingInputKeyHasher at spec-emit time when status=insufficient_context. NULL when no v1-type missing inputs are present. Indexed by the cross-story matcher and the ready-to-retry query. Spec: Missing Input Resolver Flow (2026-05-20).';
