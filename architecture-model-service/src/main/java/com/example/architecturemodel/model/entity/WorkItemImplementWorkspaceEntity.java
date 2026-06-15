package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for work item implement workspace.
 *
 * Stores the full workspace state as an atomic JSONB snapshot for each work item's
 * Implement workspace, enabling persistence across browser sessions, tab switches,
 * and application restarts.
 *
 * The workspace state includes:
 * - implementationMode: user-controlled implementation phase flag
 * - plannerPayload: nested object with feature understanding, scope, assumptions, etc.
 * - activeIncrementId: currently selected increment
 * - questions: array of Question objects (PO and SA questions)
 * - executionArtifactsByIncrement: keyed by incrementId
 * - teamChatTranscript: array of transcript entries with persona attribution
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * - Task Group 1: Database Entity and Repository
 */
@Entity
@Table(
    name = "work_item_implement_workspace",
    indexes = {
        @Index(name = "idx_workspace_project_work_item", columnList = "project_id, work_item_id", unique = true),
        @Index(name = "idx_workspace_project_id", columnList = "project_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkItemImplementWorkspaceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    /**
     * Full workspace state stored as JSONB for atomic snapshot persistence.
     * Contains all persistable fields including:
     * - schemaVersion
     * - implementationMode
     * - plannerPayload
     * - activeIncrementId
     * - questions
     * - executionArtifactsByIncrement
     * - teamChatTranscript
     */
    @Type(JsonType.class)
    @Column(name = "workspace_state", columnDefinition = "jsonb")
    @Builder.Default
    private Map<String, Object> workspaceState = new HashMap<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
