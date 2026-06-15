package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ImplementWorkspaceDto;
import com.example.architecturemodel.model.entity.WorkItemImplementWorkspaceEntity;
import com.example.architecturemodel.repository.entity.WorkItemImplementWorkspaceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * Service for managing work item implement workspace.
 *
 * Provides methods to get and save the full workspace state for a work item's
 * Implement tab, enabling persistence across browser sessions and restarts.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 2: Backend Service Layer
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class WorkItemImplementWorkspaceService {

    private final WorkItemImplementWorkspaceRepository repository;

    /**
     * Default schema version for new workspaces.
     */
    private static final Integer DEFAULT_SCHEMA_VERSION = 1;

    /**
     * Get the implement workspace for a work item.
     * Returns empty default DTO if no workspace exists.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the implement workspace DTO with current or empty state
     */
    @Transactional(readOnly = true)
    public ImplementWorkspaceDto getWorkspace(UUID projectId, UUID workItemId) {
        log.debug("Getting implement workspace for project: {}, workItem: {}", projectId, workItemId);

        return repository.findByProjectIdAndWorkItemId(projectId, workItemId)
            .map(this::toDto)
            .orElseGet(() -> {
                log.debug("No workspace found, returning empty default");
                return ImplementWorkspaceDto.empty(projectId, workItemId);
            });
    }

    /**
     * Save the implement workspace for a work item (upsert).
     * Creates new workspace if none exists, or updates existing workspace.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param workspaceState the full workspace state as a Map
     * @return the saved implement workspace DTO
     */
    @Transactional
    public ImplementWorkspaceDto saveWorkspace(UUID projectId, UUID workItemId, Map<String, Object> workspaceState) {
        log.debug("Saving implement workspace for project: {}, workItem: {}", projectId, workItemId);

        WorkItemImplementWorkspaceEntity entity = repository.findByProjectIdAndWorkItemId(projectId, workItemId)
            .orElseGet(() -> {
                log.debug("Creating new implement workspace");
                return WorkItemImplementWorkspaceEntity.builder()
                    .id(UUID.randomUUID())
                    .projectId(projectId)
                    .workItemId(workItemId)
                    .build();
            });

        // Ensure schemaVersion is present
        Map<String, Object> stateWithVersion = new HashMap<>(workspaceState != null ? workspaceState : Map.of());
        if (!stateWithVersion.containsKey("schemaVersion")) {
            stateWithVersion.put("schemaVersion", DEFAULT_SCHEMA_VERSION);
        }

        entity.setWorkspaceState(stateWithVersion);

        WorkItemImplementWorkspaceEntity saved = repository.save(entity);
        log.debug("Saved implement workspace with id: {}", saved.getId());

        return toDto(saved);
    }

    /**
     * Convert entity to DTO.
     * Extracts fields from the JSONB workspace_state column.
     * If schemaVersion is missing, defaults to 1 for backward compatibility.
     */
    @SuppressWarnings("unchecked")
    private ImplementWorkspaceDto toDto(WorkItemImplementWorkspaceEntity entity) {
        Map<String, Object> state = entity.getWorkspaceState();
        if (state == null) {
            state = new HashMap<>();
        }

        // Extract schemaVersion with default
        Integer schemaVersion = DEFAULT_SCHEMA_VERSION;
        Object schemaVersionObj = state.get("schemaVersion");
        if (schemaVersionObj instanceof Number) {
            schemaVersion = ((Number) schemaVersionObj).intValue();
        }

        // Extract implementationMode with default
        Boolean implementationMode = false;
        Object implementationModeObj = state.get("implementationMode");
        if (implementationModeObj instanceof Boolean) {
            implementationMode = (Boolean) implementationModeObj;
        }

        // Extract plannerPayload with default
        Map<String, Object> plannerPayload = Map.of();
        Object plannerPayloadObj = state.get("plannerPayload");
        if (plannerPayloadObj instanceof Map) {
            plannerPayload = (Map<String, Object>) plannerPayloadObj;
        }

        // Extract activeIncrementId with default
        String activeIncrementId = null;
        Object activeIncrementIdObj = state.get("activeIncrementId");
        if (activeIncrementIdObj instanceof String) {
            activeIncrementId = (String) activeIncrementIdObj;
        }

        // Extract questions with default
        List<Map<String, Object>> questions = List.of();
        Object questionsObj = state.get("questions");
        if (questionsObj instanceof List) {
            questions = (List<Map<String, Object>>) questionsObj;
        }

        // Extract executionArtifactsByIncrement with default
        Map<String, Object> executionArtifactsByIncrement = Map.of();
        Object artifactsObj = state.get("executionArtifactsByIncrement");
        if (artifactsObj instanceof Map) {
            executionArtifactsByIncrement = (Map<String, Object>) artifactsObj;
        }

        // Extract teamChatTranscript with default
        List<Map<String, Object>> teamChatTranscript = List.of();
        Object transcriptObj = state.get("teamChatTranscript");
        if (transcriptObj instanceof List) {
            teamChatTranscript = (List<Map<String, Object>>) transcriptObj;
        }

        return new ImplementWorkspaceDto(
            entity.getProjectId(),
            entity.getWorkItemId(),
            schemaVersion,
            implementationMode,
            plannerPayload,
            activeIncrementId,
            questions,
            executionArtifactsByIncrement,
            teamChatTranscript
        );
    }
}
