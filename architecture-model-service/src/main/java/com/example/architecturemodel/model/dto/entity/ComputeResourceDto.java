package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for ComputeResource.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record ComputeResourceDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("cloud_account_id")
    String cloudAccountId,

    @JsonProperty("location_id")
    String locationId,

    @JsonProperty("cluster_id")
    String clusterId,

    @JsonProperty("compute_type")
    String computeType,

    @JsonProperty("provider")
    String provider,

    @JsonProperty("hostname")
    String hostname,

    @JsonProperty("fqdn")
    String fqdn,

    @JsonProperty("private_ip")
    String privateIp,

    @JsonProperty("public_ip")
    String publicIp,

    @JsonProperty("os")
    String os,

    @JsonProperty("runtime")
    String runtime,

    @JsonProperty("instance_size")
    String instanceSize,

    @JsonProperty("scaling_min")
    Integer scalingMin,

    @JsonProperty("scaling_max")
    Integer scalingMax,

    @JsonProperty("external_id")
    String externalId,

    @JsonProperty("lifecycle_state")
    String lifecycleState,

    @JsonProperty("owner")
    String owner
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
    String lastVerifiedAt,

    // ========================================================================
    // Terraform readiness fields (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // ========================================================================

    @JsonProperty("terraform_ready")
    Boolean terraformReady,

    @JsonProperty("terraform_module_hint")
    String terraformModuleHint,

    @JsonProperty("terraform_resource_hint")
    String terraformResourceHint,

    @JsonProperty("terraform_variable_hints")
    String terraformVariableHints,

    @JsonProperty("terraform_notes")
    String terraformNotes
) {}
