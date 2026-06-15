package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.UUID;

/**
 * Request body for creating an {@code api_behaviour_diffs} row.
 *
 * <p>The diff is created in {@code status="computing"} -- the validation
 * service's {@code diffRunner.ts} then populates the counts and PATCHes the
 * row to {@code status="completed"} when the diff finishes (or
 * {@code "failed"} on error).</p>
 *
 * <p>Service-layer FK-pairing invariant (no DB enum):</p>
 * <ul>
 *   <li>{@link #sourceBaselineId} MUST point at an existing baseline with
 *       {@code kind="current"}.</li>
 *   <li>{@link #targetBaselineId} MUST point at an existing baseline with
 *       {@code kind="target"} AND whose {@code paired_with_baseline_id}
 *       equals {@link #sourceBaselineId}.</li>
 * </ul>
 *
 * <p>Spec: API Test Harness — Diff Engine (2026-05-25) — Task Group 2</p>
 */
public record CreateApiBehaviourDiffRequest(
    UUID architectureId,
    UUID sourceBaselineId,
    UUID targetBaselineId
) {}
