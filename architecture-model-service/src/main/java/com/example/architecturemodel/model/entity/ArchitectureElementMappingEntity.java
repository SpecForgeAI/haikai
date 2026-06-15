package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for cross-architecture element mappings.
 *
 * Each row records that a source-architecture element is related to a
 * target-architecture element via a particular {@code mapping_type}
 * (equivalent / renamed / replaced_by / split / merged / manual_review_required
 * in v1). Auto-mapped rows produced by the selective-copy + auto-map workflow
 * carry {@code created_by_task = "selective-copy-with-auto-map"} and
 * {@code confidence = 1.0}; manually added rows from the Mapping Review modal
 * carry {@code created_by_task = "mapping-review-modal-add"} (or
 * {@code "mapping-review-modal-edit"} after a PATCH) and may have a null
 * {@code confidence} unless the user supplies a value.
 *
 * <p>Mirrors {@link DiscoveryCandidateEntityMappingEntity} in shape (Lombok
 * {@code @Entity / @Builder / @Getter / @Setter / @NoArgsConstructor /
 * @AllArgsConstructor}) and adds a {@code @PreUpdate} hook so the
 * {@code updated_at} column is bumped on every modification (mirrors
 * {@link ArchitectureEntity}'s pattern).</p>
 *
 * <p><b>Critical:</b> {@code confidence} is declared as a boxed {@link Double}
 * (NOT primitive {@code double}) so PATCH semantics can preserve a null value
 * if the request body omits the field. Primitive numerics silently default to
 * {@code 0} during Jackson deserialisation, which would wipe the column on
 * every update — see project memory note
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 1</p>
 */
@Entity
@Table(
    name = "architecture_element_mappings",
    indexes = {
        @Index(
            name = "idx_arch_elt_mapping_arch_pair",
            columnList = "project_id, source_architecture_id, target_architecture_id"
        ),
        @Index(
            name = "idx_arch_elt_mapping_source_element",
            columnList = "project_id, source_element_id"
        ),
        @Index(
            name = "idx_arch_elt_mapping_target_element",
            columnList = "project_id, target_element_id"
        )
    },
    uniqueConstraints = {
        @UniqueConstraint(
            name = "architecture_element_mappings_unique_pair",
            columnNames = {
                "project_id",
                "source_architecture_id",
                "target_architecture_id",
                "source_element_type",
                "source_element_id",
                "target_element_type",
                "target_element_id",
                "mapping_type"
            }
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ArchitectureElementMappingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "source_architecture_id", nullable = false)
    private UUID sourceArchitectureId;

    @Column(name = "target_architecture_id", nullable = false)
    private UUID targetArchitectureId;

    @Column(name = "source_element_type", nullable = false)
    private String sourceElementType;

    @Column(name = "source_element_id", nullable = false)
    private String sourceElementId;

    @Column(name = "target_element_type", nullable = false)
    private String targetElementType;

    @Column(name = "target_element_id", nullable = false)
    private String targetElementId;

    @Column(name = "mapping_type", nullable = false)
    private String mappingType;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "created_by_task", nullable = false)
    private String createdByTask;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "notes")
    private String notes;

    /**
     * Confidence score for the mapping (0.0 .. 1.0). NULL is allowed and
     * preserved through PATCH semantics — boxed {@link Double} (NOT primitive)
     * to avoid Jackson's default-to-zero behaviour on missing JSON fields.
     * Auto-mapped rows from the selective-copy + auto-map workflow set this
     * to {@code 1.0}; manually added rows default to {@code null} unless the
     * user supplies a value.
     */
    @Column(name = "confidence")
    private Double confidence;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
