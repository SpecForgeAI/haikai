package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing an IaC Resource Binding relationship.
 *
 * Maps an IaC source (iac_sources) to an Infrastructure entity (via
 * infrastructure_points polymorphic supertype) at a specific Terraform /
 * cloud-resource address. Relationship-shaped envelope: NO `name` column;
 * description and tags are non-null TEXT.
 *
 * confidence is BigDecimal at DECIMAL(4,3); no DB CHECK and no JPA validation
 * -- range is documentation-only, producers clamp. start_line / end_line are
 * nullable Integer.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 */
@Entity
@Table(name = "iac_resource_bindings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IaCResourceBindingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "iac_source_id", nullable = false)
    private String iacSourceId;

    @Column(name = "infrastructure_point_id", nullable = false)
    private String infrastructurePointId;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "iac_address")
    private String iacAddress;

    @Column(name = "iac_resource_type")
    private String iacResourceType;

    @Column(name = "iac_resource_name")
    private String iacResourceName;

    @Column(name = "provider")
    private String provider;

    @Column(name = "file_path")
    private String filePath;

    @Column(name = "start_line")
    private Integer startLine;

    @Column(name = "end_line")
    private Integer endLine;

    @Column(name = "state_resource_id")
    private String stateResourceId;

    @Column(name = "external_id")
    private String externalId;

    @Column(name = "binding_status")
    private String bindingStatus;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "last_seen_at")
    private String lastSeenAt;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;
}
