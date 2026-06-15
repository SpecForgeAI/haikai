package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * Data Transfer Object for work item statistics.
 *
 * Returns work item counts grouped by type and status, plus a count of stories
 * with acceptance criteria (non-empty description).
 *
 * Spec 2026-03-06: Dashboard Real Data -- Work Item Stats Endpoint.
 */
public record WorkItemStatsDto(
    @JsonProperty("type_counts")
    Map<String, Map<String, Long>> typeCounts,

    @JsonProperty("stories_with_ac_count")
    long storiesWithAcCount
) {}
