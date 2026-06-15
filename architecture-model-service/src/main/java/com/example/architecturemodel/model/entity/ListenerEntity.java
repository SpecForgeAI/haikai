package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing a Listener.
 *
 * Listeners attach a protocol/port/host/path-pattern to a load balancer (or
 * directly to a compute resource). A1 decision: compute_resource_id is a
 * direct typed FK to compute_resources -- NOT polymorphic via
 * InfrastructurePoint. Polymorphic routing targets are handled by R3
 * (load_balancer_resource_routes.target_infrastructure_point_id).
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "listeners")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListenerEntity {

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

    @Column(name = "load_balancer_id")
    private String loadBalancerId;

    /**
     * Direct typed FK to compute_resources(id) per A1 decision.
     * NOT polymorphic via InfrastructurePoint.
     */
    @Column(name = "compute_resource_id")
    private String computeResourceId;

    @Column(name = "protocol")
    private String protocol;

    @Column(name = "port")
    private Integer port;

    @Column(name = "host_name")
    private String hostName;

    @Column(name = "path_pattern")
    private String pathPattern;

    @Column(name = "exposure")
    private String exposure;

    @Column(name = "is_public")
    private Boolean isPublic;

    @Column(name = "certificate_reference")
    private String certificateReference;

    @Column(name = "external_id")
    private String externalId;

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
