package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.BulkReviewDiscoveryFindingsRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewDiscoveryFindingsResponse;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryClusterRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRelationshipRepository;
import com.example.architecturemodel.service.DiscoveryRunArchitectureGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-layer tests for {@code DiscoveryFindingService.bulkReview(...)}
 * added by the Bulk Findings Actions spec (2026-05-28) Task Group 1 and
 * NORMALIZED by Normalize Findings Review Actions (Spec F, 2026-06-02) Task
 * Group 2.
 *
 * <p>Scope per Spec F acceptance criteria:</p>
 *
 * <ul>
 *   <li>Happy path: mixed-from-disposition update produces correct
 *       {@code updatedCount}, {@code skippedCount}, and
 *       {@code deltaByFromStatus} accumulator (keyed by the new vocabulary).</li>
 *   <li>Any-&gt;any: a move the OLD transition graph would have blocked
 *       (e.g. {@code approved -> deferred}) now SUCCEEDS, and
 *       {@code skipped_by_reason.transition_not_allowed == 0}.</li>
 *   <li>Already-in-target rows (same {@code review_status}) are counted in
 *       {@code skippedByReason.alreadyInTarget}.</li>
 *   <li>{@code delta_by_from_status} is keyed by the new vocabulary
 *       ({@code pending_review}, {@code approved}, {@code rejected},
 *       {@code deferred}).</li>
 *   <li>Cross-run id injection returns 404.</li>
 *   <li>Mutually-exclusive inputs ({@code ids} AND {@code filter})
 *       returns 400.</li>
 *   <li>Invalid disposition (e.g. {@code pending_review} or unknown) returns
 *       400.</li>
 *   <li>{@code reviewerNotes} non-empty trimmed value overwrites;
 *       omitted/null preserves existing notes.</li>
 *   <li>{@code previous_review_status} is stamped on every transitioned row.</li>
 * </ul>
 *
 * <p>Standalone Mockito setup mirrors
 * {@code DiscoveryFindingOriginAndLinkTargetTest} -- no full Spring context
 * (the AMS test suite has unrelated pre-existing failures documented in
 * MEMORY.md).</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DiscoveryFindingBulkReviewTest {

    @Mock private DiscoveryFindingRepository findingRepository;
    @Mock private DiscoveryFindingLinkRepository linkRepository;
    @Mock private DiscoveryRunArchitectureGuard runGuard;
    @Mock private DiscoveryCandidateRepository candidateRepository;
    @Mock private DiscoveryDecisionTaskRepository decisionTaskRepository;
    @Mock private DiscoveryEvidenceRepository evidenceRepository;
    @Mock private DiscoveryRelationshipRepository relationshipRepository;
    @Mock private DiscoveryClusterRepository clusterRepository;

    private DiscoveryFindingService service;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID FOREIGN_RUN_ID = UUID.fromString("99999999-9999-9999-9999-999999999999");

    @BeforeEach
    void setUp() {
        service = new DiscoveryFindingService(
            findingRepository, linkRepository, runGuard,
            candidateRepository, decisionTaskRepository, evidenceRepository,
            relationshipRepository, clusterRepository);
        doNothing().when(runGuard).verify(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
    }

    private DiscoveryFindingEntity finding(UUID id, String reviewStatus, UUID runId) {
        return DiscoveryFindingEntity.builder()
            .id(id)
            .runId(runId)
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .findingType("low_confidence_candidate")
            .category("ambiguity")
            .severity("medium")
            .reviewStatus(reviewStatus)
            .title("t")
            .build();
    }

    private DiscoveryFindingEntity finding(UUID id, String reviewStatus) {
        return finding(id, reviewStatus, RUN_ID);
    }

    @Test
    @DisplayName("Happy path: mixed from-disposition request returns correct updated_count, skipped_count, and delta_by_from_status")
    void happyPathMixedFromStatusReturnsCorrectDelta() {
        // 2 deferred + 2 pending_review + 1 rejected -> all bulk-set to 'approved'.
        // Transitions are unrestricted (any->any), so all 5 transition; delta
        // map should be {deferred:2, pending_review:2, rejected:1}.
        DiscoveryFindingEntity df1 = finding(UUID.randomUUID(), "deferred");
        DiscoveryFindingEntity df2 = finding(UUID.randomUUID(), "deferred");
        DiscoveryFindingEntity pr1 = finding(UUID.randomUUID(), "pending_review");
        DiscoveryFindingEntity pr2 = finding(UUID.randomUUID(), "pending_review");
        DiscoveryFindingEntity rj1 = finding(UUID.randomUUID(), "rejected");
        List<DiscoveryFindingEntity> all = List.of(df1, df2, pr1, pr2, rj1);
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(all);
        when(findingRepository.saveAll(anyList()))
            .thenAnswer(inv -> inv.getArgument(0));

        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(
                null, null, "approved", null);

        BulkReviewDiscoveryFindingsResponse resp =
            service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        assertThat(resp.updatedCount()).isEqualTo(5);
        assertThat(resp.skippedCount()).isZero();
        assertThat(resp.skippedByReason().alreadyInTarget()).isZero();
        assertThat(resp.skippedByReason().transitionNotAllowed()).isZero();
        assertThat(resp.deltaByFromStatus())
            .containsEntry("deferred", 2)
            .containsEntry("pending_review", 2)
            .containsEntry("rejected", 1);
        // CRITICAL Q12: single saveAll + flush at the end (not per-row
        // saveAndFlush).
        ArgumentCaptor<List<DiscoveryFindingEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(findingRepository, times(1)).saveAll(captor.capture());
        verify(findingRepository, times(1)).flush();
        assertThat(captor.getValue()).hasSize(5);
        // Verify entities are mutated in-place to the requested disposition and
        // each captured its prior value into previous_review_status.
        assertThat(captor.getValue())
            .allSatisfy(e -> assertThat(e.getReviewStatus()).isEqualTo("approved"));
        assertThat(df1.getPreviousReviewStatus()).isEqualTo("deferred");
        assertThat(pr1.getPreviousReviewStatus()).isEqualTo("pending_review");
        assertThat(rj1.getPreviousReviewStatus()).isEqualTo("rejected");
    }

    @Test
    @DisplayName("Any->any: a move the OLD transition graph would have blocked (approved -> deferred) now succeeds with transition_not_allowed == 0")
    void anyToAnyMovePreviouslyBlockedNowSucceeds() {
        // Under the old graph, an approved/resolved finding could only re-open
        // to needs_review; approved -> deferred was forbidden. Spec F removes
        // the transition graph, so this must SUCCEED for every row.
        DiscoveryFindingEntity ap1 = finding(UUID.randomUUID(), "approved");
        DiscoveryFindingEntity ap2 = finding(UUID.randomUUID(), "approved");
        DiscoveryFindingEntity rj1 = finding(UUID.randomUUID(), "rejected");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(ap1, ap2, rj1));
        when(findingRepository.saveAll(anyList()))
            .thenAnswer(inv -> inv.getArgument(0));

        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(
                null, null, "deferred", null);

        BulkReviewDiscoveryFindingsResponse resp =
            service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        assertThat(resp.updatedCount()).isEqualTo(3);
        assertThat(resp.skippedCount()).isZero();
        assertThat(resp.skippedByReason().alreadyInTarget()).isZero();
        assertThat(resp.skippedByReason().transitionNotAllowed())
            .as("Spec F: transition_not_allowed is always 0 (unrestricted transitions)")
            .isZero();
        assertThat(resp.deltaByFromStatus())
            .containsEntry("approved", 2)
            .containsEntry("rejected", 1);
        assertThat(ap1.getReviewStatus()).isEqualTo("deferred");
        assertThat(ap1.getPreviousReviewStatus()).isEqualTo("approved");
        assertThat(rj1.getReviewStatus()).isEqualTo("deferred");
        assertThat(rj1.getPreviousReviewStatus()).isEqualTo("rejected");
    }

    @Test
    @DisplayName("Already-in-target rows (same review_status) are counted in skipped_by_reason.already_in_target and NOT saved")
    void alreadyInTargetRowsSkipped() {
        // 2 already approved + 1 deferred -> bulk-set to approved.
        // The 2 approved rows are no-ops; only the 1 deferred row updates.
        DiscoveryFindingEntity ap1 = finding(UUID.randomUUID(), "approved");
        DiscoveryFindingEntity ap2 = finding(UUID.randomUUID(), "approved");
        DiscoveryFindingEntity df1 = finding(UUID.randomUUID(), "deferred");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(ap1, ap2, df1));
        when(findingRepository.saveAll(anyList()))
            .thenAnswer(inv -> inv.getArgument(0));

        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(
                null, null, "approved", null);

        BulkReviewDiscoveryFindingsResponse resp =
            service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        assertThat(resp.updatedCount()).isEqualTo(1);
        assertThat(resp.skippedCount()).isEqualTo(2);
        assertThat(resp.skippedByReason().alreadyInTarget()).isEqualTo(2);
        assertThat(resp.skippedByReason().transitionNotAllowed()).isZero();
        assertThat(resp.deltaByFromStatus()).containsExactlyEntriesOf(
            java.util.Map.of("deferred", 1));

        ArgumentCaptor<List<DiscoveryFindingEntity>> captor =
            ArgumentCaptor.forClass(List.class);
        verify(findingRepository, times(1)).saveAll(captor.capture());
        // Only the deferred row is in the save batch.
        assertThat(captor.getValue()).hasSize(1);
        assertThat(captor.getValue().get(0).getId()).isEqualTo(df1.getId());
    }

    @Test
    @DisplayName("Cross-run id injection returns 404 (ResourceNotFoundException) when any id is foreign to the scope")
    void crossRunIdInjectionReturns404() {
        UUID inScopeId = UUID.randomUUID();
        UUID foreignId = UUID.randomUUID();
        DiscoveryFindingEntity inScope = finding(inScopeId, "deferred");
        // Foreign row has a different runId.
        DiscoveryFindingEntity foreign = finding(foreignId, "deferred", FOREIGN_RUN_ID);
        when(findingRepository.findAllById(List.of(inScopeId, foreignId)))
            .thenReturn(List.of(inScope, foreign));

        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(
                List.of(inScopeId, foreignId), null, "approved", null);

        assertThatThrownBy(() ->
                service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found in the requested scope");
        // No save attempted -- foreign id rejected before any mutation.
        verify(findingRepository, never()).saveAll(anyList());
        verify(findingRepository, never()).flush();
    }

    @Test
    @DisplayName("Both ids AND filter supplied returns 400 mutually_exclusive_inputs")
    void mutuallyExclusiveInputsReturns400() {
        BulkReviewDiscoveryFindingsRequest.Filter filter =
            new BulkReviewDiscoveryFindingsRequest.Filter(
                null, null, "high", null, null, null, null, null, null);
        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(
                List.of(UUID.randomUUID()), filter, "approved", null);

        assertThatThrownBy(() ->
                service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("mutually_exclusive_inputs");
        verify(findingRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("Invalid disposition (review_status='pending_review' or unknown) returns 400 before any DB read")
    void invalidStatusReturns400() {
        // 'pending_review' is rejected because a reviewer action always lands
        // on one of the three dispositions -- the bulk endpoint refuses it
        // up-front.
        BulkReviewDiscoveryFindingsRequest reqPending =
            new BulkReviewDiscoveryFindingsRequest(null, null, "pending_review", null);
        assertThatThrownBy(() ->
                service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqPending))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not a valid reviewer status");

        // Completely unknown disposition also rejected.
        BulkReviewDiscoveryFindingsRequest reqBogus =
            new BulkReviewDiscoveryFindingsRequest(null, null, "bogus", null);
        assertThatThrownBy(() ->
                service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqBogus))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not a valid reviewer status");

        verify(findingRepository, never()).findByRunIdAndProjectIdAndArchitectureId(
            any(), any(), any());
        verify(findingRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("reviewer_notes semantics (Q5): non-empty trimmed value overwrites; omitted/null preserves existing notes")
    void reviewerNotesOverwriteOrPreserve() {
        // Case A: reviewer_notes supplied as non-empty trimmed string ->
        // overwrites existing notes on each UPDATED row (NOT on skipped
        // rows).
        DiscoveryFindingEntity withOldNotes = finding(UUID.randomUUID(), "deferred");
        withOldNotes.setReviewerNotes("old note A");
        DiscoveryFindingEntity skipped = finding(UUID.randomUUID(), "approved");
        skipped.setReviewerNotes("old note B (skipped)");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(new ArrayList<>(List.of(withOldNotes, skipped)));
        when(findingRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewDiscoveryFindingsRequest reqWithNotes =
            new BulkReviewDiscoveryFindingsRequest(
                null, null, "approved", "  reviewed in bulk  ");

        service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqWithNotes);
        assertThat(withOldNotes.getReviewerNotes())
            .as("non-empty trimmed reviewer_notes overwrites existing on UPDATED rows")
            .isEqualTo("reviewed in bulk");
        assertThat(skipped.getReviewerNotes())
            .as("skipped rows are not touched")
            .isEqualTo("old note B (skipped)");

        // Case B: reviewer_notes omitted (null) -> existing notes preserved.
        DiscoveryFindingEntity preserveMe = finding(UUID.randomUUID(), "deferred");
        preserveMe.setReviewerNotes("pre-existing note");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(new ArrayList<>(List.of(preserveMe)));

        BulkReviewDiscoveryFindingsRequest reqNoNotes =
            new BulkReviewDiscoveryFindingsRequest(null, null, "approved", null);
        service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqNoNotes);
        assertThat(preserveMe.getReviewerNotes())
            .as("omitted reviewer_notes preserves existing")
            .isEqualTo("pre-existing note");

        // Case C: blank-after-trim reviewer_notes also preserves
        // (treats whitespace-only as "field omitted").
        DiscoveryFindingEntity alsoPreserve = finding(UUID.randomUUID(), "deferred");
        alsoPreserve.setReviewerNotes("pre-existing");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(new ArrayList<>(List.of(alsoPreserve)));

        BulkReviewDiscoveryFindingsRequest reqBlankNotes =
            new BulkReviewDiscoveryFindingsRequest(null, null, "approved", "   ");
        service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqBlankNotes);
        assertThat(alsoPreserve.getReviewerNotes())
            .as("whitespace-only reviewer_notes preserves existing")
            .isEqualTo("pre-existing");
    }

    @Test
    @DisplayName("delta_by_from_status keys use the new vocabulary (pending_review, approved, rejected, deferred)")
    void deltaKeysUseNewVocabulary() {
        // 1 each of pending_review + approved + rejected + deferred ->
        // bulk-set to approved. The already-approved row is a no-op; the
        // other three transition.
        DiscoveryFindingEntity pr = finding(UUID.randomUUID(), "pending_review");
        DiscoveryFindingEntity ap = finding(UUID.randomUUID(), "approved");
        DiscoveryFindingEntity rj = finding(UUID.randomUUID(), "rejected");
        DiscoveryFindingEntity df = finding(UUID.randomUUID(), "deferred");
        when(findingRepository.findByRunIdAndProjectIdAndArchitectureId(
                RUN_ID, PROJECT_ID, ARCHITECTURE_ID))
            .thenReturn(List.of(pr, ap, rj, df));
        when(findingRepository.saveAll(anyList()))
            .thenAnswer(inv -> inv.getArgument(0));

        BulkReviewDiscoveryFindingsRequest req =
            new BulkReviewDiscoveryFindingsRequest(null, null, "approved", null);

        BulkReviewDiscoveryFindingsResponse resp =
            service.bulkReview(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        assertThat(resp.updatedCount()).isEqualTo(3);
        assertThat(resp.skippedCount()).isEqualTo(1);
        assertThat(resp.skippedByReason().alreadyInTarget()).isEqualTo(1);
        assertThat(resp.skippedByReason().transitionNotAllowed()).isZero();
        assertThat(resp.deltaByFromStatus())
            .containsEntry("pending_review", 1)
            .containsEntry("rejected", 1)
            .containsEntry("deferred", 1)
            .doesNotContainKey("approved");
    }
}
