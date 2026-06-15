package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for DataStoreInstance.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record DataStoreInstanceDto(
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

    @JsonProperty("data_store_type")
    String dataStoreType,

    @JsonProperty("engine")
    String engine,

    @JsonProperty("engine_version")
    String engineVersion,

    @JsonProperty("provider")
    String provider,

    @JsonProperty("host")
    String host,

    @JsonProperty("port")
    Integer port,

    @JsonProperty("external_id")
    String externalId,

    @JsonProperty("encrypted")
    Boolean encrypted,

    @JsonProperty("ha_enabled")
    Boolean haEnabled,

    @JsonProperty("backup_enabled")
    Boolean backupEnabled,

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
