package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_baseline_items} row.
 *
 * <p>{@code volatilePathsJson} is OPTIONAL: the capture-time volatility probe
 * supplies the measured envelope ({@code { paths, volatility_source, k }}) at
 * pin time; callers that record no volatility (or pre-probe callers) omit it
 * and the row is stored with {@code null} (strict-comparison default). It is
 * written ONCE here at create time and never mutated thereafter (baseline
 * immutability) — there is no PATCH path for it.</p>
 *
 * <p>{@code sequenceJson} is OPTIONAL: the capture-side sequence assembly
 * supplies the pinned ordered HTTP chain (setup &rarr; act &rarr; cleanup) for a
 * STATEFUL SEQUENCE scenario; single-shot scenarios omit it and the row is
 * stored with {@code null} (today's behaviour, zero regression). Like
 * {@code volatilePathsJson} it is written ONCE here at create time and never
 * mutated thereafter — there is no PATCH path for it.</p>
 *
 * <p>Wire format is snake_case (the AMS default — NO {@code @CamelCaseWire}):
 * {@code volatilePathsJson} accepts {@code volatile_paths_json} and
 * {@code sequenceJson} accepts {@code sequence_json} on the wire.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2.
 * Extended by Reconcile-Time Determinism &amp; Volatile-Value Handling
 * (2026-06-16) — Task Group 1 ({@code volatilePathsJson}). Extended by Stateful
 * Sequence Scenarios (2026-06-18) — Task Group 1 ({@code sequenceJson}).</p>
 */
public record CreateApiBehaviourBaselineItemRequest(
    UUID baselineId,
    UUID captureId,
    UUID operationId,
    UUID scenarioId,
    String method,
    String path,
    String scenarioName,
    Map<String, Object> requestJson,
    Integer responseStatus,
    Map<String, Object> responseJson,
    Map<String, Object> volatilePathsJson,
    Map<String, Object> sequenceJson,
    String responseBodyRaw,
    String businessNotes
) {
    /**
     * Backward-compatible delegating constructor for pre-raw call sites
     * (Spec 2026-07-06-j): delegates with {@code responseBodyRaw == null}
     * ("raw unavailable"; strict verdicts degrade visibly).
     */
    public CreateApiBehaviourBaselineItemRequest(
        UUID baselineId,
        UUID captureId,
        UUID operationId,
        UUID scenarioId,
        String method,
        String path,
        String scenarioName,
        Map<String, Object> requestJson,
        Integer responseStatus,
        Map<String, Object> responseJson,
        Map<String, Object> volatilePathsJson,
        Map<String, Object> sequenceJson,
        String businessNotes
    ) {
        this(
            baselineId, captureId, operationId, scenarioId,
            method, path, scenarioName, requestJson, responseStatus,
            responseJson, volatilePathsJson, sequenceJson, null, businessNotes);
    }

    /**
     * Backward-compatible delegating constructor for pre-sequence call sites:
     * delegates with {@code sequenceJson == null} (a single-shot item) and
     * {@code responseBodyRaw == null}.
     */
    public CreateApiBehaviourBaselineItemRequest(
        UUID baselineId,
        UUID captureId,
        UUID operationId,
        UUID scenarioId,
        String method,
        String path,
        String scenarioName,
        Map<String, Object> requestJson,
        Integer responseStatus,
        Map<String, Object> responseJson,
        Map<String, Object> volatilePathsJson,
        String businessNotes
    ) {
        this(
            baselineId, captureId, operationId, scenarioId,
            method, path, scenarioName, requestJson, responseStatus,
            responseJson, volatilePathsJson, null, null, businessNotes);
    }
}
