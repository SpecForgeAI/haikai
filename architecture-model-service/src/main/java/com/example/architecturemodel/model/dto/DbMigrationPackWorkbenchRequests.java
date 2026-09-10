package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Request bodies for the translation workbench loop -- Stored Proc &amp;
 * Function Behaviour Program, Spec 4 (changeset 231).
 *
 * <p>Every field carries an explicit {@code @JsonProperty("snake_case")} name
 * so the wire shape is unambiguous at the source (matching
 * {@link com.example.architecturemodel.model.dto.procbehaviour.ProcBehaviourRequests}).
 * Responses are the entities verbatim -- there are no response DTOs.</p>
 */
public final class DbMigrationPackWorkbenchRequests {

    private DbMigrationPackWorkbenchRequests() {
    }

    /**
     * POST {@code .../translations/{translationId}/attempts} -- append one
     * attempt. {@code attempt_no} is unique per translation; a re-post of an
     * existing number is a 409, never an overwrite.
     */
    public record CreateTranslationAttemptRequest(
        @JsonProperty("attempt_no") Integer attemptNo,
        @JsonProperty("draft_content") String draftContent,
        @JsonProperty("judge_verdict_json") Map<String, Object> judgeVerdictJson,
        @JsonProperty("apply_result_json") Map<String, Object> applyResultJson,
        @JsonProperty("parity_report_id") UUID parityReportId,
        @JsonProperty("verdict") String verdict,
        @JsonProperty("evidence_rungs_json") Map<String, Object> evidenceRungsJson,
        @JsonProperty("guidance_text") String guidanceText
    ) {}

    /**
     * POST {@code .../target-builds} -- open a build row. It starts
     * {@code running} with empty phases; the gateway PATCHes progress as the
     * chain advances.
     */
    public record CreateTargetBuildRequest(
        @JsonProperty("project_id") UUID projectId,
        @JsonProperty("architecture_id") UUID architectureId,
        @JsonProperty("target_binding_json") Map<String, Object> targetBindingJson,
        @JsonProperty("pack_version") String packVersion,
        @JsonProperty("rebuild") Boolean rebuild
    ) {}

    /**
     * PATCH {@code .../target-builds/{id}} -- SPARSE: a null field is "not
     * supplied" and leaves the column alone, so a phase update never wipes a
     * recorded error or the S0 fingerprint.
     */
    public record PatchTargetBuildRequest(
        @JsonProperty("status") String status,
        @JsonProperty("phases_json") Map<String, Object> phasesJson,
        @JsonProperty("s0_fingerprint_json") Map<String, Object> s0FingerprintJson,
        @JsonProperty("error") String error,
        @JsonProperty("ended_at") Instant endedAt
    ) {}
}
