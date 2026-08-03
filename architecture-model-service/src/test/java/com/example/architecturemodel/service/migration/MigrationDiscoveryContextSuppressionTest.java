package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingLinkEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * ORACLE-CRITICAL suppression proof for
 * {@link MigrationDiscoveryContextService} (Spec 2, Cascade-aware Bulk Review +
 * Reject Suppression, 2026-06-02, Task Group 2).
 *
 * <p>Proves that a {@code rejected} finding / candidate is GENUINELY ABSENT
 * from BOTH the LLM payloads AND the summary counts of the book-of-work /
 * migration-delivery-plan context, while {@code deferred} stays VISIBLE, and
 * that the suppression is automatically reversible (reject -&gt; absent -&gt;
 * re-approve -&gt; present).</p>
 *
 * <p>The repository mocks here are stubbed with an {@code Answer} that
 * faithfully emulates the new {@code ...ReviewStatusNot} DB semantics (it
 * filters a MIXED fixture list -- including a rejected row, a deferred row, and
 * a pending row -- on {@code reviewStatus != excludedArg}). This proves BOTH
 * that the service now CALLS the excluding finder with {@code "rejected"} (if it
 * still called the unfiltered finder the stub would never fire and the
 * assertions would fail) AND that, under the real exclusion semantics, rejected
 * IR never reaches the payload or the counts. A {@code @DataJpaTest} would
 * additionally prove the derived query string itself; the finder name is a
 * Spring Data derived query so its correctness is structural.</p>
 *
 * <p>Standalone Mockito (no Spring context) mirrors
 * {@code MigrationDiscoveryContextServiceTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MigrationDiscoveryContextSuppressionTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();

    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;
    @Mock private DiscoveryRunRepository discoveryRunRepository;
    @Mock private DiscoveryFindingRepository discoveryFindingRepository;
    @Mock private DiscoveryFindingLinkRepository discoveryFindingLinkRepository;
    @Mock private DiscoveryCandidateRepository discoveryCandidateRepository;
    @Mock private DiscoveryEvidenceRepository discoveryEvidenceRepository;
    @Mock private DiscoveryDecisionTaskRepository discoveryDecisionTaskRepository;
    @Mock private ApiBehaviourBaselineRepository apiBehaviourBaselineRepository;
    @Mock private ArchitectureElementMappingRepository architectureElementMappingRepository;

    private MigrationDiscoveryContextService service;

    private UUID runId;

    @BeforeEach
    void setUp() {
        service = new MigrationDiscoveryContextService(
            projectRepository, architectureRepository, discoveryRunRepository,
            discoveryFindingRepository, discoveryFindingLinkRepository,
            discoveryCandidateRepository, discoveryEvidenceRepository,
            discoveryDecisionTaskRepository, apiBehaviourBaselineRepository,
            architectureElementMappingRepository,
            null, null, null, null, null, null, null, null, null, null, null,
            null, null, null /* DB-migration-pack repos (Spec 2026-07-02-a) */);

        runId = UUID.randomUUID();
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(architecture(CURRENT_ARCH_ID)));
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(List.of(buildRun(runId)));
        when(apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryEvidenceRepository.findByRunId(any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryDecisionTaskRepository.findByRunId(any()))
            .thenReturn(Collections.emptyList());
    }

    /**
     * Stub the finding finder so it faithfully emulates the new
     * {@code findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot}
     * derived-query semantics: return the supplied fixture filtered to rows
     * whose {@code reviewStatus} differs from the 4th (excluded) argument.
     */
    private void stubFindingFinder(List<DiscoveryFindingEntity> fullFixture) {
        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(
                eq(runId), eq(PROJECT_ID), eq(CURRENT_ARCH_ID), any()))
            .thenAnswer(inv -> {
                String excluded = inv.getArgument(3);
                List<DiscoveryFindingEntity> out = new ArrayList<>();
                for (DiscoveryFindingEntity f : fullFixture) {
                    if (!excluded.equals(f.getReviewStatus())) {
                        out.add(f);
                    }
                }
                return out;
            });
    }

    /** Same emulation for the candidate finder. */
    private void stubCandidateFinder(List<DiscoveryCandidateEntity> fullFixture) {
        when(discoveryCandidateRepository.findByRunIdAndReviewStatusNot(eq(runId), any()))
            .thenAnswer(inv -> {
                String excluded = inv.getArgument(1);
                List<DiscoveryCandidateEntity> out = new ArrayList<>();
                for (DiscoveryCandidateEntity c : fullFixture) {
                    if (!excluded.equals(c.getReviewStatus())) {
                        out.add(c);
                    }
                }
                return out;
            });
    }

    @Test
    @DisplayName("A rejected finding is ABSENT from highPriorityFindings AND from findingsSummary counts; a deferred finding stays PRESENT in both")
    void rejectedFindingAbsentFromPayloadAndCountsDeferredVisible() {
        DiscoveryFindingEntity rejected = finding("rejected", "critical", "migration_risk");
        DiscoveryFindingEntity deferred = finding("deferred", "high", "data_quality");
        DiscoveryFindingEntity pending = finding("pending_review", "medium", "business_logic");
        stubFindingFinder(List.of(rejected, deferred, pending));
        stubCandidateFinder(Collections.emptyList());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        // Payload: rejected absent; deferred + pending present.
        List<UUID> highlightIds = result.highPriorityFindings().stream()
            .map(MigrationDiscoveryContextDto.FindingHighlight::findingId).toList();
        assertThat(highlightIds)
            .doesNotContain(rejected.getId())
            .contains(deferred.getId(), pending.getId());

        // Counts: totalFindings excludes the rejected row; the status tally has
        // NO 'rejected' bucket but DOES retain 'deferred'.
        assertThat(result.findingsSummary().totalFindings()).isEqualTo(2);
        assertThat(result.findingsSummary().countsByStatus())
            .doesNotContainKey("rejected")
            .containsKey("deferred");
    }

    @Test
    @DisplayName("A rejected candidate is ABSENT from candidateSummary counts; a deferred candidate stays PRESENT")
    void rejectedCandidateAbsentFromCountsDeferredVisible() {
        stubFindingFinder(Collections.emptyList());
        DiscoveryCandidateEntity rejected = candidate("rejected", "proposed", "service");
        DiscoveryCandidateEntity deferred = candidate("deferred", "proposed", "application");
        DiscoveryCandidateEntity approved = candidate("approved", "committed", "service");
        stubCandidateFinder(List.of(rejected, deferred, approved));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        // totalCandidates excludes the rejected row (2 survive). The by-status
        // tally (proposed/committed) is unchanged for the survivors.
        assertThat(result.candidateSummary().totalCandidates()).isEqualTo(2);
        assertThat(result.candidateSummary().countsByStatus())
            .containsEntry("proposed", 1)   // deferred candidate (status=proposed)
            .containsEntry("committed", 1);  // approved candidate (status=committed)
        // The deferred candidate's TYPE survives in the by-type rollup.
        assertThat(result.candidateSummary().countsByType())
            .containsKey("application");
    }

    @Test
    @DisplayName("Evidence whose ONLY linking findings are rejected is ABSENT from evidence highlights; evidence linked by a surviving finding survives")
    void evidenceReachableOnlyThroughRejectedFindingIsDropped() {
        DiscoveryFindingEntity rejected = finding("rejected", "critical", "migration_risk");
        DiscoveryFindingEntity survivor = finding("deferred", "high", "data_quality");
        stubFindingFinder(List.of(rejected, survivor));
        stubCandidateFinder(Collections.emptyList());

        UUID evOnlyRejected = UUID.randomUUID();
        UUID evSurvivor = UUID.randomUUID();
        // Evidence is reached ONLY through its linking finding. The rejected
        // finding is dropped upstream, so its links are never queried; only the
        // surviving finding's links are loaded.
        lenient().when(discoveryFindingLinkRepository.findByFindingId(rejected.getId()))
            .thenReturn(List.of(evidenceLink(rejected.getId(), evOnlyRejected)));
        when(discoveryFindingLinkRepository.findByFindingId(survivor.getId()))
            .thenReturn(List.of(evidenceLink(survivor.getId(), evSurvivor)));
        lenient().when(discoveryEvidenceRepository.findById(evOnlyRejected))
            .thenReturn(Optional.of(evidence(evOnlyRejected, runId)));
        when(discoveryEvidenceRepository.findById(evSurvivor))
            .thenReturn(Optional.of(evidence(evSurvivor, runId)));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        List<UUID> evidenceIds = result.evidenceHighlights().stream()
            .map(MigrationDiscoveryContextDto.EvidenceHighlight::evidenceId).toList();
        assertThat(evidenceIds)
            .doesNotContain(evOnlyRejected)
            .contains(evSurvivor);
    }

    @Test
    @DisplayName("Reversibility round-trip: reject -> ABSENT -> re-approve -> PRESENT on the next context build, nothing else to unset")
    void reversibilityRoundTrip() {
        // The SAME finding id flips review_status across two context builds.
        UUID stableFindingId = UUID.randomUUID();

        // Build 1: the finding is rejected -> absent from payload + counts.
        DiscoveryFindingEntity rejectedView = finding("rejected", "critical", "migration_risk");
        rejectedView.setId(stableFindingId);
        stubFindingFinder(List.of(rejectedView));
        stubCandidateFinder(Collections.emptyList());

        MigrationDiscoveryContextDto rejectedBuild =
            service.build(PROJECT_ID, newRequest());
        assertThat(rejectedBuild.highPriorityFindings()).isEmpty();
        assertThat(rejectedBuild.findingsSummary().totalFindings()).isZero();

        // Build 2: the same finding is re-approved (live review_status flipped)
        // -> reappears in payload + counts, with NOTHING to "unset".
        DiscoveryFindingEntity approvedView = finding("approved", "critical", "migration_risk");
        approvedView.setId(stableFindingId);
        stubFindingFinder(List.of(approvedView));

        MigrationDiscoveryContextDto approvedBuild =
            service.build(PROJECT_ID, newRequest());
        assertThat(approvedBuild.highPriorityFindings())
            .extracting(MigrationDiscoveryContextDto.FindingHighlight::findingId)
            .containsExactly(stableFindingId);
        assertThat(approvedBuild.findingsSummary().totalFindings()).isEqualTo(1);
        assertThat(approvedBuild.findingsSummary().countsByStatus())
            .containsEntry("approved", 1)
            .doesNotContainKey("rejected");
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private static MigrationDiscoveryContextRequestDto newRequest() {
        return new MigrationDiscoveryContextRequestDto(
            CURRENT_ARCH_ID, null, null, null,
            true, true, true, true, true,
            100, 100, null);
    }

    private static ArchitectureEntity architecture(UUID id) {
        return ArchitectureEntity.builder()
            .id(id).projectId(PROJECT_ID).name("Current").archived(false)
            .createdAt(Instant.now()).updatedAt(Instant.now()).build();
    }

    private DiscoveryRunEntity buildRun(UUID id) {
        DiscoveryRunEntity r = DiscoveryRunEntity.builder()
            .id(id).projectId(PROJECT_ID).architectureId(CURRENT_ARCH_ID)
            .status("COMPLETED").discoveryKind("code").build();
        r.setCreatedAt(Instant.now());
        r.setUpdatedAt(Instant.now());
        return r;
    }

    private DiscoveryFindingEntity finding(String reviewStatus, String severity, String category) {
        DiscoveryFindingEntity f = DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .findingType("low_confidence_candidate")
            .category(category)
            .severity(severity)
            .reviewStatus(reviewStatus)
            .title("Finding " + reviewStatus)
            .build();
        f.setCreatedAt(Instant.now());
        f.setUpdatedAt(Instant.now());
        return f;
    }

    private DiscoveryCandidateEntity candidate(String reviewStatus, String status, String type) {
        return DiscoveryCandidateEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .candidateType(type)
            .name("cand-" + reviewStatus)
            .confidence(0.9)
            .status(status)
            .reviewStatus(reviewStatus)
            .build();
    }

    private static DiscoveryFindingLinkEntity evidenceLink(UUID findingId, UUID evidenceId) {
        return DiscoveryFindingLinkEntity.builder()
            .id(UUID.randomUUID())
            .findingId(findingId)
            .linkType("evidence")
            .targetType("discovery_evidence")
            .targetId(evidenceId.toString())
            .build();
    }

    private static DiscoveryEvidenceEntity evidence(UUID id, UUID runId) {
        return DiscoveryEvidenceEntity.builder()
            .id(id).runId(runId).repoUrl("https://example.com/repo")
            .filePath("src/X.java").type("symbol")
            .data(new java.util.HashMap<>()).extractedAt(Instant.now())
            .source("code").build();
    }
}
