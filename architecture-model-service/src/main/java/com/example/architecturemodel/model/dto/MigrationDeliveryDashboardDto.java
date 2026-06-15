package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * Top-level DTO returned by the new read-only delivery-dashboard endpoint:
 * {@code GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard}.
 *
 * <p>All sub-DTOs in this record are rolled up by
 * {@code MigrationDeliveryDashboardService.loadDashboard(projectId, bookId)}
 * from three existing AMS tables only (no new tables, no new write paths
 * other than Addition B):</p>
 * <ul>
 *   <li>{@code generated_migration_books_of_work.book_of_work_json}
 *       (Liquibase changeset 139) -- the hierarchy + per-item metadata + the
 *       stored {@code workItemId} from Addition B.</li>
 *   <li>{@code migration_story_spec_generations}
 *       (Liquibase changeset 140) -- latest-attempt status, confidence, and
 *       the {@code missing_inputs_json[]} projection (Addition C).</li>
 *   <li>{@code work_item_implement_workspace} -- implementation status derived
 *       strictly from existing workspace fields.</li>
 * </ul>
 *
 * <p><b>WorkItem linkage (AC 14, Addition B).</b> The dashboard joins
 * book-items to WorkItem rows strictly by stored {@code workItemId} (never by
 * title). An orphan stored id (id present but no matching WorkItem row)
 * surfaces as {@code backlogStatus='not_saved_to_backlog'} on the hierarchy
 * node AND adds a top-level entry to {@link #warnings()}.</p>
 *
 * <p><b>Addition C surfacing.</b> When a spec-generation row has
 * {@code status='insufficient_context'}, its {@code missing_inputs_json[]}
 * entries flow verbatim into:</p>
 * <ul>
 *   <li>{@link MigrationDeliveryNeedsAttentionItemDto#missingInputs()} on the
 *       corresponding needs-attention row.</li>
 *   <li>{@link MigrationDeliveryHierarchyNodeDto#missingInputsCount()} on the
 *       corresponding hierarchy node.</li>
 * </ul>
 *
 * <p><b>Partial roll-up posture (Q-11, AC 16).</b> If any subsection's fetch
 * fails, the service appends a {@code warnings[]} entry naming the failed
 * subsection and returns the rest of the dashboard. The endpoint NEVER
 * returns 5xx for a partial-failure case; the frontend renders an inline
 * "Could not load X -- retry" placeholder for any warned subsection.</p>
 *
 * <p><b>Sizing (Q-2, AC 17).</b> When the book contains more than ~500
 * stories, the service appends a soft-warning entry to {@code warnings[]}
 * advising the frontend to display the size banner -- the full payload is
 * still returned (no server-side pagination in v1).</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link java.util.List}, sibling record types). No Java primitives appear on
 * any of the Migration Delivery dashboard DTOs per
 * {@code project_primitive_double_dto_overwrite.md}: primitives would
 * silently default to {@code 0}/{@code false} on a PATCH that omits the
 * field, and could wipe column content downstream.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * {@code agent-os/specs/2026-05-19-migration-delivery-progress-and-evidence-tracking/spec.md}.
 * Task Group 2.</p>
 *
 * @param bookOfWorkId           The {@code GeneratedMigrationBookOfWork} id.
 * @param projectId              The owning project id.
 * @param currentArchitectureId  Current-state architecture id (nullable per the entity, Q-14 of Spec 1).
 * @param targetArchitectureId   Target-state architecture id (nullable per the entity, Q-14 of Spec 1).
 * @param title                  Display title from the book.
 * @param status                 Book lifecycle status (see {@code GeneratedMigrationBookOfWorkStatus}).
 * @param generatedAt            ISO-8601 timestamp of book generation (typically the book's {@code createdAt}).
 * @param summary                Umbrella counts roll-up.
 * @param hierarchy              Initiative -> Epic -> Feature -> Story tree built from {@code book_of_work_json}.
 * @param workstreamSummaries    Per-workstream roll-up (one row per distinct workstream).
 * @param specGenerationSummary  Per-status spec-generation roll-up.
 * @param backlogSaveSummary     Per-status backlog-save roll-up (Addition B).
 * @param implementationSummary  Per-status implementation-workspace roll-up.
 * @param evidenceSummary        Per-reference-kind evidence-coverage roll-up.
 * @param needsAttention         Needs-attention rows in priority order
 *                               (failed > insufficient_context > blocked >
 *                               not_saved_to_backlog > generated_with_warnings).
 * @param warnings               Free-form warning messages surfaced inline by
 *                               the partial-roll-up tolerance path (Q-11),
 *                               by orphan-id detection (Q-5), and by the
 *                               ~500-story soft-warning rule (Q-2).
 *                               Empty list if no warnings.
 */
public record MigrationDeliveryDashboardDto(
    @JsonProperty("book_of_work_id")
    UUID bookOfWorkId,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("current_architecture_id")
    UUID currentArchitectureId,

    @JsonProperty("target_architecture_id")
    UUID targetArchitectureId,

    @JsonProperty("title")
    String title,

    @JsonProperty("status")
    String status,

    @JsonProperty("generated_at")
    String generatedAt,

    @JsonProperty("summary")
    MigrationDeliverySummaryDto summary,

    @JsonProperty("hierarchy")
    List<MigrationDeliveryHierarchyNodeDto> hierarchy,

    @JsonProperty("workstream_summaries")
    List<MigrationDeliveryWorkstreamSummaryDto> workstreamSummaries,

    @JsonProperty("spec_generation_summary")
    MigrationDeliverySpecGenerationSummaryDto specGenerationSummary,

    @JsonProperty("backlog_save_summary")
    MigrationDeliveryBacklogSaveSummaryDto backlogSaveSummary,

    @JsonProperty("implementation_summary")
    MigrationDeliveryImplementationSummaryDto implementationSummary,

    @JsonProperty("evidence_summary")
    MigrationDeliveryEvidenceSummaryDto evidenceSummary,

    @JsonProperty("needs_attention")
    List<MigrationDeliveryNeedsAttentionItemDto> needsAttention,

    @JsonProperty("warnings")
    List<String> warnings
) {}
