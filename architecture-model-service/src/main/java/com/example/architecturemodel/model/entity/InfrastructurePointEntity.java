package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Check;

/**
 * JPA entity representing an Infrastructure Point.
 *
 * Infrastructure Points act as polymorphic reference wrappers for the 12
 * infrastructure entity types (Environment, CloudAccount, Location, Network,
 * Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer,
 * Listener, DataStoreInstance, InfrastructureResource), enabling the 3
 * infrastructure relationship tables (resource_subnet_hostings,
 * deployment_unit_compute_resources, load_balancer_resource_routes) to point
 * at any of them through a single polymorphic FK.
 *
 * Mirrors {@link DataEntityPointEntity} verbatim for structure: typed-FK-per-
 * target + discriminator + DB-level CHECK + per-FK partial unique indexes.
 * Does NOT use ApplicationPointEntity's hybrid target_type/target_ref_id style.
 *
 * The {@link Check} annotation mirrors the SQL CHECK from changeset
 * 110-infrastructure-points.sql so the constraint is enforceable in the
 * H2-based test environment (which uses ddl-auto=create-drop with Liquibase
 * disabled).
 *
 * The 12 unique constraints on (model_file_id, &lt;fk_id&gt;) approximate the
 * Liquibase partial unique indexes for the H2 test environment. SQL standard
 * unique constraints treat NULLs as distinct, so duplicate NULLs are allowed
 * just as the partial index intends.
 *
 * <p><b>Target Architecture Authoring Flow extension (2026-05-20, Task Group 1):</b>
 * Liquibase changeset 145 adds two authoring-metadata columns,
 * {@link #provenance} and {@link #decommissioningStatus}. Both are NULLABLE
 * boxed {@link String} reference types so PATCH semantics preserve null per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(
    name = "infrastructure_points",
    uniqueConstraints = {
        @UniqueConstraint(name = "uq_infra_points_environment_per_model",          columnNames = {"model_file_id", "environment_id"}),
        @UniqueConstraint(name = "uq_infra_points_cloud_account_per_model",        columnNames = {"model_file_id", "cloud_account_id"}),
        @UniqueConstraint(name = "uq_infra_points_location_per_model",             columnNames = {"model_file_id", "location_id"}),
        @UniqueConstraint(name = "uq_infra_points_network_per_model",              columnNames = {"model_file_id", "network_id"}),
        @UniqueConstraint(name = "uq_infra_points_subnet_per_model",               columnNames = {"model_file_id", "subnet_id"}),
        @UniqueConstraint(name = "uq_infra_points_compute_cluster_per_model",      columnNames = {"model_file_id", "compute_cluster_id"}),
        @UniqueConstraint(name = "uq_infra_points_compute_resource_per_model",     columnNames = {"model_file_id", "compute_resource_id"}),
        @UniqueConstraint(name = "uq_infra_points_deployment_unit_per_model",      columnNames = {"model_file_id", "deployment_unit_id"}),
        @UniqueConstraint(name = "uq_infra_points_load_balancer_per_model",        columnNames = {"model_file_id", "load_balancer_id"}),
        @UniqueConstraint(name = "uq_infra_points_listener_per_model",             columnNames = {"model_file_id", "listener_id"}),
        @UniqueConstraint(name = "uq_infra_points_data_store_instance_per_model",  columnNames = {"model_file_id", "data_store_instance_id"}),
        @UniqueConstraint(name = "uq_infra_points_infrastructure_resource_per_model", columnNames = {"model_file_id", "infrastructure_resource_id"})
    }
)
@Check(constraints =
    "(point_kind = 'ENVIRONMENT'             AND environment_id             IS NOT NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'CLOUD_ACCOUNT'           AND cloud_account_id           IS NOT NULL AND environment_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'LOCATION'                AND location_id                IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'NETWORK'                 AND network_id                 IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'SUBNET'                  AND subnet_id                  IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'COMPUTE_CLUSTER'         AND compute_cluster_id         IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'COMPUTE_RESOURCE'        AND compute_resource_id        IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'DEPLOYMENT_UNIT'         AND deployment_unit_id         IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'LOAD_BALANCER'           AND load_balancer_id           IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'LISTENER'                AND listener_id                IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND data_store_instance_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'DATA_STORE_INSTANCE'     AND data_store_instance_id     IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND infrastructure_resource_id IS NULL)" +
    " OR " +
    "(point_kind = 'INFRASTRUCTURE_RESOURCE' AND infrastructure_resource_id IS NOT NULL AND environment_id IS NULL AND cloud_account_id IS NULL AND location_id IS NULL AND network_id IS NULL AND subnet_id IS NULL AND compute_cluster_id IS NULL AND compute_resource_id IS NULL AND deployment_unit_id IS NULL AND load_balancer_id IS NULL AND listener_id IS NULL AND data_store_instance_id IS NULL)"
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InfrastructurePointEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "point_kind", nullable = false)
    private String pointKind;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "cloud_account_id")
    private String cloudAccountId;

    @Column(name = "location_id")
    private String locationId;

    @Column(name = "network_id")
    private String networkId;

    @Column(name = "subnet_id")
    private String subnetId;

    @Column(name = "compute_cluster_id")
    private String computeClusterId;

    @Column(name = "compute_resource_id")
    private String computeResourceId;

    @Column(name = "deployment_unit_id")
    private String deploymentUnitId;

    @Column(name = "load_balancer_id")
    private String loadBalancerId;

    @Column(name = "listener_id")
    private String listenerId;

    @Column(name = "data_store_instance_id")
    private String dataStoreInstanceId;

    @Column(name = "infrastructure_resource_id")
    private String infrastructureResourceId;

    /**
     * Authoring provenance for this infrastructure element. Allowed values:
     * {@code cloned-from} / {@code imported} / {@code user-authored} /
     * {@code llm-suggested}. Nullable. Enforced by DB CHECK
     * {@code chk_infrastructure_points_provenance} (changeset 145). Spec:
     * Target Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "provenance", length = 32)
    private String provenance;

    /**
     * Target-side decommissioning vocabulary. Allowed values:
     * {@code not-applicable} / {@code proposed} / {@code decommissioned}.
     * Nullable. Enforced by DB CHECK
     * {@code chk_infrastructure_points_decom_status} (changeset 145). Spec:
     * Target Architecture Authoring Flow (2026-05-20).
     */
    @Column(name = "decommissioning_status", length = 32)
    private String decommissioningStatus;
}
