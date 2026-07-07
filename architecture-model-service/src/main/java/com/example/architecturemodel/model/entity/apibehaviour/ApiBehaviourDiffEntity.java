package com.example.architecturemodel.model.entity.apibehaviour;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Per-pair (source_baseline, target_baseline) diff header.
 *
 * <p>AMS is the system-of-record only; the deterministic JSON-shape diff
 * itself is computed by {@code diffRunner.ts} in
 * {@code api-migration-validation-service}. This row carries the lifecycle
 * status, the six summary count fields, the two FK references to the paired
 * baselines, and metadata around when the diff was computed (plus the
 * {@code updated_at} snapshots of both baselines at compute-time so the UI
 * can render a "Stale" badge when either baseline moves on).</p>
 *
 * <p>Allowed {@code status} values (validated at service layer, no DB enum):
 * {@code computing} (runner in flight or just-created) | {@code completed}
 * (summary counts populated) | {@code failed} (error_message populated).</p>
 *
 * <h2>PATCH safety on numeric count fields</h2>
 *
 * <p><b>All 6 count fields ({@link #matchedCount},
 * {@link #statusDriftCount}, {@link #bodyShapeDriftCount},
 * {@link #bodyValueDriftCount}, {@link #sourceOnlyCount},
 * {@link #targetOnlyCount}) are BOXED {@link Integer} -- never primitive
 * {@code int}.</b> Per {@code project_primitive_double_dto_overwrite.md},
 * any field that participates in PATCH semantics must be a boxed type so a
 * missing JSON field does NOT silently wipe to {@code 0}. Future maintainers
 * adding new count fields MUST follow this rule.</p>
 *
 * <h2>Service-layer FK-pairing invariant (Task Group 2 enforces)</h2>
 *
 * <ul>
 *   <li>{@link #sourceBaselineId} MUST point at a {@code kind='current'} baseline.</li>
 *   <li>{@link #targetBaselineId} MUST point at a {@code kind='target'} baseline
 *       whose {@code paired_with_baseline_id} equals {@link #sourceBaselineId}.</li>
 * </ul>
 *
 * <p>These invariants are NOT enforced at the DB level (matches the existing
 * AMS convention for status discriminators).</p>
 *
 * <h2>Cascade behaviour</h2>
 *
 * <p>ON DELETE CASCADE on both {@code source_baseline_id} and
 * {@code target_baseline_id} FKs ensures the diff vanishes when either
 * baseline is deleted. Diff items in turn CASCADE off this row's
 * {@code id}.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 1</p>
 */
@Entity
@Table(
    name = "api_behaviour_diffs",
    indexes = {
        @Index(
            name = "api_behaviour_diffs_target_idx",
            columnList = "target_baseline_id"
        ),
        @Index(
            name = "api_behaviour_diffs_source_idx",
            columnList = "source_baseline_id"
        )
    },
    uniqueConstraints = {
        @UniqueConstraint(
            name = "api_behaviour_diffs_pair_unique",
            columnNames = { "source_baseline_id", "target_baseline_id" }
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourDiffEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "source_baseline_id", nullable = false)
    private UUID sourceBaselineId;

    @Column(name = "target_baseline_id", nullable = false)
    private UUID targetBaselineId;

    /**
     * Lifecycle. Valid values: {@code computing} | {@code completed} |
     * {@code failed}. Validated at the service layer.
     */
    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "computing";

    /**
     * Comparison profile chosen at diff-creation time
     * (Spec 2026-07-06-j, changeset 205): {@code 'standard'} | {@code 'strict'}.
     * Nullable — {@code null} reads as {@code 'standard'} (today's semantics,
     * zero regression). Validated at the service layer.
     */
    @Column(name = "comparison_profile")
    private String comparisonProfile;

    /**
     * Count of paired items classified as status_match + body_match.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- primitive
     * {@code int} would silently wipe to 0 on missing JSON per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "matched_count")
    private Integer matchedCount;

    /**
     * Count of paired items where the status codes differ.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #matchedCount}.</p>
     */
    @Column(name = "status_drift_count")
    private Integer statusDriftCount;

    /**
     * Count of paired items classified as body_shape_drift (key sets differ
     * OR leaf type changes).
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #matchedCount}.</p>
     */
    @Column(name = "body_shape_drift_count")
    private Integer bodyShapeDriftCount;

    /**
     * Count of paired items classified as body_value_drift (same shape,
     * different leaf values -- informational).
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #matchedCount}.</p>
     */
    @Column(name = "body_value_drift_count")
    private Integer bodyValueDriftCount;

    /**
     * Count of source items with no paired target.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #matchedCount}.</p>
     */
    @Column(name = "source_only_count")
    private Integer sourceOnlyCount;

    /**
     * Count of target items with no paired source. Forward-compat; v1
     * should not produce this.
     *
     * <p>Boxed {@link Integer} required for PATCH safety -- see
     * {@link #matchedCount}.</p>
     */
    @Column(name = "target_only_count")
    private Integer targetOnlyCount;

    /**
     * Snapshot of the source baseline's {@code updated_at} at the moment the
     * diff was computed. The UI uses this to render a "Stale" badge when
     * the source baseline has moved on after the diff completed.
     */
    @Column(name = "source_baseline_updated_at")
    private Instant sourceBaselineUpdatedAt;

    /**
     * Snapshot of the target baseline's {@code updated_at} at the moment the
     * diff was computed. The UI uses this to render a "Stale" badge when
     * the target baseline has moved on after the diff completed.
     */
    @Column(name = "target_baseline_updated_at")
    private Instant targetBaselineUpdatedAt;

    @Column(name = "computed_at")
    private Instant computedAt;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

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
