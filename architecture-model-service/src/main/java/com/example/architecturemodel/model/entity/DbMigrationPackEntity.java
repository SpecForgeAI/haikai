package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a DB schema + data migration pack.
 *
 * <p>The root row of the pack persistence stack (Liquibase changeset 172).
 * Each row is the ONE active pack for a {@code (projectId, architectureId)}
 * pair -- enforced by the unique index {@code uq_dmp_project_architecture}.
 * Regeneration updates this row IN PLACE (same id) so the pack-scoped
 * decisions ({@link DbMigrationPackDecisionEntity}) and the append-only
 * drift-report history ({@link DbMigrationPackDriftReportEntity}) survive by
 * pack id.</p>
 *
 * <p>Modeled structurally on {@link GeneratedMigrationBookOfWorkEntity}: same
 * Lombok layout, same {@code @PrePersist} / {@code @PreUpdate} timestamp
 * callbacks, same hypersistence {@link JsonType} JSONB mapping.</p>
 *
 * <p>All numeric fields are BOXED reference types ({@link Integer} /
 * {@link Long}) -- never Java primitives -- per
 * {@code project_primitive_double_dto_overwrite.md}: a sparse PATCH that
 * omits a field must leave the column untouched, and a primitive would
 * silently default to {@code 0}.</p>
 *
 * <p>Status vocabulary is constrained to {@link DbMigrationPackStatus}
 * ({@code generated | stale}); the DB CHECK constraint {@code chk_dmp_status}
 * is the source of truth. A stale pack is NEVER auto-regenerated.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Entity
@Table(
    name = "db_migration_packs",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dmp_project_architecture",
            columnNames = {"project_id", "architecture_id"}
        )
    },
    indexes = {
        @Index(name = "idx_dmp_project_id", columnList = "project_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbMigrationPackEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * The (current-state) architecture whose committed physical model the
     * pack was generated from. Together with {@link #projectId} this is the
     * pack's identity: one active pack per pair.
     */
    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /**
     * Lifecycle status: {@code generated | stale}. See
     * {@link DbMigrationPackStatus}; {@code chk_dmp_status} is the source of
     * truth.
     */
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private String status = DbMigrationPackStatus.GENERATED;

    /** Human-readable reason the pack went stale (nullable). */
    @Column(name = "stale_reason", columnDefinition = "TEXT")
    private String staleReason;

    /**
     * SHA-256 of the canonically-serialized generation inputs (committed
     * physical model + findings + db.* captured decisions + resolved pack
     * decisions). The staleness comparator.
     */
    @Column(name = "input_snapshot_hash", columnDefinition = "TEXT")
    private String inputSnapshotHash;

    /** Timestamp of the last explicit (re)generation. */
    @Column(name = "generated_at")
    private Instant generatedAt;

    /**
     * Nullable text id of the user-chosen DB epic book-of-work item. Set via
     * PATCH (one-time picker in the pack UI); preserved across regeneration.
     */
    @Column(name = "work_item_id", columnDefinition = "TEXT")
    private String workItemId;

    /** Coverage ledger: objects deterministically translated. Boxed. */
    @Column(name = "translated_count")
    private Integer translatedCount;

    /** Coverage ledger: objects explicitly skipped with a reason. Boxed. */
    @Column(name = "skipped_count")
    private Integer skippedCount;

    /** Coverage ledger: objects flagged as needs_decision. Boxed. */
    @Column(name = "flagged_count")
    private Integer flaggedCount;

    /**
     * Pack-level margin added to captured sequence/identity high-water marks
     * in the sequences-seed changeset. Boxed Long -- PATCH-safe.
     */
    @Column(name = "seed_margin")
    private Long seedMargin;

    /**
     * The pack manifest: coverage ledger + per-object provenance, phase
     * ordering, delta-key strategies, requires_translation_spec_2 listings,
     * and the expected-schema JSON consumed by the verification diff.
     */
    @Type(JsonType.class)
    @Column(name = "manifest_json", columnDefinition = "jsonb")
    private Map<String, Object> manifestJson;

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
        if (status == null) {
            status = DbMigrationPackStatus.GENERATED;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
