package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.Map;

/**
 * PATCH body for {@code api_behaviour_diagnostics}. Diagnostics are largely
 * write-once but PATCH is supported for completeness; every field is
 * boxed/reference so PATCH preserves null when omitted.
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 */
public record UpdateApiBehaviourDiagnosticRequest(
    String diagnosticType,
    String message,
    Map<String, Object> detailJson
) {}
