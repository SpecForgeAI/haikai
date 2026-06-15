package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing an Application Compute Deployment relationship (XR1).
 *
 * Wires an Application/Service (via application_points) to a Compute Resource
 * with an optional drill-down to a specific Deployment Unit.
 *
 * Q7: environment_id is nullable on all 4 cross-domain relationships (differs
 * from spec 1's NOT NULL choice on Infra-internal relationships).
 *
 * description and tags are non-null TEXT (envelope contract). confidence is
 * nullable BigDecimal at scale 3 (no DB CHECK).
 *
 * All FK fields are stored as raw String columns (matches DataMovementEntity /
 * spec 2 relationship-entity pattern; no JPA association mapping).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Entity
@Table(name = "application_compute_deployments")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApplicationComputeDeploymentEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "application_point_id", nullable = false)
    private String applicationPointId;

    @Column(name = "compute_resource_id", nullable = false)
    private String computeResourceId;

    @Column(name = "deployment_unit_id")
    private String deploymentUnitId;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "deployment_role")
    private String deploymentRole;

    @Column(name = "runtime_name")
    private String runtimeName;

    @Column(name = "runtime_version")
    private String runtimeVersion;

    @Column(name = "evidence_source")
    private String evidenceSource;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;
}
