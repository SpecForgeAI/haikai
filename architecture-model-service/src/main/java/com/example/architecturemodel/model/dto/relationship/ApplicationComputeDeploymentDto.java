package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for an Application Compute Deployment relationship (XR1).
 *
 * Cross-domain wiring: Application (via application_points) -> Compute Resource
 * with optional drill-down to a Deployment Unit.
 *
 * confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK and no
 * JPA validation -- range is documentation-only.
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 * model_file_id is server-side only and not exposed.
 */
public record ApplicationComputeDeploymentDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("application_point_id")
    String applicationPointId,

    @JsonProperty("compute_resource_id")
    String computeResourceId,

    @JsonProperty("deployment_unit_id")
    String deploymentUnitId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("deployment_role")
    String deploymentRole,

    @JsonProperty("runtime_name")
    String runtimeName,

    @JsonProperty("runtime_version")
    String runtimeVersion,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
