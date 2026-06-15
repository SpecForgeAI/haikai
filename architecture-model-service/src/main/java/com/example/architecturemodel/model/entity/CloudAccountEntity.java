package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing a Cloud Account.
 *
 * Cloud accounts (e.g. GCP project, AWS account, Azure subscription) live
 * inside an environment and own the locations, networks, and resources within.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "cloud_accounts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CloudAccountEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(name = "provider")
    private String provider;

    @Column(name = "external_account_id")
    private String externalAccountId;

    @Column(name = "parent_org_id")
    private String parentOrgId;

    @Column(name = "billing_owner")
    private String billingOwner;

    @Column(name = "technical_owner")
    private String technicalOwner;

    @Column(name = "landing_zone_name")
    private String landingZoneName;

    // ========================================================================
    // Provenance fields (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // 6 nullable fields recording origin, system, reference, status, notes, and
    // verified-at timestamp. Populated by future discovery / import pipelines.
    // ========================================================================

    @Column(name = "source_origin")
    private String sourceOrigin;

    @Column(name = "source_system")
    private String sourceSystem;

    @Column(name = "source_reference")
    private String sourceReference;

    @Column(name = "generation_status")
    private String generationStatus;

    @Column(name = "generation_notes")
    private String generationNotes;

    @Column(name = "last_verified_at")
    private String lastVerifiedAt;

    // ========================================================================
    // Terraform readiness fields (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // 5 nullable fields recording whether a Terraform module/resource hint is
    // available and analyser notes. terraform_variable_hints is TEXT (raw JSON
    // string) NOT JSONB (per Q9, parallel to the existing tags convention).
    // ========================================================================

    @Column(name = "terraform_ready")
    private Boolean terraformReady;

    @Column(name = "terraform_module_hint")
    private String terraformModuleHint;

    @Column(name = "terraform_resource_hint")
    private String terraformResourceHint;

    @Column(name = "terraform_variable_hints")
    private String terraformVariableHints;

    @Column(name = "terraform_notes")
    private String terraformNotes;
}
