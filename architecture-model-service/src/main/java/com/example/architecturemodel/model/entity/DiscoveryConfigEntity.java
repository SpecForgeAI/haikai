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
 * JPA Entity for discovery configuration.
 *
 * Stores structured Phase 0 discovery configuration as JSONB with one-per-project
 * upsert semantics. The config payload contains machine-readable JSON covering:
 * - repos (array of repo scope entries)
 * - repoApplicationMappings (array mapping repos/paths to application names)
 * - techHints (array of technology hints per repo/path)
 * - exclusions (array of paths/patterns to exclude)
 * - notes (array of free-text notes/ambiguities)
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * - Task Group 2: JPA Entity, DTO, and Repository
 */
@Entity
@Table(
    name = "discovery_config",
    indexes = {
        @Index(name = "idx_discovery_config_project_id", columnList = "project_id", unique = true)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryConfigEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Structured discovery config JSON payload stored as JSONB.
     * Contains repo scope, mappings, tech hints, exclusions, and notes.
     */
    @Type(JsonType.class)
    @Column(name = "config_payload", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> configPayload = new HashMap<>();

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "DRAFT";

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
