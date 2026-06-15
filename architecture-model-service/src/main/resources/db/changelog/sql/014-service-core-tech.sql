-- ============================================================================
-- Migration 014: Add core_tech column to services table
-- Spec: Add Service.Core Tech Column and Change Service Type to Free-Text
--
-- Adds a new core_tech TEXT column to the services table for documenting
-- the languages, tools, and frameworks used by each service.
-- ============================================================================

ALTER TABLE services ADD COLUMN core_tech TEXT;
