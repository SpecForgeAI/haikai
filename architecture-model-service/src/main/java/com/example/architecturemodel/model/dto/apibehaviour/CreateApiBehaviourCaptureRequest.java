package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_captures} row.
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
    Integer durationMs,
    String errorType,
    String errorMessage,
    Instant capturedAt,
    Boolean accepted,
    Instant acceptedAt,
    String reviewerNotes
) {}
