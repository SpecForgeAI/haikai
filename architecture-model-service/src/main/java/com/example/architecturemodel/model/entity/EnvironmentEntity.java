package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing an Environment.
 *
 * An environment scopes cloud accounts, locations, networks, etc. into
 * DEV / TEST / STAGING / PROD / DR / CURRENT_STATE / TARGET_STATE / OTHER groupings.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "environments")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EnvironmentEntity {

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

    @Column(name = "environment_type")
    private String environmentType;

    @Column(name = "lifecycle_state")
    private String lifecycleState;

    @Column(name = "is_current_state")
    private Boolean isCurrentState;

    @Column(name = "is_target_state")
    private Boolean isTargetState;

    @Column(name = "owner")
    private String owner;

    @Column(name = "criticality")
    private String criticality;

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
