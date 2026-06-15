package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryEvidenceDto;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing discovery evidence atoms.
 *
 * Provides bulk create, query (with optional type filter), and count operations
 * for Phase 1a universal extraction evidence atoms. Evidence atoms are scoped
 * to a discovery run and traceable to a specific repo, file, and extraction type.
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 2: Evidence Entity, DTO, Repository, Service, and Controller
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * Task Group 1: source and logOrigin fields mapping in toDto and bulkCreate
 *
 * Extended: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 2: Upsert semantics -- re-saving by stable ID updates rather than duplicates
 *
 * Extended: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: Adds {@code *InArchitecture} variants that go through
 * {@link DiscoveryRunArchitectureGuard} to verify the run is bound to the
 * requested (project, architecture) pair before delegating. The evidence
 * child table itself carries no architecture_id column -- the guard is the
 * JOIN to discovery_run.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryEvidenceService {

    private final DiscoveryEvidenceRepository evidenceRepository;
    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryEvidenceDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, List<DiscoveryEvidenceDto> atoms) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, atoms);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryEvidenceDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, String type) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId, type);
    }

    @Transactional(readOnly = true)
    public long countByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return countByRunId(runId);
    }

    /**
     * Bulk create or update evidence atoms for a discovery run (upsert semantics).
     *
     * Maps each DTO to an entity, overriding the runId with the path parameter value
     * for consistency. For entities with IDs that already exist in the database,
     * fields are updated in place (upsert). For new IDs, entities are inserted.
     * This ensures that re-persisting the same records by stable ID is a no-op
     * rather than causing duplicate key violations.
     *
     * @param runId the discovery run UUID (from the URL path)
     * @param atoms list of evidence atom DTOs to persist
     * @return list of persisted evidence atom DTOs
     */
    @Transactional
    public List<DiscoveryEvidenceDto> bulkCreate(UUID runId, List<DiscoveryEvidenceDto> atoms) {
        log.debug("Bulk upserting {} evidence atoms for run: {}", atoms.size(), runId);

        // Build entity list from DTOs
        List<DiscoveryEvidenceEntity> entities = atoms.stream()
            .map(dto -> DiscoveryEvidenceEntity.builder()
                .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                .runId(runId)
                .repoUrl(dto.repoUrl())
                .filePath(dto.filePath())
                .type(dto.type())
                .data(dto.data() != null ? new HashMap<>(dto.data()) : new HashMap<>())
                .extractedAt(dto.extractedAt() != null ? Instant.parse(dto.extractedAt()) : Instant.now())
                .source(dto.source())
                .logOrigin(dto.logOrigin() != null ? new HashMap<>(dto.logOrigin()) : null)
                .build()
            )
            .collect(Collectors.toList());

        // Collect all incoming IDs and find which already exist
        List<UUID> incomingIds = entities.stream()
            .map(DiscoveryEvidenceEntity::getId)
            .collect(Collectors.toList());
        Map<UUID, DiscoveryEvidenceEntity> existingMap = evidenceRepository.findAllById(incomingIds)
            .stream()
            .collect(Collectors.toMap(DiscoveryEvidenceEntity::getId, e -> e));

        // Partition into new inserts and existing updates
        List<DiscoveryEvidenceEntity> toSave = new ArrayList<>();
        int updatedCount = 0;
        for (DiscoveryEvidenceEntity entity : entities) {
            DiscoveryEvidenceEntity existing = existingMap.get(entity.getId());
            if (existing != null) {
                // Update existing entity fields (upsert)
                existing.setRunId(entity.getRunId());
                existing.setRepoUrl(entity.getRepoUrl());
                existing.setFilePath(entity.getFilePath());
                existing.setType(entity.getType());
                existing.setData(entity.getData());
                existing.setExtractedAt(entity.getExtractedAt());
                existing.setSource(entity.getSource());
                existing.setLogOrigin(entity.getLogOrigin());
                toSave.add(existing);
                updatedCount++;
            } else {
                toSave.add(entity);
            }
        }

        List<DiscoveryEvidenceEntity> saved = evidenceRepository.saveAll(toSave);
        log.debug("Persisted {} evidence atoms for run: {} ({} updated, {} inserted)",
            saved.size(), runId, updatedCount, saved.size() - updatedCount);

        return saved.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get evidence atoms by run ID with optional type filter.
     *
     * @param runId the discovery run UUID
     * @param type optional evidence atom type filter (file_structure, symbol, string_pattern)
     * @return list of matching evidence atom DTOs
     */
    @Transactional(readOnly = true)
    public List<DiscoveryEvidenceDto> getByRunId(UUID runId, String type) {
        log.debug("Getting evidence atoms for run: {}, type filter: {}", runId, type);

        List<DiscoveryEvidenceEntity> entities;
        if (type != null && !type.isBlank()) {
            entities = evidenceRepository.findByRunIdAndType(runId, type);
        } else {
            entities = evidenceRepository.findByRunId(runId);
        }

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Count evidence atoms for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of evidence atoms for the run
     */
    @Transactional(readOnly = true)
    public long countByRunId(UUID runId) {
        log.debug("Counting evidence atoms for run: {}", runId);
        return evidenceRepository.countByRunId(runId);
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp string.
     * Includes source and logOrigin fields for log enrichment support.
     */
    private DiscoveryEvidenceDto toDto(DiscoveryEvidenceEntity entity) {
        return new DiscoveryEvidenceDto(
            entity.getId(),
            entity.getRunId(),
            entity.getRepoUrl(),
            entity.getFilePath(),
            entity.getType(),
            entity.getData(),
            entity.getExtractedAt().toString(),
            entity.getSource(),
            entity.getLogOrigin()
        );
    }
}
