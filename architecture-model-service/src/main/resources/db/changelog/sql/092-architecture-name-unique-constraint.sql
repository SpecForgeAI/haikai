-- ============================================================================
-- Migration 092: Architecture Name Case-Insensitive Unique Constraint
-- Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
--
-- Adds the server-side source of truth for architecture-name uniqueness within
-- a project. This prevents two architectures with names that differ only by
-- case (e.g., "Default" vs "default" vs "DEFAULT") from coexisting in the
-- same project's selector.
--
-- The application service layer also performs an explicit
-- existsByProjectIdAndNameIgnoreCase check so it can return a friendly 409
-- before hitting the DB constraint, but this index is the safety net that
-- catches concurrent writes that race past the application check.
--
-- Index name follows the project's existing convention
-- (table_columns_uidx).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS architecture_project_id_lower_name_uidx
  ON architecture (project_id, LOWER(name));
