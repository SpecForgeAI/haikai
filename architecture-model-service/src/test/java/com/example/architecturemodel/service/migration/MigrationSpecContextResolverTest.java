package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for {@link MigrationSpecContextResolver}.
 *
 * <p>Uses Mockito for repository mocks (no Spring context) -- mirrors the
 * standalone-JUnit pattern established by {@code MigrationDiscoveryContextServiceTest}
 * (the migration-discovery-context sibling resolver). Verifies the six
 * context-type blocks (service / api / soap / data / infrastructure / test_pack)
 * plus bounding caps, missing-input aggregation, and 404 paths.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 7.</p>
 *
 * <p>Extended: Cross-Story Context Injection (2026-05-20) -- Task Group 3 adds
 * the {@link MigrationStorySpecGenerationRepository} +
 * {@link EpicCapturedDecisionRepository} constructor parameters. The
 * cross-story-specific test cases live in
 * {@link MigrationSpecContextResolverCrossStoryTest}; this file keeps the
 * existing per-block coverage and is updated only for the new ctor signature.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationSpecContextResolverTest {

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
            projectRepository,
            workItemRepository,
            mappingRepository,
            baselineRepository,
            findingRepository,
            specGenerationRepository,
            epicCapturedDecisionRepository,
            capabilityRepository,
            capabilityMemberRepository
        );
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void stubScope() {
        ProjectEntity project = ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .isActive(true)
            .build();
        lenient().when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
        WorkItemEntity wi = WorkItemEntity.builder()
            .id(WORK_ITEM_ID)
            .projectId(PROJECT_ID)
            .type("STORY")
            .title("Migrate /customer/{id} to target Customer service")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        lenient().when(workItemRepository.findByIdAndProjectId(WORK_ITEM_ID, PROJECT_ID))
            .thenReturn(Optional.of(wi));
        lenient().when(mappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(baselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    private MigrationSpecContextRequestDto buildRequest(List<String> types) {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID,
            "bi-1",
            WORK_ITEM_ID,
            CURRENT_ARCH,
            TARGET_ARCH,
            types,
            null, null, null
        );
    }

    private static ArchitectureElementMappingEntity mapping(
        String sourceType, String sourceId, String targetType, String targetId) {
        Instant now = Instant.now();
        return ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .sourceArchitectureId(CURRENT_ARCH)
            .targetArchitectureId(TARGET_ARCH)
            .sourceElementType(sourceType)
            .sourceElementId(sourceId)
            .targetElementType(targetType)
            .targetElementId(targetId)
            .mappingType("equivalent")
            .status("active")
            .createdByTask("test")
            .createdAt(now)
            .updatedAt(now)
            .build();
    }

    private static DiscoveryFindingEntity finding(String findingType, String category, String source) {
        DiscoveryFindingEntity f = new DiscoveryFindingEntity();
        f.setId(UUID.randomUUID());
        f.setRunId(UUID.randomUUID());
        f.setProjectId(PROJECT_ID);
        f.setArchitectureId(CURRENT_ARCH);
        f.setFindingType(findingType);
        f.setCategory(category);
        f.setSeverity("medium");
        f.setReviewStatus("pending_review");
        f.setTitle("title");
        f.setSummary("summary");
        f.setSource(source);
        f.setCreatedAt(Instant.now());
        return f;
    }

    private static ApiBehaviourBaselineEntity baseline() {
        ApiBehaviourBaselineEntity b = new ApiBehaviourBaselineEntity();
        b.setId(UUID.randomUUID());
        b.setProjectId(PROJECT_ID);
        b.setArchitectureId(CURRENT_ARCH);
        b.setName("baseline");
        b.setStatus("active");
        b.setOperationCount(1);
        b.setAcceptedCaptureCount(1);
        b.setCreatedAt(Instant.now());
        return b;
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Service context block returns a populated block when requested")
    void serviceBlockPopulated() {
        stubScope();
        when(mappingRepository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                PROJECT_ID, CURRENT_ARCH, TARGET_ARCH))
            .thenReturn(List.of(
                mapping("service", "svc-current", "service", "svc-target")));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));

        assertThat(out).isNotNull();
        assertThat(out.service()).isNotNull();
        assertThat(out.service().mappings()).isNotEmpty();
        assertThat(out.returnedContextTypes())
            .containsExactly(MigrationSpecContextRequestDto.CTX_SERVICE);
    }

    @Test
    @DisplayName("API context block returns a populated block when requested")
    void apiBlockPopulated() {
        stubScope();
        when(mappingRepository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                PROJECT_ID, CURRENT_ARCH, TARGET_ARCH))
            .thenReturn(List.of(
                mapping("interface", "int-current", "interface", "int-target")));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
                PROJECT_ID, CURRENT_ARCH))
            .thenReturn(List.of(baseline()));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_API)));

        assertThat(out.api()).isNotNull();
        assertThat(out.api().mappings()).isNotEmpty();
        assertThat(out.api().baselineRefs()).hasSize(1);
        // Should report no missing-baseline blocker since a baseline was supplied.
        assertThat(out.api().missingInputs())
            .noneMatch(mi -> "baseline".equals(mi.kind()));
    }

    @Test
    @DisplayName("SOAP, data, infrastructure, and test_pack blocks return populated when requested")
    void otherBlocksPopulated() {
        stubScope();
        when(mappingRepository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                PROJECT_ID, CURRENT_ARCH, TARGET_ARCH))
            .thenReturn(List.of(
                mapping("soap", "op-current", "soap", "op-target"),
                mapping("data_entity", "CUSTOMER", "data_entity", "Customer")));
        when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(PROJECT_ID, CURRENT_ARCH, "rejected"))
            .thenReturn(List.of(
                finding("soap_payload", "soap", "soap-pack"),
                finding("db_profile", "data_quality", "db-pack"),
                finding("reconciliation", "reconciliation", "recon-pack")));
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
                PROJECT_ID, CURRENT_ARCH))
            .thenReturn(List.of(baseline()));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(
                MigrationSpecContextRequestDto.CTX_SOAP,
                MigrationSpecContextRequestDto.CTX_DATA,
                MigrationSpecContextRequestDto.CTX_INFRASTRUCTURE,
                MigrationSpecContextRequestDto.CTX_TEST_PACK)));

        assertThat(out.soap()).isNotNull();
        assertThat(out.soap().mappings()).isNotEmpty();
        assertThat(out.data()).isNotNull();
        assertThat(out.data().mappings()).isNotEmpty();
        assertThat(out.infrastructure()).isNotNull();
        assertThat(out.testPack()).isNotNull();
        assertThat(out.testPack().baselineRefs()).hasSize(1);
        assertThat(out.returnedContextTypes()).hasSize(4);
    }

    @Test
    @DisplayName("missingInputs populated when mappings/baselines/contracts absent")
    void missingInputsPopulated() {
        stubScope();
        // No mappings, no baselines, no findings.
        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(
                MigrationSpecContextRequestDto.CTX_API,
                MigrationSpecContextRequestDto.CTX_DATA)));

        assertThat(out.api()).isNotNull();
        assertThat(out.api().missingInputs())
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("mapping"))
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("baseline"));
        assertThat(out.data()).isNotNull();
        assertThat(out.data().missingInputs())
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("mapping"));
        // Top-level missingInputs aggregates per-block blockers.
        assertThat(out.missingInputs()).isNotEmpty();
    }

    @Test
    @DisplayName("maxFindings cap is respected: 10 -> at most 10 findings per relevant block")
    void boundingLimitsRespected() {
        stubScope();
        List<DiscoveryFindingEntity> all = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            all.add(finding("raw_sql", "migration_risk", "service-pack"));
        }
        when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(PROJECT_ID, CURRENT_ARCH, "rejected"))
            .thenReturn(all);

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            new MigrationSpecContextRequestDto(
                BOOK_OF_WORK_ID, "bi-1", WORK_ITEM_ID,
                CURRENT_ARCH, TARGET_ARCH,
                List.of(MigrationSpecContextRequestDto.CTX_SERVICE),
                10, null, null
            ));

        assertThat(out.service()).isNotNull();
        // The service block surfaces a raw_sql bucket; cap at maxFindings=10
        // applies per-bucket. Loader-level pre-cap (which slices the underlying
        // list to maxFindings before bucketing) also enforces the bound.
        assertThat(out.service().rawSqlFindings().size()).isLessThanOrEqualTo(10);
    }

    @Test
    @DisplayName("Unknown WorkItem id returns 404")
    void unknownWorkItem404() {
        ProjectEntity project = ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .isActive(true)
            .build();
        when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));
        when(workItemRepository.findByIdAndProjectId(WORK_ITEM_ID, PROJECT_ID))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() -> resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE))))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("Unknown project id returns 404")
    void unknownProject404() {
        when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE))))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("Combined contextTypes returns all requested blocks")
    void combinedTypesReturnsAllBlocks() {
        stubScope();

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(
                MigrationSpecContextRequestDto.CTX_SERVICE,
                MigrationSpecContextRequestDto.CTX_API,
                MigrationSpecContextRequestDto.CTX_SOAP,
                MigrationSpecContextRequestDto.CTX_DATA,
                MigrationSpecContextRequestDto.CTX_INFRASTRUCTURE,
                MigrationSpecContextRequestDto.CTX_TEST_PACK)));

        assertThat(out.service()).isNotNull();
        assertThat(out.api()).isNotNull();
        assertThat(out.soap()).isNotNull();
        assertThat(out.data()).isNotNull();
        assertThat(out.infrastructure()).isNotNull();
        assertThat(out.testPack()).isNotNull();
        assertThat(out.returnedContextTypes()).hasSize(6);
    }

    @Test
    @DisplayName("Regression: resolver uses findByProjectIdAndArchitectureIdAndRunIdNotNull so diff-sourced findings (run_id=null) do NOT NPE downstream (accepted Q7)")
    void loadFindingsFiltersDiffSourcedOriginOut() {
        stubScope();
        // The new RunIdNotNull finder is the contract -- the resolver MUST
        // call it (not the old findByProjectIdAndArchitectureId, which
        // returns BOTH origins post-2026-05-25). The stub here returns ONLY
        // run-sourced findings (this is what the new finder produces in
        // production); the test then asserts the resolver consumed them
        // happily without NPE on f.getRunId(). The companion repository
        // test loadFindingsFiltersDiffSourcedOut.runIdNotNullFinderFiltersDiffSourcedOut
        // in DiscoveryFindingApiBehaviourDiffOriginPersistenceTest confirms
        // the finder itself filters at the DB layer.
        when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
                PROJECT_ID, CURRENT_ARCH, "rejected"))
            .thenReturn(List.of(finding("raw_sql", "migration_risk", "service-pack")));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildRequest(List.of(MigrationSpecContextRequestDto.CTX_SERVICE)));

        // Resolver returns a populated block -- did NOT NPE on f.getRunId().
        assertThat(out).isNotNull();
        assertThat(out.service()).isNotNull();
        // And critically, no call to the OLD finder was made -- the
        // production code path now goes through the RunIdNotNull variant.
        // If a future maintainer reverts the resolver's loadFindings, the
        // existing tests that stub findByProjectIdAndArchitectureId would
        // need to be re-stubbed -- this regression assertion plus the
        // existing test stubs being on the new finder keep the contract.
        org.mockito.Mockito.verify(findingRepository, org.mockito.Mockito.never())
            .findByProjectIdAndArchitectureId(any(), any());
    }

}
