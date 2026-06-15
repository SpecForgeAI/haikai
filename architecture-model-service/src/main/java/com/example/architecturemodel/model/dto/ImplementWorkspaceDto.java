package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for work item implement workspace.
 *
 * Represents the full workspace state for a work item's Implement tab,
 * including all fields needed for persistence and rehydration.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 2: Backend Service Layer
 *
 * @param projectId Project identifier
 * @param workItemId Work item UUID
 * @param schemaVersion Schema version for migration support (starts at 1)
 * @param implementationMode User-controlled implementation phase flag
 * @param plannerPayload Nested object with feature understanding, scope, assumptions, etc.
 * @param activeIncrementId Currently selected increment (nullable)
 * @param questions Array of Question objects (PO and SA questions)
 * @param executionArtifactsByIncrement Keyed by incrementId with artifacts per increment
 * @param teamChatTranscript Array of transcript entries with persona attribution
 */
public record ImplementWorkspaceDto(
    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("schema_version")
    Integer schemaVersion,

    @JsonProperty("implementation_mode")
    Boolean implementationMode,

    @JsonProperty("planner_payload")
    Map<String, Object> plannerPayload,

    @JsonProperty("active_increment_id")
    String activeIncrementId,

    @JsonProperty("questions")
    List<Map<String, Object>> questions,

    @JsonProperty("execution_artifacts_by_increment")
    Map<String, Object> executionArtifactsByIncrement,

    @JsonProperty("team_chat_transcript")
    List<Map<String, Object>> teamChatTranscript
) {
    /**
     * Create an empty default workspace DTO.
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return a new ImplementWorkspaceDto with default values
     */
    public static ImplementWorkspaceDto empty(UUID projectId, UUID workItemId) {
        return new ImplementWorkspaceDto(
            projectId,
            workItemId,
            1, // default schemaVersion
            false, // default implementationMode
            Map.of(), // empty plannerPayload
            null, // no active increment
            List.of(), // empty questions
            Map.of(), // empty execution artifacts
            List.of() // empty transcript
        );
    }
}
