package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;

/**
 * PATCH body for {@code api_behaviour_scenarios}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record UpdateApiBehaviourScenarioRequest(
    String scenarioName,
    String scenarioType,
    String status,
    String generationSource,
    String requestMethod,
    String requestPath,
    Map<String, Object> requestQueryJson,
    Map<String, Object> requestHeadersRedactedJson,
    Map<String, Object> requestBodyJson,
    String notes
) {}
