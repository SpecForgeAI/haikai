package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_diagnostics} row.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record ApiBehaviourDiagnosticDto(
    UUID id,
    UUID sessionId,
    UUID operationId,
    UUID scenarioId,
    String diagnosticType,
    String message,
    Map<String, Object> detailJson,
    Instant createdAt
) {}
