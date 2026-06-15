package com.example.architecturemodel.model.dto.migration;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Readiness assessment derived by {@code MigrationDiscoveryContextService}
 * from the loaded discovery / baseline / mapping aggregates.
 *
 * <p>Per-stream status values are one of {@code "sufficient"},
 * {@code "partial"}, {@code "insufficient"}. Overall status follows the rules
 * documented in raw-idea Part 6: {@code "sufficient"} only when core selected
 * streams are sufficient; {@code "partial"} when prerequisite work could
 * resolve gaps; {@code "insufficient"} when critical inputs are missing.</p>
 *
 * <p>{@code gaps} is a list of stable gap codes drawn from the fixed
 * enum-like set documented in {@link MigrationGapCodes}.</p>
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1
 * (D2).</p>
 */
public record ReadinessAssessmentDto(
    @JsonProperty("overallStatus")
    String overallStatus,

    @JsonProperty("apiReadiness")
    String apiReadiness,

    @JsonProperty("dataReadiness")
    String dataReadiness,

    @JsonProperty("infrastructureReadiness")
    String infrastructureReadiness,

    @JsonProperty("discoveryReadiness")
    String discoveryReadiness,

    @JsonProperty("mappingReadiness")
    String mappingReadiness,

    @JsonProperty("baselineReadiness")
    String baselineReadiness,

    @JsonProperty("decisionReadiness")
    String decisionReadiness,

    @JsonProperty("gaps")
    List<String> gaps
) {}
