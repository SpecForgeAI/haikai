package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * A single node in the dashboard's initiative -> epic -> feature -> story
 * hierarchy. The hierarchy is built strictly from
 * {@code generated_migration_books_of_work.book_of_work_json} (Liquibase
 * changeset 139); the service never derives structure from the WorkItem table.
 *
 * <p><b>Addition B (AC 14).</b> The {@link #workItemId()} field carries the
 * stored WorkItem UUID from {@code book_of_work_json.items[].workItemId}. The
 * dashboard's backlog-save badge is driven by the presence of this id AND a
 * matching WorkItem row in the backlog -- never by title-matching. An orphan
 * stored id (id present but no matching WorkItem) is rendered as
 * {@code backlogStatus='not_saved_to_backlog'} AND raises a top-level
 * {@code warnings[]} entry (per spec Q-5); the stored id is NOT auto-repaired.</p>
 *
 * <p><b>Addition C (AC 5).</b> The {@link #missingInputsCount()} field carries
 * the count of entries from the latest spec-generation row's
 * {@code missing_inputs_json[]} when this node's
 * {@code specGenerationStatus='insufficient_context'}; zero (or null) otherwise.</p>
 *
 * <p><b>Target Architecture + Missing Input Resolver follow-up (2026-05-20).</b>
 * The {@link #staleReason()} field surfaces the latest spec-generation row's
 * {@code stale_reason} discriminator (one of {@code target_architecture_changed}
 * / {@code resolution_reset}) so the dashboard's stale-specs panel can
 * render the per-WorkItem chip variant directly from the node DTO -- replacing
 * an earlier v1 shim that passed the reason map through a separate prop.</p>
 *
 * <p><b>Spec Quality Scoring extension (2026-05-20).</b> The
 * {@link #qualityGrade()} field surfaces the latest spec-generation row's
 * {@code quality_grade} discriminator (one of {@code A|B|C|D|F}) so the
 * dashboard's hierarchy tree can render the per-story quality chip directly
 * from the node DTO. NULL when no spec row exists, when the latest spec is
 * {@code insufficient_context} / {@code failed} (deliberately skipped), or
 * when the row pre-dates the deploy and has not yet been caught up by the
 * bulk recompute endpoint.</p>
 *
 * <p><b>In-Product Spec Editor + Confirm-Overwrite extension (2026-05-20).</b>
 * The {@link #manuallyEdited()} field surfaces the latest spec-generation
 * row's {@code manually_edited} discriminator so the dashboard's hierarchy
 * tree can render the per-story "Edited" chip directly from the node DTO --
 * no additional fetch per node. NULL when no spec row exists. {@code FALSE}
 * is the default for un-edited spec rows (the DB column is
 * {@code NOT NULL DEFAULT false}); {@code TRUE} once a user has saved a
 * manual edit through the drawer and until the next successful
 * {@code overwriteManuallyEdited=true} regenerate.</p>
 *
 * <p>The seven badge fields below correspond directly to the seven badge types
 * the frontend hierarchy tree renders (AC 4):</p>
 * <ol>
 *   <li>{@link #backlogStatus()} -- backlog saved / unsaved badge.</li>
 *   <li>{@link #specGenerationStatus()} -- spec-generation status badge.</li>
 *   <li>{@link #specGenerationConfidence()} -- confidence badge.</li>
 *   <li>{@link #implementationStatus()} -- implementation workspace status.</li>
 *   <li>{@link #evidenceStatus()} -- evidence-coverage badge.</li>
 *   <li>{@link #needsAttentionCount()} -- count of own + descendants in needs-attention.</li>
 *   <li>{@link #missingInputsCount()} -- count of unresolved inputs (Addition C).</li>
 * </ol>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 4, AC 5, AC 14, AC 15. Task Group 2.</p>
 * <p>Extended: Target Architecture Authoring Flow + Missing Input Resolver
 * Flow (2026-05-20) -- {@code staleReason} surfacing.</p>
 * <p>Extended: Spec Quality Scoring (2026-05-20) -- {@code qualityGrade}
 * surfacing.</p>
 * <p>Extended: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
 * {@code manuallyEdited} surfacing.</p>
 *
 * @param id                       Stable id of the node from {@code book_of_work_json.items[].id}.
 * @param parentId                 Parent node id ({@code null} for root nodes).
 * @param type                     One of {@code initiative | epic | feature | story} (free-text per WorkItem audit).
 * @param title                    Display title from the book item.
 * @param workstream               Optional workstream label from the book item metadata.
 * @param sequenceOrder            Optional sort key from the book item.
 * @param workItemId               Stored WorkItem UUID from {@code book_of_work_json.items[].workItemId} (Addition B);
 *                                 {@code null} for items not yet saved to backlog.
 * @param backlogStatus            One of {@code saved | not_saved_to_backlog}.
 * @param specGenerationStatus     The latest spec-generation status; null if no attempt exists.
 * @param specGenerationConfidence The latest spec-generation confidence; null if not meaningful.
 * @param implementationStatus     Derived strictly from {@code WorkItemImplementWorkspace} fields; null if no workspace exists.
 * @param evidenceStatus           Derived from the book item's evidence/discovery/baseline/mapping/architecture refs.
 * @param needsAttentionCount      Count of own + descendant rows in the needs-attention panel.
 * @param missingInputsCount       Count of {@code missing_inputs_json[]} entries for {@code insufficient_context}
 *                                 nodes (Addition C); 0 or null otherwise.
 * @param staleReason              Latest spec-generation row's {@code stale_reason} discriminator
 *                                 ({@code target_architecture_changed} or {@code resolution_reset});
 *                                 {@code null} when the row is not stale or no spec exists.
 * @param qualityGrade             Latest spec-generation row's {@code quality_grade} letter
 *                                 ({@code A|B|C|D|F}); {@code null} when no spec exists, the spec is
 *                                 {@code insufficient_context} / {@code failed}, or the row pre-dates
 *                                 the spec-quality-scoring deploy and has not yet been caught up.
 * @param manuallyEdited           Latest spec-generation row's {@code manually_edited} flag; {@code null}
 *                                 when no spec exists; {@code false} for never-edited rows; {@code true}
 *                                 once a user has saved a manual edit through the drawer (cleared back
 *                                 to {@code false} on a successful overwrite-regenerate).
 * @param children                 Nested child node DTOs; empty list for leaf stories.
 */
public record MigrationDeliveryHierarchyNodeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("parent_id")
    String parentId,

    @JsonProperty("type")
    String type,

    @JsonProperty("title")
    String title,

    @JsonProperty("workstream")
    String workstream,

    @JsonProperty("sequence_order")
    Integer sequenceOrder,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("backlog_status")
    String backlogStatus,

    @JsonProperty("spec_generation_status")
    String specGenerationStatus,

    @JsonProperty("spec_generation_confidence")
    String specGenerationConfidence,

    @JsonProperty("implementation_status")
    String implementationStatus,

    @JsonProperty("evidence_status")
    String evidenceStatus,

    @JsonProperty("needs_attention_count")
    Long needsAttentionCount,

    @JsonProperty("missing_inputs_count")
    Long missingInputsCount,

    @JsonProperty("stale_reason")
    String staleReason,

    @JsonProperty("quality_grade")
    String qualityGrade,

    @JsonProperty("manually_edited")
    Boolean manuallyEdited,

    @JsonProperty("children")
    List<MigrationDeliveryHierarchyNodeDto> children
) {

    /**
     * Backward-compatible 15-arg constructor preserving the pre-cleanup-C
     * signature. Delegates to the canonical 18-arg constructor with
     * {@code staleReason}, {@code qualityGrade}, and {@code manuallyEdited}
     * defaulted to {@code null}.
     * Existing call sites (including the dashboard service's placeholder
     * branch + any tests that construct the DTO directly) continue to compile
     * without modification.
     */
    public MigrationDeliveryHierarchyNodeDto(
            String id,
            String parentId,
            String type,
            String title,
            String workstream,
            Integer sequenceOrder,
            UUID workItemId,
            String backlogStatus,
            String specGenerationStatus,
            String specGenerationConfidence,
            String implementationStatus,
            String evidenceStatus,
            Long needsAttentionCount,
            Long missingInputsCount,
            List<MigrationDeliveryHierarchyNodeDto> children) {
        this(id, parentId, type, title, workstream, sequenceOrder, workItemId,
            backlogStatus, specGenerationStatus, specGenerationConfidence,
            implementationStatus, evidenceStatus, needsAttentionCount,
            missingInputsCount, null, null, null, children);
    }

    /**
     * Backward-compatible 16-arg constructor preserving the post-target-arch
     * / post-missing-input-resolver signature (which added
     * {@code staleReason}). Delegates to the canonical 18-arg constructor with
     * {@code qualityGrade} and {@code manuallyEdited} defaulted to
     * {@code null}.
     */
    public MigrationDeliveryHierarchyNodeDto(
            String id,
            String parentId,
            String type,
            String title,
            String workstream,
            Integer sequenceOrder,
            UUID workItemId,
            String backlogStatus,
            String specGenerationStatus,
            String specGenerationConfidence,
            String implementationStatus,
            String evidenceStatus,
            Long needsAttentionCount,
            Long missingInputsCount,
            String staleReason,
            List<MigrationDeliveryHierarchyNodeDto> children) {
        this(id, parentId, type, title, workstream, sequenceOrder, workItemId,
            backlogStatus, specGenerationStatus, specGenerationConfidence,
            implementationStatus, evidenceStatus, needsAttentionCount,
            missingInputsCount, staleReason, null, null, children);
    }

    /**
     * Backward-compatible 17-arg constructor preserving the post-spec-quality-
     * scoring signature (which added {@code qualityGrade}). Delegates to the
     * canonical 18-arg constructor with {@code manuallyEdited} defaulted to
     * {@code null}. Allows existing call sites that already supply
     * {@code staleReason} + {@code qualityGrade} to continue to compile
     * unchanged after the {@code manuallyEdited} addition.
     */
    public MigrationDeliveryHierarchyNodeDto(
            String id,
            String parentId,
            String type,
            String title,
            String workstream,
            Integer sequenceOrder,
            UUID workItemId,
            String backlogStatus,
            String specGenerationStatus,
            String specGenerationConfidence,
            String implementationStatus,
            String evidenceStatus,
            Long needsAttentionCount,
            Long missingInputsCount,
            String staleReason,
            String qualityGrade,
            List<MigrationDeliveryHierarchyNodeDto> children) {
        this(id, parentId, type, title, workstream, sequenceOrder, workItemId,
            backlogStatus, specGenerationStatus, specGenerationConfidence,
            implementationStatus, evidenceStatus, needsAttentionCount,
            missingInputsCount, staleReason, qualityGrade, null, children);
    }
}
