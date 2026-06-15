package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a single behavioural BREAK in a Migration Execution reconcile
 * run (Liquibase changeset 183).
 *
 * <p>A break == a drifting {@code api_behaviour_diff_item}: the target response
 * diverged from the pinned current-state oracle for the same request. This row
 * is the run-scoped break &lt;-&gt; bug lifecycle + disposition record the
 * gateway loop (Groups 2/3/4) reads and mutates after the final-spec deploy. It
 * REFERENCES the existing {@code api_behaviour_diff_item} (via
 * {@link #diffItemId}) rather than duplicating the break payload; the inline
 * {@link #detailJson} carries the render-ready break detail (method / path /
 * summary / diff) so the review surface + the bug-report {@code BreakEvidence}
 * do not need a join.</p>
 *
 * <p>Modeled structurally on {@link MigrationExecutionRunEntity} (Spec 3): same
 * Lombok layout, same {@code @PrePersist} / {@code @PreUpdate} timestamp
 * callbacks, same hypersistence {@link JsonType} JSONB mapping, and the same
 * boxed-reference-type discipline so PATCH semantics preserve {@code null} per
 * {@code project_primitive_double_dto_overwrite.md} -- an omitted DTO field on
 * an update never silently wipes the column. This is load-bearing for
 * {@link #attemptCount} (boxed {@link Integer}: a primitive would reset the
 * circuit-breaker counter to {@code 0} on an unrelated PATCH) and the two
 * boolean flags ({@link #circuitBroken} / {@link #needsHuman}).</p>
 *
 * <p><b>Oracle anchor (CD-1) / disposition (CD-A):</b> {@link #pinnedBaselineId}
 * echoes {@code migration_execution_run.pinned_current_baseline_id}; the oracle
 * is ALWAYS that pinned baseline. {@link #sourceBaselineItemId} is the CD-6
 * scoped-re-reconcile resolution key (the replayable source operation behind
 * this break). Intentional / deferred deviations are recorded by the terminal
 * human {@link #dispositionStatus} values, never by changing the oracle.</p>
 *
 * <p>Disposition vocabulary is the eight values on
 * {@link MigrationReconciliationBreakStatus} (service-layer validated; no DB
 * enum, matching the AMS status-as-TEXT convention).</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 */
@Entity
@Table(
    name = "migration_reconciliation_break",
    indexes = {
        @Index(name = "idx_mrb_run_id", columnList = "run_id"),
        @Index(name = "idx_mrb_bug_id", columnList = "bug_id"),
        @Index(name = "idx_mrb_source_baseline_item_id", columnList = "source_baseline_item_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MigrationReconciliationBreakEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /**
     * The owning reconcile run. FK -&gt; {@code migration_execution_run(id)}
     * ON DELETE CASCADE (run-scoped: a break only exists in the context of its
     * run).
     */
    @Column(name = "run_id", nullable = false)
    private UUID runId;

    /**
     * The {@code kind='current'} ApiBehaviourBaseline this break was reconciled
     * against (echoes {@code migration_execution_run.pinned_current_baseline_id}
     * -- the CD-1 oracle anchor). Soft reference (no FK). Reference type
     * ({@link UUID}) -- no primitive-wipe risk.
     */
    @Column(name = "pinned_baseline_id")
    private UUID pinnedBaselineId;

    /**
     * The replayable source baseline_item behind this break (from
     * {@code api_behaviour_diff_item.source_baseline_item_id}) -- the CD-6
     * scoped-re-reconcile resolution key. Soft reference (no FK).
     */
    @Column(name = "source_baseline_item_id")
    private UUID sourceBaselineItemId;

    /**
     * The {@code api_behaviour_diff_item} this break references (the existing
     * break data; NO duplication of the break payload). Soft reference (no FK).
     */
    @Column(name = "diff_item_id")
    private UUID diffItemId;

    /**
     * The break detail (method / path / summary / source-target status /
     * structured diff) carried inline so the review surface + the bug-report
     * {@code BreakEvidence} render without a diff_item join. NULL is the valid
     * empty state.
     *
     * <p>Stored as JSONB via Hibernate's {@code JsonType}, mirroring the
     * {@code body_diff_json} idiom on {@link ApiBehaviourDiffItemEntity} and the
     * {@code decision_log_json} idiom on {@link MigrationExecutionRunEntity}.
     * BOXED {@link Map} per {@code project_primitive_double_dto_overwrite.md} so
     * a PATCH that omits the field never wipes the column.</p>
     */
    @Type(JsonType.class)
    @Column(name = "detail_json", columnDefinition = "jsonb")
    private Map<String, Object> detailJson;

    /**
     * The break lifecycle / disposition. Allowed values are declared on
     * {@link MigrationReconciliationBreakStatus}; the service layer validates.
     * Defaults to {@link MigrationReconciliationBreakStatus#OPEN}.
     */
    @Column(name = "disposition_status", nullable = false)
    @Builder.Default
    private String dispositionStatus = MigrationReconciliationBreakStatus.OPEN;

    /**
     * Set when the break is sent in a bug report; the bug-fix build-results
     * callback correlation key. NULL until sent. Reference type ({@link String}).
     */
    @Column(name = "bug_id", columnDefinition = "TEXT")
    private String bugId;

    /**
     * The circuit-breaker round / attempt counter (incremented per re-run
     * round).
     *
     * <p>BOXED {@link Integer} (NOT primitive {@code int}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code 0} on a PATCH that omits the field and could
     * reset the circuit-breaker counter. Defaults to {@code 0}.</p>
     */
    @Column(name = "attempt_count", nullable = false)
    @Builder.Default
    private Integer attemptCount = 0;

    /**
     * TRUE once the bounded re-run round tripped the max-attempts threshold;
     * gates any further auto-loop (CD-6). BOXED {@link Boolean}. Defaults to
     * {@code false}.
     */
    @Column(name = "circuit_broken", nullable = false)
    @Builder.Default
    private Boolean circuitBroken = Boolean.FALSE;

    /**
     * TRUE once the break is escalated for human review (circuit broken, or a
     * failed / rejected bug outcome). BOXED {@link Boolean}. Defaults to
     * {@code false}.
     */
    @Column(name = "needs_human", nullable = false)
    @Builder.Default
    private Boolean needsHuman = Boolean.FALSE;

    /**
     * Failure / escalation detail (e.g. the still-broken reason, the bug
     * failed / rejected message). Reference type ({@link String}); nullable.
     */
    @Column(name = "error_detail", columnDefinition = "TEXT")
    private String errorDetail;

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
        if (dispositionStatus == null) {
            dispositionStatus = MigrationReconciliationBreakStatus.OPEN;
        }
        if (attemptCount == null) {
            attemptCount = 0;
        }
        if (circuitBroken == null) {
            circuitBroken = Boolean.FALSE;
        }
        if (needsHuman == null) {
            needsHuman = Boolean.FALSE;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
