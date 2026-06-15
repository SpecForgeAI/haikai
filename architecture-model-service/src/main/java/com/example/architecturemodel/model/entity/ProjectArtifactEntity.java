package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for versioned project artifacts (mission.md, roadmap.md, backlog.md).
 *
 * Maps to the project_artifact table with automatic revision tracking.
 * Each artifact is uniquely identified by (project_id, artifact_type, revision).
 */
@Entity
@Table(name = "project_artifact")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProjectArtifactEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "artifact_type", nullable = false)
    private String artifactType;

    // TEXT matches Liquibase changeset 012 (content is unbounded markdown);
    // without this the ddl-auto test schema defaults to VARCHAR(255).
    @Column(name = "content", nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "source", nullable = false)
    @Builder.Default
    private String source = "AGENT_OS";

    @Column(name = "revision", nullable = false)
    @Builder.Default
    private Integer revision = 1;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
