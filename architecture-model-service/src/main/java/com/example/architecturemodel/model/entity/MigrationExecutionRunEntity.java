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
 * JPA Entity for a single Migration Execution Driver run over one book of work
 * (Liquibase changeset 182).
 *
 * <p>The durable spine the gateway-hosted Migration Execution Driver advances
 * over. The Driver is EVENT-DRIVEN over this run-state -- each build-results
 * callback steps it forward (advance the run-item, advance the run position,
 * dispatch the next spec, or on the final spec mark the run deployed) -- so the
 * run survives a gateway restart with no long-held in-memory loop. AMS persists
 * only; the gateway is the sole orchestrator.</p>
 *
 * <p>Modeled structurally on {@link MigrationStorySpecGenerationEntity}: same
 * Lombok layout, same {@code @PrePersist} / {@code @PreUpdate} timestamp
 * callbacks, same hypersistence {@link JsonType} JSONB mapping, and the same
 * boxed-reference-type discipline so PATCH semantics preserve {@code null} per
 * {@code project_primitive_double_dto_overwrite.md} -- an omitted DTO field on
 * an update never silently wipes the column.</p>
 *
 * <p><b>Baseline pinning (CD-7):</b> {@link #pinnedCurrentBaselineId} records the
 * active {@code kind='current'} {@link com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity}
 * id at Migrate kick-off, so Spec 4 reconciles against EXACTLY that behavioural
 * oracle and it does not drift if a newer baseline is captured mid-run. Soft
 * reference (no FK) -- a baseline is a durable artefact that outlives its
 * capture session.</p>
 *
 * <p>Status vocabulary is the five values on
 * {@link MigrationExecutionRunStatus} (service-layer validated; no DB enum,
 * matching the AMS status-as-TEXT convention).</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "migration_execution_run",
    indexes = {
        @Index(name = "idx_mer_project_id", columnList = "project_id"),
        @Index(name = "idx_mer_book_of_work_id", columnList = "book_of_work_id"),
        @Index(name = "idx_mer_status", columnList = "status")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MigrationExecutionRunEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * Workspace scope NAMES (changeset 219, 2026-08-07): the gateway's
     * boot-recovery sweep discovers in-flight runs CROSS-project and must
     * re-derive the driver scope ({@code company}/{@code project} strings) the
     * run was created under — the UUID alone cannot be mapped back at boot.
     * Set once at run creation by the gateway; never PATCHed. Nullable for
     * rows created before the column existed (the discovery endpoint skips
     * those with a warning).
     */
    @Column(name = "company", columnDefinition = "TEXT")
    private String company;

    /** Workspace scope project NAME (see {@link #company}). */
    @Column(name = "project", columnDefinition = "TEXT")
    private String project;

    /**
     * The {@code generated_migration_books_of_work} row this run executes.
     * Soft reference (no FK) so the run outlives a book edit / regenerate.
     */
    @Column(name = "book_of_work_id", nullable = false)
    private UUID bookOfWorkId;

    /**
     * Lifecycle status. Allowed values are declared on
     * {@link MigrationExecutionRunStatus}; the service layer validates.
     */
    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = MigrationExecutionRunStatus.STARTED;

    /**
     * The run-item sequence position currently in flight; advances on each
     * build-results callback.
     *
     * <p>BOXED {@link Integer} (NOT primitive {@code int}) per
     * {@code project_primitive_double_dto_overwrite.md}: a primitive would
     * silently default to {@code 0} on a PATCH that omits the field and could
     * wipe a previously-advanced position.</p>
     */
    @Column(name = "current_sequence_position")
    private Integer currentSequencePosition;

    /**
     * The active {@code kind='current'} ApiBehaviourBaseline id pinned at
     * Migrate kick-off (CD-7 baseline pinning). Spec 4 reconciles against
     * EXACTLY this baseline. Soft reference (no FK).
     *
     * <p>Reference type ({@link UUID}) -- no primitive-wipe risk.</p>
     */
    @Column(name = "pinned_current_baseline_id")
    private UUID pinnedCurrentBaselineId;

    /**
     * The deployed product base URL, returned on the final spec's
     * {@code deployed} build-results callback. NULL until the run reaches the
     * deployed outcome. Reference type ({@link String}).
     */
    @Column(name = "target_base_url", columnDefinition = "TEXT")
    private String targetBaseUrl;

    /**
     * Run-branch chaining (2026-08-06): the spec name whose
     * {@code feature/<base_spec>[--<folder>]} branch(es) form the base ref for
     * this run's FIRST dispatch -- the cross-run continuation chosen at run
     * creation (a "Start Stage 2" that must see Stage 1's unmerged work).
     * {@code NULL} = start fresh from the default branch. Within-run chaining
     * derives from the run-items (the last successfully implemented item's
     * {@code spec_name}), not from this column. Persisted so retries,
     * resume-from-failure and the boot-recovery sweep re-derive the same base
     * after a gateway restart. Reference type ({@link String}).
     */
    @Column(name = "base_spec", columnDefinition = "TEXT")
    private String baseSpec;

    /**
     * Run-level decision / event log (CD-4): an append-only list of
     * {@code { question, answer, rationale }} maps and lifecycle events. NULL is
     * the valid empty state.
     *
     * <p>Stored as JSONB via Hibernate's {@code JsonType}, mirroring the
     * {@code warnings_json} / {@code quality_dimensions_json} sibling-JSONB
     * idiom on {@link MigrationStorySpecGenerationEntity}. BOXED
     * {@link java.util.List} per {@code project_primitive_double_dto_overwrite.md}
     * so a PATCH that omits the field never wipes the column.</p>
     */
    @Type(JsonType.class)
    @Column(name = "decision_log_json", columnDefinition = "jsonb")
    private List<Map<String, Object>> decisionLogJson;

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
            status = MigrationExecutionRunStatus.STARTED;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
