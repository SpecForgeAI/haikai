package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing a Deployment Unit.
 *
 * Deployment units are the deployable artefacts (container image, VM image,
 * function bundle, JAR, WAR, static bundle, package). The optional service_id
 * links a unit to the deployable service it implements (Q1: direct typed FK
 * to services -- NOT polymorphic via ApplicationPoint).
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "deployment_units")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeploymentUnitEntity {

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

    /**
     * Optional direct typed FK to services(id) per Q1 decision.
     * NOT polymorphic via ApplicationPoint.
     */
    @Column(name = "service_id")
    private String serviceId;

    @Column(name = "deployment_unit_type")
    private String deploymentUnitType;

    @Column(name = "version")
    private String version;

    @Column(name = "artifact_uri")
    private String artifactUri;

    @Column(name = "image_name")
    private String imageName;

    @Column(name = "image_tag")
    private String imageTag;

    @Column(name = "source_repository")
    private String sourceRepository;

    @Column(name = "source_commit")
    private String sourceCommit;

    @Column(name = "build_pipeline")
    private String buildPipeline;

    @Column(name = "owner")
    private String owner;

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
