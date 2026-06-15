package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;
import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_diagnostics} row.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record CreateApiBehaviourDiagnosticRequest(
    UUID sessionId,
    UUID operationId,
    UUID scenarioId,
    String diagnosticType,
    String message,
    Map<String, Object> detailJson
) {}
