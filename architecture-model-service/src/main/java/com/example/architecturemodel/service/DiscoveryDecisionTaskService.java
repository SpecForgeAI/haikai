package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryDecisionTaskDto;
import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing discovery decision tasks.
 *
 * Provides bulk create, query (with optional status and/or taskType filters),
 * count, and update operations for Phase 1b decision tasks. Decision tasks
 * are created during candidate triage when ambiguous or competing relationships
 * require LLM resolution.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * Task Group 5: Liquibase Migration and JPA Entity Stack
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryDecisionTaskService {

    private final DiscoveryDecisionTaskRepository decisionTaskRepository;

    private final DiscoveryRunArchitectureGuard runGuard;

    @Transactional
    public List<DiscoveryDecisionTaskDto> bulkCreateInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, List<DiscoveryDecisionTaskDto> tasks) {
        runGuard.verify(runId, projectId, architectureId);
        return bulkCreate(runId, tasks);
    }

    @Transactional(readOnly = true)
    public List<DiscoveryDecisionTaskDto> getByRunIdInArchitecture(
            UUID runId, UUID projectId, UUID architectureId, String status, String taskType) {
        runGuard.verify(runId, projectId, architectureId);
        return getByRunId(runId, status, taskType);
    }

    @Transactional(readOnly = true)
    public long countByRunIdInArchitecture(UUID runId, UUID projectId, UUID architectureId, String status) {
        runGuard.verify(runId, projectId, architectureId);
        return countByRunId(runId, status);
    }

    @Transactional
    public DiscoveryDecisionTaskDto updateTaskInArchitecture(
            UUID runId, UUID projectId, UUID architectureId,
            UUID taskId, DiscoveryDecisionTaskDto update) {
        runGuard.verify(runId, projectId, architectureId);
        return updateTask(runId, taskId, update);
    }


    /**
     * Bulk create decision tasks for a discovery run.
     *
     * Maps each DTO to an entity, overriding the runId with the path parameter value
     * for consistency, and persists all tasks in a single batch via saveAll().
     *
     * @param runId the discovery run UUID (from the URL path)
     * @param tasks list of decision task DTOs to persist
     * @return list of persisted decision task DTOs
     */
    @Transactional
    public List<DiscoveryDecisionTaskDto> bulkCreate(UUID runId, List<DiscoveryDecisionTaskDto> tasks) {
        log.debug("Bulk creating {} decision tasks for run: {}", tasks.size(), runId);

        List<DiscoveryDecisionTaskEntity> entities = tasks.stream()
            .map(dto -> DiscoveryDecisionTaskEntity.builder()
                .id(dto.id() != null ? dto.id() : UUID.randomUUID())
                .runId(runId)
                .taskType(dto.taskType())
                .status(dto.status() != null ? dto.status() : "pending")
                .inputData(dto.inputData() != null ? new HashMap<>(dto.inputData()) : new HashMap<>())
                .outputData(dto.outputData() != null ? new HashMap<>(dto.outputData()) : null)
                .createdAt(dto.createdAt() != null ? Instant.parse(dto.createdAt()) : Instant.now())
                .resolvedAt(dto.resolvedAt() != null ? Instant.parse(dto.resolvedAt()) : null)
                .build()
            )
            .collect(Collectors.toList());

        List<DiscoveryDecisionTaskEntity> saved = decisionTaskRepository.saveAll(entities);
        log.debug("Persisted {} decision tasks for run: {}", saved.size(), runId);

        return saved.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Get decision tasks by run ID with optional status and/or taskType filters.
     *
     * Delegates to the appropriate repository method based on which filters are present:
     * - Both status and taskType: findByRunIdAndStatus intersected with findByRunIdAndTaskType
     *   (falls back to findByRunId and filters in-memory for simplicity)
     * - Status only: findByRunIdAndStatus
     * - TaskType only: findByRunIdAndTaskType
     * - Neither: findByRunId
     *
     * @param runId the discovery run UUID
     * @param status optional status filter (pending, resolved, failed)
     * @param taskType optional task type filter (confirm_relationship, resolve_competing_relationships)
     * @return list of matching decision task DTOs
     */
    @Transactional(readOnly = true)
    public List<DiscoveryDecisionTaskDto> getByRunId(UUID runId, String status, String taskType) {
        log.debug("Getting decision tasks for run: {}, status filter: {}, taskType filter: {}", runId, status, taskType);

        boolean hasStatus = status != null && !status.isBlank();
        boolean hasTaskType = taskType != null && !taskType.isBlank();

        List<DiscoveryDecisionTaskEntity> entities;
        if (hasStatus && hasTaskType) {
            // No single repository method for both filters; use status filter and filter taskType in-memory
            entities = decisionTaskRepository.findByRunIdAndStatus(runId, status).stream()
                .filter(e -> taskType.equals(e.getTaskType()))
                .collect(Collectors.toList());
        } else if (hasStatus) {
            entities = decisionTaskRepository.findByRunIdAndStatus(runId, status);
        } else if (hasTaskType) {
            entities = decisionTaskRepository.findByRunIdAndTaskType(runId, taskType);
        } else {
            entities = decisionTaskRepository.findByRunId(runId);
        }

        return entities.stream()
            .map(this::toDto)
            .collect(Collectors.toList());
    }

    /**
     * Count decision tasks for a discovery run with optional status filter.
     *
     * @param runId the discovery run UUID
     * @param status optional status filter (pending, resolved, failed)
     * @return the number of matching decision tasks
     */
    @Transactional(readOnly = true)
    public long countByRunId(UUID runId, String status) {
        log.debug("Counting decision tasks for run: {}, status filter: {}", runId, status);

        boolean hasStatus = status != null && !status.isBlank();
        if (hasStatus) {
            return decisionTaskRepository.countByRunIdAndStatus(runId, status);
        }
        return decisionTaskRepository.countByRunId(runId);
    }

    /**
     * Update a decision task for a discovery run.
     *
     * Finds the existing task entity, updates status, outputData, and resolvedAt
     * from the provided DTO, saves, and returns the updated DTO. Used primarily
     * for recording LLM resolution results.
     *
     * @param runId the discovery run UUID
     * @param taskId the decision task UUID to update
     * @param update DTO containing the updated field values
     * @return the updated decision task DTO
     * @throws IllegalArgumentException if the task is not found or does not belong to the run
     */
    @Transactional
    public DiscoveryDecisionTaskDto updateTask(UUID runId, UUID taskId, DiscoveryDecisionTaskDto update) {
        log.debug("Updating decision task {} for run: {}", taskId, runId);

        DiscoveryDecisionTaskEntity entity = decisionTaskRepository.findById(taskId)
            .orElseThrow(() -> new IllegalArgumentException("Decision task not found: " + taskId));

        if (!entity.getRunId().equals(runId)) {
            throw new IllegalArgumentException("Decision task " + taskId + " does not belong to run " + runId);
        }

        // Update fields from the DTO if they are non-null
        if (update.status() != null) {
            entity.setStatus(update.status());
        }
        if (update.outputData() != null) {
            entity.setOutputData(new HashMap<>(update.outputData()));
        }
        if (update.resolvedAt() != null) {
            entity.setResolvedAt(Instant.parse(update.resolvedAt()));
        }

        DiscoveryDecisionTaskEntity saved = decisionTaskRepository.save(entity);
        log.debug("Updated decision task {} for run: {}", taskId, runId);

        return toDto(saved);
    }

    /**
     * Convert entity to DTO with ISO-8601 timestamp strings.
     */
    private DiscoveryDecisionTaskDto toDto(DiscoveryDecisionTaskEntity entity) {
        return new DiscoveryDecisionTaskDto(
            entity.getId(),
            entity.getRunId(),
            entity.getTaskType(),
            entity.getStatus(),
            entity.getInputData(),
            entity.getOutputData(),
            entity.getCreatedAt().toString(),
            entity.getResolvedAt() != null ? entity.getResolvedAt().toString() : null
        );
    }
}
