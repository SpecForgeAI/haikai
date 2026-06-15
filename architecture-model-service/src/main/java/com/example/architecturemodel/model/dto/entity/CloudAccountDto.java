package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for CloudAccount.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record CloudAccountDto(
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

    @JsonProperty("provider")
    String provider,

    @JsonProperty("external_account_id")
    String externalAccountId,

    @JsonProperty("parent_org_id")
    String parentOrgId,

    @JsonProperty("billing_owner")
    String billingOwner,

    @JsonProperty("technical_owner")
    String technicalOwner,

    @JsonProperty("landing_zone_name")
    String landingZoneName
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
