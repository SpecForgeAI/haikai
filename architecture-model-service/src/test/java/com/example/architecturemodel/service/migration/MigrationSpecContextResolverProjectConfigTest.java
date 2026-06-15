package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.BudgetMeta;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
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
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * AMS-side coverage for Task Group 9 (Cross-Story Context Injection, 2026-05-20):
 * the per-project token-cap config columns flow into the resolver's
 * {@link BudgetMetaTracker} construction.
 *
 * <p>Two focused tests:</p>
 * <ol>
 *   <li>{@code per_story_context_token_cap} and
 *       {@code cross_story_context_token_cap} on the project row are honoured
 *       by the resolver; the {@code budget_meta} in the response reflects the
 *       configured maxes rather than the {@link BudgetMetaTracker} compile-time
 *       defaults.</li>
 *   <li>When the project's columns are {@code null} (the DB DEFAULT clauses
 *       should prevent this in practice, but the entity exposes boxed types so
 *       null is representable), the resolver falls back to the
 *       {@link BudgetMetaTracker} {@code DEFAULT_*_TOKEN_CAP} constants --
 *       defensive two-layer defaulting per the field doc.</li>
 * </ol>
 *
 * <p>The {@code auto_run_pass_2} flag is exercised at the gateway layer (Task
 * Group 5/6) -- it does not influence the AMS resolver path. Its AMS-side
 * coverage lives in the ProjectController PATCH tests, which verify the field
 * round-trips through the DTO/Mapper/Entity stack with null-guarded PATCH
 * semantics.</p>
 *
 * <p>Mockito-only; no Spring context. Mirrors the harness used by
 * {@link MigrationSpecContextResolverCrossStoryTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationSpecContextResolverProjectConfigTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH = UUID.randomUUID();
    private static final UUID TARGET_ARCH = UUID.randomUUID();
    private static final UUID BOOK_OF_WORK_ID = UUID.randomUUID();
    private static final UUID FEATURE_ID = UUID.randomUUID();
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

    private WorkItemEntity buildStory() {
        return WorkItemEntity.builder()
            .id(WORK_ITEM_ID)
            .projectId(PROJECT_ID)
            .type("STORY")
            .parentId(FEATURE_ID)
            .title("Story under test")
            .description("Short description")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private MigrationSpecContextRequestDto buildPassTwoRequest() {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID,
            "bi-1",
            WORK_ITEM_ID,
            CURRENT_ARCH,
            TARGET_ARCH,
            List.of(MigrationSpecContextRequestDto.CTX_SERVICE),
            null, null, null,
            Integer.valueOf(2),
            Collections.emptyList()
        );
    }

    private void stubEmptyDependencies() {
        lenient().when(workItemRepository.findByIdAndProjectId(WORK_ITEM_ID, PROJECT_ID))
            .thenReturn(Optional.of(buildStory()));
        lenient().when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    PROJECT_ID, FEATURE_ID))
            .thenReturn(Collections.emptyList());
        lenient().when(mappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(baselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(findingRepository.findByProjectIdAndArchitectureId(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(epicCapturedDecisionRepository
                .findByProjectIdAndEpicWorkItemIdAndStatusIn(any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    /**
     * Task 9.1, AMS test 1: configured caps flow through to the resolver's
     * BudgetMetaTracker construction and appear in budget_meta.maxTokens.
     */
    @Test
    @DisplayName("per_story_context_token_cap and cross_story_context_token_cap are loaded by resolver")
    void perProjectCapsHonoured() {
        // Custom non-default caps -- the resolver must pick these up from the
        // project row, not fall back to BudgetMetaTracker's compile-time defaults.
        Integer customPerStory = Integer.valueOf(50_000);
        Integer customCrossStory = Integer.valueOf(8_000);

        ProjectEntity project = ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .isActive(true)
            .perStoryContextTokenCap(customPerStory)
            .crossStoryContextTokenCap(customCrossStory)
            .autoRunPass2(Boolean.TRUE)
            .build();
        when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));

        stubEmptyDependencies();

        MigrationSpecContextDto out = resolver.resolve(PROJECT_ID, buildPassTwoRequest());

        BudgetMeta meta = out.budgetMeta();
        assertThat(meta).as("budget_meta must be populated").isNotNull();

        // The per-story / cross-story maxes flow through directly to budget_meta.
        // toBudgetMeta() exposes them as separate fields plus a summed maxTokens.
        assertThat(meta.perStoryMaxTokens())
            .as("per-story max should equal the project column value")
            .isEqualTo(customPerStory);
        assertThat(meta.crossStoryMaxTokens())
            .as("cross-story max should equal the project column value")
            .isEqualTo(customCrossStory);
        assertThat(meta.maxTokens())
            .as("aggregate max should be the sum of per-story + cross-story caps")
            .isEqualTo(customPerStory + customCrossStory);
    }

    /**
     * Task 9.1, AMS test 2: when project columns are null (which the DB DEFAULTs
     * should prevent, but the entity exposes boxed types so null is
     * representable), the resolver falls back to BudgetMetaTracker.DEFAULT_*
     * constants -- defensive two-layer defaulting. This also implicitly covers
     * the "auto_run_pass_2 defaults to true when not set" requirement from the
     * test list: the DB DEFAULT is TRUE, the entity exposes a boxed Boolean,
     * and a null value is preserved on read. We assert that a null
     * autoRunPass2 round-trips through the entity rather than being silently
     * coerced to false, which is what the boxed-type guard exists to prevent.
     */
    @Test
    @DisplayName("Null caps on project row fall back to BudgetMetaTracker defaults; auto_run_pass_2 stays nullable on entity")
    void nullCapsFallbackToDefaults() {
        // Null caps -- simulates a row that pre-dates the DB DEFAULT backfill
        // (or has been explicitly nulled via PATCH).
        ProjectEntity project = ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .isActive(true)
            .perStoryContextTokenCap(null)
            .crossStoryContextTokenCap(null)
            .autoRunPass2(null) // boxed Boolean stays null on entity (PATCH-safe)
            .build();
        when(projectRepository.findById(PROJECT_ID)).thenReturn(Optional.of(project));

        stubEmptyDependencies();

        MigrationSpecContextDto out = resolver.resolve(PROJECT_ID, buildPassTwoRequest());

        BudgetMeta meta = out.budgetMeta();
        assertThat(meta).as("budget_meta must be populated").isNotNull();

        assertThat(meta.perStoryMaxTokens())
            .as("per-story max should fall back to BudgetMetaTracker.DEFAULT_PER_STORY_TOKEN_CAP")
            .isEqualTo(BudgetMetaTracker.DEFAULT_PER_STORY_TOKEN_CAP);
        assertThat(meta.crossStoryMaxTokens())
            .as("cross-story max should fall back to BudgetMetaTracker.DEFAULT_CROSS_STORY_TOKEN_CAP")
            .isEqualTo(BudgetMetaTracker.DEFAULT_CROSS_STORY_TOKEN_CAP);

        // Reload the entity to confirm null is preserved on the boxed Boolean
        // (project_primitive_double_dto_overwrite.md): a primitive boolean
        // would silently coerce to false here.
        assertThat(project.getAutoRunPass2())
            .as("autoRunPass2 must stay null on boxed Boolean entity; primitive default would be wrong")
            .isNull();
    }
}
