package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing a Resource-Subnet Hosting relationship (R1).
 *
 * Polymorphic source via infrastructure_point_id. The relationship attaches an
 * infrastructure point (e.g. compute resource, load balancer, infrastructure
 * resource) to a subnet within an environment. Allowed point_kind values at
 * this relationship level are documentation-only; the per-row CHECK on
 * infrastructure_points already enforces correctness at the point level.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "resource_subnet_hostings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ResourceSubnetHostingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "infrastructure_point_id", nullable = false)
    private String infrastructurePointId;

    @Column(name = "subnet_id", nullable = false)
    private String subnetId;

    /**
     * Q7: environment_id is preserved on every relationship; cross-row
     * consistency (matching endpoints' environments) is caller-enforced.
     */
    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(name = "relationship_role")
    private String relationshipRole;

    @Column(name = "primary_ip")
    private String primaryIp;

    @Column(name = "private_ip")
    private String privateIp;

    @Column(name = "public_ip")
    private String publicIp;

    @Column(name = "evidence_source")
    private String evidenceSource;

    /**
     * Q4: nullable DECIMAL(4,3); no DB CHECK, no JPA validation.
     * Range guidance (0.0 - 1.0) is documentation-only.
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
