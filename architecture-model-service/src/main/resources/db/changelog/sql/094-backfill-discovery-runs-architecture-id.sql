-- ============================================================================
-- Migration 094: Backfill architecture_id on discovery_run
-- Spec: Discovery Service architectureId Integration (Spec #4)
--
-- For every existing discovery_run row, sets architecture_id = project_id.
--
-- This exploits spec #1's deterministic-Default rule (changeset 088):
-- `architecture.id = project.id` for the auto-created `Default` architecture
-- of each project. Because every project's Default row was inserted in 088
-- with id = project.id, the backfill needs no JOIN -- the project_id column
-- already holds the correct architecture_id value for the Default.
--
-- Idempotency: the UPDATE has a `WHERE architecture_id IS NULL` guard, so
-- re-running this changeset is a no-op (zero rows updated).
--
-- Pre-existing discovery_run rows are silently backfilled to their project's
-- Default architecture -- no banner, no "legacy" tag, per spec #4 decision #4.
--
-- Safety: the YAML changeset wraps this SQL with a SQL precondition that
-- asserts every distinct project_id in discovery_run has a matching
-- architecture row with id = project_id. If the precondition fails (e.g.
-- spec #1 changeset 088 was somehow skipped or the deterministic Default rule
-- was broken by manual data fix-ups), the migration HALTs loudly rather
-- than leaving NULL architecture_ids that would later fail the NOT NULL
-- enforcement in 095.
-- ============================================================================

UPDATE discovery_run
   SET architecture_id = project_id
 WHERE architecture_id IS NULL;
