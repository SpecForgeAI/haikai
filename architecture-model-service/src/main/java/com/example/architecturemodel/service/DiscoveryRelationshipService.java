package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryRelationshipDto;
import com.example.architecturemodel.model.entity.DiscoveryRelationshipEntity;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
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
 * Service for managing discovery relationships.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 2: Relationship JPA Stack (1b)
 *
 * Extended: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 2: Upsert semantics -- re-saving by stable ID updates rather than duplicates
 *
 * Extended: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: {@code *InArchitecture} variants verify run-architecture binding
 * via {@link DiscoveryRunArchitectureGuard} (JOIN to discovery_run).
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryRelationshipService {

    private final DiscoveryRelationshipRepository relationshipRepository;
    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryRelationshipDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, List<DiscoveryRelationshipDto> relationships) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, relationships);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryRelationshipDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, String type) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId, type);
    }

    @Transactional(readOnly = true)
    public long countByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId) {
        runGuard.verify(runId, projectId, architectureId);
        return countByRunId(runId);
    }

    @Transactional
    public List<DiscoveryRelationshipDto> bulkCreate(UUID runId, List<DiscoveryRelationshipDto> relationships) {
        log.debug("Bulk upserting {} relationships for run: {}", relationships.size(), runId);

        List<DiscoveryRelationshipEntity> entities = relationships.stream()
            .map(dto -> DiscoveryRelationshipEntity.builder()
                .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                .runId(runId)
                .sourceAtomId(dto.sourceAtomId())
                .targetAtomId(dto.targetAtomId())
                .relationshipType(dto.relationshipType())
                .confidence(dto.confidence())
                .data(dto.data() != null ? new HashMap<>(dto.data()) : new HashMap<>())
                .inferredAt(dto.inferredAt() != null ? Instant.parse(dto.inferredAt()) : Instant.now())
                .build()
            )
            .collect(Collectors.toList());

        // Collect all incoming IDs and find which already exist
        List<UUID> incomingIds = entities.stream()
            .map(DiscoveryRelationshipEntity::getId)
            .collect(Collectors.toList());
        Map<UUID, DiscoveryRelationshipEntity> existingMap = relationshipRepository.findAllById(incomingIds)
            .stream()
            .collect(Collectors.toMap(DiscoveryRelationshipEntity::getId, e -> e));

        // Partition into new inserts and existing updates
        List<DiscoveryRelationshipEntity> toSave = new ArrayList<>();
        int updatedCount = 0;
        for (DiscoveryRelationshipEntity entity : entities) {
            DiscoveryRelationshipEntity existing = existingMap.get(entity.getId());
            if (existing != null) {
                // Update existing entity fields (upsert)
                existing.setRunId(entity.getRunId());
                existing.setSourceAtomId(entity.getSourceAtomId());
                existing.setTargetAtomId(entity.getTargetAtomId());
                existing.setRelationshipType(entity.getRelationshipType());
                existing.setConfidence(entity.getConfidence());
                existing.setData(entity.getData());
                existing.setInferredAt(entity.getInferredAt());
                toSave.add(existing);
                updatedCount++;
            } else {
                toSave.add(entity);
            }
        }

        List<DiscoveryRelationshipEntity> saved = relationshipRepository.saveAll(toSave);
        log.debug("Persisted {} relationships for run: {} ({} updated, {} inserted)",
            saved.size(), runId, updatedCount, saved.size() - updatedCount);

        return saved.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<DiscoveryRelationshipDto> getByRunId(UUID runId, String type) {
        log.debug("Getting relationships for run: {}, type filter: {}", runId, type);

        List<DiscoveryRelationshipEntity> entities;
        if (type != null && !type.isBlank()) {
            entities = relationshipRepository.findByRunIdAndRelationshipType(runId, type);
        } else {
            entities = relationshipRepository.findByRunId(runId);
        }

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public long countByRunId(UUID runId) {
        log.debug("Counting relationships for run: {}", runId);
        return relationshipRepository.countByRunId(runId);
    }

    private DiscoveryRelationshipDto toDto(DiscoveryRelationshipEntity entity) {
        return new DiscoveryRelationshipDto(
            entity.getId(),
            entity.getRunId(),
            entity.getSourceAtomId(),
            entity.getTargetAtomId(),
            entity.getRelationshipType(),
            entity.getConfidence(),
            entity.getData(),
            entity.getInferredAt().toString()
        );
    }
}
