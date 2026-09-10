package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * Wire DTO for one per-object DB translation row. Snake_case wire per the AMS
 * global default (NO {@code @CamelCaseWire} -- all consumers are new; the
 * gateway translation pipeline + the frontend Translations tab both speak
 * snake_case).
 *
 * <p>Also the inline shape inside
 * {@link UpsertDbMigrationPackTranslationsRequest#translations()}: on bulk
 * upsert the server matches by {@code translation_key} (unique per pack) and
 * RE-LINKS the existing row -- applying ONLY the non-null caller-supplied
 * fields, so an unchanged row's draft / verdict / disposition / review
 * lifecycle is preserved verbatim when the caller omits those fields.
 * Client-sent {@code id} / {@code pack_id} / timestamps are ignored on
 * upsert (server-managed).</p>
 *
 * <p>{@code truncated} / {@code legacy_redacted} are boxed {@link Boolean}s
 * per {@code project_primitive_double_dto_overwrite.md} -- a missing JSON
 * field maps to {@code null}, never silently to {@code false}.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 *
 * @param id Internal database UUID (server-generated).
 * @param packId Owning pack UUID (server-stamped).
 * @param translationKey Stable identity {@code kind--object_ref}, unique per pack.
 * @param objectRef Human-readable schema.object reference.
 * @param kind One of {@code stored_procedure | trigger | view}.
 * @param disposition One of {@code translate | rewrite_in_app | drop}.
 * @param dropReason Mandatory rationale when disposition is {@code drop}.
 * @param pipelineState One of {@code pending | translating | drafted | failed | needs_manual}.
 * @param sourceBody The captured (redacted, size-capped) source T-SQL body.
 * @param sourceBodyHash SHA-256 of the source body (re-link change detector).
 * @param truncated Fidelity flag: body truncated at capture (boxed).
 * @param legacyRedacted Fidelity flag: captured under the legacy blanket
 *     literal collapse -- no {@code literal_policy: targeted_v2} marker (boxed).
 * @param draftContent The LLM-translated PL/pgSQL draft.
 * @param judgeVerdictJson The verdict-only judge output, stored verbatim.
 * @param reviewStatus One of {@code unreviewed | approved | rejected | needs_rework}.
 * @param reviewerNotes Reviewer notes persisted with the review action.
 * @param createdAt ISO-8601 creation timestamp.
 * @param translatedAt ISO-8601 timestamp of the last persisted draft (nullable).
 * @param reviewedAt ISO-8601 timestamp of the last review action (nullable).
 * @param loopStatus Workbench loop state: {@code idle | queued | translating |
 *     applying | reconciling | reconciled | exhausted | apply_failed |
 *     unverified | stale | blocked_by_callee | dispositioned} (changeset 231).
 * @param currentAttemptNo Attempt the loop is currently on; 0 = never attempted.
 * @param bestAttemptNo On exhaustion, the attempt with the fewest failing scenarios.
 * @param verdictJson Rolled-up loop verdict for the row.
 * @param parityReportId {@code proc_parity_reports.id} backing the current verdict.
 * @param staleReason Why the row went stale.
 */
public record DbMigrationPackTranslationDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("pack_id")
    UUID packId,

    @JsonProperty("translation_key")
    String translationKey,

    @JsonProperty("object_ref")
    String objectRef,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("disposition")
    String disposition,

    @JsonProperty("drop_reason")
    String dropReason,

    @JsonProperty("pipeline_state")
    String pipelineState,

    @JsonProperty("source_body")
    String sourceBody,

    @JsonProperty("source_body_hash")
    String sourceBodyHash,

    @JsonProperty("truncated")
    Boolean truncated,

    @JsonProperty("legacy_redacted")
    Boolean legacyRedacted,

    @JsonProperty("routine_id")
    UUID routineId,

    @JsonProperty("draft_content")
    String draftContent,

    @JsonProperty("judge_verdict_json")
    Map<String, Object> judgeVerdictJson,

    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewer_notes")
    String reviewerNotes,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("translated_at")
    String translatedAt,

    @JsonProperty("reviewed_at")
    String reviewedAt,

    // --- Workbench loop (changeset 231, Spec 4, 2026-09-09) -----------------
    // Appended at the END of the record so every existing positional
    // construction keeps its prefix; loop fields ride the same sparse
    // upsert/PATCH discipline as the rest.

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
