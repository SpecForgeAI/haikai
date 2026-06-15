package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;

/**
 * PATCH body for {@code api_behaviour_baseline_items}.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record UpdateApiBehaviourBaselineItemRequest(
    String method,
    String path,
    String scenarioName,
    Map<String, Object> requestJson,
    Integer responseStatus,
    Map<String, Object> responseJson,
    String businessNotes
) {}
