package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntityMappingEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateEntityMappingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing discovery candidate entity mappings (provenance tracking).
 *
 * Provides bulk create and query operations for mappings between discovery
 * candidates and canonical meta-model entities. Each mapping records which
 * candidate produced which entity during a save-back operation, and whether
 * the entity was newly created or reused (matched by name).
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 *
 * Extended: Discovery Results Visibility (Increment 12)
 * Task Group 1: Cross-project query method for entity-origins endpoint
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCandidateEntityMappingService {

    private final DiscoveryCandidateEntityMappingRepository mappingRepository;

    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryCandidateEntityMappingDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId,
            List<DiscoveryCandidateEntityMappingDto> mappings) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, mappings);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryCandidateEntityMappingDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId);
    }


    /**
     * Bulk create mappings for a discovery run.
     *
     * Maps each DTO to an entity, overriding the runId with the path parameter value
     * for consistency, and persists all mappings in a single batch via saveAll().
     *
     * @param runId the discovery run UUID (from the URL path)
     * @param mappings list of mapping DTOs to persist
     * @return list of persisted mapping DTOs
     */
    @Transactional
    public List<DiscoveryCandidateEntityMappingDto> bulkCreate(
            UUID runId, List<DiscoveryCandidateEntityMappingDto> mappings) {
        log.debug("Bulk creating {} candidate entity mappings for run: {}", mappings.size(), runId);

        List<DiscoveryCandidateEntityMappingEntity> entities = mappings.stream()
            .map(dto -> DiscoveryCandidateEntityMappingEntity.builder()
                .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                .candidateId(dto.candidateId())
                .runId(runId)
                .entityType(dto.entityType())
                .entityId(dto.entityId())
                .action(dto.action())
                .createdAt(dto.createdAt() != null ? Instant.parse(dto.createdAt()) : Instant.now())
                .build()
            )
            .collect(Collectors.toList());

        List<DiscoveryCandidateEntityMappingEntity> saved = mappingRepository.saveAll(entities);
        log.debug("Persisted {} candidate entity mappings for run: {}", saved.size(), runId);

        return saved.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get all mappings for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of mapping DTOs for the run
     */
    @Transactional(readOnly = true)
    public List<DiscoveryCandidateEntityMappingDto> getByRunId(UUID runId) {
        log.debug("Getting candidate entity mappings for run: {}", runId);

        List<DiscoveryCandidateEntityMappingEntity> entities = mappingRepository.findByRunId(runId);

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get all mappings across multiple discovery runs.
     *
     * This enables fetching all entity mappings for a project in one query
     * by providing all run IDs for that project. Returns an empty list if
     * no run IDs are provided or no mappings exist.
     *
     * Spec: Discovery Results Visibility (Increment 12)
     * Task Group 1: Cross-project entity mapping query
     *
     * @param runIds list of discovery run UUIDs for the project
     * @return list of mapping DTOs across all specified runs
     */
    @Transactional(readOnly = true)
    public List<DiscoveryCandidateEntityMappingDto> getByProjectRunIds(List<UUID> runIds) {
        log.debug("Getting candidate entity mappings for {} run IDs", runIds.size());

        if (runIds.isEmpty()) {
            return Collections.emptyList();
        }

        List<DiscoveryCandidateEntityMappingEntity> entities = mappingRepository.findByRunIdIn(runIds);

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp string.
     */
    private DiscoveryCandidateEntityMappingDto toDto(DiscoveryCandidateEntityMappingEntity entity) {
        return new DiscoveryCandidateEntityMappingDto(
            entity.getId(),
            entity.getCandidateId(),
            entity.getRunId(),
            entity.getEntityType(),
            entity.getEntityId(),
            entity.getAction(),
            entity.getCreatedAt().toString()
        );
    }
}
