package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryConfigDto;
import com.example.architecturemodel.model.entity.DiscoveryConfigEntity;
import com.example.architecturemodel.repository.entity.DiscoveryConfigRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Service for managing discovery configuration.
 *
 * Provides upsert and retrieval operations for Phase 0 discovery config,
 * enabling durable persistence of structured JSONB configuration payloads
 * with one-per-project semantics.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 3: Service and Controller
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryConfigService {

    private final DiscoveryConfigRepository repository;

    private static final Set<String> ALLOWED_STATUSES = Set.of("DRAFT", "COMPLETE");

    /**
     * Upsert a discovery config for a project.
     * Creates a new entity if none exists for the given projectId,
     * or updates the existing entity's payload and status.
     *
     * @param projectId the project UUID
     * @param configPayload the structured discovery config JSON payload
     * @param status the lifecycle status (DRAFT or COMPLETE)
     * @return the saved discovery config DTO
     * @throws IllegalArgumentException if status is not a valid value
     */
    @Transactional
    public DiscoveryConfigDto upsertConfig(UUID projectId, Map<String, Object> configPayload, String status) {
        log.debug("Upserting discovery config for project: {}, status: {}", projectId, status);

        validateStatus(status);

        DiscoveryConfigEntity entity = repository.findByProjectId(projectId)
            .orElseGet(() -> {
                log.debug("Creating new discovery config for project: {}", projectId);
                return DiscoveryConfigEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .build();
            });

        entity.setConfigPayload(configPayload);
        entity.setStatus(status);

        DiscoveryConfigEntity saved = repository.save(entity);
        log.debug("Saved discovery config with id: {}", saved.getId());

        return toDto(saved);
    }

    /**
     * Get a discovery config by project ID.
     *
     * @param projectId the project UUID
     * @return the discovery config DTO, or null if not found
     */
    @Transactional(readOnly = true)
    public DiscoveryConfigDto getConfig(UUID projectId) {
        log.debug("Getting discovery config for project: {}", projectId);

        return repository.findByProjectId(projectId)
            .map(this::toDto)
            .orElse(null);
    }

    /**
     * Validate that the status is an allowed value.
     *
     * @param status the status to validate
     * @throws IllegalArgumentException if the status is not allowed
     */
    private void validateStatus(String status) {
        if (status == null || !ALLOWED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                "Invalid status: " + status + ". Allowed values: " + ALLOWED_STATUSES);
        }
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp strings.
     */
    private DiscoveryConfigDto toDto(DiscoveryConfigEntity entity) {
        return new DiscoveryConfigDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getConfigPayload(),
            entity.getStatus(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );
    }
}
