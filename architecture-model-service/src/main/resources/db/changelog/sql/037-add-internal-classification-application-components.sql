-- ============================================================================
-- Migration 037: Add is_internal and tech_type columns to application_components table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_internal BOOLEAN column for internal/external classification.
-- Adds tech_type TEXT column for technology type categorization.
-- ============================================================================

ALTER TABLE application_components
    ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS tech_type TEXT NOT NULL DEFAULT 'Other';
