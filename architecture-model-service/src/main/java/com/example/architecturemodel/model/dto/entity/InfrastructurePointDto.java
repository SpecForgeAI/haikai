package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for an Infrastructure Point.
 *
 * Infrastructure Points act as polymorphic reference wrappers for the 12
 * infrastructure entity types (Environment, CloudAccount, Location, Network,
 * Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer,
 * Listener, DataStoreInstance, InfrastructureResource), enabling the 3
 * infrastructure relationship tables to point at any of them through a single
 * polymorphic FK.
 *
 * Mirrors {@link DataEntityPointDto} verbatim for shape: discriminator
 * (point_kind) + 12 nullable typed FK fields. Does NOT use the older
 * target_type/target_ref_id hybrid style.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record InfrastructurePointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("point_kind")
    String pointKind,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("cloud_account_id")
    String cloudAccountId,

    @JsonProperty("location_id")
    String locationId,

    @JsonProperty("network_id")
    String networkId,

    @JsonProperty("subnet_id")
    String subnetId,

    @JsonProperty("compute_cluster_id")
    String computeClusterId,

    @JsonProperty("compute_resource_id")
    String computeResourceId,

    @JsonProperty("deployment_unit_id")
    String deploymentUnitId,

    @JsonProperty("load_balancer_id")
    String loadBalancerId,

    @JsonProperty("listener_id")
    String listenerId,

    @JsonProperty("data_store_instance_id")
    String dataStoreInstanceId,

    @JsonProperty("infrastructure_resource_id")
    String infrastructureResourceId
) {}
