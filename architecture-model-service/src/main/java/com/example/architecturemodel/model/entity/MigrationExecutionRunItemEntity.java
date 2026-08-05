package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a single dispatched spec within a Migration Execution Driver
 * run (Liquibase changeset 182). One row per spec the run dispatches (stories
 * from Spec 1 + TEST items from Spec 2).
 *
 * <p>Ordered by {@link #sequencePosition} from the {@code (depth, sequenceOrder)}
 * walk of the book-of-work blob (CD-5). The inbound build-results callback
 * correlates on {@link #jobId} (the {@code idx_meri_job_id} index backs the
 * lookup). The Driver advances each item's {@link #status} / {@link #outcome}
 * over durable run-state, event-driven on callbacks -- a duplicate callback for
 * an item already carrying a terminal {@link #outcome} is the idempotent no-op
 * (CD-6).</p>
 *
 * <p>Modeled structurally on {@link MigrationStorySpecGenerationEntity}: same
 * Lombok layout, the same {@code @PrePersist} / {@code @PreUpdate} callbacks,
 * the same hypersistence {@link JsonType} JSONB mapping for the INLINE
 * auto-answerer decision log (CD-4 -- NOT a separate table), and the same
 * boxed-reference-type discipline so PATCH semantics preserve {@code null} per
 * {@code project_primitive_double_dto_overwrite.md}. The two boolean flags
 * ({@link #dispatched} / {@link #deployOnComplete}) are BOXED {@link Boolean}
 * (NOT primitive) so a partial PATCH that omits them never flips the column,
 * with a {@code @PrePersist} default mirroring the DB {@code DEFAULT false}.</p>
 *
 * <p>FK {@link #runId} -&gt; {@code migration_execution_run(id)} ON DELETE
 * CASCADE (declared in the SQL changeset; modelled here as a bare UUID column
 * consistent with the AMS {@code projectId} / {@code parentId} bare-FK
 * convention -- no {@code @ManyToOne}).</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "migration_execution_run_item",
    indexes = {
        @Index(name = "idx_meri_run_id", columnList = "run_id"),
        @Index(name = "idx_meri_job_id", columnList = "job_id"),
        @Index(name = "idx_meri_run_sequence", columnList = "run_id, sequence_position")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MigrationExecutionRunItemEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    /**
     * FK to the owning {@link MigrationExecutionRunEntity}. Bare UUID column
     * (no {@code @ManyToOne}); ON DELETE CASCADE is declared in the SQL
     * changeset.
     */
    @Column(name = "run_id", nullable = false)
    private UUID runId;

    /**
     * Position in the {@code (depth, sequenceOrder)} walk of the book-of-work
     * blob (CD-5). NOT NULL.
     *
     * <p>BOXED {@link Integer} (NOT primitive) per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "sequence_position", nullable = false)
    private Integer sequencePosition;

    /**
     * The story / TEST work item this spec implements. Soft reference (no FK)
     * so a work-item edit does not break the run record. Nullable.
     */
    @Column(name = "work_item_id")
    private UUID workItemId;

    /**
     * The {@code migration_story_spec_generations} row whose
     * {@code generated_spec_text} was dispatched for this item. Soft reference
     * (no FK). Nullable.
     */
    @Column(name = "spec_generation_id")
    private UUID specGenerationId;

    /**
     * The spec folder name (the shape-spec {@code folder} event), used as the
     * orchestration {@code SpecIntent.spec_name}. Nullable until the stream
     * concludes. Reference type ({@link String}).
     */
    @Column(name = "spec_name", columnDefinition = "TEXT")
    private String specName;

    /**
     * Lifecycle status. Allowed values are declared on
     * {@link MigrationExecutionRunItemStatus}; the service layer validates.
     */
    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = MigrationExecutionRunItemStatus.PENDING;

    /**
     * TRUE once the orchestration submit has been issued for this item.
     *
     * <p>BOXED {@link Boolean} (NOT primitive {@code boolean}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code false} on a PATCH that omits the field and
     * could wipe a previously-set {@code true}. DB column is
     * {@code NOT NULL DEFAULT false}; the {@code @PrePersist} mirrors that.</p>
     */
    @Column(name = "dispatched", nullable = false)
    @Builder.Default
    private Boolean dispatched = Boolean.FALSE;

    /**
     * The orchestration {@code job_id} correlated from the submit response.
     * The inbound build-results callback lookup key (idx_meri_job_id). NULL
     * until the orchestration submit returns. Reference type ({@link String}).
     */
    @Column(name = "job_id", columnDefinition = "TEXT")
    private String jobId;

    /**
     * Feature branch produced by the implementation job (human traceability).
     * NULL until known. Reference type ({@link String}).
     */
    @Column(name = "branch", columnDefinition = "TEXT")
    private String branch;

    /**
     * Pull request URL produced by the implementation job (human traceability).
     * NULL until known. Reference type ({@link String}).
     */
    @Column(name = "pr_url", columnDefinition = "TEXT")
    private String prUrl;

    /**
     * The terminal build-results outcome: {@code implemented | deployed |
     * failed | rejected} (see
     * {@link MigrationExecutionRunItemStatus#TERMINAL_OUTCOMES}). NULL until a
     * build-results callback resolves the item. The presence of a terminal
     * outcome is what makes a duplicate callback an idempotent no-op (CD-6).
     * Reference type ({@link String}).
     */
    @Column(name = "outcome")
    private String outcome;

    /**
     * TRUE only on the FINAL run-item (big-bang: the external service
     * integrates all specs and deploys once everything is implemented;
     * {@code target_base_url} comes back on the deployed outcome). All other
     * items FALSE.
     *
     * <p>BOXED {@link Boolean} (NOT primitive) per
     * {@code project_primitive_double_dto_overwrite.md}. DB column is
     * {@code NOT NULL DEFAULT false}; the {@code @PrePersist} mirrors that.</p>
     */
    @Column(name = "deploy_on_complete", nullable = false)
    @Builder.Default
    private Boolean deployOnComplete = Boolean.FALSE;

    /**
     * Per-item deployed URL echo (set on the final item's {@code deployed}
     * callback). NULL otherwise. Reference type ({@link String}).
     */
    @Column(name = "target_base_url", columnDefinition = "TEXT")
    private String targetBaseUrl;

    /**
     * Failure detail recorded on a {@code failed} / {@code rejected} outcome.
     * NULL otherwise. Reference type ({@link String}).
     */
    @Column(name = "error_detail", columnDefinition = "TEXT")
    private String errorDetail;

    /**
     * INLINE per-spec headless-shape-spec auto-answerer decision log (CD-4):
     * the list of {@code { question, answer, rationale }} maps the auto-answerer
     * produced for THIS spec. NOT a separate table. Surfaced in the
     * run-progress view. NULL is the valid empty state.
     *
     * <p>Stored as JSONB via Hibernate's {@code JsonType}, mirroring the
     * sibling-JSONB idiom on {@link MigrationStorySpecGenerationEntity}. BOXED
     * {@link java.util.List} per {@code project_primitive_double_dto_overwrite.md}
     * so a PATCH that omits the field never wipes the column. The Group 4
     * auto-answerer APPENDS to this via the Group 1 run-item PATCH.</p>
     */
    @Type(JsonType.class)
    @Column(name = "auto_answer_decision_log_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> autoAnswerDecisionLogJson;

    /**
     * Dispatch attempts already used for this item (Robustness R2 driver-level
     * spec auto-retry, changeset 217). {@code 0} = never retried; the gateway
     * increments it when a transient build-results failure is absorbed instead
     * of halting the run.
     *
     * <p>BOXED {@link Integer} (NOT primitive) per
     * {@code project_primitive_double_dto_overwrite.md}; DB column is
     * {@code NOT NULL DEFAULT 0}, mirrored in {@code @PrePersist}.</p>
     */
    @Column(name = "retry_attempt_count", nullable = false)
    @Builder.Default
    private Integer retryAttemptCount = 0;

    /**
     * When the next automatic re-dispatch is due (Robustness R2). Set (with
     * status back to {@code pending}) when the gateway schedules a retry;
     * {@code status=pending} + non-null here + {@code retry_attempt_count>0}
     * is the boot-recovery sweep's armed-retry predicate, so a scheduled
     * retry survives a gateway restart. Nullable.
     */
    @Column(name = "retry_next_attempt_at")
    private Instant retryNextAttemptAt;

    /**
     * Last failure classification for the item:
     * {@code transient_upstream | real} (from the IVS R1 classifier, or the
     * gateway's local signature scan when the callback carried no class).
     * Traceability + run-progress display. Nullable.
     */
    @Column(name = "failure_class", columnDefinition = "TEXT")
    private String failureClass;

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
            status = MigrationExecutionRunItemStatus.PENDING;
        }
        if (dispatched == null) {
            dispatched = Boolean.FALSE;
        }
        if (deployOnComplete == null) {
            deployOnComplete = Boolean.FALSE;
        }
        if (retryAttemptCount == null) {
            retryAttemptCount = 0;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
