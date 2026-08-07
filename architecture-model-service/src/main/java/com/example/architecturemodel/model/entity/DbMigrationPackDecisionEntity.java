package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * JPA Entity for one pack-scoped needs_decision row (Liquibase changeset
 * 174). The deterministic generator NEVER guesses an ambiguous mapping -- it
 * emits a decision keyed by a STABLE {@link #decisionKey} (object identity +
 * question kind, e.g. {@code type_mapping:dbo.orders.rowver}).
 *
 * <p>Regeneration upserts by {@code (packId, decisionKey)} -- unique via
 * {@code uq_dmpd_pack_decision_key} -- so a resolved decision RE-LINKS to the
 * re-flagged object instead of duplicating, and its resolution feeds back as
 * a mandatory input to the next explicit generation run.</p>
 *
 * <p>Resolving a decision flips {@code open -> resolved}, stamps
 * {@link #resolvedAt} + {@link #resolutionJson}, and marks the owning pack
 * stale (service layer). Pack-scoped by design (settled Q2): decisions live
 * here, NOT in {@code target_state_captured_decisions}.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
@Entity
@Table(
    name = "db_migration_pack_decisions",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dmpd_pack_decision_key",
            columnNames = {"pack_id", "decision_key"}
        )
    },
    indexes = {
        @Index(name = "idx_dmpd_pack_status", columnList = "pack_id, status", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbMigrationPackDecisionEntity {

    public static final String STATUS_OPEN = "open";
    public static final String STATUS_RESOLVED = "resolved";

    /** All allowed decision statuses, mirroring chk_dmpd_status. */
    public static final Set<String> ALL_STATUSES = Set.of(STATUS_OPEN, STATUS_RESOLVED);

    public static final String CATEGORY_TYPE_MAPPING = "type_mapping";
    public static final String CATEGORY_COMPUTED_COLUMN = "computed_column";
    public static final String CATEGORY_COLLATION = "collation";
    public static final String CATEGORY_DELTA_KEY = "delta_key";
    /**
     * 2026-08-07 (gold-standard C4, changeset 220): a PK/UNIQUE constraint
     * whose member column(s) are omitted/dropped raises this decision — it
     * used to be dropped silently by the pack generator.
     */
    public static final String CATEGORY_PK_COMPOSITION = "pk_composition";
    public static final String CATEGORY_OTHER = "other";

    /** All allowed decision categories, mirroring chk_dmpd_category (changeset 220). */
    public static final Set<String> ALL_CATEGORIES = Set.of(
        CATEGORY_TYPE_MAPPING,
        CATEGORY_COMPUTED_COLUMN,
        CATEGORY_COLLATION,
        CATEGORY_DELTA_KEY,
        CATEGORY_PK_COMPOSITION,
        CATEGORY_OTHER
    );

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "pack_id", nullable = false)
    private UUID packId;

    /**
     * Stable identity: object identity + question kind. Unique per pack so
     * regeneration re-links instead of duplicating.
     */
    @Column(name = "decision_key", nullable = false, columnDefinition = "TEXT")
    private String decisionKey;

    /** Human-readable schema/table/column reference. */
    @Column(name = "object_ref", columnDefinition = "TEXT")
    private String objectRef;

    /** One of {@link #ALL_CATEGORIES}; chk_dmpd_category is the source of truth. */
    @Column(name = "category", nullable = false, length = 32)
    private String category;

    /** The concrete question the generator could not answer deterministically. */
    @Column(name = "question", columnDefinition = "TEXT")
    private String question;

    /** The concrete options offered (JSONB array; string or object elements). */
    @Type(JsonType.class)
    @Column(name = "options_json", columnDefinition = "jsonb")
    private List<Object> optionsJson;

    /** The chosen resolution payload; persisted on resolve. */
    @Type(JsonType.class)
    @Column(name = "resolution_json", columnDefinition = "jsonb")
    private Map<String, Object> resolutionJson;

    /** {@code open | resolved}; chk_dmpd_status is the source of truth. */
    @Column(name = "status", nullable = false, length = 16)
    @Builder.Default
    private String status = STATUS_OPEN;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

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
            status = STATUS_OPEN;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
