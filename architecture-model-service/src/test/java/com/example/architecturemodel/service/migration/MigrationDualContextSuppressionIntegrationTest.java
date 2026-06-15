package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityMemberRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import com.example.architecturemodel.repository.entity.EpicCapturedDecisionRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
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
 * ORACLE-CRITICAL cross-builder suppression INTEGRATION proof (Spec 2,
 * Cascade-aware Bulk Review + Reject Suppression, 2026-06-02, Task Group 6.3).
 *
 * <p>The two existing suppression suites
 * ({@code MigrationDiscoveryContextSuppressionTest} and
 * {@code MigrationSpecContextSuppressionTest}) each prove ONE leak site in
 * isolation, with its OWN fixture. This test closes the one genuine end-to-end
 * gap surfaced by Group 6.2: it drives ONE shared finding scenario through BOTH
 * downstream context builders in the SAME run and asserts the SAME {@code
 * rejected} finding id is GENUINELY ABSENT from BOTH the book-of-work /
 * migration-delivery-plan context ({@link MigrationDiscoveryContextService}) AND
 * the per-story shape-spec context ({@link MigrationSpecContextResolver}) --
 * payloads AND counts -- while the SAME {@code deferred} finding stays VISIBLE in
 * BOTH. It then flips the rejected finding to {@code approved} (live
 * {@code review_status}) and asserts it REAPPEARS in BOTH builders on the next
 * build, with nothing to "unset" -- proving the suppression is wired
 * CONSISTENTLY at both leak sites against a single scenario, not two
 * independently-constructed fixtures that could drift.</p>
 *
 * <p>Both services are constructed standalone with Mockito mocks (no Spring
 * context) exactly as the two single-builder suppression suites do; the finding
 * finders are stubbed with {@code Answer}s that faithfully emulate the new
 * {@code ...ReviewStatusNot} derived-query semantics over the SHARED fixture, so
 * the same rows are presented to both builders.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MigrationDualContextSuppressionIntegrationTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID TARGET_ARCH_ID = UUID.randomUUID();
    private static final UUID BOOK_OF_WORK_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    // ---- MigrationDiscoveryContextService collaborators ----
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

    // ---- MigrationSpecContextResolver collaborators ----
    @Mock private WorkItemRepository workItemRepository;
    @Mock private MigrationStorySpecGenerationRepository specGenerationRepository;
    @Mock private EpicCapturedDecisionRepository epicCapturedDecisionRepository;
    @Mock private DiscoveryCapabilityRepository capabilityRepository;
    @Mock private DiscoveryCapabilityMemberRepository capabilityMemberRepository;

    private MigrationDiscoveryContextService discoveryContextService;
    private MigrationSpecContextResolver specContextResolver;

    private UUID runId;

    @BeforeEach
    void setUp() {
        discoveryContextService = new MigrationDiscoveryContextService(
            projectRepository, architectureRepository, discoveryRunRepository,
            discoveryFindingRepository, discoveryFindingLinkRepository,
            discoveryCandidateRepository, discoveryEvidenceRepository,
            discoveryDecisionTaskRepository, apiBehaviourBaselineRepository,
            architectureElementMappingRepository,
            null, null, null, null, null, null, null, null, null, null);

        specContextResolver = new MigrationSpecContextResolver(
            projectRepository, workItemRepository,
            architectureElementMappingRepository, apiBehaviourBaselineRepository,
            discoveryFindingRepository, specGenerationRepository,
            epicCapturedDecisionRepository,
            capabilityRepository,
            capabilityMemberRepository);

        runId = UUID.randomUUID();

        // ---- MigrationDiscoveryContextService wiring ----
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
        when(discoveryCandidateRepository.findByRunIdAndReviewStatusNot(eq(runId), any()))
            .thenReturn(Collections.emptyList());

        // ---- MigrationSpecContextResolver wiring ----
        ProjectEntity project = ProjectEntity.builder()
            .id(PROJECT_ID).name("test-project").projectParentFolder("/tmp/test")
            .isActive(true).build();
        when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
        WorkItemEntity wi = WorkItemEntity.builder()
            .id(WORK_ITEM_ID).projectId(PROJECT_ID).type("STORY")
            .title("Migrate /customer/{id} to target Customer service")
            .status("PLANNED").sortOrder(0)
            .createdAt(Instant.now()).updatedAt(Instant.now()).build();
        when(workItemRepository.findByIdAndProjectId(WORK_ITEM_ID, PROJECT_ID))
            .thenReturn(Optional.of(wi));
        when(architectureElementMappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    /**
     * Stub BOTH finders (the book-of-work finder keyed by run + the per-story
     * finder keyed by project/architecture) so they faithfully emulate the new
     * {@code ...ReviewStatusNot} semantics over the SAME shared fixture: each
     * returns the fixture filtered to rows whose {@code reviewStatus} differs
     * from the excluded argument. This presents IDENTICAL rows to both builders.
     */
    private void stubBothFindersFrom(List<DiscoveryFindingEntity> sharedFixture) {
        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(
                eq(runId), eq(PROJECT_ID), eq(CURRENT_ARCH_ID), any()))
            .thenAnswer(inv -> filterExcluding(sharedFixture, inv.getArgument(3)));
        when(discoveryFindingRepository
            .findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
                eq(PROJECT_ID), eq(CURRENT_ARCH_ID), any()))
            .thenAnswer(inv -> filterExcluding(sharedFixture, inv.getArgument(2)));
    }

    private static List<DiscoveryFindingEntity> filterExcluding(
            List<DiscoveryFindingEntity> fixture, String excluded) {
        List<DiscoveryFindingEntity> out = new ArrayList<>();
        for (DiscoveryFindingEntity f : fixture) {
            if (!excluded.equals(f.getReviewStatus())) {
                out.add(f);
            }
        }
        return out;
    }

    @Test
    @DisplayName("One run, BOTH builders: a rejected finding is ABSENT from book-of-work payload+counts AND the per-story context, while the deferred finding stays PRESENT in BOTH")
    void rejectedFindingAbsentFromBothBuildersInOneRunDeferredVisibleInBoth() {
        UUID rejectedId = UUID.randomUUID();
        UUID deferredId = UUID.randomUUID();

        DiscoveryFindingEntity rejected = finding(rejectedId, "rejected");
        DiscoveryFindingEntity deferred = finding(deferredId, "deferred");
        DiscoveryFindingEntity pending = finding(UUID.randomUUID(), "pending_review");
        stubBothFindersFrom(List.of(rejected, deferred, pending));

        // ---- Builder A: book-of-work / migration-delivery-plan context ----
        MigrationDiscoveryContextDto bookOfWork =
            discoveryContextService.build(PROJECT_ID, newDiscoveryRequest());

        List<UUID> bookHighlightIds = bookOfWork.highPriorityFindings().stream()
            .map(MigrationDiscoveryContextDto.FindingHighlight::findingId).toList();
        assertThat(bookHighlightIds)
            .as("book-of-work payload excludes the rejected finding")
            .doesNotContain(rejectedId)
            .as("book-of-work payload retains the deferred finding")
            .contains(deferredId);
        // Counts (not just the payload) exclude rejected and retain deferred.
        assertThat(bookOfWork.findingsSummary().totalFindings()).isEqualTo(2);
        assertThat(bookOfWork.findingsSummary().countsByStatus())
            .doesNotContainKey("rejected")
            .containsKey("deferred");

        // ---- Builder B: per-story shape-spec context (SAME run, SAME fixture) ----
        MigrationSpecContextDto perStory = specContextResolver.resolve(
            PROJECT_ID,
            specRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));

        assertThat(perStory.service()).isNotNull();
        List<String> perStoryIds = perStory.service().rawSqlFindings().stream()
            .map(m -> (String) m.get("id")).toList();
        assertThat(perStoryIds)
            .as("per-story context excludes the SAME rejected finding")
            .doesNotContain(rejectedId.toString())
            .as("per-story context retains the SAME deferred finding")
            .contains(deferredId.toString());
    }

    @Test
    @DisplayName("Reversibility across BOTH builders: reject -> ABSENT in both -> re-approve -> PRESENT in both on the next build")
    void reversibilityAcrossBothBuildersInOneRun() {
        UUID stableId = UUID.randomUUID();

        // Build 1: rejected -> absent from BOTH builders.
        stubBothFindersFrom(List.of(finding(stableId, "rejected")));

        MigrationDiscoveryContextDto bookRejected =
            discoveryContextService.build(PROJECT_ID, newDiscoveryRequest());
        assertThat(bookRejected.highPriorityFindings()).isEmpty();
        assertThat(bookRejected.findingsSummary().totalFindings()).isZero();

        MigrationSpecContextDto specRejected = specContextResolver.resolve(
            PROJECT_ID, specRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));
        List<String> specRejectedIds = specRejected.service() == null
            ? List.of()
            : specRejected.service().rawSqlFindings().stream()
                .map(m -> (String) m.get("id")).toList();
        assertThat(specRejectedIds).doesNotContain(stableId.toString());

        // Build 2: the SAME finding re-approved (live review_status flipped) ->
        // reappears in BOTH builders, with nothing to "unset".
        stubBothFindersFrom(List.of(finding(stableId, "approved")));

        MigrationDiscoveryContextDto bookApproved =
            discoveryContextService.build(PROJECT_ID, newDiscoveryRequest());
        assertThat(bookApproved.highPriorityFindings())
            .extracting(MigrationDiscoveryContextDto.FindingHighlight::findingId)
            .containsExactly(stableId);
        assertThat(bookApproved.findingsSummary().totalFindings()).isEqualTo(1);

        MigrationSpecContextDto specApproved = specContextResolver.resolve(
            PROJECT_ID, specRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));
        List<String> specApprovedIds = specApproved.service().rawSqlFindings().stream()
            .map(m -> (String) m.get("id")).toList();
        assertThat(specApprovedIds).contains(stableId.toString());
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private MigrationDiscoveryContextRequestDto newDiscoveryRequest() {
        return new MigrationDiscoveryContextRequestDto(
            CURRENT_ARCH_ID, null, null, null,
            true, true, true, true, true,
            100, 100, null);
    }

    private MigrationSpecContextRequestDto specRequest(List<String> types) {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID, "bi-1", WORK_ITEM_ID,
            CURRENT_ARCH_ID, TARGET_ARCH_ID, types, null, null, null);
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

    /**
     * A finding usable by BOTH builders: {@code raw_sql} type + {@code
     * migration_risk} category so the per-story service block's
     * {@code rawSqlFindings} bucket picks it up, with the shared
     * {@code (project, architecture, run)} scope and a {@code source} so the
     * resolver renders it.
     */
    private DiscoveryFindingEntity finding(UUID id, String reviewStatus) {
        DiscoveryFindingEntity f = DiscoveryFindingEntity.builder()
            .id(id)
            .runId(runId)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .findingType("raw_sql")
            .category("migration_risk")
            .severity("high")
            .reviewStatus(reviewStatus)
            .title("Finding " + reviewStatus)
            .summary("summary")
            .source("service-pack")
            .build();
        f.setCreatedAt(Instant.now());
        f.setUpdatedAt(Instant.now());
        return f;
    }
}
