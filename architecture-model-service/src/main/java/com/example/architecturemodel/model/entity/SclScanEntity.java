package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for an SCL corpus mining scan.
 *
 * One row per Structural Contract Language mining run over a
 * (project, architecture). The scan is the parent handle every
 * {@link SclContractEntity} and {@link SclReachabilityItemEntity} row hangs
 * off; the miner streams contract batches against an {@code in_progress} scan
 * and flips it to {@code completed} / {@code failed} at the end.
 *
 * The {@code statsJson} payload is OPAQUE JSON written by the miner (counts,
 * timings, per-kind breakdowns) -- architecture-model-service never parses it,
 * mirroring the {@code config_snapshot} precedent on {@link DiscoveryRunEntity}.
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
    name = "scl_scan",
    indexes = {
        @Index(name = "idx_scl_scan_project_arch", columnList = "project_id, architecture_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SclScanEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /**
     * Scan lifecycle status as plain TEXT (no DB enum). Validated at the
     * service layer against {@link SclScanStatus#ALL}. DB DEFAULT
     * 'in_progress' (changeset 224); the Java field is initialised to the same
     * value so builder-constructed entities satisfy the NOT NULL contract.
     */
    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = SclScanStatus.IN_PROGRESS;

    /**
     * Opaque miner-written scan statistics (counts, timings, per-kind
     * breakdowns). Never parsed by architecture-model-service. Null until the
     * miner reports.
     */
    @Type(JsonType.class)
    @Column(name = "stats_json", columnDefinition = "jsonb")
    private Map<String, Object> statsJson;

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
        // Defence-in-depth: the @Builder.Default initializer already covers
        // builder-constructed entities, but the no-args/all-args constructors
        // (Jackson / JPA reflection) can bypass it. Apply the DB default here
        // so a freshly persisted row never violates the NOT NULL contract.
        if (status == null) {
            status = SclScanStatus.IN_PROGRESS;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
