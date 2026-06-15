package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.dto.DiscoverySummaryDto;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateEntityMappingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.*;

/**
 * Service-level tests for DiscoverySummaryService.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 1: Backend Discovery Summary Endpoint
 *
 * Extended: Discovery Summary Performance (N+1 elimination)
 * Tests now assert that the service uses aggregate repository methods
 * (countByRunIdGroupByStatus, countByRunIds, countDistinctEntityTypesByRunIds)
 * instead of per-status loops and in-memory mapping aggregation.
 *
 * Tests:
 * 1. getSummary returns correct aggregated metrics when runs and data exist
 * 2. getSummary returns empty DTO when no runs exist
 * 3. Candidate count-by-status correctly filters known statuses
 * 4. Entity type coverage is sourced from the aggregate distinct-count query
 * 5. Bounded query count regression backstop: at most 5 repository calls
 */
@ExtendWith(MockitoExtension.class)
class DiscoverySummaryServiceTest {

    @Mock
    private DiscoveryRunService discoveryRunService;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryCandidateEntityMappingRepository mappingRepository;

    private DiscoverySummaryService summaryService;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        summaryService = new DiscoverySummaryService(
            discoveryRunService, candidateRepository, mappingRepository
        );
    }

    /**
     * Helper to build a status-row list with explicit {@code List<Object[]>} typing.
     * Required because {@code List.of(new Object[]{...})} otherwise infers
     * to {@code List<Object>} for single-element calls.
     */
    private static List<Object[]> statusRows(Object[]... rows) {
        return List.of(rows);
    }

    /**
     * Test 1: getSummary returns correct aggregated metrics when runs exist.
     */
    @Test
    @DisplayName("Test 1: getSummary returns correct aggregated metrics when runs exist")
    void getSummary_returnsCorrectMetrics_whenRunsExist() {
        // Given: two runs, latest is COMPLETED
        UUID runId1 = UUID.randomUUID();
        UUID runId2 = UUID.randomUUID();
        Instant now = Instant.now();
        Instant earlier = now.minusSeconds(3600);

        DiscoveryRunDto latestRun = new DiscoveryRunDto(
            runId1, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );
        DiscoveryRunDto olderRun = new DiscoveryRunDto(
            runId2, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, earlier.toString(), earlier.toString()
        );

        when(discoveryRunService.getRunsByProject(PROJECT_ID))
            .thenReturn(List.of(latestRun, olderRun));

        // Latest run: 4 proposed, 3 accepted, 2 rejected, 1 merged = 10 total
        when(candidateRepository.countByRunIdGroupByStatus(runId1)).thenReturn(statusRows(
            new Object[]{"proposed", 4L},
            new Object[]{"accepted", 3L},
            new Object[]{"rejected", 2L},
            new Object[]{"merged", 1L}
        ));

        // Aggregate mapping totals across both runs: 5 mappings, 2 distinct types
        when(mappingRepository.countByRunIds(List.of(runId1, runId2))).thenReturn(5L);
        when(mappingRepository.countDistinctEntityTypesByRunIds(List.of(runId1, runId2))).thenReturn(2L);

        // When
        DiscoverySummaryDto result = summaryService.getSummary(PROJECT_ID);

        // Then
        assertThat(result.latestRunId()).isEqualTo(runId1);
        assertThat(result.latestRunStatus()).isEqualTo("COMPLETED");
        assertThat(result.latestRunCreatedAt()).isEqualTo(now.toString());
        assertThat(result.totalCandidates()).isEqualTo(10);
        assertThat(result.candidateCountsByStatus()).containsEntry("proposed", 4L);
        assertThat(result.candidateCountsByStatus()).containsEntry("accepted", 3L);
        assertThat(result.candidateCountsByStatus()).containsEntry("rejected", 2L);
        assertThat(result.candidateCountsByStatus()).containsEntry("merged", 1L);
        assertThat(result.entitiesSaved()).isEqualTo(5);
        assertThat(result.entityTypeCoverage()).isEqualTo(2);
    }

    /**
     * Test 2: getSummary returns empty DTO when no runs exist.
     */
    @Test
    @DisplayName("Test 2: getSummary returns empty DTO when no runs exist")
    void getSummary_returnsEmptyDto_whenNoRunsExist() {
        // Given
        when(discoveryRunService.getRunsByProject(PROJECT_ID))
            .thenReturn(Collections.emptyList());

        // When
        DiscoverySummaryDto result = summaryService.getSummary(PROJECT_ID);

        // Then
        assertThat(result.latestRunId()).isNull();
        assertThat(result.latestRunStatus()).isNull();
        assertThat(result.latestRunCreatedAt()).isNull();
        assertThat(result.totalCandidates()).isEqualTo(0);
        assertThat(result.candidateCountsByStatus()).isEmpty();
        assertThat(result.entitiesSaved()).isEqualTo(0);
        assertThat(result.entityTypeCoverage()).isEqualTo(0);

        // Should not query candidates or mappings when no runs exist
        verifyNoInteractions(candidateRepository);
        verifyNoInteractions(mappingRepository);
    }

    /**
     * Test 3: Count-by-status only includes statuses with non-zero counts
     * and silently drops unknown status values.
     */
    @Test
    @DisplayName("Test 3: Candidate count-by-status filters to known statuses with non-zero counts")
    void getSummary_filtersKnownStatusesWithNonZeroCounts() {
        // Given: a run with proposed, accepted, and an unexpected status "weird"
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto run = new DiscoveryRunDto(
            runId, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProject(PROJECT_ID))
            .thenReturn(List.of(run));

        // GROUP BY query only returns statuses present in the DB; "rejected"
        // and "merged" rows simply don't appear. An unknown "weird" status
        // must be silently dropped from the response map but still counts
        // toward totalCandidates (matches original countByRunId behaviour).
        when(candidateRepository.countByRunIdGroupByStatus(runId)).thenReturn(statusRows(
            new Object[]{"proposed", 5L},
            new Object[]{"accepted", 2L},
            new Object[]{"weird", 1L}
        ));

        when(mappingRepository.countByRunIds(List.of(runId))).thenReturn(0L);
        when(mappingRepository.countDistinctEntityTypesByRunIds(List.of(runId))).thenReturn(0L);

        // When
        DiscoverySummaryDto result = summaryService.getSummary(PROJECT_ID);

        // Then: only proposed and accepted are in the map; weird is dropped
        assertThat(result.candidateCountsByStatus()).hasSize(2);
        assertThat(result.candidateCountsByStatus()).containsEntry("proposed", 5L);
        assertThat(result.candidateCountsByStatus()).containsEntry("accepted", 2L);
        assertThat(result.candidateCountsByStatus()).doesNotContainKey("rejected");
        assertThat(result.candidateCountsByStatus()).doesNotContainKey("merged");
        assertThat(result.candidateCountsByStatus()).doesNotContainKey("weird");
        // totalCandidates includes ALL statuses returned by the GROUP BY,
        // including unknown ones, preserving the pre-optimization total.
        assertThat(result.totalCandidates()).isEqualTo(8);
    }

    /**
     * Test 4: Entity type coverage is sourced from the aggregate distinct-count query.
     */
    @Test
    @DisplayName("Test 4: Entity type coverage comes from countDistinctEntityTypesByRunIds")
    void getSummary_entityTypeCoverage_fromAggregateQuery() {
        // Given: a run with mappings across 3 entity types
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();

        DiscoveryRunDto run = new DiscoveryRunDto(
            runId, PROJECT_ID, UUID.randomUUID(), null, null, null, null, false,
 null, null, null, "COMPLETED", null,
            Map.of(), Map.of(), null, now.toString(), now.toString()
        );

        when(discoveryRunService.getRunsByProject(PROJECT_ID))
            .thenReturn(List.of(run));

        when(candidateRepository.countByRunIdGroupByStatus(runId)).thenReturn(statusRows(
            new Object[]{"proposed", 5L}
        ));

        // 4 mappings, 3 distinct entity types, sourced from aggregate queries
        when(mappingRepository.countByRunIds(List.of(runId))).thenReturn(4L);
        when(mappingRepository.countDistinctEntityTypesByRunIds(List.of(runId))).thenReturn(3L);

        // When
        DiscoverySummaryDto result = summaryService.getSummary(PROJECT_ID);

        // Then
        assertThat(result.entityTypeCoverage()).isEqualTo(3);
        assertThat(result.entitiesSaved()).isEqualTo(4);
    }

    /**
     * Test 5: Regression backstop for the N+1 over-fetch.
     *
     * Asserts the service makes a bounded, small number of repository
     * method calls regardless of run/mapping/candidate count. The previous
     * implementation issued 1 + N status-count calls plus a full
     * findByRunIdIn fetch; this test prevents re-introducing either pattern.
     *
     * Expected call count when at least one run exists:
     *   - DiscoveryRunService.getRunsByProject .................... 1
     *   - DiscoveryCandidateRepository.countByRunIdGroupByStatus .. 1
     *   - DiscoveryCandidateEntityMappingRepository.countByRunIds . 1
     *   - DiscoveryCandidateEntityMappingRepository
     *       .countDistinctEntityTypesByRunIds ..................... 1
     *   Total: 4 (well within the ceiling of 5).
     */
    @Test
    @DisplayName("Test 5: getSummary makes at most 5 repository calls regardless of run count")
    void getSummary_boundedQueryCount_regressionBackstop() {
        // Given: ten runs in the project (would have been 10 mapping fetches
        // in the old in-memory aggregation path; should still be bounded now).
        Instant now = Instant.now();
        List<DiscoveryRunDto> manyRuns = new java.util.ArrayList<>();
        for (int i = 0; i < 10; i++) {
            manyRuns.add(new DiscoveryRunDto(
                UUID.randomUUID(), PROJECT_ID, UUID.randomUUID(),
                null, null, null, null, false,
 null, null, null, "COMPLETED", null,
                Map.of(), Map.of(), null, now.toString(), now.toString()
            ));
        }

        when(discoveryRunService.getRunsByProject(PROJECT_ID)).thenReturn(manyRuns);
        when(candidateRepository.countByRunIdGroupByStatus(any(UUID.class)))
            .thenReturn(statusRows(new Object[]{"proposed", 1L}));
        when(mappingRepository.countByRunIds(anyCollection())).thenReturn(0L);
        when(mappingRepository.countDistinctEntityTypesByRunIds(anyCollection())).thenReturn(0L);

        // When
        summaryService.getSummary(PROJECT_ID);

        // Then: every repository / service method is invoked at most once,
        //       regardless of the number of runs.
        verify(discoveryRunService, times(1)).getRunsByProject(PROJECT_ID);
        verify(candidateRepository, times(1)).countByRunIdGroupByStatus(any(UUID.class));
        verify(mappingRepository, times(1)).countByRunIds(anyCollection());
        verify(mappingRepository, times(1)).countDistinctEntityTypesByRunIds(anyCollection());

        // Hard ceiling on total interactions: ensure no other repo methods
        // (e.g. per-status counts, full mapping fetch) are called.
        verifyNoMoreInteractions(candidateRepository);
        verifyNoMoreInteractions(mappingRepository);
    }
}
