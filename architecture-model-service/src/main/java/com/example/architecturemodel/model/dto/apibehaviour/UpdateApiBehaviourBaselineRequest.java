package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.UUID;

/**
 * PATCH body for {@code api_behaviour_baselines}.
 *
 * <p>{@code kind} and {@code pairedWithBaselineId} are optional PATCH fields;
 * the service layer null-guards them and validates the FK-pairing invariant
 * (target → non-null pair; current → null pair) whenever either field is
 * present in the body.</p>
 *
 * <p>A backward-compatible 5-arg constructor delegates to the canonical 7-arg
 * constructor with {@code kind=null} and {@code pairedWithBaselineId=null} so
 * existing callers compile unchanged.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code pairedWithBaselineId}).</p>
 */
public record UpdateApiBehaviourBaselineRequest(
    String name,
    String status,
    Integer acceptedCaptureCount,
    Integer operationCount,
    String notes,
    String kind,
    UUID pairedWithBaselineId
) {

    /**
     * Backward-compatible 5-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical 7-arg constructor with
     * {@code kind=null} and {@code pairedWithBaselineId=null} (PATCH-no-op
     * for those fields).
     */
    public UpdateApiBehaviourBaselineRequest(
            String name,
            String status,
            Integer acceptedCaptureCount,
            Integer operationCount,
            String notes) {
        this(name, status, acceptedCaptureCount, operationCount, notes,
            null, null);
    }
}
