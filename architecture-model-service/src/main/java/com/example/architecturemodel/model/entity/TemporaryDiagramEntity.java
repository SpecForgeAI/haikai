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
 * JPA Entity for temporary architecture diagrams.
 *
 * Stores LLM-generated temporary architecture diagram payloads as JSONB snapshots,
 * enabling durable persistence and retrieval prior to conversion to native diagram format.
 *
 * The diagram payload contains the full TemporaryArchitectureDiagram JSON including:
 * - id, name, diagram_kind, source_architecture_domain, view_mode, version
 * - nodes (with compartments and attributes)
 * - edges (with edge_points)
 * - groups (optional)
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * - Task Group 1: Liquibase Migration and JPA Entity
 *
 * Spec "Multi-Architecture Plumbing" (Spec #1):
 * - Added architecture_id column scoping. Every temporary diagram is now bound
 *   to a specific architecture under its project.
 */
@Entity
@Table(
    name = "temporary_diagrams",
    indexes = {
        @Index(name = "idx_temp_diagram_project_diagram_id", columnList = "project_id, temporary_diagram_id", unique = true),
        @Index(name = "idx_temp_diagram_project_id", columnList = "project_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TemporaryDiagramEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Architecture this temporary diagram belongs to.
     * Spec: Multi-Architecture Plumbing (Spec #1).
     */
    @Column(name = "architecture_id")
    private UUID architectureId;

    @Column(name = "temporary_diagram_id", nullable = false)
    private String temporaryDiagramId;

    /**
     * Full TemporaryArchitectureDiagram JSON payload stored as JSONB.
     * Contains all diagram data including nodes, edges, groups, and metadata.
     */
    @Type(JsonType.class)
    @Column(name = "diagram_payload", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> diagramPayload = new HashMap<>();

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
