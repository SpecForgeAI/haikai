package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_scenarios} row.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record ApiBehaviourScenarioDto(
    UUID id,
    UUID sessionId,
    UUID operationId,
    String scenarioName,
    String scenarioType,
    String status,
    String generationSource,
    String requestMethod,
    String requestPath,
    Map<String, Object> requestQueryJson,
    Map<String, Object> requestHeadersRedactedJson,
    Map<String, Object> requestBodyJson,
    String notes,
    Instant createdAt,
    Instant updatedAt
) {}
