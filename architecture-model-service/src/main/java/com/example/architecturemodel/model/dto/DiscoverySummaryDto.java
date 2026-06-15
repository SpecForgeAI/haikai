package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for aggregated discovery summary metrics for a project.
 *
 * Returns the latest discovery run's status and key counts used by the
 * Dashboard discovery summary card. All counts are simple integers (no
 * percentages or quality scores).
 *
 * When no discovery runs exist for a project, all fields should be null/zero
 * to represent the empty state.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 1: Backend Discovery Summary Endpoint
 *
 * @param latestRunId UUID of the most recent discovery run (null if no runs exist)
 * @param latestRunStatus Status of the most recent run (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
 * @param latestRunCreatedAt ISO-8601 timestamp of the most recent run's creation
 * @param totalCandidates Total number of candidates in the latest run
 * @param candidateCountsByStatus Map of status to count (e.g., {"proposed": 5, "accepted": 3})
 * @param entitiesSaved Total number of entity mappings across all runs for the project
 * @param entityTypeCoverage Number of distinct entity types with at least one mapping
 */
public record DiscoverySummaryDto(
    @JsonProperty("latest_run_id")
    UUID latestRunId,

    @JsonProperty("latest_run_status")
    String latestRunStatus,

    @JsonProperty("latest_run_created_at")
    String latestRunCreatedAt,

    @JsonProperty("total_candidates")
    long totalCandidates,

    @JsonProperty("candidate_counts_by_status")
    Map<String, Long> candidateCountsByStatus,

    @JsonProperty("entities_saved")
    long entitiesSaved,

    @JsonProperty("entity_type_coverage")
    int entityTypeCoverage
) {}
