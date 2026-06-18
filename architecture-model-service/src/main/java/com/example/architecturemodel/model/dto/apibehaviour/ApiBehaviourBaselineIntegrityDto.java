package com.example.architecturemodel.model.dto.apibehaviour;

/**
 * Result of the server-side baseline integrity verify operation
 * ({@code GET .../baselines/{baselineId}/integrity}).
 *
 * <p>Recomputes the canonical content hash (see
 * {@link com.example.architecturemodel.util.BaselineContentHashUtil}) over the
 * CURRENT stored items and compares it to the {@code content_hash} stamped at
 * activation:</p>
 * <ul>
 *   <li>{@code contentHash} — the hash stamped on the baseline header at the
 *       draft→active transition. {@code null} for a pre-existing /
 *       never-activated baseline ("no integrity hash recorded").</li>
 *   <li>{@code recomputedHash} — the hash recomputed NOW over the stored
 *       items.</li>
 *   <li>{@code integrityVerified} —
 *       {@code contentHash != null && contentHash.equals(recomputedHash)}. When
 *       {@code contentHash} is null this is {@code false}, and the consumer must
 *       treat the null-hash case as "no hash recorded" (NEUTRAL), NOT a
 *       mismatch.</li>
 * </ul>
 *
 * <p>Verification is server-side only — there is no TS↔Java hash reimplementation
 * (one Java hashing implementation eliminates canonical-serialization drift).</p>
 *
 * <p>Snake_case wire (AMS default — NO {@code @CamelCaseWire}): the
 * validation-service + frontend consumers read {@code content_hash} /
 * {@code recomputed_hash} / {@code integrity_verified}.</p>
 *
 * <p>Spec: Baseline Integrity &amp; Provenance (2026-06-17) — Task Group 1.</p>
 */
public record ApiBehaviourBaselineIntegrityDto(
    String contentHash,
    String recomputedHash,
    boolean integrityVerified
) {
}
