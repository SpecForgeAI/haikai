package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for a single Migration Execution Driver run over one book of work
 * (Liquibase changeset 182).
 *
 * <p>Wire shape for the gateway-facing run-state endpoints (Task Group 1). The
 * gateway-hosted Driver (Groups 2/3) calls these to create a run, read
 * run-state for the progress view, and PATCH the run status / current position /
 * {@code target_base_url} / decision-log as it advances. Modeled structurally on
 * {@link MigrationStorySpecGenerationDto} (record type, snake_case
 * {@link JsonProperty} naming -- the global AMS wire default).</p>
 *
 * <p>NEW run-state consumer -- snake_case wire (NO {@code @CamelCaseWire}): the
 * gateway Driver client reads snake_case, matching every other AMS consumer.</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link Integer}, {@link java.util.List}). No Java primitives -- per
 * {@code project_primitive_double_dto_overwrite.md}, primitives would silently
 * default to {@code 0} / {@code false} on a PATCH that omits the field and could
 * wipe column content. This is particularly critical for
 * {@link #currentSequencePosition}.</p>
 *
 * <p>PATCH null-guard contract: the update handler in
 * {@code MigrationExecutionRunMapper#updateEntityFromDto} null-guards every
 * editable field. Omitted JSON fields arrive as {@code null} on this record and
 * the existing column survives the update untouched.</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 *
 * @param id                       Internal database UUID.
 * @param projectId                Owning project UUID (workspace scope key).
 * @param bookOfWorkId             The generated migration Book of Work this run executes.
 * @param status                   Lifecycle status (see {@code MigrationExecutionRunStatus}).
 * @param currentSequencePosition  Run-item sequence position currently in flight; nullable, boxed.
 * @param pinnedCurrentBaselineId  The pinned active {@code kind='current'} ApiBehaviourBaseline id (CD-7); nullable.
 * @param targetBaseUrl            Deployed product base URL (set on the final spec deployed outcome); nullable.
 * @param decisionLogJson          Run-level decision / event log (CD-4): list of {@code {question, answer, rationale}}; nullable.
 * @param createdAt                ISO-8601 timestamp of creation.
 * @param updatedAt                ISO-8601 timestamp of last update.
 * @param items                    The ordered per-spec run-items (populated on the run-state read; null on create requests / list rows).
 */
public record MigrationExecutionRunDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("book_of_work_id")
    UUID bookOfWorkId,

    @JsonProperty("status")
    String status,

    @JsonProperty("current_sequence_position")
    Integer currentSequencePosition,

    @JsonProperty("pinned_current_baseline_id")
    UUID pinnedCurrentBaselineId,

    @JsonProperty("target_base_url")
    String targetBaseUrl,

    @JsonProperty("decision_log_json")
    List<Map<String, Object>> decisionLogJson,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt,

    @JsonProperty("items")
    List<MigrationExecutionRunItemDto> items
) {

    /**
     * Convenience constructor for the create / PATCH / list shapes that do NOT
     * carry the nested run-items (the {@code items} list is only populated by
     * the run-state read endpoint). Delegates to the canonical constructor with
     * {@code items = null}.
     */
    public MigrationExecutionRunDto(
            UUID id,
            UUID projectId,
            UUID bookOfWorkId,
            String status,
            Integer currentSequencePosition,
            UUID pinnedCurrentBaselineId,
            String targetBaseUrl,
            List<Map<String, Object>> decisionLogJson,
            String createdAt,
            String updatedAt) {
        this(id, projectId, bookOfWorkId, status, currentSequencePosition,
            pinnedCurrentBaselineId, targetBaseUrl, decisionLogJson,
            createdAt, updatedAt, null);
    }
}
