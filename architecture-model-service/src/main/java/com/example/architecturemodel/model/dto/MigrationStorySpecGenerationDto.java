package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for a single shape-spec-generation attempt against a saved-story
 * WorkItem.
 *
 * <p>Wire shape for the new
 * {@code POST/GET/PUT /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations}
 * endpoints (Group 8). Modeled structurally on
 * {@link GeneratedMigrationBookOfWorkDto} (record type, snake_case
 * {@link JsonProperty} naming) so the rest of the AMS HTTP layer applies
 * uniformly.</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link Integer}, {@link Boolean}, {@link java.util.Map}, {@link java.util.List}).
 * No Java primitives appear on this DTO -- per
 * {@code project_primitive_double_dto_overwrite.md}, primitives would silently
 * default to {@code 0} / {@code false} on a PATCH that omits the field, and
 * could wipe column content. This is particularly critical for
 * {@link #generationAttemptNumber}, which is bumped across regenerate runs
 * (R-8), and for {@link #manuallyEdited}, which guards the manual-edit
 * confirm-overwrite flow.</p>
 *
 * <p>PATCH null-guard contract: the update handler in
 * {@code MigrationStorySpecGenerationMapper#updateEntityFromDto} null-guards
 * every editable field. Omitted JSON fields arrive as {@code null} on this
 * record and the existing column survives the update untouched.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 * <p>Extended: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.
 * Adds {@link #manuallyEdited} / {@link #lastManuallyEditedAt} /
 * {@link #lastManuallyEditedBy} / {@link #previousSpecText} to carry manual-edit
 * audit + single-slot prior-version through to the frontend.</p>
 *
 * <p>Extended: Implementation-Ready Migration Spec Generation (2026-06-14, Spec
 * 1 of 4) -- Task Group 1. Adds {@link #structuredTestsJson} (the structured
 * unit/functional test pack) and {@link #coveredEndpointIds} (forward-only
 * endpoint-coverage groundwork, D9). The back-compat 19-arg constructor (the
 * pre-manual-edit signature) now delegates to the canonical 25-arg constructor,
 * defaulting the four manual-edit fields AND both new implementation-ready
 * fields to {@code null} / {@code false} so existing positional call sites
 * continue to compile.</p>
 *
 * @param id                       Internal database UUID.
 * @param projectId                Owning project UUID.
 * @param workItemId               Saved-story WorkItem UUID (source of truth for linkage, R-9).
 * @param bookOfWorkId             Originating generated migration Book of Work UUID (nullable).
 * @param bookItemId               Book-of-work hierarchy item id (nullable, VARCHAR).
 * @param status                   Lifecycle status (see {@code MigrationStorySpecGenerationStatus}).
 * @param confidence               LLM-self-rated, possibly gateway-downgraded ({@code high|medium|low}); nullable.
 * @param predictedReadiness       Snapshot of predicted-readiness from BoW for R-10 comparison; nullable.
 * @param generatedSpecText        Literal {@code /agent-os:shape-spec ...} body; nullable for non-generated rows.
 * @param warningsJson             Structured warnings array (incl. CONFIDENCE_DOWNGRADED); nullable.
 * @param missingInputsJson        Non-empty for {@code insufficient_context} rows; nullable otherwise.
 * @param focusedContextRefsJson   Refs used to assemble the LLM payload; nullable.
 * @param evidenceRefsJson         Evidence refs cited by the generated spec (acceptance signal 11); nullable.
 * @param generatedAt              ISO-8601 timestamp when the LLM call succeeded; nullable.
 * @param errorMessage             Diagnostic message for failed rows; nullable.
 * @param generationAttemptNumber  Bumped on regenerate-all (R-8). Boxed {@link Integer}, defaults to 0 at insert.
 * @param createdByTask            Producer task id; defaults to {@code product-manager--migration-shape-spec-generation}.
 * @param createdAt                ISO-8601 timestamp of creation.
 * @param updatedAt                ISO-8601 timestamp of last update.
 * @param manuallyEdited           TRUE once a user has saved a manual edit through the drawer; cleared on overwrite-regenerate.
 *                                 Boxed {@link Boolean}; DB column is {@code NOT NULL DEFAULT false}.
 * @param lastManuallyEditedAt     ISO-8601 timestamp of the most recent manual save; null until first edit.
 * @param lastManuallyEditedBy     Identity of the user who last manually saved (from {@code X-User-Id} header); null until first edit.
 * @param previousSpecText         Single-slot prior version of {@code generatedSpecText} captured before each manual save / overwrite-regenerate; null until first save.
 * @param structuredTestsJson       Structured unit/functional test pack (array of {@code {title, description, type}}, type in {@code unit|functional}); nullable. (Implementation-Ready Migration Spec Generation, D6.)
 * @param coveredEndpointIds        Model EndpointEntity UUIDs this story migrates; EMPTY array for non-endpoint stories, nullable when never populated. Forward-only groundwork, NOT consumed in v1. (Implementation-Ready Migration Spec Generation, D9.)
 */
public record MigrationStorySpecGenerationDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("book_of_work_id")
    UUID bookOfWorkId,

    @JsonProperty("book_item_id")
    String bookItemId,

    @JsonProperty("status")
    String status,

    @JsonProperty("confidence")
    String confidence,

    @JsonProperty("predicted_readiness")
    String predictedReadiness,

    @JsonProperty("generated_spec_text")
    String generatedSpecText,

    @JsonProperty("warnings_json")
    List<Map<String, Object>> warningsJson,

    @JsonProperty("missing_inputs_json")
    List<Map<String, Object>> missingInputsJson,

    @JsonProperty("focused_context_refs_json")
    Map<String, Object> focusedContextRefsJson,

    @JsonProperty("evidence_refs_json")
    List<String> evidenceRefsJson,

    @JsonProperty("generated_at")
    String generatedAt,

    @JsonProperty("error_message")
    String errorMessage,

    @JsonProperty("generation_attempt_number")
    Integer generationAttemptNumber,

    @JsonProperty("created_by_task")
    String createdByTask,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt,

    @JsonProperty("manually_edited")
    Boolean manuallyEdited,

    @JsonProperty("last_manually_edited_at")
    String lastManuallyEditedAt,

    @JsonProperty("last_manually_edited_by")
    String lastManuallyEditedBy,

    @JsonProperty("previous_spec_text")
    String previousSpecText,

    @JsonProperty("structured_tests_json")
    List<Map<String, Object>> structuredTestsJson,

    @JsonProperty("covered_endpoint_ids")
    List<String> coveredEndpointIds,

    @JsonProperty("manual_ready")
    Boolean manualReady,

    @JsonProperty("manual_ready_at")
    String manualReadyAt,

    @JsonProperty("manual_ready_by")
    String manualReadyBy,

    /**
     * Stale trio (carry-over triage, 2026-07-26). The columns have existed
     * since the Target Architecture Authoring Flow but were never exposed on
     * this wire shape — so the gateway's {@code isStorySpecReady} stale check
     * and the plan screen's stale chip could never see them. READ-ONLY on the
     * wire: {@code updateEntityFromDto} deliberately ignores them (stale is
     * stamped server-side by the mark-stale paths and cleared on successful
     * regeneration — clients cannot set or clear it via PATCH).
     */
    @JsonProperty("stale")
    Boolean stale,

    @JsonProperty("stale_reason")
    String staleReason,

    @JsonProperty("stale_marked_at")
    String staleMarkedAt
) {

    /**
     * Backward-compatible 19-arg constructor preserving the pre-manual-edit
     * signature. Delegates to the canonical 25-arg constructor with the four
     * manual-edit fields defaulted to {@code null} / {@code false}
     * ({@code manuallyEdited} mirrors the DB default of {@code false}) AND both
     * implementation-ready fields ({@code structuredTestsJson} /
     * {@code coveredEndpointIds}) defaulted to {@code null}.
     *
     * <p>Existing positional call sites (the mapper, the service-layer
     * builders, and a number of test fixtures) compile unchanged after the
     * extension. New code should prefer the canonical 25-arg constructor or
     * the record's component getters.</p>
     */
    public MigrationStorySpecGenerationDto(
            UUID id,
            UUID projectId,
            UUID workItemId,
            UUID bookOfWorkId,
            String bookItemId,
            String status,
            String confidence,
            String predictedReadiness,
            String generatedSpecText,
            List<Map<String, Object>> warningsJson,
            List<Map<String, Object>> missingInputsJson,
            Map<String, Object> focusedContextRefsJson,
            List<String> evidenceRefsJson,
            String generatedAt,
            String errorMessage,
            Integer generationAttemptNumber,
            String createdByTask,
            String createdAt,
            String updatedAt) {
        this(id, projectId, workItemId, bookOfWorkId, bookItemId, status,
            confidence, predictedReadiness, generatedSpecText, warningsJson,
            missingInputsJson, focusedContextRefsJson, evidenceRefsJson,
            generatedAt, errorMessage, generationAttemptNumber, createdByTask,
            createdAt, updatedAt,
            Boolean.FALSE, null, null, null,
            null, null,
            Boolean.FALSE, null, null);
    }

    /**
     * Backward-compatible 28-arg constructor preserving the pre-2026-07-26
     * (pre-stale-exposure) canonical signature. Delegates to the canonical
     * 31-arg constructor with the stale trio defaulted ({@code stale} mirrors
     * the DB default of {@code false}).
     */
    public MigrationStorySpecGenerationDto(
            UUID id,
            UUID projectId,
            UUID workItemId,
            UUID bookOfWorkId,
            String bookItemId,
            String status,
            String confidence,
            String predictedReadiness,
            String generatedSpecText,
            List<Map<String, Object>> warningsJson,
            List<Map<String, Object>> missingInputsJson,
            Map<String, Object> focusedContextRefsJson,
            List<String> evidenceRefsJson,
            String generatedAt,
            String errorMessage,
            Integer generationAttemptNumber,
            String createdByTask,
            String createdAt,
            String updatedAt,
            Boolean manuallyEdited,
            String lastManuallyEditedAt,
            String lastManuallyEditedBy,
            String previousSpecText,
            List<Map<String, Object>> structuredTestsJson,
            List<String> coveredEndpointIds,
            Boolean manualReady,
            String manualReadyAt,
            String manualReadyBy) {
        this(id, projectId, workItemId, bookOfWorkId, bookItemId, status,
            confidence, predictedReadiness, generatedSpecText, warningsJson,
            missingInputsJson, focusedContextRefsJson, evidenceRefsJson,
            generatedAt, errorMessage, generationAttemptNumber, createdByTask,
            createdAt, updatedAt,
            manuallyEdited, lastManuallyEditedAt, lastManuallyEditedBy,
            previousSpecText, structuredTestsJson, coveredEndpointIds,
            manualReady, manualReadyAt, manualReadyBy,
            Boolean.FALSE, null, null);
    }

    /**
     * Backward-compatible 25-arg constructor preserving the pre-manual-ready
     * signature (Phase 1a, 2026-07-20). Delegates to the canonical 28-arg
     * constructor with the manual-ready trio defaulted ({@code manualReady}
     * mirrors the DB default of {@code false}).
     */
    public MigrationStorySpecGenerationDto(
            UUID id,
            UUID projectId,
            UUID workItemId,
            UUID bookOfWorkId,
            String bookItemId,
            String status,
            String confidence,
            String predictedReadiness,
            String generatedSpecText,
            List<Map<String, Object>> warningsJson,
            List<Map<String, Object>> missingInputsJson,
            Map<String, Object> focusedContextRefsJson,
            List<String> evidenceRefsJson,
            String generatedAt,
            String errorMessage,
            Integer generationAttemptNumber,
            String createdByTask,
            String createdAt,
            String updatedAt,
            Boolean manuallyEdited,
            String lastManuallyEditedAt,
            String lastManuallyEditedBy,
            String previousSpecText,
            List<Map<String, Object>> structuredTestsJson,
            List<String> coveredEndpointIds) {
        this(id, projectId, workItemId, bookOfWorkId, bookItemId, status,
            confidence, predictedReadiness, generatedSpecText, warningsJson,
            missingInputsJson, focusedContextRefsJson, evidenceRefsJson,
            generatedAt, errorMessage, generationAttemptNumber, createdByTask,
            createdAt, updatedAt,
            manuallyEdited, lastManuallyEditedAt, lastManuallyEditedBy,
            previousSpecText, structuredTestsJson, coveredEndpointIds,
            Boolean.FALSE, null, null);
    }
}
