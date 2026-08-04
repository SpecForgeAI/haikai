package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * JPA Entity for one per-project DB structural-finding disposition row
 * (Liquibase changeset 215). One row per reviewed structural finding that the
 * DB migration pack generator emits (e.g. "no primary keys captured").
 *
 * <p>Disposition rows are NOT pack rows -- packs are wholesale delete+insert
 * on regeneration, while this table is the DURABILITY mechanism: rows are
 * keyed by {@code project_id} + the stable {@link #findingKey} identity
 * ({@code kind:subject}, unique per project via
 * {@code uq_dsfd_project_finding_key}), so a finding re-emitted by a
 * regenerated pack re-links to its existing disposition.</p>
 *
 * <p>{@code accepted} and {@code known_gap} REQUIRE a non-blank {@link #note}
 * (service-enforced, mirroring the {@code drop_reason} rule on
 * {@link DbMigrationPackTranslationEntity}); {@code fix_upstream} does not.</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
@Entity
@Table(
    name = "db_structural_finding_dispositions",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_dsfd_project_finding_key",
            columnNames = {"project_id", "finding_key"}
        )
    },
    indexes = {
        @Index(name = "idx_dsfd_project", columnList = "project_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DbStructuralFindingDispositionEntity {

    public static final String DISPOSITION_ACCEPTED = "accepted";
    public static final String DISPOSITION_FIX_UPSTREAM = "fix_upstream";
    public static final String DISPOSITION_KNOWN_GAP = "known_gap";

    /** All allowed dispositions, mirroring chk_dsfd_disposition. */
    public static final Set<String> ALL_DISPOSITIONS = Set.of(
        DISPOSITION_ACCEPTED,
        DISPOSITION_FIX_UPSTREAM,
        DISPOSITION_KNOWN_GAP
    );

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Stable identity {@code kind:subject} (e.g.
     * {@code no_primary_keys:all_tables}). Unique per project so pack
     * regeneration re-links instead of duplicating.
     */
    @Column(name = "finding_key", nullable = false, columnDefinition = "TEXT")
    private String findingKey;

    /** Finding kind (e.g. {@code no_primary_keys}). */
    @Column(name = "kind", nullable = false, columnDefinition = "TEXT")
    private String kind;

    /** Finding subject (e.g. {@code all_tables}). */
    @Column(name = "subject", nullable = false, columnDefinition = "TEXT")
    private String subject;

    /** One of {@link #ALL_DISPOSITIONS}; chk_dsfd_disposition is the source of truth. */
    @Column(name = "disposition", nullable = false, columnDefinition = "TEXT")
    private String disposition;

    /**
     * Rationale. Mandatory (service-enforced) when {@link #disposition} is
     * {@code accepted} or {@code known_gap}.
     */
    @Column(name = "note", columnDefinition = "TEXT")
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    /** Stamped on every subsequent upsert of an existing row. */
    @Column(name = "updated_at")
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
