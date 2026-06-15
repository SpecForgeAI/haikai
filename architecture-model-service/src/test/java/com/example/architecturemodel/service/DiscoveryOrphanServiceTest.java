package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryOrphanSummaryDto;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DiscoveryRunService orphan detection and cleanup methods.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 4: Orphan Detection and Cleanup Endpoints
 *
 * Tests:
 * 1. findOrphanedData returns correct counts for evidence without a valid run
 * 2. findOrphanedData returns correct counts for candidates without a valid run
 * 3. findOrphanedData returns stale FAILED/CANCELLED runs older than threshold
 * 4. cleanupOrphanedData deletes orphaned records and returns summary
 * 5. Cleanup threshold is configurable (staleDays parameter)
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryOrphanServiceTest {

    @Mock
    private DiscoveryRunRepository runRepository;

    @Mock
    private DiscoveryConfigRepository configRepository;

    @Mock
    private DiscoveryEvidenceRepository evidenceRepository;

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRelationshipRepository relationshipRepository;

    @Mock
    private DiscoveryClusterRepository clusterRepository;

    @Mock
    private DiscoveryDecisionTaskRepository decisionTaskRepository;

    private DiscoveryRunService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryRunService(
            runRepository,
            configRepository,
            evidenceRepository,
            candidateRepository,
            relationshipRepository,
            clusterRepository,
            decisionTaskRepository
        );
    }

    /**
     * Test 1: findOrphanedData returns correct counts for evidence without a valid run.
     *
     * When there are evidence records whose run_id does not exist in discovery_run,
     * the orphan detection should count them accurately.
     */
    @Test
    void findOrphanedData_returnsCorrectCountForOrphanedEvidence() {
        // Given -- 5 orphaned evidence records
        when(evidenceRepository.countAllOrphaned()).thenReturn(5L);
        when(candidateRepository.countAllOrphaned()).thenReturn(0L);
        when(relationshipRepository.countAllOrphaned()).thenReturn(0L);
        when(clusterRepository.countAllOrphaned()).thenReturn(0L);
        when(decisionTaskRepository.countAllOrphaned()).thenReturn(0L);
        when(runRepository.countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), anyList(), any(Instant.class)
        )).thenReturn(0L);

        // When
        DiscoveryOrphanSummaryDto result = service.findOrphanedData(PROJECT_ID, 30);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.orphanedEvidenceCount()).isEqualTo(5);
        assertThat(result.orphanedCandidateCount()).isEqualTo(0);
        assertThat(result.orphanedRelationshipCount()).isEqualTo(0);
        assertThat(result.orphanedClusterCount()).isEqualTo(0);
        assertThat(result.orphanedDecisionTaskCount()).isEqualTo(0);
        assertThat(result.staleRunCount()).isEqualTo(0);

        verify(evidenceRepository).countAllOrphaned();
    }

    /**
     * Test 2: findOrphanedData returns correct counts for candidates without a valid run.
     *
     * When there are candidate records whose run_id does not exist in discovery_run,
     * the orphan detection should count them accurately.
     */
    @Test
    void findOrphanedData_returnsCorrectCountForOrphanedCandidates() {
        // Given -- 3 orphaned candidates, 2 orphaned relationships
        when(evidenceRepository.countAllOrphaned()).thenReturn(0L);
        when(candidateRepository.countAllOrphaned()).thenReturn(3L);
        when(relationshipRepository.countAllOrphaned()).thenReturn(2L);
        when(clusterRepository.countAllOrphaned()).thenReturn(0L);
        when(decisionTaskRepository.countAllOrphaned()).thenReturn(0L);
        when(runRepository.countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), anyList(), any(Instant.class)
        )).thenReturn(0L);

        // When
        DiscoveryOrphanSummaryDto result = service.findOrphanedData(PROJECT_ID, 30);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.orphanedCandidateCount()).isEqualTo(3);
        assertThat(result.orphanedRelationshipCount()).isEqualTo(2);
        assertThat(result.orphanedEvidenceCount()).isEqualTo(0);

        verify(candidateRepository).countAllOrphaned();
        verify(relationshipRepository).countAllOrphaned();
    }

    /**
     * Test 3: findOrphanedData returns stale FAILED/CANCELLED runs older than threshold.
     *
     * When there are FAILED or CANCELLED runs older than the configured staleRunDaysThreshold,
     * they should be counted in the staleRunCount.
     */
    @Test
    void findOrphanedData_returnsStaleRunsOlderThanThreshold() {
        // Given -- 2 stale FAILED/CANCELLED runs
        when(evidenceRepository.countAllOrphaned()).thenReturn(0L);
        when(candidateRepository.countAllOrphaned()).thenReturn(0L);
        when(relationshipRepository.countAllOrphaned()).thenReturn(0L);
        when(clusterRepository.countAllOrphaned()).thenReturn(0L);
        when(decisionTaskRepository.countAllOrphaned()).thenReturn(0L);
        when(runRepository.countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), eq(List.of("FAILED", "CANCELLED")), any(Instant.class)
        )).thenReturn(2L);

        // When
        DiscoveryOrphanSummaryDto result = service.findOrphanedData(PROJECT_ID, 30);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.staleRunCount()).isEqualTo(2);
        assertThat(result.orphanedEvidenceCount()).isEqualTo(0);
        assertThat(result.orphanedCandidateCount()).isEqualTo(0);

        verify(runRepository).countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), eq(List.of("FAILED", "CANCELLED")), any(Instant.class)
        );
    }

    /**
     * Test 4: cleanupOrphanedData deletes orphaned records and returns summary.
     *
     * The cleanup should delete all orphaned records across all entity types
     * and delete stale runs, returning accurate counts of what was removed.
     */
    @Test
    void cleanupOrphanedData_deletesOrphanedRecordsAndReturnsSummary() {
        // Given -- various orphaned record counts
        when(evidenceRepository.deleteAllOrphaned()).thenReturn(10);
        when(relationshipRepository.deleteAllOrphaned()).thenReturn(5);
        when(clusterRepository.deleteAllOrphaned()).thenReturn(3);
        when(candidateRepository.deleteAllOrphaned()).thenReturn(7);
        when(decisionTaskRepository.deleteAllOrphaned()).thenReturn(2);

        // 1 stale FAILED run older than threshold
        UUID staleRunId = UUID.randomUUID();
        DiscoveryRunEntity staleRun = DiscoveryRunEntity.builder()
            .id(staleRunId)
            .projectId(PROJECT_ID)
            .status("FAILED")
            .configSnapshot(Map.of())
            .createdAt(Instant.now().minus(60, ChronoUnit.DAYS))
            .updatedAt(Instant.now().minus(60, ChronoUnit.DAYS))
            .build();

        when(runRepository.findByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), eq(List.of("FAILED", "CANCELLED")), any(Instant.class)
        )).thenReturn(List.of(staleRun));

        // When
        DiscoveryOrphanSummaryDto result = service.cleanupOrphanedData(PROJECT_ID, 30);

        // Then
        assertThat(result).isNotNull();
        assertThat(result.orphanedEvidenceCount()).isEqualTo(10);
        assertThat(result.orphanedCandidateCount()).isEqualTo(7);
        assertThat(result.orphanedRelationshipCount()).isEqualTo(5);
        assertThat(result.orphanedClusterCount()).isEqualTo(3);
        assertThat(result.orphanedDecisionTaskCount()).isEqualTo(2);
        assertThat(result.staleRunCount()).isEqualTo(1);

        // Verify all orphan delete methods were called
        verify(evidenceRepository).deleteAllOrphaned();
        verify(relationshipRepository).deleteAllOrphaned();
        verify(clusterRepository).deleteAllOrphaned();
        verify(candidateRepository).deleteAllOrphaned();
        verify(decisionTaskRepository).deleteAllOrphaned();

        // Verify stale runs were deleted
        verify(runRepository).deleteAll(List.of(staleRun));
    }

    /**
     * Test 5: Cleanup threshold is configurable via staleDays parameter.
     *
     * Verifying that different staleDays values change the cutoff timestamp used
     * for the stale run query. With staleDays=7, only runs older than 7 days
     * are considered stale.
     */
    @Test
    void findOrphanedData_thresholdIsConfigurableViaStaleDaysParameter() {
        // Given -- setup mocks
        when(evidenceRepository.countAllOrphaned()).thenReturn(0L);
        when(candidateRepository.countAllOrphaned()).thenReturn(0L);
        when(relationshipRepository.countAllOrphaned()).thenReturn(0L);
        when(clusterRepository.countAllOrphaned()).thenReturn(0L);
        when(decisionTaskRepository.countAllOrphaned()).thenReturn(0L);
        when(runRepository.countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID), anyList(), any(Instant.class)
        )).thenReturn(3L);

        // When -- call with staleDays=7 instead of default 30
        DiscoveryOrphanSummaryDto result = service.findOrphanedData(PROJECT_ID, 7);

        // Then
        assertThat(result.staleRunCount()).isEqualTo(3);

        // Verify the cutoff timestamp was calculated with 7 days (not 30)
        verify(runRepository).countByProjectIdAndStatusInAndUpdatedAtBefore(
            eq(PROJECT_ID),
            eq(List.of("FAILED", "CANCELLED")),
            argThat(cutoff -> {
                // The cutoff should be approximately 7 days ago
                Instant expected = Instant.now().minus(7, ChronoUnit.DAYS);
                long diffSeconds = Math.abs(cutoff.getEpochSecond() - expected.getEpochSecond());
                return diffSeconds < 5; // Within 5 seconds tolerance
            })
        );
    }
}
