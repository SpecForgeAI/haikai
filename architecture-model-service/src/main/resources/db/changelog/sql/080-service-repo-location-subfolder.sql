-- 080-service-repo-location-subfolder.sql
-- Spec: Service-Scoped Discovery
--
-- Adds repo_location and repo_subfolder columns to the services table.
-- repo_location stores the Git repository URL or local folder path for
-- the service's source code. repo_subfolder optionally narrows the scan
-- scope to a specific directory within the repository.
-- Both columns are nullable free-text with no validation.

-- Step 1: Add repo_location column
ALTER TABLE services ADD COLUMN repo_location TEXT;

-- Step 2: Add repo_subfolder column
ALTER TABLE services ADD COLUMN repo_subfolder TEXT;
