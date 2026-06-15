package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * PackageSetDefaultRule DTO - stores matching rules for resolving "Default (Auto)" package set selections.
 *
 * Rules are evaluated against Service.core_tech and Service.service_type fields.
 * First matching rule (by priority) determines the default PackageSet for a Service.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
public record PackageSetDefaultRuleDto(
    @JsonProperty("id")
    String id,

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     */
    @JsonProperty("standard_source")
    String standardSource,

    /**
     * ID of the PackageSet this rule resolves to.
     */
    @JsonProperty("package_set_id")
    String packageSetId,

    /**
     * List of keywords to match against Service.core_tech (case-insensitive).
     * All keywords must be present for a match.
     * Example: ["java", "spring"] matches "Java, Spring Boot, PostgreSQL"
     */
    @JsonProperty("core_tech_includes")
    List<String> coreTechIncludes,

    /**
     * List of keywords to match against Service.service_type (case-insensitive).
     * All keywords must be present for a match.
     * Example: ["api"] matches "REST API"
     */
    @JsonProperty("service_type_includes")
    List<String> serviceTypeIncludes,

    /**
     * Priority for rule evaluation (higher = checked first).
     * Default is 0.
     */
    @JsonProperty("priority")
    Integer priority
) {}
