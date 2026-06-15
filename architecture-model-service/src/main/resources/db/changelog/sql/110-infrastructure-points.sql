-- ============================================================================
-- Infrastructure Domain: Infrastructure Points Table (polymorphic supertype)
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Modelled after data_entity_points (typed-FK-per-target + discriminator +
-- exactly-one-FK CHECK + per-FK partial unique indexes), NOT after
-- application_points's hybrid target_type/target_ref_id style.
--
-- Used by the 3 infrastructure relationships to point at any of the 12
-- infrastructure entity types via a single polymorphic FK. The DB-level CHECK
-- constraint enforces (a) exactly one of the 12 typed FK columns is non-null
-- AND (b) point_kind matches the set FK (12-way disjunction).
-- ============================================================================

CREATE TABLE infrastructure_points (
  id                            TEXT PRIMARY KEY,
  model_file_id                 TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  point_kind                    TEXT NOT NULL,
  environment_id                TEXT REFERENCES environments(id),
  cloud_account_id              TEXT REFERENCES cloud_accounts(id),
  location_id                   TEXT REFERENCES locations(id),
  network_id                    TEXT REFERENCES networks(id),
  subnet_id                     TEXT REFERENCES subnets(id),
  compute_cluster_id            TEXT REFERENCES compute_clusters(id),
  compute_resource_id           TEXT REFERENCES compute_resources(id),
  deployment_unit_id            TEXT REFERENCES deployment_units(id),
  load_balancer_id              TEXT REFERENCES load_balancers(id),
  listener_id                   TEXT REFERENCES listeners(id),
  data_store_instance_id        TEXT REFERENCES data_store_instances(id),
  infrastructure_resource_id    TEXT REFERENCES infrastructure_resources(id),

  -- ==========================================================================
  -- CHECK constraint: exactly one of the 12 typed FK columns is non-null AND
  -- point_kind matches the set FK. 12-way disjunction with consistency.
  -- ==========================================================================
  CONSTRAINT chk_infrastructure_points_exactly_one_fk
    CHECK (
      (point_kind = 'ENVIRONMENT'             AND environment_id             IS NOT NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'CLOUD_ACCOUNT'           AND cloud_account_id           IS NOT NULL AND environment_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'LOCATION'                AND location_id                IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'NETWORK'                 AND network_id                 IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'SUBNET'                  AND subnet_id                  IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'COMPUTE_CLUSTER'         AND compute_cluster_id         IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'COMPUTE_RESOURCE'        AND compute_resource_id        IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'DEPLOYMENT_UNIT'         AND deployment_unit_id         IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'LOAD_BALANCER'           AND load_balancer_id           IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'LISTENER'                AND listener_id                IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'DATA_STORE_INSTANCE'     AND data_store_instance_id     IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND infrastructure_resource_id IS NULL)
      OR
      (point_kind = 'INFRASTRUCTURE_RESOURCE' AND infrastructure_resource_id IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL)
    )
);

-- ============================================================================
-- PARTIAL UNIQUE INDEXES (one per FK)
-- Ensure no duplicate (model_file_id, <fk_id>) per FK while allowing duplicate
-- NULLs. Mirrors the data_entity_points pattern.
-- ============================================================================

CREATE UNIQUE INDEX uq_infra_points_environment_per_model
  ON infrastructure_points(model_file_id, environment_id)
  WHERE environment_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_cloud_account_per_model
  ON infrastructure_points(model_file_id, cloud_account_id)
  WHERE cloud_account_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_location_per_model
  ON infrastructure_points(model_file_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_network_per_model
  ON infrastructure_points(model_file_id, network_id)
  WHERE network_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_subnet_per_model
  ON infrastructure_points(model_file_id, subnet_id)
  WHERE subnet_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_compute_cluster_per_model
  ON infrastructure_points(model_file_id, compute_cluster_id)
  WHERE compute_cluster_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_compute_resource_per_model
  ON infrastructure_points(model_file_id, compute_resource_id)
  WHERE compute_resource_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_deployment_unit_per_model
  ON infrastructure_points(model_file_id, deployment_unit_id)
  WHERE deployment_unit_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_load_balancer_per_model
  ON infrastructure_points(model_file_id, load_balancer_id)
  WHERE load_balancer_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_listener_per_model
  ON infrastructure_points(model_file_id, listener_id)
  WHERE listener_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_data_store_instance_per_model
  ON infrastructure_points(model_file_id, data_store_instance_id)
  WHERE data_store_instance_id IS NOT NULL;

CREATE UNIQUE INDEX uq_infra_points_infrastructure_resource_per_model
  ON infrastructure_points(model_file_id, infrastructure_resource_id)
  WHERE infrastructure_resource_id IS NOT NULL;

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_infrastructure_points_model_file ON infrastructure_points(model_file_id);
