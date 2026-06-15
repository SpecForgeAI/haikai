-- ============================================================================
-- Migration 036: Add is_internal column to applications table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column to classify applications as internal or external.
-- Default TRUE means existing applications are treated as internal.
-- ============================================================================

ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE;
