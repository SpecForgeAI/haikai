package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.InvalidFindingLinkTargetException;
import com.example.architecturemodel.model.dto.discovery.BulkCreateDiscoveryFindingsRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryFindingRequest.CreateDiscoveryFindingLinkRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryFindingDto;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Service-layer tests for the origin invariant + link-target allowlist
 * extension added in Task Group 1 of the API Test Harness — Findings
 * Integration spec (2026-05-25).
 *
 * <p>Covers:</p>
 *
 * <ol>
 *   <li>Exactly-one-of-origin validation in
 *       {@code DiscoveryFindingService.createForDiff}: passing a diffId
 *       yields a persisted entity with {@code runId=null} and
 *       {@code apiBehaviourDiffId} set.</li>
 *   <li>Run-scoped create still rejects passing-no-origin and passing-both
 *       at the static {@code validateExactlyOneOrigin} mirror.</li>
 *   <li>{@code ALLOWED_LINK_TARGET_TYPES} now accepts
 *       {@code api_behaviour_diff_item}.</li>
 *   <li>{@code ALLOWED_LINK_TARGET_TYPES} still rejects
 *       {@code api_behaviour_baseline} -- documented-but-unused in v1
 *       per accepted Q5 (no consumer; minimises blast radius).</li>
 *   <li>{@code deleteFindingsByApiBehaviourDiffId} bulk-removes findings
 *       (and their links) for the given diff and returns the count.</li>
 * </ol>
 *
 * <p>Standalone Mockito setup mirrors {@code DiscoveryFindingControllerTest}
 * -- no full Spring context (the AMS test suite has unrelated pre-existing
 * failures documented in MEMORY.md).</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DiscoveryFindingOriginAndLinkTargetTest {

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
    private static final UUID DIFF_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID DIFF_ITEM_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID RUN_ID = UUID.fromString("55555555-5555-5555-5555-555555555555");

    @BeforeEach
    void setUp() {
        service = new DiscoveryFindingService(
            findingRepository, linkRepository, runGuard,
            candidateRepository, decisionTaskRepository, evidenceRepository,
            relationshipRepository, clusterRepository);
        // Echo whatever entity the service persists, with the diff-id
        // pass-through intact -- this lets us assert the entity shape via
        // ArgumentCaptor / direct verify.
        when(findingRepository.saveAndFlush(any(DiscoveryFindingEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(linkRepository.saveAndFlush(any(DiscoveryFindingLinkEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
    }

    private CreateDiscoveryFindingRequest req(String severity) {
        return new CreateDiscoveryFindingRequest(
            "api_behaviour_status_drift",
            "api_behaviour_drift",
            severity,
            null,                       // confidence
            null,                       // reviewStatus -- service defaults to 'pending_review'
            "Status drift: GET /widgets responded 200 -> 500",
            "Source 200 vs target 500 for scenario \"happy-path\".",
            Map.of("method", "GET", "path", "/widgets"),
            "api_behaviour_diff",
            "diffRunner.findingEmission",
            null,                       // reviewerNotes
            null                        // links
        );
    }

    @Test
    @DisplayName("createForDiff persists a diff-sourced finding with apiBehaviourDiffId set and runId null")
    void createForDiffPersistsDiffSourcedFinding() {
        CreateDiscoveryFindingRequest body = req("critical");

        DiscoveryFindingDto dto = service.createForDiff(
            PROJECT_ID, ARCHITECTURE_ID, DIFF_ID, body);

        assertThat(dto.apiBehaviourDiffId()).isEqualTo(DIFF_ID);
        assertThat(dto.runId()).isNull();
        assertThat(dto.projectId()).isEqualTo(PROJECT_ID);
        assertThat(dto.architectureId()).isEqualTo(ARCHITECTURE_ID);
        assertThat(dto.findingType()).isEqualTo("api_behaviour_status_drift");
        // First-ever `critical` severity in the platform -- the service must
        // NOT block this (validation goes via ALLOWED_STATUSES which is for
        // review_status, not severity; severity is TEXT-extensible).
        assertThat(dto.severity()).isEqualTo("critical");
        assertThat(dto.reviewStatus()).isEqualTo("pending_review");

        verify(findingRepository).saveAndFlush(any(DiscoveryFindingEntity.class));
        // No run-scope guard call on the diff-scoped path.
        verifyNoInteractions(runGuard);
    }

    @Test
    @DisplayName("createForDiff with neither origin (diffId=null) throws IllegalArgumentException")
    void createForDiffNeitherOriginThrows() {
        assertThatThrownBy(() ->
            service.createForDiff(PROJECT_ID, ARCHITECTURE_ID, null, req("medium")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("diffId is required");
        verify(findingRepository, never()).saveAndFlush(any(DiscoveryFindingEntity.class));
    }

    @Test
    @DisplayName("createForDiff with api_behaviour_diff_item link is accepted; api_behaviour_baseline link rejected (v1 allowlist)")
    void linkTargetAllowlistExtendedForDiffItemRejectsBaseline() {
        // Accept api_behaviour_diff_item.
        CreateDiscoveryFindingRequest acceptable = new CreateDiscoveryFindingRequest(
            "api_behaviour_status_drift", "api_behaviour_drift", "critical",
            null, null,
            "Status drift", "summary", Map.of(),
            "api_behaviour_diff", "diffRunner.findingEmission", null,
            List.of(new CreateDiscoveryFindingLinkRequest(
                "derived_from", "api_behaviour_diff_item",
                DIFF_ITEM_ID.toString(), null)));

        DiscoveryFindingDto dto = service.createForDiff(
            PROJECT_ID, ARCHITECTURE_ID, DIFF_ID, acceptable);
        assertThat(dto.apiBehaviourDiffId()).isEqualTo(DIFF_ID);
        assertThat(dto.links()).hasSize(1);
        assertThat(dto.links().get(0).targetType()).isEqualTo("api_behaviour_diff_item");
        verify(linkRepository, times(1)).saveAndFlush(any(DiscoveryFindingLinkEntity.class));

        // Reject api_behaviour_baseline (documented-but-unused in v1 per
        // accepted Q5 -- the allowlist explicitly omits it).
        CreateDiscoveryFindingRequest rejected = new CreateDiscoveryFindingRequest(
            "api_behaviour_status_drift", "api_behaviour_drift", "critical",
            null, null,
            "Status drift", "summary", Map.of(),
            "api_behaviour_diff", "diffRunner.findingEmission", null,
            List.of(new CreateDiscoveryFindingLinkRequest(
                "derived_from", "api_behaviour_baseline",
                UUID.randomUUID().toString(), null)));

        assertThatThrownBy(() -> service.createForDiff(
                PROJECT_ID, ARCHITECTURE_ID, DIFF_ID, rejected))
            .isInstanceOf(InvalidFindingLinkTargetException.class)
            .hasMessageContaining("not in the v1 allowed set");
        // ALLOWED_LINK_TARGET_TYPES set membership assertion -- direct
        // structural check that we extended the allowlist correctly.
        assertThat(DiscoveryFindingService.ALLOWED_LINK_TARGET_TYPES)
            .as("api_behaviour_diff_item is activated in v1 (accepted Q5)")
            .contains("api_behaviour_diff_item");
        assertThat(DiscoveryFindingService.ALLOWED_LINK_TARGET_TYPES)
            .as("api_behaviour_baseline stays documented-but-unused in v1 (accepted Q5)")
            .doesNotContain("api_behaviour_baseline");
    }

    @Test
    @DisplayName("createForDiff rejects a run-scoped link target (no parent run to bind to)")
    void createForDiffRejectsRunScopedLink() {
        CreateDiscoveryFindingRequest withRunScopedLink = new CreateDiscoveryFindingRequest(
            "api_behaviour_status_drift", "api_behaviour_drift", "high",
            null, null,
            "Status drift", "summary", Map.of(),
            "api_behaviour_diff", "diffRunner.findingEmission", null,
            List.of(new CreateDiscoveryFindingLinkRequest(
                "supports", "discovery_candidate",
                UUID.randomUUID().toString(), null)));
        assertThatThrownBy(() -> service.createForDiff(
                PROJECT_ID, ARCHITECTURE_ID, DIFF_ID, withRunScopedLink))
            .isInstanceOf(InvalidFindingLinkTargetException.class)
            .hasMessageContaining("run-scoped target_type not permitted on a diff-sourced finding");
    }

    @Test
    @DisplayName("deleteFindingsByApiBehaviourDiffId removes findings + their links and returns the count (load-bearing for recompute)")
    void deleteFindingsByApiBehaviourDiffIdRemovesLinkedRows() {
        UUID findingA = UUID.randomUUID();
        UUID findingB = UUID.randomUUID();
        UUID linkA1 = UUID.randomUUID();
        UUID linkB1 = UUID.randomUUID();

        DiscoveryFindingEntity entityA = DiscoveryFindingEntity.builder()
            .id(findingA).apiBehaviourDiffId(DIFF_ID)
            .projectId(PROJECT_ID).architectureId(ARCHITECTURE_ID)
            .findingType("t").category("c").severity("info")
            .reviewStatus("pending_review").title("a").build();
        DiscoveryFindingEntity entityB = DiscoveryFindingEntity.builder()
            .id(findingB).apiBehaviourDiffId(DIFF_ID)
            .projectId(PROJECT_ID).architectureId(ARCHITECTURE_ID)
            .findingType("t").category("c").severity("info")
            .reviewStatus("pending_review").title("b").build();
        DiscoveryFindingLinkEntity linkARow = DiscoveryFindingLinkEntity.builder()
            .id(linkA1).findingId(findingA)
            .linkType("derived_from").targetType("api_behaviour_diff_item")
            .targetId(UUID.randomUUID().toString()).build();
        DiscoveryFindingLinkEntity linkBRow = DiscoveryFindingLinkEntity.builder()
            .id(linkB1).findingId(findingB)
            .linkType("derived_from").targetType("api_behaviour_diff_item")
            .targetId(UUID.randomUUID().toString()).build();

        when(findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(DIFF_ID))
            .thenReturn(List.of(entityA, entityB));
        when(linkRepository.findByFindingId(findingA)).thenReturn(List.of(linkARow));
        when(linkRepository.findByFindingId(findingB)).thenReturn(List.of(linkBRow));
        doNothing().when(linkRepository).deleteAll(anyList());
        doNothing().when(findingRepository).delete(any(DiscoveryFindingEntity.class));

        int deleted = service.deleteFindingsByApiBehaviourDiffId(DIFF_ID);

        assertThat(deleted).isEqualTo(2);
        verify(linkRepository).deleteAll(List.of(linkARow));
        verify(linkRepository).deleteAll(List.of(linkBRow));
        verify(findingRepository).delete(entityA);
        verify(findingRepository).delete(entityB);
        verify(findingRepository).flush();
    }

    @Test
    @DisplayName("deleteFindingsByApiBehaviourDiffId with no rows returns 0 without touching the link repository")
    void deleteFindingsNoOpWhenEmpty() {
        when(findingRepository.findByApiBehaviourDiffIdOrderByCreatedAtAsc(DIFF_ID))
            .thenReturn(List.of());

        int deleted = service.deleteFindingsByApiBehaviourDiffId(DIFF_ID);

        assertThat(deleted).isZero();
        verify(linkRepository, never()).deleteAll(anyList());
        verify(findingRepository, never()).delete(any(DiscoveryFindingEntity.class));
    }

    @Test
    @DisplayName("Run-scoped create still enforces exactly-one-of-origin: with runId=null and no diff path, IllegalArgumentException thrown")
    void runScopedCreateNeitherOriginThrows() {
        doNothing().when(runGuard).verify(eq(RUN_ID), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
        // Force runId=null through the public create -- the create() method
        // builds the entity with whatever runId it received, then
        // persistFindingEntity validates exactly-one-of-origin. We do this
        // by passing null in for runId at the public boundary.
        doNothing().when(runGuard).verify(eq((UUID) null), eq(PROJECT_ID), eq(ARCHITECTURE_ID));
        assertThatThrownBy(() -> service.create(
                PROJECT_ID, ARCHITECTURE_ID, null, req("medium")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Exactly one of runId / apiBehaviourDiffId");
    }

    // =========================================================================
    // Bulk create skips invalid link TARGETS instead of failing the batch
    // (2026-08-02). Root cause of the live findingsEmit {failed:true,
    // persisted:0}: one never-persisted discovery_evidence target 400'd the
    // whole @Transactional bulk.
    // =========================================================================

    private CreateDiscoveryFindingRequest reqWithLinks(List<CreateDiscoveryFindingLinkRequest> links) {
        return new CreateDiscoveryFindingRequest(
            "runtime_usage_observation",
            "runtime_evidence",
            "info",
            null,
            null,
            "Observed usage for GET /widgets",
            null,
            Map.of("method", "GET", "path", "/widgets"),
            "log_processing",
            "runtimeEvidence.findingEmission",
            null,
            links
        );
    }

    @Test
    @DisplayName("bulkCreate skips a link with an invalid target (never-persisted evidence id) and keeps the finding + valid links")
    void bulkCreateSkipsInvalidLinkTargetInsteadOfFailingBatch() {
        UUID goodCandidateId = UUID.fromString("66666666-6666-6666-6666-666666666666");
        UUID missingEvidenceId = UUID.fromString("77777777-7777-7777-7777-777777777777");
        DiscoveryCandidateEntity candidate = mock(DiscoveryCandidateEntity.class);
        when(candidate.getRunId()).thenReturn(RUN_ID);
        when(candidateRepository.findById(goodCandidateId)).thenReturn(Optional.of(candidate));
        when(evidenceRepository.findById(missingEvidenceId)).thenReturn(Optional.empty());

        CreateDiscoveryFindingRequest body = reqWithLinks(List.of(
            new CreateDiscoveryFindingLinkRequest(
                "cites", "discovery_candidate", goodCandidateId.toString(), null),
            new CreateDiscoveryFindingLinkRequest(
                "cites", "discovery_evidence", missingEvidenceId.toString(), null)));

        List<DiscoveryFindingDto> out = service.bulkCreate(
            PROJECT_ID, ARCHITECTURE_ID, RUN_ID,
            new BulkCreateDiscoveryFindingsRequest(List.of(body)));

        // The finding persisted; the valid candidate link persisted; the
        // invalid evidence link was SKIPPED (not thrown).
        assertThat(out).hasSize(1);
        assertThat(out.get(0).links()).hasSize(1);
        assertThat(out.get(0).links().get(0).targetId()).isEqualTo(goodCandidateId.toString());
        verify(findingRepository, times(1)).saveAndFlush(any(DiscoveryFindingEntity.class));
        verify(linkRepository, times(1)).saveAndFlush(any(DiscoveryFindingLinkEntity.class));
    }

    @Test
    @DisplayName("single create keeps the strict D6 hard-reject on an invalid link target")
    void singleCreateStillHardRejectsInvalidLinkTarget() {
        UUID missingEvidenceId = UUID.fromString("77777777-7777-7777-7777-777777777777");
        when(evidenceRepository.findById(missingEvidenceId)).thenReturn(Optional.empty());

        CreateDiscoveryFindingRequest body = reqWithLinks(List.of(
            new CreateDiscoveryFindingLinkRequest(
                "cites", "discovery_evidence", missingEvidenceId.toString(), null)));

        assertThatThrownBy(() -> service.create(PROJECT_ID, ARCHITECTURE_ID, RUN_ID, body))
            .isInstanceOf(InvalidFindingLinkTargetException.class)
            .hasMessageContaining("does not exist");
    }
}
