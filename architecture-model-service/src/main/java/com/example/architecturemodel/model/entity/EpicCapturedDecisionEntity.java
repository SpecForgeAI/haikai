package com.example.architecturemodel.model.entity;

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
 * JPA Entity for {@code epic_captured_decisions} -- the new first-class
 * artifact carrying epic-level captured decisions that feed pass-2
 * {@code parent_rollup.epic.capturedDecisions[]}.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Auto-seeded from pass-1 spec parser output (the
 * {@code MigrationStorySpecGenerationEntity#decisionsJson} column), then
 * curatable by the architect via the dedicated edit panel on the epic detail
 * page (Task Group 8). User-curated rows are pinned against further auto-
 * overwrite by the source-flag transitions enforced at the service layer.</p>
 *
 * <p><b>Source flag transitions (enforced at service layer):</b></p>
 * <ul>
 *   <li>{@code auto_extracted} -- seeded by the pass-1 captured-decisions
 *       auto-seed pipeline; {@link #sourceSpecGenerationId} is non-null.</li>
 *   <li>{@code user_edited} -- any user PATCH on an {@code auto_extracted}
 *       row flips the source flag here; the row is then pinned against
 *       further auto-overwrite by the re-run of pass-1.</li>
 *   <li>{@code user_added} -- freshly inserted via the "Add decision"
 *       affordance on the panel.</li>
 * </ul>
 *
 * <p><b>Status feed contract:</b> only rows with status in
 * {@code (draft, confirmed)} are exposed via the resolver's
 * {@code parent_rollup.epic.capturedDecisions[]} feed; {@code superseded} is
 * retained for audit but excluded from generation.</p>
 *
 * <p><b>FK on {@link #sourceSpecGenerationId} (ON DELETE SET NULL):</b> per
 * {@code project_pg_deferrable_set_null_action.md}, in PostgreSQL the SET NULL
 * action fires immediately on the parent DELETE (only the integrity check
 * defers, not the action itself). Any service-layer DELETE + re-INSERT cycle
 * on {@code migration_story_spec_generations} must capture-and-restore the
 * {@code source_spec_generation_id} values around the transaction.</p>
 *
 * <p><b>Boxed types for PATCH safety:</b> all editable fields here are boxed
 * reference types ({@link String}, {@link UUID}, {@link Instant}). No
 * primitives appear. The future PATCH endpoint controller (Task Group 4) will
 * null-guard each editable field in line with
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
@Entity
@Table(
    name = "epic_captured_decisions",
    uniqueConstraints = {
        @UniqueConstraint(
            name = "ux_ecd_project_epic_key",
            columnNames = {"project_id", "epic_work_item_id", "decision_key"}
        )
    },
    indexes = {
        @Index(name = "idx_ecd_project_epic", columnList = "project_id, epic_work_item_id"),
        @Index(name = "idx_ecd_status", columnList = "status"),
        @Index(name = "idx_ecd_source_spec", columnList = "source_spec_generation_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EpicCapturedDecisionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * The epic WorkItem this decision belongs to. NOT NULL. Source of truth
     * for epic linkage; no new field is added on the WorkItem entity itself.
     */
    @Column(name = "epic_work_item_id", nullable = false)
    private UUID epicWorkItemId;

    /**
     * Stable key used for upsert semantics across pass-1 re-runs. Unique
     * within {@code (project_id, epic_work_item_id)} via the
     * {@code ux_ecd_project_epic_key} constraint.
     */
    @Column(name = "decision_key", nullable = false, length = 255)
    private String decisionKey;

    @Column(name = "decision_text", nullable = false, columnDefinition = "TEXT")
    private String decisionText;

    /**
     * Provenance flag. Allowed values {@code auto_extracted}, {@code user_edited},
     * {@code user_added}. CHECK constraint {@code chk_ecd_source} (changeset 142)
     * is the source of truth. Stored as {@link String} (not Java enum) to
     * match the existing AMS family pattern.
     */
    @Column(name = "source", nullable = false, length = 32)
    private String source;

    /**
     * Optional FK back to the {@code migration_story_spec_generations} row
     * that originated this auto-extracted decision. ON DELETE SET NULL at the
     * DB level (see class-level note about capture-and-restore awareness).
     * Null for {@code user_added} rows; non-null for {@code auto_extracted}
     * rows; may become null after the originating spec-generation row is
     * deleted.
     */
    @Column(name = "source_spec_generation_id")
    private UUID sourceSpecGenerationId;

    /**
     * Lifecycle status. Allowed values {@code draft}, {@code confirmed},
     * {@code superseded}. CHECK constraint {@code chk_ecd_status} (changeset
     * 142) is the source of truth. Default {@code draft} on auto-seed.
     */
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private String status = "draft";

    /**
     * Audit channel: user/principal identifier of the last editor. Populated
     * on user PATCH/POST. Nullable for auto-seeded rows that have never been
     * edited.
     */
    @Column(name = "last_edited_by", length = 255)
    private String lastEditedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
        if (status == null) {
            status = "draft";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
