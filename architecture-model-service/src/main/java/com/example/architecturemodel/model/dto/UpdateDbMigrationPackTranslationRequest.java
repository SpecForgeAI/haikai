package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * Sparse PATCH body for one translation row. Snake_case wire per the AMS
 * global default. EVERY field is nullable and null-guarded in the service
 * (per {@code project_primitive_double_dto_overwrite.md}): an omitted field
 * leaves the column untouched, so a review-only PATCH can never wipe the
 * draft, the verdict, the pipeline state or the fidelity flags.
 *
 * <p>Reachable surfaces (per tasks.md 2.4):</p>
 * <ul>
 *   <li>{@code pipeline_state} -- state-machine transitions (validated).</li>
 *   <li>{@code draft_content} + {@code judge_verdict_json} -- persisted
 *       TOGETHER by the gateway ({@code drafted} always carries its verdict);
 *       providing {@code draft_content} stamps {@code translated_at}.</li>
 *   <li>{@code disposition} (+ {@code drop_reason}, mandatory for
 *       {@code drop}).</li>
 *   <li>{@code review_status} + {@code reviewer_notes} -- a review action
 *       stamps {@code reviewed_at} ({@code unreviewed} clears it).</li>
 * </ul>
 *
 * <p>Generator-owned fields (source body / hash / fidelity flags / identity)
 * are NOT on this surface at all -- they are only writable through the bulk
 * upsert, so a sparse PATCH can never corrupt the re-link inputs.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 *
 * @param pipelineState One of {@code pending | translating | drafted | failed | needs_manual}.
 * @param draftContent The LLM-translated PL/pgSQL draft.
 * @param judgeVerdictJson The verdict-only judge output, stored verbatim.
 * @param disposition One of {@code translate | rewrite_in_app | drop}.
 * @param dropReason Mandatory rationale when disposition is {@code drop}; blank clears.
 * @param reviewStatus One of {@code unreviewed | approved | rejected | needs_rework}.
 * @param reviewerNotes Reviewer notes; blank clears.
 * @param loopStatus Workbench loop state (validated against
 *     {@code chk_dmpt_loop_status}); changeset 231.
 * @param currentAttemptNo Attempt the loop is currently on.
 * @param bestAttemptNo The best attempt so far (fewest failing scenarios).
 * @param verdictJson Rolled-up loop verdict for the row.
 * @param parityReportId The parity report backing the current verdict.
 * @param staleReason Why the row went stale; blank clears.
 */
public record UpdateDbMigrationPackTranslationRequest(
    @JsonProperty("pipeline_state")
    String pipelineState,

    @JsonProperty("draft_content")
    String draftContent,

    @JsonProperty("judge_verdict_json")
    Map<String, Object> judgeVerdictJson,

    @JsonProperty("disposition")
    String disposition,

    @JsonProperty("drop_reason")
    String dropReason,

    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewer_notes")
    String reviewerNotes,

    // --- Workbench loop (changeset 231, Spec 4, 2026-09-09) -----------------

    @JsonProperty("loop_status")
    String loopStatus,

    @JsonProperty("current_attempt_no")
    Integer currentAttemptNo,

    @JsonProperty("best_attempt_no")
    Integer bestAttemptNo,

    @JsonProperty("verdict_json")
    Map<String, Object> verdictJson,

    @JsonProperty("parity_report_id")
    UUID parityReportId,

    @JsonProperty("stale_reason")
    String staleReason
) {}
