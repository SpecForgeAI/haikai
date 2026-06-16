package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_captures} row.
 *
 * <p>{@code attemptNumber}, {@code responseStatus}, {@code durationMs} are
 * boxed {@link Integer} so PATCH preserves {@code null}; {@code accepted} is
 * boxed {@link Boolean} for the same reason (see project memory note
 * {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>{@code volatilePathsJson} is the capture-time volatility envelope
 * {@code { paths, volatility_source, k }} measured by the probe in
 * {@code execute_http_request}; it is carried forward onto the source baseline
 * item on Save-as-baseline. snake_case wire ({@code volatile_paths_json}, AMS
 * default). {@code null} =&gt; no volatility recorded =&gt; strict comparison.
 * Spec: Reconcile-Time Determinism &amp; Volatile-Value Handling (2026-06-16) —
 * FU-2.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record ApiBehaviourCaptureDto(
    UUID id,
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
) {}
