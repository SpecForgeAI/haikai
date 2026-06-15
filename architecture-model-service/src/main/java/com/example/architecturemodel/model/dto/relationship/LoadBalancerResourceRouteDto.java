package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for a LoadBalancer-Resource Route relationship (R3).
 *
 * R3: polymorphic target via target_infrastructure_point_id; the relationship
 * maps a load balancer (and optionally a specific listener) to a target
 * infrastructure point.
 *
 * JSON property name: target_infrastructure_point_id; Java field:
 * targetInfrastructurePointId.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record LoadBalancerResourceRouteDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("load_balancer_id")
    String loadBalancerId,

    @JsonProperty("listener_id")
    String listenerId,

    @JsonProperty("target_infrastructure_point_id")
    String targetInfrastructurePointId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("protocol")
    String protocol,

    @JsonProperty("target_port")
    Integer targetPort,

    @JsonProperty("host_name")
    String hostName,

    @JsonProperty("path_pattern")
    String pathPattern,

    @JsonProperty("routing_type")
    String routingType,

    @JsonProperty("weight")
    Integer weight,

    @JsonProperty("health_check_path")
    String healthCheckPath,

    @JsonProperty("tags")
    String tags
,

    // ========================================================================
    // Provenance fields (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // ========================================================================

    @JsonProperty("source_origin")
    String sourceOrigin,

    @JsonProperty("source_system")
    String sourceSystem,

    @JsonProperty("source_reference")
    String sourceReference,

    @JsonProperty("generation_status")
    String generationStatus,

    @JsonProperty("generation_notes")
    String generationNotes,

    @JsonProperty("last_verified_at")
    String lastVerifiedAt
) {}
