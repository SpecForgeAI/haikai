package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for an IaC Resource Binding relationship.
 *
 * Maps an IaC source to an Infrastructure entity (via infrastructure_points
 * polymorphic supertype) at a specific Terraform / cloud-resource address.
 *
 * Relationship envelope: NO `name` field. confidence is BigDecimal
 * (DECIMAL(4,3) at the DB layer); no DB CHECK and no JPA validation -- range
 * is documentation-only, producers clamp. start_line / end_line are nullable
 * Integer.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 * model_file_id is server-side only and not exposed.
 */
public record IaCResourceBindingDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("iac_source_id")
    String iacSourceId,

    @JsonProperty("infrastructure_point_id")
    String infrastructurePointId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("iac_address")
    String iacAddress,

    @JsonProperty("iac_resource_type")
    String iacResourceType,

    @JsonProperty("iac_resource_name")
    String iacResourceName,

    @JsonProperty("provider")
    String provider,

    @JsonProperty("file_path")
    String filePath,

    @JsonProperty("start_line")
    Integer startLine,

    @JsonProperty("end_line")
    Integer endLine,

    @JsonProperty("state_resource_id")
    String stateResourceId,

    @JsonProperty("external_id")
    String externalId,

    @JsonProperty("binding_status")
    String bindingStatus,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("last_seen_at")
    String lastSeenAt,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
