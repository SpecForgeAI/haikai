package com.example.architecturemodel.service.discovery;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit test for {@link DiscoveryFindingService}'s review-disposition
 * vocabulary under Spec F (Normalize Findings Review Actions, 2026-06-02).
 *
 * <p>Spec F removes the restrictive transition graph: dispositions move
 * any-&gt;any (mirroring {@code DiscoveryCandidateService.reviewCandidate}).
 * There is therefore no {@code ALLOWED_TRANSITIONS} map and no
 * {@code isTransitionAllowed} helper to exercise -- this test now pins the
 * vocabulary constants instead.</p>
 *
 * <p>Spinning up a Spring context is unnecessary (the AMS test suite has
 * unrelated pre-existing failures documented in MEMORY.md); the
 * package-private accessors are read directly.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.1 (status rules); normalized by Normalize
 * Findings Review Actions (Spec F, 2026-06-02) Task Group 2.</p>
 */
class DiscoveryFindingStatusTransitionTest {

    @Test
    @DisplayName("ALLOWED_STATUSES is the candidate-parity disposition set + the pre-review state")
    void allowedStatusesAreCandidateParity() {
        // 'dismissed' joined the vocabulary with D4 (Carry-over Completeness
        // Gate, 2026-06-14): unlike rejected ("not real"), a dismissed
        // behaviour-bearing finding is real-but-consciously-not-carried.
        assertThat(DiscoveryFindingService.snapshotAllowedStatuses())
            .containsExactlyInAnyOrder(
                "pending_review", "approved", "rejected", "deferred", "dismissed");
    }

    @Test
    @DisplayName("ALLOWED_REVIEWER_STATUSES excludes pending_review (a reviewer action lands on one of the three dispositions)")
    void reviewerStatusesAreApproveRejectDefer() {
        assertThat(DiscoveryFindingService.ALLOWED_REVIEWER_STATUSES)
            .containsExactlyInAnyOrder("approved", "rejected", "deferred", "dismissed");
    }

    @Test
    @DisplayName("legacy vocabulary (new/accepted/ignored/needs_review/resolved) is fully retired")
    void legacyVocabularyRetired() {
        assertThat(DiscoveryFindingService.snapshotAllowedStatuses())
            .doesNotContain("new", "accepted", "ignored", "needs_review", "resolved");
        assertThat(DiscoveryFindingService.ALLOWED_REVIEWER_STATUSES)
            .doesNotContain("new", "accepted", "ignored", "needs_review", "resolved");
    }
}
