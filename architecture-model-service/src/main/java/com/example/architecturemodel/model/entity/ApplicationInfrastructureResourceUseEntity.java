package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing an Application Infrastructure Resource Use
 * relationship (XR3).
 *
 * Wires an Application/Service (via application_points) to an Infrastructure
 * Resource (bucket, queue, topic, cache, secret store, scheduler, registry,
 * CDN, etc.).
 *
 * Q7: environment_id is nullable on all 4 cross-domain relationships.
 *
 * description and tags are non-null TEXT (envelope contract). confidence is
 * nullable BigDecimal at scale 3 (no DB CHECK).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Entity
@Table(name = "application_infrastructure_resource_uses")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApplicationInfrastructureResourceUseEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "application_point_id", nullable = false)
    private String applicationPointId;

    @Column(name = "infrastructure_resource_id", nullable = false)
    private String infrastructureResourceId;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "dependency_type")
    private String dependencyType;

    @Column(name = "protocol")
    private String protocol;

    @Column(name = "endpoint_or_topic")
    private String endpointOrTopic;

    @Column(name = "access_mode")
    private String accessMode;

    @Column(name = "evidence_source")
    private String evidenceSource;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;
}
