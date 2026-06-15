package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_baseline_items} row.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
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
    String businessNotes
) {}
