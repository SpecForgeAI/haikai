package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing a Load Balancer Routes To Resource relationship (R3).
 *
 * Polymorphic target via target_infrastructure_point_id. The relationship maps
 * a load balancer (and optionally a specific listener) to a target
 * infrastructure point. The optional listener_id ties the route to a specific
 * listener on the load balancer; when null the route applies at load-balancer
 * level.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 */
@Entity
@Table(name = "load_balancer_resource_routes")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LoadBalancerResourceRouteEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "load_balancer_id", nullable = false)
    private String loadBalancerId;

    @Column(name = "listener_id")
    private String listenerId;

    /**
     * R3: polymorphic target. References infrastructure_points(id).
     */
    @Column(name = "target_infrastructure_point_id", nullable = false)
    private String targetInfrastructurePointId;

    /**
     * Q7: environment_id is preserved on every relationship; cross-row
     * consistency (matching endpoints' environments) is caller-enforced.
     */
    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(name = "protocol")
    private String protocol;

    @Column(name = "target_port")
    private Integer targetPort;

    @Column(name = "host_name")
    private String hostName;

    @Column(name = "path_pattern")
    private String pathPattern;

    @Column(name = "routing_type")
    private String routingType;

    @Column(name = "weight")
    private Integer weight;

    @Column(name = "health_check_path")
    private String healthCheckPath;

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
