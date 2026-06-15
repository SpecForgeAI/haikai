package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing an Application Load Balancer Exposure relationship
 * (XR4).
 *
 * Wires an Application/Service (via application_points) to a Load Balancer
 * with an optional drill-down to a specific Listener. Q2: load_balancer_id is
 * NOT NULL and listener_id is nullable (NOT polymorphic, NOT both-nullable).
 *
 * Q7: environment_id is nullable on all 4 cross-domain relationships.
 *
 * targetPort is Integer at the JPA layer; the grid presents it as
 * numeric-as-text per spec 4 precedent.
 *
 * description and tags are non-null TEXT (envelope contract). confidence is
 * nullable BigDecimal at scale 3 (no DB CHECK).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Entity
@Table(name = "application_load_balancer_exposures")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApplicationLoadBalancerExposureEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "application_point_id", nullable = false)
    private String applicationPointId;

    @Column(name = "load_balancer_id", nullable = false)
    private String loadBalancerId;

    @Column(name = "listener_id")
    private String listenerId;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "host_name")
    private String hostName;

    @Column(name = "path_pattern")
    private String pathPattern;

    @Column(name = "protocol")
    private String protocol;

    @Column(name = "target_port")
    private Integer targetPort;

    @Column(name = "exposure")
    private String exposure;

    @Column(name = "evidence_source")
    private String evidenceSource;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;
}
