-- 081-discovery-run-service-id.sql
-- Spec: Service-Scoped Discovery
--
-- Adds service_id column to the discovery_run table with a FK reference
-- to services(id). This links a discovery run to a specific service for
-- service-scoped discovery flows. When present, the run is scoped to
-- that service's repository and technology stack.

-- Step 1: Add service_id column with FK reference
ALTER TABLE discovery_run ADD COLUMN service_id TEXT REFERENCES services(id);

-- Step 2: Add index for FK query performance
CREATE INDEX IF NOT EXISTS idx_discovery_run_service_id ON discovery_run(service_id);
