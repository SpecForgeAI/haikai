package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for DeploymentUnit.
 *
 * Q1: service_id is a direct typed FK to services(id), NOT polymorphic via
 * ApplicationPoint. JSON property name: service_id; Java field: serviceId.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record DeploymentUnitDto(
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

    @JsonProperty("service_id")
    String serviceId,

    @JsonProperty("deployment_unit_type")
    String deploymentUnitType,

    @JsonProperty("version")
    String version,

    @JsonProperty("artifact_uri")
    String artifactUri,

    @JsonProperty("image_name")
    String imageName,

    @JsonProperty("image_tag")
    String imageTag,

    @JsonProperty("source_repository")
    String sourceRepository,

    @JsonProperty("source_commit")
    String sourceCommit,

    @JsonProperty("build_pipeline")
    String buildPipeline,

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
