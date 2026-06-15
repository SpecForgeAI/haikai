-- ============================================================================
-- Migration 038: Add is_internal column to services table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column to classify services as internal or external.
-- Default TRUE means existing services are treated as internal.
-- ============================================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE;
