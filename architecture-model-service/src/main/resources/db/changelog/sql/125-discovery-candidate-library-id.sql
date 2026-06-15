-- ============================================================================
-- Library Discovery Integration: add library_id column to discovery_candidate
-- Spec: 2026-05-06-library-discovery-integration — Task Group 5.2
--
-- Adds a new TEXT NULL `library_id` column to the discovery_candidate table.
-- Service-rooted discovery runs continue to populate `service_id` (which lives
-- in the `data` JSONB column on this table) for back-compat; library-rooted
-- runs (and library-scoped sub-scans inside a Service-rooted run) populate the
-- new `library_id` column. Per-row contract: candidate writers populate AT
-- MOST one of `service_id` (in `data` JSONB) and `library_id` (this column).
--
-- No FK constraint — mirrors the existing service_id pattern (which lives in
-- the `data` JSONB) and per Spec 2026-05-06 § "Resolution: add library_id
-- column" the dedup / referential integrity is enforced at the find-or-create
-- endpoint layer (Spec 1) rather than at the DB level.
--
-- This is a NEW changeset (id 125-...) — never edits the previously applied
-- 070-discovery-candidate.sql file. Per project memory: applied Liquibase
-- changesets are immutable; even comment-only edits break startup with
-- checksum-validation errors.
-- ============================================================================

ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS library_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_discovery_candidate_library_id
    ON discovery_candidate (library_id) WHERE library_id IS NOT NULL;

COMMENT ON COLUMN discovery_candidate.library_id IS
    'Optional FK-shape reference to libraries.id when this candidate was produced by a library-scoped discovery run. Mutually exclusive with data.service_id (per-row contract: one of {service_id, library_id} populated, not both). No DB-level FK — referential integrity is enforced at the find-or-create endpoint layer per Spec 2026-05-05 / 2026-05-06.';
