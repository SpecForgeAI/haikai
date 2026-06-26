-- 201-target-manifest-tier2-facts.sql
-- Spec: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2 Free
--       Facts (2026-06-26) -- Task Group 7 (R7/FR7).
--
-- Adds the tier2_facts JSONB column to target_manifest_artifacts so the Tier-2
-- "free facts" -- manifest-declared technology OUTSIDE the 51 architecture
-- questions (e.g. an MCP SDK, a Spring AI / LLM client), named by the upload
-- LLM gap-fill -- PERSIST alongside the confirmed manifest and feed the
-- prompt-ready output / seed-build-files.
--
-- Stored as a JSONB array of { friendly_name, coordinate } objects, mirroring
-- the resolved_dependencies JSONB column on the same table (the AMS side stores
-- the element objects opaquely). Informational only -- these are NEVER new
-- questions and never ride target_state_captured_decisions.
--
-- NULLABLE, no backfill: existing rows read it back null (the entity defaults it
-- to an empty list, the DTO maps a null read back to an empty list, so reads are
-- total).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only (200 is the highest sequential on disk
-- at build time); changesets <= 200 are not edited. Registered AFTER 200 in
-- db.changelog-master.yaml with the not-columnExists precondition idiom
-- (onFail MARK_RAN) so a re-run is a clean no-op (mirrors 200 / 195 / 198).

ALTER TABLE target_manifest_artifacts
  ADD COLUMN tier2_facts JSONB;

COMMENT ON COLUMN target_manifest_artifacts.tier2_facts IS
  'JSONB array of Tier-2 "free facts" -- manifest-declared technology OUTSIDE the 51 architecture questions (e.g. MCP SDK, Spring AI / LLM client), named by the upload LLM gap-fill. Each element is { friendly_name, coordinate }. Informational only (never new questions); feeds the prompt-ready output. Nullable; legacy rows read back null. Spec: Target Dependency-Manifest Auto-Answer (Comprehensive) + Tier-2 Free Facts (2026-06-26).';
