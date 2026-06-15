package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeRequest;
import com.example.architecturemodel.model.dto.discovery.BulkReviewCascadeResponse;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.service.DiscoveryRunArchitectureGuard;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-layer tests for {@link DiscoveryCascadeReviewService#bulkReviewCascade}
 * -- the ATOMIC cascade-aware bulk review spanning candidates AND findings in
 * one transaction (Spec 2, Cascade-aware Bulk Review + Reject Suppression,
 * 2026-06-02, Task Group 1).
 *
 * <p>Standalone Mockito setup mirrors {@code DiscoveryFindingBulkReviewTest}:
 * no full Spring context (the AMS suite has unrelated pre-existing failures
 * documented in MEMORY.md). Atomicity is unit-tested at the service-boundary
 * level: the oracle-critical rollback test asserts that when ANY id is
 * out-of-scope, NEITHER repository's {@code saveAll}/{@code flush} is ever
 * invoked -- so the {@code @Transactional} boundary has nothing committed to
 * roll back from and no row is mutated. (The full DB-level rollback is also
 * covered by the single transaction; here we prove the pre-mutation scope
 * guard fires before any write.)</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CascadeBulkReviewTest {

    @Mock private DiscoveryCandidateRepository candidateRepository;
    @Mock private DiscoveryFindingRepository findingRepository;
    @Mock private DiscoveryRunArchitectureGuard runGuard;

    private DiscoveryCascadeReviewService service;

    private static final UUID PROJECT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID ARCHITECTURE_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID RUN_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SIBLING_RUN_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID FOREIGN_RUN_ID = UUID.fromString("99999999-9999-9999-9999-999999999999");
    private static final UUID FOREIGN_ARCHITECTURE_ID = UUID.fromString("88888888-8888-8888-8888-888888888888");

    @BeforeEach
    void setUp() {
        service = new DiscoveryCascadeReviewService(
            candidateRepository, findingRepository, runGuard);
        doNothing().when(runGuard).verify(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
    }

    private DiscoveryCandidateEntity candidate(UUID id, String reviewStatus, String status, UUID runId) {
        return DiscoveryCandidateEntity.builder()
            .id(id)
            .runId(runId)
            .candidateType("service")
            .name("cand-" + id)
            .confidence(0.9)
            .status(status)
            .reviewStatus(reviewStatus)
            .build();
    }

    private DiscoveryCandidateEntity candidate(UUID id, String reviewStatus) {
        return candidate(id, reviewStatus, "proposed", RUN_ID);
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
    @DisplayName("Happy path: curated candidates + linked findings all transition in one tx; per-kind updated_count + delta_by_from_status exact")
    void happyPathCascadeTransitionsBothKinds() {
        // 2 candidates (pending_review, deferred) + 2 findings (pending_review,
        // rejected) -> all bulk-set to 'rejected'. The already-rejected finding
        // is a no-op; everything else transitions.
        UUID c1 = UUID.randomUUID();
        UUID c2 = UUID.randomUUID();
        DiscoveryCandidateEntity cand1 = candidate(c1, "pending_review");
        DiscoveryCandidateEntity cand2 = candidate(c2, "deferred");
        when(candidateRepository.findAllById(List.of(c1, c2)))
            .thenReturn(List.of(cand1, cand2));
        when(candidateRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        UUID f1 = UUID.randomUUID();
        UUID f2 = UUID.randomUUID();
        DiscoveryFindingEntity find1 = finding(f1, "pending_review");
        DiscoveryFindingEntity find2 = finding(f2, "rejected"); // already in target
        when(findingRepository.findAllById(List.of(f1, f2)))
            .thenReturn(List.of(find1, find2));
        when(findingRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(c1, c2), List.of(f1, f2), "rejected", null);

        BulkReviewCascadeResponse resp =
            service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        // Candidate block: both transitioned.
        assertThat(resp.candidates().updatedCount()).isEqualTo(2);
        assertThat(resp.candidates().skippedCount()).isZero();
        assertThat(resp.candidates().deltaByFromStatus())
            .containsEntry("pending_review", 1)
            .containsEntry("deferred", 1);
        assertThat(cand1.getReviewStatus()).isEqualTo("rejected");
        assertThat(cand1.getPreviousReviewStatus()).isEqualTo("pending_review");
        assertThat(cand2.getReviewStatus()).isEqualTo("rejected");
        assertThat(cand2.getReviewedAt()).isNotNull();

        // Finding block: 1 transitioned, 1 already-in-target.
        assertThat(resp.findings().updatedCount()).isEqualTo(1);
        assertThat(resp.findings().skippedCount()).isEqualTo(1);
        assertThat(resp.findings().skippedByReason().alreadyInTarget()).isEqualTo(1);
        assertThat(resp.findings().skippedByReason().transitionNotAllowed()).isZero();
        assertThat(resp.findings().deltaByFromStatus())
            .containsEntry("pending_review", 1)
            .doesNotContainKey("rejected");
        assertThat(find1.getReviewStatus()).isEqualTo("rejected");
        assertThat(find1.getPreviousReviewStatus()).isEqualTo("pending_review");

        // One saveAll + one flush per repository (NOT per-row).
        verify(candidateRepository, times(1)).saveAll(anyList());
        verify(candidateRepository, times(1)).flush();
        verify(findingRepository, times(1)).saveAll(anyList());
        verify(findingRepository, times(1)).flush();
    }

    @Test
    @DisplayName("Atomic rollback (oracle-critical): an out-of-scope finding id aborts the WHOLE batch -- NO candidate AND NO finding is saved")
    void atomicRollbackOnPartialFailureMutatesNothing() {
        // Candidates are all in-scope and WOULD transition, but one finding id
        // is foreign (different ARCHITECTURE). The scope guard must reject the
        // batch before ANY save on EITHER repository -- proving atomicity: the
        // user's curated set is applied all-or-nothing.
        UUID c1 = UUID.randomUUID();
        DiscoveryCandidateEntity cand1 = candidate(c1, "pending_review");
        when(candidateRepository.findAllById(List.of(c1)))
            .thenReturn(List.of(cand1));

        UUID inScopeFinding = UUID.randomUUID();
        UUID foreignFinding = UUID.randomUUID();
        DiscoveryFindingEntity inScope = finding(inScopeFinding, "pending_review");
        // Foreign at the ARCHITECTURE level: same project + run, different
        // architecture -> out of scope under architecture-scoping.
        DiscoveryFindingEntity foreign = DiscoveryFindingEntity.builder()
            .id(foreignFinding)
            .runId(RUN_ID)
            .projectId(PROJECT_ID)
            .architectureId(FOREIGN_ARCHITECTURE_ID)
            .findingType("low_confidence_candidate")
            .category("ambiguity")
            .severity("medium")
            .reviewStatus("pending_review")
            .title("t")
            .build();
        when(findingRepository.findAllById(List.of(inScopeFinding, foreignFinding)))
            .thenReturn(List.of(inScope, foreign));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(c1), List.of(inScopeFinding, foreignFinding), "rejected", null);

        assertThatThrownBy(() ->
                service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found in the requested scope");

        // NOTHING saved or flushed on either repository -- the batch is atomic.
        verify(candidateRepository, never()).saveAll(anyList());
        verify(candidateRepository, never()).flush();
        verify(findingRepository, never()).saveAll(anyList());
        verify(findingRepository, never()).flush();
        // And the in-scope candidate entity was never mutated in-place either.
        assertThat(cand1.getReviewStatus()).isEqualTo("pending_review");
        assertThat(cand1.getPreviousReviewStatus()).isNull();
    }

    @Test
    @DisplayName("Atomic rollback: a non-existent candidate id (does not load) aborts the batch -- nothing mutates")
    void atomicRollbackOnMissingCandidateId() {
        UUID present = UUID.randomUUID();
        UUID missing = UUID.randomUUID();
        // Only one of the two requested candidate ids loads.
        when(candidateRepository.findAllById(List.of(present, missing)))
            .thenReturn(List.of(candidate(present, "pending_review")));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(present, missing), List.of(), "approved", null);

        assertThatThrownBy(() ->
                service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found in scope");

        verify(candidateRepository, never()).saveAll(anyList());
        verify(findingRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("committed gating: a committed candidate in the set is SKIPPED (counted in transition_not_allowed), not failed; the rest still apply")
    void committedCandidateSkippedNotFailed() {
        UUID committedId = UUID.randomUUID();
        UUID proposedId = UUID.randomUUID();
        // committed candidate already saved to the model: review_status may be
        // 'committed' or 'approved' but status == 'committed' is the gate.
        DiscoveryCandidateEntity committed =
            candidate(committedId, "committed", "committed", RUN_ID);
        DiscoveryCandidateEntity proposed =
            candidate(proposedId, "approved", "proposed", RUN_ID);
        when(candidateRepository.findAllById(List.of(committedId, proposedId)))
            .thenReturn(List.of(committed, proposed));
        when(candidateRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(committedId, proposedId), List.of(), "rejected", null);

        BulkReviewCascadeResponse resp =
            service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        // The proposed candidate transitions; the committed one is skipped.
        assertThat(resp.candidates().updatedCount()).isEqualTo(1);
        assertThat(resp.candidates().skippedCount()).isEqualTo(1);
        assertThat(resp.candidates().skippedByReason().transitionNotAllowed())
            .as("committed candidate counted as a skip, not a failure")
            .isEqualTo(1);
        assertThat(resp.candidates().skippedByReason().alreadyInTarget()).isZero();
        // committed row untouched; proposed row transitioned.
        assertThat(committed.getReviewStatus()).isEqualTo("committed");
        assertThat(committed.getPreviousReviewStatus()).isNull();
        assertThat(proposed.getReviewStatus()).isEqualTo("rejected");
        assertThat(proposed.getPreviousReviewStatus()).isEqualTo("approved");
    }

    @Test
    @DisplayName("Audit + any->any: previous_review_status + reviewed_at set on every updated candidate AND finding; same-disposition rows counted alreadyInTarget")
    void auditAndAnyToAnyTransitions() {
        // any->any moves the OLD finding transition graph would have blocked:
        // approved -> deferred, rejected -> deferred (both must succeed).
        UUID c1 = UUID.randomUUID(); // approved -> deferred
        UUID c2 = UUID.randomUUID(); // deferred -> deferred (already-in-target)
        DiscoveryCandidateEntity cand1 = candidate(c1, "approved");
        DiscoveryCandidateEntity cand2 = candidate(c2, "deferred");
        when(candidateRepository.findAllById(List.of(c1, c2)))
            .thenReturn(List.of(cand1, cand2));
        when(candidateRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        UUID f1 = UUID.randomUUID(); // rejected -> deferred
        DiscoveryFindingEntity find1 = finding(f1, "rejected");
        when(findingRepository.findAllById(List.of(f1)))
            .thenReturn(List.of(find1));
        when(findingRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(c1, c2), List.of(f1), "deferred", null);

        BulkReviewCascadeResponse resp =
            service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        // Candidate: approved->deferred succeeds (any->any); deferred is no-op.
        assertThat(resp.candidates().updatedCount()).isEqualTo(1);
        assertThat(resp.candidates().skippedByReason().alreadyInTarget()).isEqualTo(1);
        assertThat(cand1.getReviewStatus()).isEqualTo("deferred");
        assertThat(cand1.getPreviousReviewStatus()).isEqualTo("approved");
        assertThat(cand1.getReviewedAt()).isNotNull();

        // Finding: rejected->deferred succeeds (any->any), audit stamped.
        assertThat(resp.findings().updatedCount()).isEqualTo(1);
        assertThat(resp.findings().skippedByReason().transitionNotAllowed()).isZero();
        assertThat(find1.getReviewStatus()).isEqualTo("deferred");
        assertThat(find1.getPreviousReviewStatus()).isEqualTo("rejected");
        assertThat(find1.getReviewedAt()).isNotNull();
    }

    @Test
    @DisplayName("Invalid disposition (review_status='pending_review' or unknown) returns 400 before any DB read")
    void invalidDispositionReturns400() {
        BulkReviewCascadeRequest reqPending = new BulkReviewCascadeRequest(
            List.of(UUID.randomUUID()), List.of(), "pending_review", null);
        assertThatThrownBy(() ->
                service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqPending))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not a valid reviewer status");

        BulkReviewCascadeRequest reqBogus = new BulkReviewCascadeRequest(
            List.of(), List.of(UUID.randomUUID()), "bogus", null);
        assertThatThrownBy(() ->
                service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, reqBogus))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("not a valid reviewer status");

        verify(candidateRepository, never()).findAllById(anyList());
        verify(findingRepository, never()).findAllById(anyList());
        verify(candidateRepository, never()).saveAll(anyList());
        verify(findingRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("reviewer_notes written to updated findings + reviewedBy stamped on updated candidates when supplied non-blank")
    void reviewerNotesAppliedToUpdatedRows() {
        UUID c1 = UUID.randomUUID();
        DiscoveryCandidateEntity cand1 = candidate(c1, "pending_review");
        when(candidateRepository.findAllById(List.of(c1)))
            .thenReturn(List.of(cand1));
        when(candidateRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        UUID f1 = UUID.randomUUID();
        DiscoveryFindingEntity find1 = finding(f1, "pending_review");
        find1.setReviewerNotes("old note");
        when(findingRepository.findAllById(List.of(f1)))
            .thenReturn(List.of(find1));
        when(findingRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(c1), List.of(f1), "rejected", "  rejected in bulk cascade  ");

        service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        // Finding notes overwritten with the trimmed value.
        assertThat(find1.getReviewerNotes()).isEqualTo("rejected in bulk cascade");
        // Candidate review actor recorded.
        assertThat(cand1.getReviewedBy()).isEqualTo("bulk-cascade");
    }

    @Test
    @DisplayName("Cross-run cascade (the 404 fix): a candidate owned by a SIBLING run in the SAME architecture is in-scope and transitions -- no 404")
    void siblingRunCandidateInSameArchitectureIsInScope() {
        // The Review Room unions a code scan + a database scan; an Approve
        // cascade legitimately pulls in a candidate owned by the OTHER run.
        // Pre-fix this 404'd ("not found in the requested scope") because the
        // apply was pinned to a single run; now the run guard accepts it since
        // the sibling run is bound to the SAME (project, architecture).
        doNothing().when(runGuard).verify(eq(SIBLING_RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));

        UUID pathRunCand = UUID.randomUUID();
        UUID siblingRunCand = UUID.randomUUID();
        DiscoveryCandidateEntity onPathRun =
            candidate(pathRunCand, "pending_review", "proposed", RUN_ID);
        DiscoveryCandidateEntity onSiblingRun =
            candidate(siblingRunCand, "pending_review", "proposed", SIBLING_RUN_ID);
        when(candidateRepository.findAllById(List.of(pathRunCand, siblingRunCand)))
            .thenReturn(List.of(onPathRun, onSiblingRun));
        when(candidateRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(pathRunCand, siblingRunCand), List.of(), "approved", null);

        BulkReviewCascadeResponse resp =
            service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        // BOTH transition -- the sibling-run candidate is no longer rejected.
        assertThat(resp.candidates().updatedCount()).isEqualTo(2);
        assertThat(onPathRun.getReviewStatus()).isEqualTo("approved");
        assertThat(onSiblingRun.getReviewStatus()).isEqualTo("approved");
        verify(candidateRepository, times(1)).saveAll(anyList());
        verify(candidateRepository, times(1)).flush();
    }

    @Test
    @DisplayName("Cross-run cascade: a finding owned by a SIBLING run in the SAME architecture is in-scope and transitions")
    void siblingRunFindingInSameArchitectureIsInScope() {
        UUID f1 = UUID.randomUUID();
        DiscoveryFindingEntity siblingRunFinding = finding(f1, "pending_review", SIBLING_RUN_ID);
        when(findingRepository.findAllById(List.of(f1)))
            .thenReturn(List.of(siblingRunFinding));
        when(findingRepository.saveAll(anyList())).thenAnswer(inv -> inv.getArgument(0));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(), List.of(f1), "rejected", null);

        BulkReviewCascadeResponse resp =
            service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req);

        assertThat(resp.findings().updatedCount()).isEqualTo(1);
        assertThat(siblingRunFinding.getReviewStatus()).isEqualTo("rejected");
    }

    @Test
    @DisplayName("Scope still enforced: a candidate whose run is in ANOTHER architecture is rejected -- batch rolls back, nothing saved")
    void foreignArchitectureCandidateRejected() {
        // Architecture-scoping widened run -> architecture, but a candidate whose
        // parent run is bound to a DIFFERENT architecture must still 404
        // (cross-tenant safety). The run guard throws NoSuchElementException for
        // that run; the service remaps it to the candidate scope 404.
        doThrow(new NoSuchElementException("run not bound to architecture"))
            .when(runGuard).verify(eq(FOREIGN_RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));

        UUID inArch = UUID.randomUUID();
        UUID foreignArch = UUID.randomUUID();
        DiscoveryCandidateEntity ok =
            candidate(inArch, "pending_review", "proposed", RUN_ID);
        DiscoveryCandidateEntity foreign =
            candidate(foreignArch, "pending_review", "proposed", FOREIGN_RUN_ID);
        when(candidateRepository.findAllById(List.of(inArch, foreignArch)))
            .thenReturn(List.of(ok, foreign));

        BulkReviewCascadeRequest req = new BulkReviewCascadeRequest(
            List.of(inArch, foreignArch), List.of(), "approved", null);

        assertThatThrownBy(() ->
                service.bulkReviewCascade(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, req))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("not found in the requested scope");

        // Atomic: nothing saved, and the in-architecture candidate is untouched.
        verify(candidateRepository, never()).saveAll(anyList());
        verify(candidateRepository, never()).flush();
        assertThat(ok.getReviewStatus()).isEqualTo("pending_review");
    }
}
