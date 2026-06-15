package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for a generated draft Migration Delivery Plan / Book of Work.
 *
 * <p>Persistence target for the new {@code product-manager--migration-delivery-plan}
 * task. Each row represents one generated draft book-of-work for a given
 * {@code (projectId, currentArchitectureId, targetArchitectureId)} tuple,
 * produced by the gateway orchestrator (Q-1, Q-3) and POSTed to AMS for
 * persistence. AMS persists only -- it never calls the LLM for this flow.</p>
 *
 * <p>Modeled structurally on {@link DiscoveryRunEntity}, the strongest
 * project-scoped artifact precedent: same Lombok layout, same {@code @PrePersist}
 * / {@code @PreUpdate} timestamp callbacks, same hypersistence {@link JsonType}
 * mapping for JSONB columns (per {@code fix-hibernate-jsonb-mapping}).</p>
 *
 * <p>Four sibling JSONB columns (all nullable so partial / recovery drafts
 * are representable per Q-14):</p>
 * <ul>
 *   <li>{@code generation_inputs_json}  -- snapshot of inputs used by the generator</li>
 *   <li>{@code generation_summary_json} -- counts + coverage stats from the LLM</li>
 *   <li>{@code quality_assessment_json} -- whole-book + per-level rubric scores</li>
 *   <li>{@code book_of_work_json}       -- the full hierarchy + per-item metadata</li>
 * </ul>
 *
 * <p>All fields are boxed reference types (never Java primitives) so PATCH
 * semantics can preserve null per
 * {@code project_primitive_double_dto_overwrite.md}: callers null-guard each
 * field before assigning during update flows so an omitted DTO field never
 * silently wipes the column.</p>
 *
 * <p>Status vocabulary is constrained to the six values declared on
 * {@link GeneratedMigrationBookOfWorkStatus}; the DB CHECK constraint
 * ({@code chk_gmbw_status}, Liquibase changeset 139) is the source of truth.</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "generated_migration_books_of_work",
    indexes = {
        @Index(name = "idx_gmbw_project_id", columnList = "project_id", unique = false),
        @Index(name = "idx_gmbw_current_arch", columnList = "current_architecture_id", unique = false),
        @Index(name = "idx_gmbw_target_arch", columnList = "target_architecture_id", unique = false),
        @Index(name = "idx_gmbw_status", columnList = "status", unique = false),
        @Index(
            name = "idx_gmbw_project_arch_status",
            columnList = "project_id, current_architecture_id, target_architecture_id, status",
            unique = false
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GeneratedMigrationBookOfWorkEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * The current-state architecture this draft was generated against.
     * Nullable so partial / recovery drafts remain representable (Q-14);
     * the service layer enforces presence at create-time for the canonical
     * generation flow.
     */
    @Column(name = "current_architecture_id")
    private UUID currentArchitectureId;

    /**
     * The target-state architecture this draft was generated against.
     * Same nullability rationale as {@link #currentArchitectureId}.
     */
    @Column(name = "target_architecture_id")
    private UUID targetArchitectureId;

    /**
     * Lifecycle status. Allowed values are declared on
     * {@link GeneratedMigrationBookOfWorkStatus}; the DB CHECK constraint
     * {@code chk_gmbw_status} is the source of truth.
     */
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private String status = GeneratedMigrationBookOfWorkStatus.DRAFT;

    @Column(name = "title", columnDefinition = "TEXT")
    private String title;

    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    /**
     * Snapshot of inputs used by the generator (Product Definition refs,
     * architecture refs, mapping refs, finding refs, options).
     * Nullable per Q-14.
     */
    @Type(JsonType.class)
    @Column(name = "generation_inputs_json", columnDefinition = "jsonb")
    private Map<String, Object> generationInputsJson;

    /**
     * Counts + coverage stats produced by the LLM/generator.
     * Nullable per Q-14.
     */
    @Type(JsonType.class)
    @Column(name = "generation_summary_json", columnDefinition = "jsonb")
    private Map<String, Object> generationSummaryJson;

    /**
     * Whole-book + per-level rubric scores + rationale.
     * Nullable per Q-14.
     */
    @Type(JsonType.class)
    @Column(name = "quality_assessment_json", columnDefinition = "jsonb")
    private Map<String, Object> qualityAssessmentJson;

    /**
     * The full hierarchy (Initiatives -> Epics -> Features -> Stories) with
     * per-item metadata, confidence, readiness, workstream, traceability.
     * {@code saveState} per item lives in frontend state during review and is
     * written back here only on explicit Save Draft or save-to-backlog (Q-16).
     * Nullable per Q-14.
     */
    @Type(JsonType.class)
    @Column(name = "book_of_work_json", columnDefinition = "jsonb")
    private Map<String, Object> bookOfWorkJson;

    /**
     * Producer task id. Defaults to {@code product-manager--migration-delivery-plan}
     * via the DB default and the entity initializer so the row is self-describing
     * without joining task config.
     */
    @Column(name = "created_by_task", length = 128)
    @Builder.Default
    private String createdByTask = "product-manager--migration-delivery-plan";

    /**
     * Timestamp of the most recent save-to-backlog call for this draft.
     * Null if save-to-backlog has never been invoked. Q-5 / Q-8.
     */
    @Column(name = "saved_to_backlog_at")
    private Instant savedToBacklogAt;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

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
            status = GeneratedMigrationBookOfWorkStatus.DRAFT;
        }
        if (createdByTask == null) {
            createdByTask = "product-manager--migration-delivery-plan";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
