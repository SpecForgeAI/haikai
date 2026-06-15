package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

/**
 * Tests for the four review workflow fields on DiscoveryCandidateEntity and DTO.
 *
 * Spec: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 1, Task 1.1: 4 focused tests for review fields
 *
 * Test 1: Entity with review_status defaults to "pending_review" when built via @Builder
 * Test 2: Entity accepts all four valid review_status values
 * Test 3: Audit fields (reviewed_by, reviewed_at, previous_review_status) are nullable and round-trip
 * Test 4: toDto conversion includes all four new fields in DiscoveryCandidateDto
 */
@ExtendWith(MockitoExtension.class)
class DiscoveryCandidateReviewFieldsTest {

    @Mock
    private DiscoveryCandidateRepository candidateRepository;

    @Mock
    private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCandidateService service;

    private static final UUID RUN_ID = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new DiscoveryCandidateService(candidateRepository, runGuard);
    }

    /**
     * Test 1: Entity with review_status defaults to "pending_review" when built via @Builder.
     *
     * Verifies that @Builder.Default on reviewStatus produces "pending_review"
     * without explicit assignment, and that this default survives toDto conversion.
     */
    @Test
    @DisplayName("Test 1: Entity review_status defaults to 'pending_review' when built via @Builder")
    void entity_reviewStatus_defaultsToPendingReview() {
        // Given: build entity without specifying reviewStatus
        UUID candidateId = UUID.randomUUID();

        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(candidateId)
            .runId(RUN_ID)
            .candidateType("application")
            .name("DefaultReviewApp")
            .confidence(0.85)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-1"))
            .data(Map.of("description", "App with default review status"))
            .synthesizedAt(Instant.now())
            .build();

        // Then: reviewStatus defaults to "pending_review"
        assertThat(entity.getReviewStatus()).isEqualTo("pending_review");

        // And: toDto preserves the default
        when(candidateRepository.findByRunId(RUN_ID))
            .thenReturn(List.of(entity));

        List<DiscoveryCandidateDto> result = service.getByRunId(RUN_ID, null, null);
        assertThat(result).hasSize(1);
        assertThat(result.get(0).reviewStatus()).isEqualTo("pending_review");
    }

    /**
     * Test 2: Entity accepts all four valid review_status values.
     *
     * Verifies that "pending_review", "approved", "rejected", and "deferred"
     * can all be set on the entity and round-trip through toDto.
     */
    @Test
    @DisplayName("Test 2: Entity accepts all four valid review_status values (pending_review, approved, rejected, deferred)")
    void entity_acceptsAllFourValidReviewStatusValues() {
        // Given: four entities, one per valid review_status
        String[] validStatuses = {"pending_review", "approved", "rejected", "deferred"};

        for (String reviewStatus : validStatuses) {
            DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
                .id(UUID.randomUUID())
                .runId(RUN_ID)
                .candidateType("service")
                .name("Svc-" + reviewStatus)
                .confidence(0.80)
                .status("proposed")
                .sourceClusterIds(List.of("cluster-x"))
                .data(Map.of("description", "Test " + reviewStatus))
                .synthesizedAt(Instant.now())
                .reviewStatus(reviewStatus)
                .build();

            // Then: each reviewStatus value is accepted and retrievable
            assertThat(entity.getReviewStatus()).isEqualTo(reviewStatus);

            // And: toDto preserves each value
            DiscoveryCandidateDto dto = service.toDto(entity);
            assertThat(dto.reviewStatus()).isEqualTo(reviewStatus);
        }
    }

    /**
     * Test 3: Audit fields (reviewed_by, reviewed_at, previous_review_status) are nullable
     * and round-trip correctly through toDto.
     *
     * Verifies both the null case (unreviewed candidate) and the populated case
     * (after a review action has been performed).
     */
    @Test
    @DisplayName("Test 3: Audit fields are nullable and round-trip correctly through toDto")
    void auditFields_areNullableAndRoundTripCorrectly() {
        // Part 1: Null audit fields (unreviewed candidate)
        DiscoveryCandidateEntity unreviewed = DiscoveryCandidateEntity.builder()
            .id(UUID.randomUUID())
            .runId(RUN_ID)
            .candidateType("application")
            .name("UnreviewedApp")
            .confidence(0.85)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-1"))
            .data(Map.of("description", "Not yet reviewed"))
            .synthesizedAt(Instant.now())
            // reviewedBy, reviewedAt, previousReviewStatus not set (null)
            .build();

        assertThat(unreviewed.getReviewedBy()).isNull();
        assertThat(unreviewed.getReviewedAt()).isNull();
        assertThat(unreviewed.getPreviousReviewStatus()).isNull();

        DiscoveryCandidateDto unreviewedDto = service.toDto(unreviewed);
        assertThat(unreviewedDto.reviewedBy()).isNull();
        assertThat(unreviewedDto.reviewedAt()).isNull();
        assertThat(unreviewedDto.previousReviewStatus()).isNull();

        // Part 2: Populated audit fields (reviewed candidate)
        Instant reviewTime = Instant.parse("2026-04-05T10:30:00Z");

        DiscoveryCandidateEntity reviewed = DiscoveryCandidateEntity.builder()
            .id(UUID.randomUUID())
            .runId(RUN_ID)
            .candidateType("service")
            .name("ReviewedService")
            .confidence(0.90)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-2"))
            .data(Map.of("description", "Has been reviewed"))
            .synthesizedAt(Instant.now())
            .reviewStatus("approved")
            .reviewedBy("Alice")
            .reviewedAt(reviewTime)
            .previousReviewStatus("pending_review")
            .build();

        assertThat(reviewed.getReviewedBy()).isEqualTo("Alice");
        assertThat(reviewed.getReviewedAt()).isEqualTo(reviewTime);
        assertThat(reviewed.getPreviousReviewStatus()).isEqualTo("pending_review");

        DiscoveryCandidateDto reviewedDto = service.toDto(reviewed);
        assertThat(reviewedDto.reviewedBy()).isEqualTo("Alice");
        assertThat(reviewedDto.reviewedAt()).isEqualTo(reviewTime.toString());
        assertThat(reviewedDto.previousReviewStatus()).isEqualTo("pending_review");
    }

    /**
     * Test 4: toDto conversion includes all four new fields in DiscoveryCandidateDto.
     *
     * Creates a fully populated entity with all review fields and verifies
     * that the DTO record contains all four fields with correct values.
     */
    @Test
    @DisplayName("Test 4: toDto conversion includes all four review fields in DiscoveryCandidateDto")
    void toDto_includesAllFourReviewFields() {
        // Given: a fully populated entity
        UUID candidateId = UUID.randomUUID();
        Instant synthesizedAt = Instant.parse("2026-04-05T09:00:00Z");
        Instant reviewedAt = Instant.parse("2026-04-05T11:00:00Z");

        DiscoveryCandidateEntity entity = DiscoveryCandidateEntity.builder()
            .id(candidateId)
            .runId(RUN_ID)
            .candidateType("app_component")
            .name("AuthModule")
            .confidence(0.92)
            .status("proposed")
            .sourceClusterIds(List.of("cluster-a", "cluster-b"))
            .data(Map.of("description", "Authentication module", "techStack", "OAuth2"))
            .parentCandidateId(null)
            .synthesizedAt(synthesizedAt)
            .reviewStatus("rejected")
            .reviewedBy("Bob")
            .reviewedAt(reviewedAt)
            .previousReviewStatus("approved")
            .build();

        // When
        DiscoveryCandidateDto dto = service.toDto(entity);

        // Then: all existing fields are correct
        assertThat(dto.id()).isEqualTo(candidateId);
        assertThat(dto.runId()).isEqualTo(RUN_ID);
        assertThat(dto.candidateType()).isEqualTo("app_component");
        assertThat(dto.name()).isEqualTo("AuthModule");
        assertThat(dto.confidence()).isEqualTo(0.92);
        assertThat(dto.status()).isEqualTo("proposed");
        assertThat(dto.sourceClusterIds()).containsExactly("cluster-a", "cluster-b");
        assertThat(dto.data()).containsEntry("description", "Authentication module");
        assertThat(dto.synthesizedAt()).isEqualTo(synthesizedAt.toString());
        assertThat(dto.parentCandidateId()).isNull();

        // And: all four new review fields are present and correct
        assertThat(dto.reviewStatus()).isEqualTo("rejected");
        assertThat(dto.reviewedBy()).isEqualTo("Bob");
        assertThat(dto.reviewedAt()).isEqualTo(reviewedAt.toString());
        assertThat(dto.previousReviewStatus()).isEqualTo("approved");
    }
}
