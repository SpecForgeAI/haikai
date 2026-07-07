package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;
import java.util.UUID;

/**
 * Response shape for an {@code api_behaviour_diffs} row.
 *
 * <h2>PATCH safety</h2>
 *
 * <p><b>All 6 count fields ({@link #matchedCount}, {@link #statusDriftCount},
 * {@link #bodyShapeDriftCount}, {@link #bodyValueDriftCount},
 * {@link #sourceOnlyCount}, {@link #targetOnlyCount}) are boxed
 * {@link Integer} -- never primitive {@code int}.</b> Per
 * {@code project_primitive_double_dto_overwrite.md}, any field that
 * participates in PATCH semantics must be a boxed type so a missing JSON field
 * does NOT silently wipe to {@code 0}. Future maintainers adding new count
 * fields MUST follow this rule.</p>
 *
 * <p>All other fields are reference types ({@link UUID}, {@link String},
 * {@link Instant}) -- no primitive-type drift risk.</p>
 *
 * <h2>Wire format</h2>
 *
 * <p>Follows the existing per-field global Jackson snake_case convention used
 * by the api-behaviour DTOs -- no {@code @JsonNaming} sweep; no
 * {@code @CamelCaseWire} (the consumer is the gateway snake_case proxy + a
 * frontend that already speaks snake_case for api-behaviour).</p>
 *
 * <h2>FK-pairing invariant (service-layer enforcement)</h2>
 *
 * <ul>
 *   <li>{@link #sourceBaselineId} MUST point at an existing baseline with
 *       {@code kind="current"}.</li>
 *   <li>{@link #targetBaselineId} MUST point at an existing baseline with
 *       {@code kind="target"} AND
 *       {@code paired_with_baseline_id == source_baseline_id}.</li>
 * </ul>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
public record ApiBehaviourDiffDto(
    UUID id,
    UUID projectId,
    UUID architectureId,
    UUID sourceBaselineId,
    UUID targetBaselineId,
    String status,
    /**
     * 'standard' | 'strict' chosen at diff-creation time
     * (Spec 2026-07-06-j); null reads as 'standard' (today's semantics).
     */
    String comparisonProfile,
    Integer matchedCount,
    Integer statusDriftCount,
    Integer bodyShapeDriftCount,
    Integer bodyValueDriftCount,
    Integer sourceOnlyCount,
    Integer targetOnlyCount,
    Instant sourceBaselineUpdatedAt,
    Instant targetBaselineUpdatedAt,
    Instant computedAt,
    String errorMessage,
    Instant createdAt,
    Instant updatedAt
) {
    /**
     * Backward-compatible delegating constructor for pre-profile call sites
     * (Spec 2026-07-06-j): delegates with {@code comparisonProfile == null}
     * ('standard' semantics).
     */
    public ApiBehaviourDiffDto(
        UUID id,
        UUID projectId,
        UUID architectureId,
        UUID sourceBaselineId,
        UUID targetBaselineId,
        String status,
        Integer matchedCount,
        Integer statusDriftCount,
        Integer bodyShapeDriftCount,
        Integer bodyValueDriftCount,
        Integer sourceOnlyCount,
        Integer targetOnlyCount,
        Instant sourceBaselineUpdatedAt,
        Instant targetBaselineUpdatedAt,
        Instant computedAt,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt
    ) {
        this(
            id, projectId, architectureId, sourceBaselineId, targetBaselineId,
            status, null, matchedCount, statusDriftCount, bodyShapeDriftCount,
            bodyValueDriftCount, sourceOnlyCount, targetOnlyCount,
            sourceBaselineUpdatedAt, targetBaselineUpdatedAt, computedAt,
            errorMessage, createdAt, updatedAt);
    }
}
