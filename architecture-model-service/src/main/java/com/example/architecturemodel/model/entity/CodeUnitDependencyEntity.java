package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing a Code Unit Dependency relationship.
 *
 * Polymorphic source / Library target dependency edge using the existing
 * {@link ApplicationPointEntity} supertype for both endpoints. Doc-only target
 * type rules (test-enforced):
 * <ul>
 *   <li>{@code target_application_point_id} must reference an ApplicationPoint
 *       with {@code target_type = 'LIBRARY'}.</li>
 *   <li>{@code source_application_point_id} must reference an ApplicationPoint
 *       with {@code target_type IN ('SERVICE','LIBRARY')}.</li>
 * </ul>
 * No DB triggers, no denorm columns, no extra CHECKs -- spec-7 convention.
 *
 * confidence is BigDecimal at DECIMAL(4,3); no DB CHECK and no JPA validation
 * (range 0.0-1.0 doc-only). manifest_line is nullable Integer. description and
 * tags are nullable per codebase convention.
 *
 * Spec: 2026-05-05-library-backend-foundation
 */
@Entity
@Table(name = "code_unit_dependencies")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CodeUnitDependencyEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "source_application_point_id", nullable = false)
    private String sourceApplicationPointId;

    @Column(name = "target_application_point_id", nullable = false)
    private String targetApplicationPointId;

    @Column(name = "declared_name")
    private String declaredName;

    @Column(name = "declared_version")
    private String declaredVersion;

    @Column(name = "declared_version_range")
    private String declaredVersionRange;

    /**
     * Manifest-language-specific scope value stored verbatim. Doc-only allowed
     * values: Maven (COMPILE, RUNTIME, TEST, PROVIDED, OPTIONAL) and npm
     * (RUNTIME, DEV, PEER, OPTIONAL). NO DB CHECK.
     */
    @Column(name = "scope")
    private String scope;

    @Column(name = "manifest_path")
    private String manifestPath;

    @Column(name = "manifest_line")
    private Integer manifestLine;

    @Column(name = "evidence_source")
    private String evidenceSource;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;
}
