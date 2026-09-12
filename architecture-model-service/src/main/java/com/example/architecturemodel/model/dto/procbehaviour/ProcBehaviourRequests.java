package com.example.architecturemodel.model.dto.procbehaviour;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Request bodies for the proc behaviour capture data plane -- Stored Proc
 * &amp; Function Behaviour Program, Spec 3 (changeset 230).
 *
 * <p>Every field carries an explicit {@code @JsonProperty("snake_case")} name
 * so the wire shape is unambiguous at the source, matching
 * {@link com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest}. The
 * AMS global naming strategy is already SNAKE_CASE and
 * {@code spring.jackson.deserialization.fail-on-unknown-properties} is already
 * {@code false} (see {@code application.yml}), so unknown keys are tolerated
 * without a per-record {@code @JsonIgnoreProperties}.</p>
 *
 * <p>Responses are the entities verbatim -- there are no response DTOs.</p>
 */
public final class ProcBehaviourRequests {

    private ProcBehaviourRequests() {
    }

    /** POST /capture-sessions. */
    public record CreateProcCaptureSessionRequest(
        @JsonProperty("name") String name,
        @JsonProperty("kind") String kind,
        @JsonProperty("scope_routine_ids_json") List<String> scopeRoutineIdsJson,
        @JsonProperty("db_config_redacted_json") Map<String, Object> dbConfigRedactedJson,
        @JsonProperty("session_profile_json") Map<String, Object> sessionProfileJson,
        @JsonProperty("capture_tuning_json") Map<String, Object> captureTuningJson
    ) {}

    /**
     * PATCH /capture-sessions/{id} -- SPARSE: a null field is "not supplied"
     * and leaves the column alone. {@code status} walks the state machine.
     */
    public record PatchProcCaptureSessionRequest(
        @JsonProperty("name") String name,
        @JsonProperty("status") String status,
        @JsonProperty("scope_routine_ids_json") List<String> scopeRoutineIdsJson,
        @JsonProperty("db_config_redacted_json") Map<String, Object> dbConfigRedactedJson,
        @JsonProperty("session_profile_json") Map<String, Object> sessionProfileJson,
        @JsonProperty("capture_tuning_json") Map<String, Object> captureTuningJson,
        @JsonProperty("coverage_summary_json") Map<String, Object> coverageSummaryJson,
        @JsonProperty("s0_fingerprint_json") Map<String, Object> s0FingerprintJson,
        @JsonProperty("started_at") Instant startedAt,
        @JsonProperty("completed_at") Instant completedAt
    ) {}

    /** POST /capture-sessions/{id}/scenarios. */
    public record UpsertProcScenariosRequest(
        @JsonProperty("scenarios") List<ProcScenarioDto> scenarios
    ) {

        /** One intended routine call; keyed by (session, routine_id, scenario_name). */
        public record ProcScenarioDto(
            @JsonProperty("routine_id") UUID routineId,
            @JsonProperty("scenario_name") String scenarioName,
            @JsonProperty("scenario_type") String scenarioType,
            @JsonProperty("generation_source") String generationSource,
            @JsonProperty("inputs_json") List<Map<String, Object>> inputsJson,
            @JsonProperty("sequence_json") List<Map<String, Object>> sequenceJson,
            @JsonProperty("status") String status,
            @JsonProperty("exclusion_reason") String exclusionReason,
            @JsonProperty("notes") String notes
        ) {}
    }

    /** POST /capture-sessions/{id}/captures. */
    public record InsertProcCapturesRequest(
        @JsonProperty("captures") List<ProcCaptureDto> captures
    ) {

        /** One fired attempt. Append-only -- captures are never updated in place. */
        public record ProcCaptureDto(
            @JsonProperty("scenario_id") UUID scenarioId,
            @JsonProperty("routine_id") UUID routineId,
            @JsonProperty("attempt_number") Integer attemptNumber,
            @JsonProperty("envelope_json") Map<String, Object> envelopeJson,
            @JsonProperty("state_delta_json") Map<String, Object> stateDeltaJson,
            @JsonProperty("volatile_cells_json") List<Map<String, Object>> volatileCellsJson,
            @JsonProperty("bracket_outcome") String bracketOutcome,
            @JsonProperty("duration_ms") Long durationMs,
            @JsonProperty("error_type") String errorType,
            @JsonProperty("error_message") String errorMessage,
            @JsonProperty("accepted") Boolean accepted
        ) {}
    }

    /** POST /capture-sessions/{id}/diagnostics. */
    public record InsertProcDiagnosticsRequest(
        @JsonProperty("diagnostics") List<ProcDiagnosticDto> diagnostics
    ) {

        /** One loud reason a routine or scenario is not in the baseline. */
        public record ProcDiagnosticDto(
            @JsonProperty("routine_id") UUID routineId,
            @JsonProperty("diagnostic_type") String diagnosticType,
            @JsonProperty("message") String message,
            @JsonProperty("detail_json") Map<String, Object> detailJson
        ) {}
    }

    /** POST /baselines -- save-as-baseline from a completed session. */
    public record CreateProcBaselineRequest(
        @JsonProperty("session_id") UUID sessionId,
        @JsonProperty("name") String name,
        @JsonProperty("kind") String kind,
        @JsonProperty("s0_fingerprint_json") Map<String, Object> s0FingerprintJson,
        @JsonProperty("items") List<ProcBaselineItemDto> items
    ) {

        /** One replayable expectation carried with the routine body hash. */
        public record ProcBaselineItemDto(
            @JsonProperty("routine_id") UUID routineId,
            @JsonProperty("routine_body_hash") String routineBodyHash,
            @JsonProperty("scenario_id") UUID scenarioId,
            @JsonProperty("scenario_name") String scenarioName,
            @JsonProperty("scenario_type") String scenarioType,
            @JsonProperty("exit_outcome") String exitOutcome,
            @JsonProperty("inputs_json") List<Map<String, Object>> inputsJson,
            @JsonProperty("sequence_json") List<Map<String, Object>> sequenceJson,
            @JsonProperty("expected_envelope_json") Map<String, Object> expectedEnvelopeJson,
            @JsonProperty("state_delta_json") Map<String, Object> stateDeltaJson,
            @JsonProperty("volatile_cells_json") List<Map<String, Object>> volatileCellsJson,
            @JsonProperty("business_notes") String businessNotes
        ) {}
    }

    /**
     * POST /baselines/{id}/items/stale -- current body hash per routine id.
     * Items whose captured hash differs go stale with reason body_changed.
     */
    public record MarkProcBaselineItemsStaleRequest(
        @JsonProperty("routine_body_hashes") Map<String, String> routineBodyHashes
    ) {}
}
