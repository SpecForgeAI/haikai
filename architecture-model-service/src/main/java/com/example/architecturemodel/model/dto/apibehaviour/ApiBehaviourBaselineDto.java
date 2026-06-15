package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_baselines} row.
 *
 * <p>Numeric summary counts are boxed {@link Integer} (PATCH-safety).</p>
 *
 * <h2>PATCH safety</h2>
 * <p>Boxed types are required for any numeric / boolean field that participates
 * in PATCH semantics (per {@code project_primitive_double_dto_overwrite.md}).
 * The new {@code kind} ({@link String}) and {@code pairedWithBaselineId}
 * ({@link UUID}) fields added by the API Test Harness — Target-Side Capture
 * spec (2026-05-25) are reference types — no boxed-type audit needed for them.
 * The next maintainer adding fields must apply the same rule: any
 * primitive-numeric / primitive-boolean column-mutable field MUST be its boxed
 * counterpart.</p>
 *
 * <h2>Kind discriminator (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <p>{@code kind} distinguishes a current-state baseline ({@code "current"})
 * from a target-side replay baseline ({@code "target"}). Validated at the
 * service layer.</p>
 *
 * <p>{@code pairedWithBaselineId} is the self-FK from a target baseline back at
 * the source current-state baseline it was replayed from. Service-layer
 * invariant: target baselines MUST have a non-null pair; current baselines
 * MUST have it null.</p>
 *
 * <p>A backward-compatible 11-arg constructor delegates to the canonical
 * 13-arg constructor with {@code kind="current"} and
 * {@code pairedWithBaselineId=null}, so existing call sites compile unchanged
 * (same pattern as {@link com.example.architecturemodel.model.dto.ArchitectureDto}'s
 * 8-arg / 10-arg / 11-arg compatibility chain).</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 2</p>
 * <p>Extended: API Test Harness — Target-Side Capture (2026-05-25) — Task Group 2
 * ({@code kind} + {@code pairedWithBaselineId}).</p>
 */
public record ApiBehaviourBaselineDto(
    UUID id,
    UUID projectId,
    UUID architectureId,
    UUID sessionId,
    String name,
    String status,
    Integer acceptedCaptureCount,
    Integer operationCount,
    String notes,
    String kind,
    UUID pairedWithBaselineId,
    Instant createdAt,
    Instant updatedAt
) {

    /**
     * Backward-compatible 11-arg constructor preserving the pre-Target-Side-
     * Capture signature. Delegates to the canonical 13-arg constructor with
     * {@code kind="current"} and {@code pairedWithBaselineId=null}.
     *
     * <p>Same delegating pattern as
     * {@link com.example.architecturemodel.model.dto.ArchitectureDto}. Callers
     * that need to set the new fields use the canonical constructor directly.</p>
     */
    public ApiBehaviourBaselineDto(
            UUID id,
            UUID projectId,
            UUID architectureId,
            UUID sessionId,
            String name,
            String status,
            Integer acceptedCaptureCount,
            Integer operationCount,
            String notes,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, architectureId, sessionId, name, status,
            acceptedCaptureCount, operationCount, notes,
            "current", null,
            createdAt, updatedAt);
    }
}
