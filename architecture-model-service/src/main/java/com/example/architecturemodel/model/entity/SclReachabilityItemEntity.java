package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;

import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for an SCL reachability worklist item.
 *
 * One row per source location the miner could NOT prove reachable from any
 * entrypoint root during a scan -- the human/LLM triage worklist. The
 * {@code signalsJson} payload is OPAQUE JSON (the miner's evidence for/against
 * reachability); architecture-model-service never parses it.
 *
 * {@code disposition} is the triage verdict as plain TEXT, service-validated
 * against {@code dead_code} | {@code missed_entrypoint} |
 * {@code framework_invoked}; null means "still open" (and a PATCH back to null
 * reopens the item).
 *
 * The worklist is replace-on-write per scan ({@code deleteByScanId} + fresh
 * insert), so there is no per-item upsert key beyond the id.
 *
 * IDs are service-assigned ({@code UUID.randomUUID()} when absent) -- there is
 * NO {@code @GeneratedValue}, matching the DiscoveryRunEntity pattern.
 *
 * Backed by Liquibase changeset 224-scl-corpus.sql.
 *
 * Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).
 */
@Entity
@Table(
    name = "scl_reachability_item",
    indexes = {
        @Index(name = "idx_scl_reachability_item_scan", columnList = "scan_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SclReachabilityItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "scan_id", nullable = false)
    private UUID scanId;

    @Column(name = "source_path", nullable = false)
    private String sourcePath;

    @Column(name = "symbol")
    private String symbol;

    /** Opaque JSON: the miner's reachability evidence. Never parsed by AMS. */
    @Type(JsonType.class)
    @Column(name = "signals_json", columnDefinition = "jsonb")
    private Map<String, Object> signalsJson;

    /**
     * Triage verdict: {@code dead_code} | {@code missed_entrypoint} |
     * {@code framework_invoked} | null (open). Service-layer validated.
     */
    @Column(name = "disposition")
    private String disposition;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /** Null until the first update (the column is NULLable, changeset 224). */
    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
