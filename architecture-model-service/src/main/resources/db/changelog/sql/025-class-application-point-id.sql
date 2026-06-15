-- 025-class-application-point-id.sql
-- Spec: Class entity single Application Point owner picker
--
-- Replace the two-column ownership model (owned_by_ref_kind + owned_by_ref_id)
-- with a single application_point_id foreign key.
--
-- Migration steps:
-- 1. Add new column application_point_id with FK to application_points
-- 2. Drop legacy columns owned_by_ref_kind and owned_by_ref_id

-- Step 1: Add application_point_id column with FK reference
ALTER TABLE classes ADD COLUMN application_point_id TEXT REFERENCES application_points(id);

-- Step 2: Drop legacy columns
ALTER TABLE classes DROP COLUMN IF EXISTS owned_by_ref_kind;
ALTER TABLE classes DROP COLUMN IF EXISTS owned_by_ref_id;
