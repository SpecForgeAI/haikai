package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_captures} row.
 *
 * <p>{@code volatilePathsJson} is OPTIONAL: the capture-time volatility probe
 * (in {@code execute_http_request}) measures the volatility envelope
 * {@code { paths, volatility_source, k }} and sends it on the CREATE so it can
 * be carried forward onto the source baseline item on Save-as-baseline.
 * Write-once at capture time; omitted / {@code null} =&gt; strict comparison.
 * snake_case wire ({@code volatile_paths_json}, AMS default). Spec:
 * Reconcile-Time Determinism &amp; Volatile-Value Handling (2026-06-16) —
 * FU-2.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record CreateApiBehaviourCaptureRequest(
    UUID sessionId,
    UUID scenarioId,
    UUID operationId,
    Integer attemptNumber,
    String requestMethod,
    String requestUrlRedacted,
    String requestPath,
    Map<String, Object> requestQueryJson,
    Map<String, Object> requestHeadersRedactedJson,
    Map<String, Object> requestBodyJson,
    Integer responseStatus,
    Map<String, Object> responseHeadersRedactedJson,
    Map<String, Object> responseBodyJson,
    /** Spec 2026-07-06-j: raw body, redaction-clean only; null = unavailable. */
    String responseBodyRaw,
    /** Spec 2026-07-06-n: effect-table state delta; null = not captured. */
    Map<String, Object> stateDeltaJson,
    Integer durationMs,
    String errorType,
    String errorMessage,
    Instant capturedAt,
    Boolean accepted,
    Instant acceptedAt,
    String reviewerNotes,
    Map<String, Object> volatilePathsJson
) {
    /** Backward-compatible delegating constructor (raw + delta default null). */
    public CreateApiBehaviourCaptureRequest(
        UUID sessionId,
        UUID scenarioId,
        UUID operationId,
        Integer attemptNumber,
        String requestMethod,
        String requestUrlRedacted,
        String requestPath,
        Map<String, Object> requestQueryJson,
        Map<String, Object> requestHeadersRedactedJson,
        Map<String, Object> requestBodyJson,
        Integer responseStatus,
        Map<String, Object> responseHeadersRedactedJson,
        Map<String, Object> responseBodyJson,
        String responseBodyRaw,
        Integer durationMs,
        String errorType,
        String errorMessage,
        Instant capturedAt,
        Boolean accepted,
        Instant acceptedAt,
        String reviewerNotes,
        Map<String, Object> volatilePathsJson
    ) {
        this(
            sessionId, scenarioId, operationId, attemptNumber, requestMethod,
            requestUrlRedacted, requestPath, requestQueryJson,
            requestHeadersRedactedJson, requestBodyJson, responseStatus,
            responseHeadersRedactedJson, responseBodyJson, responseBodyRaw,
            null, durationMs, errorType, errorMessage, capturedAt, accepted,
            acceptedAt, reviewerNotes, volatilePathsJson);
    }

    /** Backward-compatible delegating constructor (raw defaults null). */
    public CreateApiBehaviourCaptureRequest(
        UUID sessionId,
        UUID scenarioId,
        UUID operationId,
        Integer attemptNumber,
        String requestMethod,
        String requestUrlRedacted,
        String requestPath,
        Map<String, Object> requestQueryJson,
        Map<String, Object> requestHeadersRedactedJson,
        Map<String, Object> requestBodyJson,
        Integer responseStatus,
        Map<String, Object> responseHeadersRedactedJson,
        Map<String, Object> responseBodyJson,
        Integer durationMs,
        String errorType,
        String errorMessage,
        Instant capturedAt,
        Boolean accepted,
        Instant acceptedAt,
        String reviewerNotes,
        Map<String, Object> volatilePathsJson
    ) {
        this(
            sessionId, scenarioId, operationId, attemptNumber, requestMethod,
            requestUrlRedacted, requestPath, requestQueryJson,
            requestHeadersRedactedJson, requestBodyJson, responseStatus,
            responseHeadersRedactedJson, responseBodyJson, null, durationMs,
            errorType, errorMessage, capturedAt, accepted, acceptedAt,
            reviewerNotes, volatilePathsJson);
    }
}
