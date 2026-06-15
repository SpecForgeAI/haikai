package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoverySummaryDto;
import com.example.architecturemodel.service.DiscoverySummaryService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Controller tests for DiscoverySummaryController.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 1: Backend Discovery Summary Endpoint
 *
 * Tests:
 * 1. Summary endpoint returns latest run info, candidate counts by status,
 *    entity mapping count, and coverage counts for a project with discovery data
 * 2. Summary endpoint returns empty/default response when no discovery runs exist
 * 3. Candidate count-by-status aggregation correctly groups proposed/accepted/rejected/merged
 * 4. Coverage count returns the number of distinct entity types with at least one mapping
 */
@WebMvcTest(DiscoverySummaryController.class)
class DiscoverySummaryControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private DiscoverySummaryService discoverySummaryService;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final String BASE_URL = "/api/model/projects/{projectId}/architectures/{architectureId}/discovery/summary";

    /**
     * Test 1: Summary endpoint returns latest run info, candidate counts, entity
     * mapping count, and coverage counts for a project with discovery data.
     */
    @Test
    @DisplayName("Test 1: GET summary returns full metrics when discovery runs exist")
    void getSummary_returnsFullMetrics_whenRunsExist() throws Exception {
        // Given
        UUID latestRunId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-04-01T10:00:00Z");

        DiscoverySummaryDto summary = new DiscoverySummaryDto(
            latestRunId,
            "COMPLETED",
            createdAt.toString(),
            12,
            Map.of("proposed", 5L, "accepted", 4L, "rejected", 2L, "merged", 1L),
            8,
            3
        );

        when(discoverySummaryService.getSummary(PROJECT_ID)).thenReturn(summary);

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.latest_run_id").value(latestRunId.toString()))
            .andExpect(jsonPath("$.latest_run_status").value("COMPLETED"))
            .andExpect(jsonPath("$.latest_run_created_at").value(createdAt.toString()))
            .andExpect(jsonPath("$.total_candidates").value(12))
            .andExpect(jsonPath("$.candidate_counts_by_status.proposed").value(5))
            .andExpect(jsonPath("$.candidate_counts_by_status.accepted").value(4))
            .andExpect(jsonPath("$.candidate_counts_by_status.rejected").value(2))
            .andExpect(jsonPath("$.candidate_counts_by_status.merged").value(1))
            .andExpect(jsonPath("$.entities_saved").value(8))
            .andExpect(jsonPath("$.entity_type_coverage").value(3));

        verify(discoverySummaryService).getSummary(PROJECT_ID);
    }

    /**
     * Test 2: Summary endpoint returns empty/default response when no discovery
     * runs exist for a project.
     */
    @Test
    @DisplayName("Test 2: GET summary returns empty response when no runs exist")
    void getSummary_returnsEmptyResponse_whenNoRunsExist() throws Exception {
        // Given
        DiscoverySummaryDto emptySummary = new DiscoverySummaryDto(
            null, null, null, 0, Collections.emptyMap(), 0, 0
        );

        when(discoverySummaryService.getSummary(PROJECT_ID)).thenReturn(emptySummary);

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.latest_run_id").doesNotExist())
            .andExpect(jsonPath("$.latest_run_status").doesNotExist())
            .andExpect(jsonPath("$.latest_run_created_at").doesNotExist())
            .andExpect(jsonPath("$.total_candidates").value(0))
            .andExpect(jsonPath("$.candidate_counts_by_status").isEmpty())
            .andExpect(jsonPath("$.entities_saved").value(0))
            .andExpect(jsonPath("$.entity_type_coverage").value(0));

        verify(discoverySummaryService).getSummary(PROJECT_ID);
    }

    /**
     * Test 3: Candidate count-by-status aggregation correctly groups counts
     * when only some statuses have non-zero counts.
     */
    @Test
    @DisplayName("Test 3: GET summary returns only non-zero status counts in candidateCountsByStatus")
    void getSummary_returnsOnlyNonZeroStatusCounts() throws Exception {
        // Given: only proposed and accepted have candidates
        UUID latestRunId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-04-02T15:30:00Z");

        DiscoverySummaryDto summary = new DiscoverySummaryDto(
            latestRunId,
            "RUNNING",
            createdAt.toString(),
            7,
            Map.of("proposed", 5L, "accepted", 2L),
            3,
            1
        );

        when(discoverySummaryService.getSummary(PROJECT_ID)).thenReturn(summary);

        // When/Then
        mockMvc.perform(get(BASE_URL, PROJECT_ID, ARCHITECTURE_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.candidate_counts_by_status.proposed").value(5))
            .andExpect(jsonPath("$.candidate_counts_by_status.accepted").value(2))
            .andExpect(jsonPath("$.candidate_counts_by_status.rejected").doesNotExist())
            .andExpect(jsonPath("$.candidate_counts_by_status.merged").doesNotExist())
            .andExpect(jsonPath("$.total_candidates").value(7));

        verify(discoverySummaryService).getSummary(PROJECT_ID);
    }
}
