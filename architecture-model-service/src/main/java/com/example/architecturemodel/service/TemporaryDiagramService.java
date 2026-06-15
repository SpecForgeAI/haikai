package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.TemporaryDiagramDto;
import com.example.architecturemodel.model.entity.TemporaryDiagramEntity;
import com.example.architecturemodel.repository.entity.TemporaryDiagramRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

/**
 * Service for managing temporary architecture diagrams.
 *
 * Provides upsert (save) and retrieval operations for temporary diagrams,
 * enabling durable persistence of LLM-generated diagram payloads.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 2: Java Service, DTO, and Controller
 *
 * Spec "Multi-Architecture Plumbing" (Spec #1):
 *   Every method now requires architectureId in addition to projectId; lookups
 *   filter by both columns and inserts populate architecture_id.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class TemporaryDiagramService {

    private final TemporaryDiagramRepository repository;

    /**
     * Save a temporary diagram (upsert) within a (project, architecture) scope.
     * Creates a new entity if none exists for the given
     * (projectId, architectureId, temporaryDiagramId), or updates the existing
     * entity's payload.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @param diagramPayload the full diagram JSON payload
     * @return the saved temporary diagram DTO
     */
    @Transactional
    public TemporaryDiagramDto saveDiagram(UUID projectId, UUID architectureId,
                                           String temporaryDiagramId,
                                           Map<String, Object> diagramPayload) {
        log.debug("Saving temporary diagram for project: {}, architecture: {}, diagramId: {}",
            projectId, architectureId, temporaryDiagramId);

        TemporaryDiagramEntity entity = repository
            .findByProjectIdAndArchitectureIdAndTemporaryDiagramId(
                projectId, architectureId, temporaryDiagramId)
            .orElseGet(() -> {
                log.debug("Creating new temporary diagram");
                return TemporaryDiagramEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .architectureId(architectureId)
                    .temporaryDiagramId(temporaryDiagramId)
                    .build();
            });

        entity.setDiagramPayload(diagramPayload);
        // Defensive: an entity created pre-spec (or by tests) might not have
        // architectureId set yet -- enforce it on every write path.
        entity.setArchitectureId(architectureId);

        TemporaryDiagramEntity saved = repository.save(entity);
        log.debug("Saved temporary diagram with id: {}", saved.getId());

        return toDto(saved);
    }

    /**
     * Get a temporary diagram by (project ID, architecture ID, temporary diagram ID).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @return the temporary diagram DTO, or null if not found in this architecture
     */
    @Transactional(readOnly = true)
    public TemporaryDiagramDto getDiagram(UUID projectId, UUID architectureId,
                                          String temporaryDiagramId) {
        log.debug("Getting temporary diagram for project: {}, architecture: {}, diagramId: {}",
            projectId, architectureId, temporaryDiagramId);

        return repository
            .findByProjectIdAndArchitectureIdAndTemporaryDiagramId(
                projectId, architectureId, temporaryDiagramId)
            .map(this::toDto)
            .orElse(null);
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp strings.
     */
    private TemporaryDiagramDto toDto(TemporaryDiagramEntity entity) {
        return new TemporaryDiagramDto(
            entity.getId(),
            entity.getProjectId(),
            entity.getTemporaryDiagramId(),
            entity.getDiagramPayload(),
            entity.getCreatedAt().toString(),
            entity.getUpdatedAt().toString()
        );
    }
}
