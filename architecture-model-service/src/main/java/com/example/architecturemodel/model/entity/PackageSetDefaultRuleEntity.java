package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

/**
 * PackageSetDefaultRule entity - stores matching rules for resolving "Default (Auto)" package set selections.
 *
 * Rules are evaluated against Service.core_tech and Service.service_type fields.
 * First matching rule (by priority) determines the default PackageSet for a Service.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Entity
@Table(name = "package_set_default_rules")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PackageSetDefaultRuleEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     * Rules from PROJECT source take precedence on conflicts.
     */
    @Column(name = "standard_source", nullable = false, length = 16)
    private String standardSource;

    /**
     * Foreign key to the PackageSet this rule resolves to.
     */
    @Column(name = "package_set_id", nullable = false)
    private String packageSetId;

    /**
     * JSON array of keywords to match against Service.core_tech (case-insensitive).
     * All keywords must be present for a match.
     * Example: '["java", "spring"]' matches "Java, Spring Boot, PostgreSQL"
     */
    @Column(name = "core_tech_includes", nullable = false, columnDefinition = "TEXT")
    private String coreTechIncludes;

    /**
     * JSON array of keywords to match against Service.service_type (case-insensitive).
     * All keywords must be present for a match.
     * Example: '["api"]' matches "REST API"
     */
    @Column(name = "service_type_includes", nullable = false, columnDefinition = "TEXT")
    private String serviceTypeIncludes;

    /**
     * Priority for rule evaluation (higher = checked first).
     * Default is 0.
     */
    @Column(name = "priority", nullable = false)
    private Integer priority;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
