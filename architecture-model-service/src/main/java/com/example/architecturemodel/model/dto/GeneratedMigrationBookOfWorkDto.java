package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for a generated draft Migration Delivery Plan / Book of Work.
 *
 * <p>Wire shape for the new
 * {@code POST/GET/PUT /api/projects/{projectId}/migration-books-of-work}
 * endpoints. Modeled structurally on {@link DiscoveryRunDto} (record type,
 * snake_case {@link JsonProperty} naming) so the rest of the AMS HTTP layer
 * applies uniformly.</p>
 *
 * <p>All four JSONB-backed fields are typed as {@code Map<String, Object>}
 * (the same shape used by {@link DiscoveryRunDto#configSnapshot()} /
 * {@link DiscoveryRunDto#stepsPayload()}). All other fields are boxed
 * reference types ({@link UUID}, {@link String}). No Java primitives appear
 * on this DTO -- per {@code project_primitive_double_dto_overwrite.md},
 * primitives would silently default to {@code 0} / {@code false} on a PATCH
 * that omits the field, and could wipe column content. Boxed types let the
 * update handler null-guard each field.</p>
 *
 * <p>PATCH null-guard contract: callers receiving a PUT/PATCH MUST null-guard
 * each field before assigning it onto the loaded entity -- an omitted JSON
 * field arrives as {@code null} on this record, and the existing column must
 * survive the update untouched. The four JSONB columns are not editable
 * post-create in the canonical flow except {@code bookOfWorkJson}, which is
 * rewritten on explicit Save Draft or save-to-backlog (Q-16).</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 1.</p>
 *
 * @param id Internal database UUID.
 * @param projectId Owning project UUID.
 * @param currentArchitectureId Source architecture for the draft. Nullable in DB (Q-14).
 * @param targetArchitectureId Target architecture for the draft. Nullable in DB (Q-14).
 * @param status Lifecycle status (see {@code GeneratedMigrationBookOfWorkStatus}).
 * @param title Optional human-readable title.
 * @param summary Optional executive summary text.
 * @param generationInputsJson Snapshot of generator inputs (nullable, JSONB).
 * @param generationSummaryJson Counts + coverage stats (nullable, JSONB).
 * @param qualityAssessmentJson Per-level rubric scores + rationale (nullable, JSONB).
 * @param bookOfWorkJson The full hierarchy + per-item metadata (nullable, JSONB).
 * @param createdByTask Producer task id (defaults to {@code product-manager--migration-delivery-plan}).
 * @param savedToBacklogAt ISO-8601 timestamp of the most recent save-to-backlog call (nullable).
 * @param errorMessage Diagnostic message for failed drafts (nullable).
 * @param createdAt ISO-8601 timestamp of creation.
 * @param updatedAt ISO-8601 timestamp of last update.
 */
public record GeneratedMigrationBookOfWorkDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("current_architecture_id")
    UUID currentArchitectureId,

    @JsonProperty("target_architecture_id")
    UUID targetArchitectureId,

    @JsonProperty("status")
    String status,

    @JsonProperty("title")
    String title,

    @JsonProperty("summary")
    String summary,

    @JsonProperty("generation_inputs_json")
    Map<String, Object> generationInputsJson,

    @JsonProperty("generation_summary_json")
    Map<String, Object> generationSummaryJson,

    @JsonProperty("quality_assessment_json")
    Map<String, Object> qualityAssessmentJson,

    @JsonProperty("book_of_work_json")
    Map<String, Object> bookOfWorkJson,

    @JsonProperty("created_by_task")
    String createdByTask,

    @JsonProperty("saved_to_backlog_at")
    String savedToBacklogAt,

    @JsonProperty("error_message")
    String errorMessage,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
