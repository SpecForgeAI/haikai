package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for a single dispatched spec within a Migration Execution Driver run
 * (Liquibase changeset 182).
 *
 * <p>Wire shape for the per-spec run-item endpoints (Task Group 1). The
 * gateway-hosted Driver (Groups 2/3/4) PATCHes a run-item to set
 * {@code dispatched} / {@code job_id} / {@code outcome} / {@code branch} /
 * {@code pr_url} and to APPEND to the inline auto-answerer decision log (CD-4).
 * Modeled structurally on {@link MigrationStorySpecGenerationDto} (record type,
 * snake_case {@link JsonProperty} naming -- the global AMS wire default).</p>
 *
 * <p>NEW run-state consumer -- snake_case wire (NO {@code @CamelCaseWire}).</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link Integer}, {@link Boolean}, {@link java.util.List}). No Java primitives
 * -- per {@code project_primitive_double_dto_overwrite.md}, primitives would
 * silently default to {@code 0} / {@code false} on a PATCH that omits the field
 * and could wipe column content. This is particularly critical for
 * {@link #dispatched} and {@link #deployOnComplete} (the two boolean flags) and
 * {@link #sequencePosition}.</p>
 *
 * <p>PATCH null-guard contract: the update handler in
 * {@code MigrationExecutionRunItemMapper#updateEntityFromDto} null-guards every
 * editable field. Omitted JSON fields arrive as {@code null} on this record and
 * the existing column survives the update untouched -- so a PATCH that sets only
 * {@code outcome} leaves {@code dispatched} / {@code job_id} / the decision log
 * intact.</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 *
 * @param id                        Internal database UUID.
 * @param runId                     Owning {@code migration_execution_run} UUID.
 * @param sequencePosition          Position in the (depth, sequenceOrder) walk (CD-5); boxed.
 * @param workItemId                The story / TEST work item this spec implements; nullable.
 * @param specGenerationId          The {@code migration_story_spec_generations} row dispatched; nullable.
 * @param specName                  The spec folder name (shape-spec {@code folder} event) used as {@code SpecIntent.spec_name}; nullable.
 * @param status                    Lifecycle status (see {@code MigrationExecutionRunItemStatus}).
 * @param dispatched                TRUE once the orchestration submit was issued; boxed Boolean.
 * @param jobId                     The orchestration {@code job_id} (the build-results callback lookup key); nullable.
 * @param branch                    Feature branch (human traceability); nullable.
 * @param prUrl                     Pull request URL (human traceability); nullable.
 * @param outcome                   Terminal build-results outcome ({@code implemented|deployed|failed|rejected}); nullable.
 * @param deployOnComplete          TRUE only on the FINAL run-item (big-bang); boxed Boolean.
 * @param targetBaseUrl             Per-item deployed URL echo (final item deployed callback); nullable.
 * @param errorDetail               Failure detail on a {@code failed} / {@code rejected} outcome; nullable.
 * @param autoAnswerDecisionLogJson INLINE per-spec auto-answerer decision log (CD-4): list of {@code {question, answer, rationale}}; nullable.
 * @param createdAt                 ISO-8601 timestamp of creation.
 * @param updatedAt                 ISO-8601 timestamp of last update.
 */
public record MigrationExecutionRunItemDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("sequence_position")
    Integer sequencePosition,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("spec_generation_id")
    UUID specGenerationId,

    @JsonProperty("spec_name")
    String specName,

    @JsonProperty("status")
    String status,

    @JsonProperty("dispatched")
    Boolean dispatched,

    @JsonProperty("job_id")
    String jobId,

    @JsonProperty("branch")
    String branch,

    @JsonProperty("pr_url")
    String prUrl,

    @JsonProperty("outcome")
    String outcome,

    @JsonProperty("deploy_on_complete")
    Boolean deployOnComplete,

    @JsonProperty("target_base_url")
    String targetBaseUrl,

    @JsonProperty("error_detail")
    String errorDetail,

    @JsonProperty("auto_answer_decision_log_json")
    List<Map<String, Object>> autoAnswerDecisionLogJson,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {
}
