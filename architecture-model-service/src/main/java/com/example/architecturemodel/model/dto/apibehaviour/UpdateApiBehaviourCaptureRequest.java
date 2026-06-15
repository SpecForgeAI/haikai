package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;

/**
 * PATCH body for {@code api_behaviour_captures}. The Test Engineer review
 * flow PATCHes {@code accepted}, {@code acceptedAt}, {@code reviewerNotes}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record UpdateApiBehaviourCaptureRequest(
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
