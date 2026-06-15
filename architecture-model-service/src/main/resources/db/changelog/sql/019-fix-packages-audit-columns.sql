-- ============================================================================
-- Migration 019: Fix Packages Audit Columns
-- Adds missing created_at and updated_at columns to packages table
-- to align database schema with PackageEntity JPA mappings
--
-- Resolves Hibernate schema validation error:
--   Schema-validation: missing column [created_at] in table [packages]
-- ============================================================================

-- ============================================================================
-- 1. ADD AUDIT COLUMNS (IF NOT EXISTS for idempotency)
-- ============================================================================

ALTER TABLE packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- ============================================================================
-- 2. BACKFILL EXISTING ROWS
-- Use COALESCE to avoid overwriting any existing values
-- ============================================================================

UPDATE packages SET created_at = COALESCE(created_at, now());
UPDATE packages SET updated_at = COALESCE(updated_at, now());

-- ============================================================================
-- 3. SET DEFAULTS FOR NEW ROWS
-- ============================================================================

ALTER TABLE packages ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE packages ALTER COLUMN updated_at SET DEFAULT now();

-- ============================================================================
-- 4. ENFORCE NOT NULL CONSTRAINTS
-- Safe to apply after backfill ensures no NULL values exist
-- ============================================================================

ALTER TABLE packages ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE packages ALTER COLUMN updated_at SET NOT NULL;
