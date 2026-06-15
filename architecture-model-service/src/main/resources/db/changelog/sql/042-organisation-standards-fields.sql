-- ============================================================================
-- Migration 042: Organisation Standards Fields and Case-Insensitive Name Index
-- Spec: Organisation Model + DB + API DTOs (Backend Foundation)
--
-- Adds six TEXT columns for storing JSON-serialized List<String> values used
-- for document categorization in future global standards generation features.
-- Also adds a boolean flag for tracking standards generation state.
--
-- Additionally replaces the existing case-sensitive unique index on name with
-- a case-insensitive unique index to prevent duplicate organisations that
-- differ only by case (e.g., "Acme" vs "acme").
--
-- All new columns are nullable for backward compatibility with existing data.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add document categorization columns (six List<String> as JSON TEXT)
-- ============================================================================

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_all_sources TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_tech_stack TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_coding_styles TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_conventions TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_error_handling TEXT;
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS docs_applied_to_validation TEXT;

-- ============================================================================
-- STEP 2: Add boolean flag for standards generation state
-- ============================================================================

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS tech_standards_generated BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- STEP 3: Replace case-sensitive unique index with case-insensitive version
-- Drop existing idx_organisations_name if present, then create new index.
-- ============================================================================

DROP INDEX IF EXISTS idx_organisations_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organisations_name_ci ON organisations(LOWER(name));
