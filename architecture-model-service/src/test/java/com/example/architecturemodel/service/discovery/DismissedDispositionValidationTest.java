package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityReviewStatus;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityMemberRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * D4 dismissal-vocabulary tests: the new {@code dismissed} disposition validates
 * on BOTH {@code DiscoveryFinding} and {@code discovery_capability}, and the
 * pre-existing {@code rejected} disposition is retained (it auto-satisfies the
 * gate). NO DDL -- {@code review_status} / {@code reviewStatus} are string-typed,
 * so {@code dismissed} is added to the service-layer validation sets only.
 *
 * <p>Spec: D4 -- Carry-over Completeness Gate (2026-06-14, Spec 4 of 6) -- Task
 * Group 1.</p>
 *
 * <p>The finding-side validation gates ({@code applyStatusChange} /
 * {@code review} / {@code bulkReview}) all validate against
 * {@code DiscoveryFindingService.ALLOWED_STATUSES} /
 * {@code ALLOWED_REVIEWER_STATUSES}, so set membership is the load-bearing
 * assertion there (a focused, DB-free check). The capability side is exercised
 * end-to-end through the service review path on the JSONB-domain-aliased H2
 * harness (mirrors {@code DiscoveryCapabilityPersistenceTest}).</p>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:dismisseddispdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class DismissedDispositionValidationTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private DiscoveryCapabilityRepository capabilityRepository;

    @Autowired
    private DiscoveryCapabilityMemberRepository memberRepository;

    private DiscoveryCapabilityService capabilityService;

    @BeforeEach
    void setUp() {
        capabilityService = new DiscoveryCapabilityService(capabilityRepository, memberRepository);
    }

    // -------------------------------------------------------------------------
    // Validation-set membership (the finding-side gate -- DB-free)
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("DiscoveryFindingService accepts 'dismissed' as a stored AND reviewer disposition; 'rejected' retained")
    void findingDispositionSetsIncludeDismissedAndRejected() {
        // Stored set (validated by create + applyStatusChange).
        assertThat(DiscoveryFindingService.ALLOWED_STATUSES)
            .contains("dismissed")
            .contains("rejected")
            .contains("pending_review", "approved", "deferred");

        // Reviewer-transition set (validated by review + bulkReview).
        assertThat(DiscoveryFindingService.ALLOWED_REVIEWER_STATUSES)
            .contains("dismissed")
            .contains("rejected")
            // dismissed/rejected are reviewer dispositions; pending_review is NOT.
            .doesNotContain("pending_review");
    }

    @Test
    @DisplayName("DiscoveryCapabilityReviewStatus accepts 'dismissed' in ALL + REVIEWER_VALID; 'rejected' retained")
    void capabilityDispositionSetsIncludeDismissedAndRejected() {
        assertThat(DiscoveryCapabilityReviewStatus.ALL)
            .contains("dismissed")
            .contains(DiscoveryCapabilityReviewStatus.REJECTED)
            .contains(
                DiscoveryCapabilityReviewStatus.PENDING_REVIEW,
                DiscoveryCapabilityReviewStatus.APPROVED,
                DiscoveryCapabilityReviewStatus.DEFERRED);

        assertThat(DiscoveryCapabilityReviewStatus.REVIEWER_VALID)
            .contains("dismissed")
            .contains(DiscoveryCapabilityReviewStatus.REJECTED);

        assertThat(DiscoveryCapabilityReviewStatus.DISMISSED).isEqualTo("dismissed");
    }

    // -------------------------------------------------------------------------
    // Capability service review path accepts 'dismissed' end-to-end (folds the
    // mandatory reason into detail_json.reviewerNotes per the D2 pattern)
    // -------------------------------------------------------------------------

    @Test
    @DisplayName("capability review to 'dismissed' is accepted and folds the reason into detail_json.reviewerNotes")
    void capabilityReviewToDismissedAcceptedWithReason() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();

        DiscoveryCapabilityDto created = capabilityService.create(projectId, architectureId, runId,
            new CreateDiscoveryCapabilityRequest(
                "Retired housekeeping job", "housekeeping", "Dead nightly purge",
                0.6, null, "co_location_heuristic", "capability_synthesis", List.of()));
        UUID capabilityId = created.id();

        // Dismiss with a mandatory reason (the D4 net rule: dismissed + non-empty
        // reason satisfies the gate). The reason folds into detail_json.reviewerNotes.
        DiscoveryCapabilityDto dismissed = capabilityService.review(capabilityId,
            new ReviewDiscoveryCapabilityRequest(
                DiscoveryCapabilityReviewStatus.DISMISSED,
                "Dead code retired in the 2025 decommission -- consciously excluded."));
        entityManager.flush();
        entityManager.clear();

        DiscoveryCapabilityDto reloaded = capabilityService.get(capabilityId);
        assertThat(reloaded.reviewStatus())
            .as("'dismissed' must be accepted as a capability review_status")
            .isEqualTo("dismissed");
        assertThat(reloaded.previousReviewStatus())
            .isEqualTo(DiscoveryCapabilityReviewStatus.PENDING_REVIEW);
        assertThat(reloaded.detailJson())
            .as("the dismissal reason folds into detail_json.reviewerNotes (D2 pattern)")
            .containsEntry("reviewerNotes",
                "Dead code retired in the 2025 decommission -- consciously excluded.");

        // Sanity: the response object reflects the dismissal too.
        assertThat(dismissed.reviewStatus()).isEqualTo("dismissed");
    }
}
