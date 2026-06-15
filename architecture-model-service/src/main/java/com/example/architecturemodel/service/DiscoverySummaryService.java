package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.model.dto.DiscoverySummaryDto;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateEntityMappingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for building aggregated discovery summary metrics for a project.
 *
 * Composes DiscoveryRunService, DiscoveryCandidateRepository, and
 * DiscoveryCandidateEntityMappingRepository to produce a single DiscoverySummaryDto
 * containing the latest run info, candidate counts by status, entity mapping
 * count, and entity type coverage.
 *
 * Returns a graceful empty DTO when no discovery runs exist for the project.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Task Group 1: Backend Discovery Summary Endpoint
 *
 * Performance: All metrics are computed via aggregate SQL. The service makes
 * at most three repository calls (runs lookup + GROUP BY status + two
 * aggregate mapping queries) regardless of candidate or mapping row counts.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoverySummaryService {

    private final DiscoveryRunService discoveryRunService;
    private final DiscoveryCandidateRepository candidateRepository;
    private final DiscoveryCandidateEntityMappingRepository mappingRepository;

    /**
     * Known candidate statuses for aggregation.
     * Any status returned by the GROUP BY query that is NOT in this set is
     * silently dropped from the response map.
     */
    private static final Set<String> CANDIDATE_STATUSES = Set.of(
        "proposed", "accepted", "rejected", "merged"
    );

    /**
     * Build aggregated discovery summary metrics for a project.
     *
     * Logic:
     * 1. Fetch all runs for the project (ordered by creation time descending)
     * 2. If no runs exist, return an empty DTO
     * 3. Take the latest run for status/timestamp info
     * 4. Count candidates by status for the latest run in ONE aggregate query
     * 5. Compute entity mapping totals across all project runs via TWO aggregate queries
     *
     * @param projectId the project UUID
     * @return aggregated summary DTO, or empty DTO if no runs exist
     */
    @Transactional(readOnly = true)
    public DiscoverySummaryDto getSummary(UUID projectId) {
        log.debug("Building discovery summary for project: {}", projectId);

        // 1. Fetch all runs for the project
        List<DiscoveryRunDto> runs = discoveryRunService.getRunsByProject(projectId);

        // 2. If no runs exist, return empty DTO
        if (runs.isEmpty()) {
            log.debug("No discovery runs found for project: {}", projectId);
            return new DiscoverySummaryDto(
                null, null, null, 0, Collections.emptyMap(), 0, 0
            );
        }

        // 3. Latest run (already ordered by creation time descending)
        DiscoveryRunDto latestRun = runs.get(0);

        // 4. Count candidates by status for the latest run via single GROUP BY query
        List<Object[]> statusRows = candidateRepository.countByRunIdGroupByStatus(latestRun.id());
        Map<String, Long> countsByStatus = new LinkedHashMap<>();
        long totalCandidates = 0L;
        for (Object[] row : statusRows) {
            String status = (String) row[0];
            long count = ((Number) row[1]).longValue();
            totalCandidates += count;
            if (status != null && CANDIDATE_STATUSES.contains(status) && count > 0) {
                countsByStatus.put(status, count);
            }
        }

        // 5. Entity mapping aggregates across all runs for the project.
        //    Guard against empty run-id collection: aggregate queries return 0
        //    cleanly on most providers, but an empty IN-clause can misbehave.
        List<UUID> allRunIds = runs.stream()
            .map(DiscoveryRunDto::id)
            .collect(Collectors.toList());

        long entitiesSaved;
        int entityTypeCoverage;
        if (allRunIds.isEmpty()) {
            entitiesSaved = 0L;
            entityTypeCoverage = 0;
        } else {
            entitiesSaved = mappingRepository.countByRunIds(allRunIds);
            entityTypeCoverage = (int) mappingRepository.countDistinctEntityTypesByRunIds(allRunIds);
        }

        log.debug("Discovery summary for project {}: latestRun={}, totalCandidates={}, " +
            "entitiesSaved={}, entityTypeCoverage={}",
            projectId, latestRun.id(), totalCandidates, entitiesSaved, entityTypeCoverage);

        return new DiscoverySummaryDto(
            latestRun.id(),
            latestRun.status(),
            latestRun.createdAt(),
            totalCandidates,
            countsByStatus,
            entitiesSaved,
            entityTypeCoverage
        );
    }
}
