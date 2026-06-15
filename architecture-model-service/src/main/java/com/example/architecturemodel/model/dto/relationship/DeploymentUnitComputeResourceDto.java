package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for a DeploymentUnit-ComputeResource relationship (R2).
 *
 * A2: polymorphic compute target via compute_infrastructure_point_id (renamed
 * from compute_resource_id). The referenced InfrastructurePoint must have
 * point_kind = COMPUTE_RESOURCE or COMPUTE_CLUSTER -- documentation-only.
 *
 * JSON property name: compute_infrastructure_point_id; Java field:
 * computeInfrastructurePointId.
 *
 * Q5: runtime_config is the only JSONB column in this spec, exposed as a raw
 * JSON String; the caller serialises/deserialises shape.
 *
 * Q4: confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK
 * and no JPA validation -- range is documentation-only.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record DeploymentUnitComputeResourceDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("deployment_unit_id")
    String deploymentUnitId,

    @JsonProperty("compute_infrastructure_point_id")
    String computeInfrastructurePointId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("version")
    String version,

    @JsonProperty("runtime_config")
    String runtimeConfig,

    @JsonProperty("desired_instances")
    Integer desiredInstances,

    @JsonProperty("min_instances")
    Integer minInstances,

    @JsonProperty("max_instances")
    Integer maxInstances,

    @JsonProperty("deployment_status")
    String deploymentStatus,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

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
