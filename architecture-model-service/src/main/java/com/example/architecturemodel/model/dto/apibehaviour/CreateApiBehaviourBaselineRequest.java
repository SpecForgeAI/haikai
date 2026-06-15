package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_baselines} row.
 *
 * <p>{@code kind} (one of {@code "current"} | {@code "target"}, defaults to
 * {@code "current"} at the service layer when omitted) and
 * {@code pairedWithBaselineId} (required when {@code kind="target"}, MUST be
 * null when {@code kind="current"}) are validated by
 * {@link com.example.architecturemodel.service.apibehaviour.ApiBehaviourBaselineService}.</p>
 *
 * <p>A backward-compatible 7-arg constructor delegates to the canonical 9-arg
 * constructor with {@code kind=null} and {@code pairedWithBaselineId=null}.
 * Existing callers that posted the older payload shape keep working — the
 * service layer treats a null {@code kind} as a request for the default
 * {@code "current"}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code pairedWithBaselineId}).</p>
 */
public record CreateApiBehaviourBaselineRequest(
    UUID architectureId,
    UUID sessionId,
    String name,
    String status,
    Integer acceptedCaptureCount,
    Integer operationCount,
    String notes,
    String kind,
    UUID pairedWithBaselineId
) {

    /**
     * Backward-compatible 7-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical 9-arg constructor with
     * {@code kind=null} (defaults to {@code "current"} at the service layer)
     * and {@code pairedWithBaselineId=null}.
     */
    public CreateApiBehaviourBaselineRequest(
            UUID architectureId,
            UUID sessionId,
            String name,
            String status,
            Integer acceptedCaptureCount,
            Integer operationCount,
            String notes) {
        this(architectureId, sessionId, name, status,
            acceptedCaptureCount, operationCount, notes,
            null, null);
    }
}
