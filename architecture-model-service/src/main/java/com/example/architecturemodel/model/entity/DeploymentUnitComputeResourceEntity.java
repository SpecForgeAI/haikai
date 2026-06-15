package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.math.BigDecimal;

/**
 * JPA entity representing a Deployment Unit Runs On Compute relationship (R2).
 *
 * Polymorphic compute target via compute_infrastructure_point_id (A2 decision:
 * renamed from compute_resource_id). The referenced InfrastructurePoint must
 * have point_kind = COMPUTE_RESOURCE or COMPUTE_CLUSTER -- this is
 * documentation-only and NOT enforced by an additional DB CHECK in this spec.
 *
 * runtime_config is the ONLY JSONB column introduced by this spec (Q5). Stored
 * as a raw JSON string blob; the caller serialises/deserialises shape. Mapped
 * via Hypersistence Utils' {@code JsonType} (the same JSONB binding used by
 * existing entities such as ServiceEntity.coreTechResolved and
 * DiscoveryEvidenceEntity.data), with a String target for raw round-trip.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "deployment_unit_compute_resources")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeploymentUnitComputeResourceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "deployment_unit_id", nullable = false)
    private String deploymentUnitId;

    /**
     * A2: polymorphic compute target. References infrastructure_points(id);
     * the referenced row's point_kind should be COMPUTE_RESOURCE or
     * COMPUTE_CLUSTER (documentation-only; not DB-enforced).
     */
    @Column(name = "compute_infrastructure_point_id", nullable = false)
    private String computeInfrastructurePointId;

    /**
     * Q7: environment_id is preserved on every relationship; cross-row
     * consistency (matching endpoints' environments) is caller-enforced.
     */
    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(name = "version")
    private String version;

    /**
     * Q5: the only JSONB column in this spec. Stored as a raw JSON String;
     * the caller is responsible for producing valid JSON. Bound via
     * Hypersistence's JsonType, matching the project's existing JSONB
     * persistence convention.
     */
    @Type(JsonType.class)
    @Column(name = "runtime_config", columnDefinition = "jsonb")
    private String runtimeConfig;

    @Column(name = "desired_instances")
    private Integer desiredInstances;

    @Column(name = "min_instances")
    private Integer minInstances;

    @Column(name = "max_instances")
    private Integer maxInstances;

    @Column(name = "deployment_status")
    private String deploymentStatus;

    @Column(name = "evidence_source")
    private String evidenceSource;

    /**
     * Q4: nullable DECIMAL(4,3); no DB CHECK, no JPA validation.
     */
    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "tags")
    private String tags;

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
}
