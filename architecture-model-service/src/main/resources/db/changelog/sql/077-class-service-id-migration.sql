-- 077-class-service-id-migration.sql
-- Spec: Extension Pack Framework & LLM File-Level Analysis
--
-- Replace the application_point_id FK on the classes table with a service_id FK
-- pointing to services(id). This simplifies class ownership: a class belongs
-- directly to a service, enabling LLM-driven candidate save-back to map
-- class -> service_id without an intermediate application_point entity.
--
-- Migration steps:
-- 1. Drop existing application_point_id column (and its implicit FK constraint)
-- 2. Add new service_id column with FK reference to services(id)
-- 3. Add index on service_id for FK query performance

-- Step 1: Drop application_point_id column
ALTER TABLE classes DROP COLUMN IF EXISTS application_point_id;

-- Step 2: Add service_id column with FK reference
ALTER TABLE classes ADD COLUMN service_id TEXT REFERENCES services(id);

-- Step 3: Add index for FK performance
CREATE INDEX IF NOT EXISTS idx_classes_service_id ON classes(service_id);
