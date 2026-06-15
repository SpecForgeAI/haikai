package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityMemberRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
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
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * ORACLE-CRITICAL suppression proof for
 * {@link MigrationSpecContextResolver#resolve} (Spec 2, Cascade-aware Bulk
 * Review + Reject Suppression, 2026-06-02, Task Group 2).
 *
 * <p>Proves that a {@code rejected} finding is GENUINELY ABSENT from the
 * per-story shape-spec block context, while a {@code deferred} finding stays
 * VISIBLE. The finding finder is stubbed with an {@code Answer} that faithfully
 * emulates the new
 * {@code findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot}
 * derived-query semantics (filtering a MIXED fixture on
 * {@code reviewStatus != excludedArg}). This proves BOTH that the resolver now
 * calls the excluding finder with {@code "rejected"} and that rejected IR never
 * reaches a per-story block builder ({@code buildServiceBlock} via
 * {@code boundedFindings}).</p>
 *
 * <p>Standalone Mockito (no Spring context) mirrors
 * {@code MigrationSpecContextResolverTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MigrationSpecContextSuppressionTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH = UUID.randomUUID();
    private static final UUID TARGET_ARCH = UUID.randomUUID();
    private static final UUID BOOK_OF_WORK_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();

    @Mock private ProjectRepository projectRepository;
    @Mock private WorkItemRepository workItemRepository;
    @Mock private ArchitectureElementMappingRepository mappingRepository;
    @Mock private ApiBehaviourBaselineRepository baselineRepository;
    @Mock private DiscoveryFindingRepository findingRepository;
    @Mock private MigrationStorySpecGenerationRepository specGenerationRepository;
    @Mock private EpicCapturedDecisionRepository epicCapturedDecisionRepository;
    @Mock private DiscoveryCapabilityRepository capabilityRepository;
    @Mock private DiscoveryCapabilityMemberRepository capabilityMemberRepository;

    private MigrationSpecContextResolver resolver;

    @BeforeEach
    void setUp() {
        resolver = new MigrationSpecContextResolver(
            projectRepository, workItemRepository, mappingRepository,
            baselineRepository, findingRepository, specGenerationRepository,
            epicCapturedDecisionRepository,
            capabilityRepository,
            capabilityMemberRepository);

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
        when(mappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(any(), any(), any()))
            .thenReturn(Collections.emptyList());
        when(baselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(any(), any()))
            .thenReturn(Collections.emptyList());
    }

    /**
     * Stub the finding finder so it faithfully emulates the new
     * {@code findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot}
     * derived-query semantics: return the supplied fixture filtered to rows
     * whose {@code reviewStatus} differs from the 3rd (excluded) argument.
     */
    private void stubFindingFinder(List<DiscoveryFindingEntity> fullFixture) {
        when(findingRepository
            .findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
                eq(PROJECT_ID), eq(CURRENT_ARCH), any()))
            .thenAnswer(inv -> {
                String excluded = inv.getArgument(2);
                List<DiscoveryFindingEntity> out = new ArrayList<>();
                for (DiscoveryFindingEntity f : fullFixture) {
                    if (!excluded.equals(f.getReviewStatus())) {
                        out.add(f);
                    }
                }
                return out;
            });
    }

    @Test
    @DisplayName("A rejected finding is ABSENT from the per-story service block; a deferred finding stays PRESENT")
    void rejectedFindingAbsentFromPerStoryContextDeferredVisible() {
        DiscoveryFindingEntity rejected = finding("rejected", "raw_sql", "migration_risk", "service-pack");
        DiscoveryFindingEntity deferred = finding("deferred", "raw_sql", "migration_risk", "service-pack");
        DiscoveryFindingEntity pending = finding("pending_review", "raw_sql", "migration_risk", "service-pack");
        stubFindingFinder(List.of(rejected, deferred, pending));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));

        assertThat(out.service()).isNotNull();
        List<String> ids = out.service().rawSqlFindings().stream()
            .map(m -> (String) m.get("id"))
            .toList();
        // Rejected finding genuinely absent; deferred + pending present.
        assertThat(ids)
            .doesNotContain(rejected.getId().toString())
            .contains(deferred.getId().toString(), pending.getId().toString());
    }

    @Test
    @DisplayName("Reversibility round-trip: a finding rejected -> ABSENT from per-story context -> re-approved -> PRESENT on the next resolve")
    void reversibilityRoundTrip() {
        UUID stableId = UUID.randomUUID();

        // Resolve 1: rejected -> absent.
        DiscoveryFindingEntity rejectedView = finding("rejected", "raw_sql", "migration_risk", "service-pack");
        rejectedView.setId(stableId);
        stubFindingFinder(List.of(rejectedView));

        MigrationSpecContextDto rejectedOut = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));
        List<String> rejectedIds = rejectedOut.service() == null
            ? List.of()
            : rejectedOut.service().rawSqlFindings().stream()
                .map(m -> (String) m.get("id")).toList();
        assertThat(rejectedIds).doesNotContain(stableId.toString());

        // Resolve 2: the SAME finding re-approved (live review_status flipped)
        // -> reappears, with nothing to "unset".
        DiscoveryFindingEntity approvedView = finding("approved", "raw_sql", "migration_risk", "service-pack");
        approvedView.setId(stableId);
        stubFindingFinder(List.of(approvedView));

        MigrationSpecContextDto approvedOut = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));
        List<String> approvedIds = approvedOut.service().rawSqlFindings().stream()
            .map(m -> (String) m.get("id")).toList();
        assertThat(approvedIds).contains(stableId.toString());
    }

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    private MigrationSpecContextRequestDto buildRequest(List<String> types) {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID, "bi-1", WORK_ITEM_ID,
            CURRENT_ARCH, TARGET_ARCH, types, null, null, null);
    }

    private static DiscoveryFindingEntity finding(
            String reviewStatus, String findingType, String category, String source) {
        DiscoveryFindingEntity f = new DiscoveryFindingEntity();
        f.setId(UUID.randomUUID());
        f.setRunId(UUID.randomUUID());
        f.setProjectId(PROJECT_ID);
        f.setArchitectureId(CURRENT_ARCH);
        f.setFindingType(findingType);
        f.setCategory(category);
        f.setSeverity("medium");
        f.setReviewStatus(reviewStatus);
        f.setTitle("title " + reviewStatus);
        f.setSummary("summary");
        f.setSource(source);
        f.setCreatedAt(Instant.now());
        return f;
    }
}
