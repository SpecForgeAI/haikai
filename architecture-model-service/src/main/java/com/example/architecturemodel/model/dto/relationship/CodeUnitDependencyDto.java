package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for a Code Unit Dependency relationship.
 *
 * Polymorphic source / Library target dependency edge using the existing
 * ApplicationPoint supertype. Doc-only target type rules (test-enforced):
 * source ApplicationPoint must have target_type IN ('SERVICE','LIBRARY');
 * target ApplicationPoint must have target_type = 'LIBRARY'.
 *
 * confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK and no
 * JPA validation -- range 0.0-1.0 is doc-only. manifest_line is nullable
 * Integer. description and tags are nullable per codebase convention.
 *
 * model_file_id is server-side only and is intentionally NOT exposed.
 *
 * Spec: 2026-05-05-library-backend-foundation
 */
public record CodeUnitDependencyDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("source_application_point_id")
    String sourceApplicationPointId,

    @JsonProperty("target_application_point_id")
    String targetApplicationPointId,

    @JsonProperty("declared_name")
    String declaredName,

    @JsonProperty("declared_version")
    String declaredVersion,

    @JsonProperty("declared_version_range")
    String declaredVersionRange,

    /**
     * Manifest-language-specific scope value stored verbatim. Doc-only allowed
     * values: Maven (COMPILE/RUNTIME/TEST/PROVIDED/OPTIONAL) and npm
     * (RUNTIME/DEV/PEER/OPTIONAL). NO DB CHECK.
     */
    @JsonProperty("scope")
    String scope,

    @JsonProperty("manifest_path")
    String manifestPath,

    @JsonProperty("manifest_line")
    Integer manifestLine,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
