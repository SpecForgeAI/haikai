package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for an Application Load Balancer Exposure relationship (XR4).
 *
 * Cross-domain wiring: Application (via application_points) -> Load Balancer
 * with optional drill-down to a Listener (Q2: load_balancer_id NOT NULL +
 * listener_id NULL).
 *
 * target_port is Integer (numeric at DB level; numeric-as-text in the grid per
 * spec 4 precedent). confidence is BigDecimal (DECIMAL(4,3) at the DB layer);
 * no DB CHECK and no JPA validation.
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 * model_file_id is server-side only and not exposed.
 */
public record ApplicationLoadBalancerExposureDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("application_point_id")
    String applicationPointId,

    @JsonProperty("load_balancer_id")
    String loadBalancerId,

    @JsonProperty("listener_id")
    String listenerId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("host_name")
    String hostName,

    @JsonProperty("path_pattern")
    String pathPattern,

    @JsonProperty("protocol")
    String protocol,

    @JsonProperty("target_port")
    Integer targetPort,

    @JsonProperty("exposure")
    String exposure,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
