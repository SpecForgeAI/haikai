-- ============================================================================
-- Infrastructure Domain: Provenance Fields
-- Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
-- Adds 6 nullable provenance columns (source_origin, source_system,
-- source_reference, generation_status, generation_notes, last_verified_at)
-- to each of the 12 Infrastructure entity tables AND the 3 Infra-internal
-- relationship tables (15 tables total). The 4 spec-6 cross-domain
-- relationship tables are NOT extended (per Q2). Backwards-compatible:
-- existing rows have NULL in the new columns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 12 ENTITY TABLES
-- ---------------------------------------------------------------------------

ALTER TABLE environments              ADD COLUMN source_origin TEXT;
ALTER TABLE environments              ADD COLUMN source_system TEXT;
ALTER TABLE environments              ADD COLUMN source_reference TEXT;
ALTER TABLE environments              ADD COLUMN generation_status TEXT;
ALTER TABLE environments              ADD COLUMN generation_notes TEXT;
ALTER TABLE environments              ADD COLUMN last_verified_at TEXT;

ALTER TABLE cloud_accounts            ADD COLUMN source_origin TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN source_system TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN source_reference TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN generation_status TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN generation_notes TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN last_verified_at TEXT;

ALTER TABLE locations                 ADD COLUMN source_origin TEXT;
ALTER TABLE locations                 ADD COLUMN source_system TEXT;
ALTER TABLE locations                 ADD COLUMN source_reference TEXT;
ALTER TABLE locations                 ADD COLUMN generation_status TEXT;
ALTER TABLE locations                 ADD COLUMN generation_notes TEXT;
ALTER TABLE locations                 ADD COLUMN last_verified_at TEXT;

ALTER TABLE networks                  ADD COLUMN source_origin TEXT;
ALTER TABLE networks                  ADD COLUMN source_system TEXT;
ALTER TABLE networks                  ADD COLUMN source_reference TEXT;
ALTER TABLE networks                  ADD COLUMN generation_status TEXT;
ALTER TABLE networks                  ADD COLUMN generation_notes TEXT;
ALTER TABLE networks                  ADD COLUMN last_verified_at TEXT;

ALTER TABLE subnets                   ADD COLUMN source_origin TEXT;
ALTER TABLE subnets                   ADD COLUMN source_system TEXT;
ALTER TABLE subnets                   ADD COLUMN source_reference TEXT;
ALTER TABLE subnets                   ADD COLUMN generation_status TEXT;
ALTER TABLE subnets                   ADD COLUMN generation_notes TEXT;
ALTER TABLE subnets                   ADD COLUMN last_verified_at TEXT;

ALTER TABLE compute_clusters          ADD COLUMN source_origin TEXT;
ALTER TABLE compute_clusters          ADD COLUMN source_system TEXT;
ALTER TABLE compute_clusters          ADD COLUMN source_reference TEXT;
ALTER TABLE compute_clusters          ADD COLUMN generation_status TEXT;
ALTER TABLE compute_clusters          ADD COLUMN generation_notes TEXT;
ALTER TABLE compute_clusters          ADD COLUMN last_verified_at TEXT;

ALTER TABLE compute_resources         ADD COLUMN source_origin TEXT;
ALTER TABLE compute_resources         ADD COLUMN source_system TEXT;
ALTER TABLE compute_resources         ADD COLUMN source_reference TEXT;
ALTER TABLE compute_resources         ADD COLUMN generation_status TEXT;
ALTER TABLE compute_resources         ADD COLUMN generation_notes TEXT;
ALTER TABLE compute_resources         ADD COLUMN last_verified_at TEXT;

ALTER TABLE deployment_units          ADD COLUMN source_origin TEXT;
ALTER TABLE deployment_units          ADD COLUMN source_system TEXT;
ALTER TABLE deployment_units          ADD COLUMN source_reference TEXT;
ALTER TABLE deployment_units          ADD COLUMN generation_status TEXT;
ALTER TABLE deployment_units          ADD COLUMN generation_notes TEXT;
ALTER TABLE deployment_units          ADD COLUMN last_verified_at TEXT;

ALTER TABLE load_balancers            ADD COLUMN source_origin TEXT;
ALTER TABLE load_balancers            ADD COLUMN source_system TEXT;
ALTER TABLE load_balancers            ADD COLUMN source_reference TEXT;
ALTER TABLE load_balancers            ADD COLUMN generation_status TEXT;
ALTER TABLE load_balancers            ADD COLUMN generation_notes TEXT;
ALTER TABLE load_balancers            ADD COLUMN last_verified_at TEXT;

ALTER TABLE listeners                 ADD COLUMN source_origin TEXT;
ALTER TABLE listeners                 ADD COLUMN source_system TEXT;
ALTER TABLE listeners                 ADD COLUMN source_reference TEXT;
ALTER TABLE listeners                 ADD COLUMN generation_status TEXT;
ALTER TABLE listeners                 ADD COLUMN generation_notes TEXT;
ALTER TABLE listeners                 ADD COLUMN last_verified_at TEXT;

ALTER TABLE data_store_instances      ADD COLUMN source_origin TEXT;
ALTER TABLE data_store_instances      ADD COLUMN source_system TEXT;
ALTER TABLE data_store_instances      ADD COLUMN source_reference TEXT;
ALTER TABLE data_store_instances      ADD COLUMN generation_status TEXT;
ALTER TABLE data_store_instances      ADD COLUMN generation_notes TEXT;
ALTER TABLE data_store_instances      ADD COLUMN last_verified_at TEXT;

ALTER TABLE infrastructure_resources  ADD COLUMN source_origin TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN source_system TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN source_reference TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN generation_status TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN generation_notes TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN last_verified_at TEXT;

-- ---------------------------------------------------------------------------
-- 3 INFRA-INTERNAL RELATIONSHIP TABLES
-- ---------------------------------------------------------------------------

ALTER TABLE resource_subnet_hostings           ADD COLUMN source_origin TEXT;
ALTER TABLE resource_subnet_hostings           ADD COLUMN source_system TEXT;
ALTER TABLE resource_subnet_hostings           ADD COLUMN source_reference TEXT;
ALTER TABLE resource_subnet_hostings           ADD COLUMN generation_status TEXT;
ALTER TABLE resource_subnet_hostings           ADD COLUMN generation_notes TEXT;
ALTER TABLE resource_subnet_hostings           ADD COLUMN last_verified_at TEXT;

ALTER TABLE deployment_unit_compute_resources  ADD COLUMN source_origin TEXT;
ALTER TABLE deployment_unit_compute_resources  ADD COLUMN source_system TEXT;
ALTER TABLE deployment_unit_compute_resources  ADD COLUMN source_reference TEXT;
ALTER TABLE deployment_unit_compute_resources  ADD COLUMN generation_status TEXT;
ALTER TABLE deployment_unit_compute_resources  ADD COLUMN generation_notes TEXT;
ALTER TABLE deployment_unit_compute_resources  ADD COLUMN last_verified_at TEXT;

ALTER TABLE load_balancer_resource_routes      ADD COLUMN source_origin TEXT;
ALTER TABLE load_balancer_resource_routes      ADD COLUMN source_system TEXT;
ALTER TABLE load_balancer_resource_routes      ADD COLUMN source_reference TEXT;
ALTER TABLE load_balancer_resource_routes      ADD COLUMN generation_status TEXT;
ALTER TABLE load_balancer_resource_routes      ADD COLUMN generation_notes TEXT;
ALTER TABLE load_balancer_resource_routes      ADD COLUMN last_verified_at TEXT;
