package com.example.architecturemodel.model.dto.apibehaviour;

import java.time.Instant;

/**
 * PATCH body for {@code api_behaviour_diffs}.
 *
 * <p>All fields are nullable -- the service layer null-guards each one so a
 * missing field in the JSON does NOT overwrite the existing value with
 * {@code null} / {@code 0}.</p>
 *
 * <h2>PATCH safety</h2>
 *
 * <p><b>All 6 count fields are boxed {@link Integer} -- never primitive
 * {@code int}.</b> Per {@code project_primitive_double_dto_overwrite.md}, any
 * field that participates in PATCH semantics must be a boxed type so a missing
 * JSON field does NOT silently wipe to {@code 0}. The
 * {@link com.example.architecturemodel.service.apibehaviour.ApiBehaviourDiffService}
 * MUST null-guard every field in this DTO when applying the PATCH.</p>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
public record UpdateApiBehaviourDiffRequest(
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
    String errorMessage
) {}
