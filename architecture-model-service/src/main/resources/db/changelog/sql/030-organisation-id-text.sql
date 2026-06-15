-- ============================================================================
-- Migration 030: Organisation ID Type Change (UUID to TEXT)
-- Spec: Organisation ID Type Change (UUID to TEXT)
--
-- Changes organisation.id and project.organisation_id from UUID to TEXT type
-- to maintain consistency with existing database patterns where entities use
-- TEXT-based IDs with prefixes (e.g., "org-xxxx").
--
-- This migration:
-- 1. Drops the existing FK constraint fk_project_organisation
-- 2. Alters organisations.id column from UUID to TEXT
-- 3. Alters project.organisation_id column from UUID to TEXT
-- 4. Re-adds the FK constraint referencing TEXT columns
--
-- Existing UUID values will be cast to TEXT representation (uuid::text).
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop existing FK constraint from project table
-- ============================================================================
-- Must drop FK before altering the referenced column type

ALTER TABLE project DROP CONSTRAINT IF EXISTS fk_project_organisation;

-- ============================================================================
-- STEP 2: Alter organisations.id column from UUID to TEXT
-- ============================================================================
-- Existing UUID values are automatically cast to their string representation

ALTER TABLE organisations ALTER COLUMN id TYPE TEXT USING id::text;

-- ============================================================================
-- STEP 3: Alter project.organisation_id column from UUID to TEXT
-- ============================================================================
-- Existing UUID values are automatically cast to their string representation

ALTER TABLE project ALTER COLUMN organisation_id TYPE TEXT USING organisation_id::text;

-- ============================================================================
-- STEP 4: Re-add FK constraint with TEXT column types
-- ============================================================================
-- Re-establish referential integrity with ON DELETE RESTRICT behavior

ALTER TABLE project
  ADD CONSTRAINT fk_project_organisation
  FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT;
