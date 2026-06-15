package com.example.architecturemodel.model.entity.discovery;

import java.util.Set;

/**
 * The allowed {@code discovery_capability.review_status} disposition values
 * (Liquibase changeset 184).
 *
 * <p>Status-as-TEXT (no DB enum, the AMS convention); the service layer validates
 * against {@link #ALL}. Mirrors the candidate / finding review vocabulary (D6):
 * {@code pending_review} | {@code approved} | {@code rejected} |
 * {@code deferred}, extended by D4 with {@code dismissed}.</p>
 *
 * <p>{@link #REVIEWER_VALID} is the subset a reviewer may transition TO via the
 * patch-review endpoint (i.e. all values except no terminal restriction --
 * {@code pending_review} is allowed as an explicit re-open).</p>
 *
 * <p>{@link #DISMISSED} (D4 -- Carry-over Completeness Gate, 2026-06-14, Spec 4
 * of 6) is the "real but consciously excluded from migration" disposition.
 * Alongside the pre-existing {@link #REJECTED} ("not real / not valid"), a
 * {@code dismissed} behaviour-bearing capability with a non-empty reason
 * satisfies the carry_over completeness gate. NO DDL -- {@code review_status} is
 * string-typed (TEXT); this is a service-layer validation-set extension only.
 * The dismissal reason folds into {@code detail_json.reviewerNotes} per the D2
 * pattern.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1; extended by D4 -- Carry-over Completeness Gate (2026-06-14,
 * Spec 4 of 6) -- Task Group 1 with the {@link #DISMISSED} disposition.</p>
 */
public final class DiscoveryCapabilityReviewStatus {

    private DiscoveryCapabilityReviewStatus() {
        // Constants holder - prevent instantiation
    }

    public static final String PENDING_REVIEW = "pending_review";
    public static final String APPROVED = "approved";
    public static final String REJECTED = "rejected";
    public static final String DEFERRED = "deferred";

    /**
     * The D4 carry_over-gate disposition: "real but consciously excluded from
     * migration" (dead code retired, out-of-scope). With a non-empty reason it
     * satisfies the carry_over completeness gate alongside {@link #REJECTED}.
     * NO DDL -- string-typed, service-layer validated.
     */
    public static final String DISMISSED = "dismissed";

    /** Every legal {@code review_status} value. */
    public static final Set<String> ALL = Set.of(
        PENDING_REVIEW, APPROVED, REJECTED, DEFERRED, DISMISSED);

    /** The dispositions a reviewer may transition a capability to. */
    public static final Set<String> REVIEWER_VALID = Set.of(
        PENDING_REVIEW, APPROVED, REJECTED, DEFERRED, DISMISSED);
}
