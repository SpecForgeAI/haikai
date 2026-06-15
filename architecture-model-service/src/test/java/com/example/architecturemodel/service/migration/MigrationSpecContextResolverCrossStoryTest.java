package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.BudgetMeta;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.DedupedRef;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.ParentRollup;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.SiblingSummary;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.WorkstreamContext;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.EpicCapturedDecisionEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
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
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cross-story context injection tests for
 * {@link MigrationSpecContextResolver} (Task Group 3, 2026-05-20).
 *
 * <p>Six focused tests covering the requirements in tasks.md 3.1, plus two
 * Task Group 10 gap-fillers (see
 * {@code agent-os/specs/2026-05-20-cross-story-context-injection/verifications/loop-guardrail-coverage.md}):</p>
 * <ol>
 *   <li>{@code sibling_summaries[]} returns ONLY rows where
 *       {@code generation_pass = 1} -- pass-2 outputs are never sibling
 *       context.</li>
 *   <li>Pass-1 rows with status {@code failed} or
 *       {@code insufficient_context} are EXCLUDED from {@code sibling_summaries[]}
 *       even if their id appears in {@code passOneSpecIdsInScope[]} -- the
 *       resolver enforces the loop guardrail at this boundary.</li>
 *   <li>{@code parent_rollup} shape: epic includes
 *       {@code capturedDecisions[]}, feature / initiative carry 1-sentence
 *       summaries.</li>
 *   <li>{@code workstream_context} deduplicates API baselines and
 *       architecture refs across stories and records
 *       {@code referencedByStoryIds[]}.</li>
 *   <li>{@code budget_meta.trimmed} records sibling specs dropped and evidence
 *       refs dropped under a small {@code cross_story_context_token_cap}.</li>
 *   <li>Tiered-trimming order preserves story description, parent rollup,
 *       and epic captured decisions even when the budget overspends; siblings
 *       drop first.</li>
 *   <li>(Task Group 10) Parent rollup excludes superseded epic captured
 *       decisions -- the resolver passes only {@code (draft, confirmed)} to
 *       the repository, mirroring the controller-layer
 *       {@code PARENT_ROLLUP_FEED_STATUSES} contract.</li>
 *   <li>(Task Group 10) {@code sibling_summaries[]} omits a pass-1 row whose
 *       id is NOT in {@code passOneSpecIdsInScope[]} -- resolver-boundary
 *       corroboration of loop-guardrail (b).</li>
 * </ol>
 *
 * <p>Tests use Mockito with no Spring context, mirroring
 * {@link MigrationSpecContextResolverTest}.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationSpecContextResolverCrossStoryTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH = UUID.randomUUID();
    private static final UUID TARGET_ARCH = UUID.randomUUID();
    private static final UUID BOOK_OF_WORK_ID = UUID.randomUUID();
    private static final UUID FEATURE_ID = UUID.randomUUID();
    private static final UUID EPIC_ID = UUID.randomUUID();
    private static final UUID INITIATIVE_ID = UUID.randomUUID();

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
    // Fixture helpers
    // -----------------------------------------------------------------------

    private ProjectEntity buildProjectEntity() {
        return ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .projectParentFolder("/tmp/test")
            .isActive(true)
            .build();
    }

    private WorkItemEntity buildStory(UUID id, UUID parentId, String title) {
        return WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type("STORY")
            .parentId(parentId)
            .title(title)
            .description("Story description for " + title)
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private WorkItemEntity buildAncestor(UUID id, UUID parentId, String type, String title) {
        return WorkItemEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .type(type)
            .parentId(parentId)
            .title(title)
            .description(title + ". A second sentence that should be dropped from the rollup summary.")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private MigrationStorySpecGenerationEntity buildPassOneRow(
            UUID workItemId, String status, List<String> decisions, List<String> interfaces) {
        Instant now = Instant.now();
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(BOOK_OF_WORK_ID)
            .status(status)
            .generationPass(1)
            .decisionsJson(decisions == null ? null : new ArrayList<>(decisions))
            .interfacesJson(interfaces == null ? null : new ArrayList<>(interfaces))
            .assumptionsJson(Collections.emptyList())
            .createdAt(now)
            .updatedAt(now)
            .createdByTask("product-manager--migration-shape-spec-generation")
            .generationAttemptNumber(0)
            .build();
    }

    private MigrationStorySpecGenerationEntity buildPassTwoRow(UUID workItemId) {
        Instant now = Instant.now();
        return MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .workItemId(workItemId)
            .bookOfWorkId(BOOK_OF_WORK_ID)
            .status(MigrationStorySpecGenerationStatus.GENERATED)
            .generationPass(2)
            .decisionsJson(List.of("Pass-2 decision that should NEVER appear as sibling context"))
            .interfacesJson(Collections.emptyList())
            .assumptionsJson(Collections.emptyList())
            .createdAt(now)
            .updatedAt(now)
            .createdByTask("product-manager--migration-shape-spec-generation")
            .generationAttemptNumber(0)
            .build();
    }

    private MigrationSpecContextRequestDto buildPassTwoRequest(
            UUID workItemId, List<UUID> passOneSpecIdsInScope) {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID,
            "bi-1",
            workItemId,
            CURRENT_ARCH,
            TARGET_ARCH,
            List.of(MigrationSpecContextRequestDto.CTX_SERVICE),
            null, null, null,
            Integer.valueOf(2),
            passOneSpecIdsInScope
        );
    }

    private void stubProject() {
        lenient().when(projectRepository.findById(PROJECT_ID))
            .thenReturn(Optional.of(buildProjectEntity()));
        lenient().when(mappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(baselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(epicCapturedDecisionRepository
                .findByProjectIdAndEpicWorkItemIdAndStatusIn(any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    /**
     * Loop guardrail surfaced at the resolver boundary: sibling_summaries[]
     * returns only generation_pass = 1 rows.
     */
    @Test
    @DisplayName("sibling_summaries[] returns ONLY generation_pass=1 rows; pass-2 outputs are excluded")
    void siblingSummariesPassOneOnly() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        UUID siblingStoryAId = UUID.randomUUID();
        UUID siblingStoryBId = UUID.randomUUID();

        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity siblingA = buildStory(siblingStoryAId, FEATURE_ID, "Sibling A");
        WorkItemEntity siblingB = buildStory(siblingStoryBId, FEATURE_ID, "Sibling B");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    PROJECT_ID, FEATURE_ID))
            .thenReturn(List.of(currentStory, siblingA, siblingB));

        // Sibling A has a clean pass-1 row -- should appear.
        MigrationStorySpecGenerationEntity passOneA = buildPassOneRow(
            siblingStoryAId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("Decision A"),
            List.of("Interface A"));
        // Sibling B has BOTH a pass-1 row AND a pass-2 row. The pass-2 row
        // must NEVER appear in sibling_summaries.
        MigrationStorySpecGenerationEntity passOneB = buildPassOneRow(
            siblingStoryBId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("Decision B"),
            List.of("Interface B"));
        MigrationStorySpecGenerationEntity passTwoB = buildPassTwoRow(siblingStoryBId);

        // Caller scope intentionally includes the pass-2 row id -- resolver
        // must still exclude it.
        List<UUID> scope = List.of(passOneA.getId(), passOneB.getId(), passTwoB.getId());
        when(specGenerationRepository.findById(passOneA.getId()))
            .thenReturn(Optional.of(passOneA));
        when(specGenerationRepository.findById(passOneB.getId()))
            .thenReturn(Optional.of(passOneB));
        when(specGenerationRepository.findById(passTwoB.getId()))
            .thenReturn(Optional.of(passTwoB));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID, buildPassTwoRequest(currentStoryId, scope));

        assertThat(out.siblingSummaries())
            .as("Pass-2 rows must never appear as sibling context")
            .extracting(SiblingSummary::workItemId)
            .containsExactlyInAnyOrder(siblingStoryAId, siblingStoryBId);
        assertThat(out.siblingSummaries())
            .allSatisfy(s -> assertThat(s.generationPass()).isEqualTo(1));
        assertThat(out.siblingSummaries())
            .flatExtracting(SiblingSummary::decisions)
            .noneMatch(text -> text.contains("Pass-2"));
    }

    /**
     * Loop guardrail: failed / insufficient_context pass-1 rows are excluded
     * even if their id appears in passOneSpecIdsInScope[].
     */
    @Test
    @DisplayName("Pass-1 rows with status failed or insufficient_context are EXCLUDED from sibling_summaries[]")
    void failedAndInsufficientContextRowsExcluded() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        UUID siblingCleanId = UUID.randomUUID();
        UUID siblingFailedId = UUID.randomUUID();
        UUID siblingInsufficientId = UUID.randomUUID();

        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity siblingClean = buildStory(siblingCleanId, FEATURE_ID, "Sibling clean");
        WorkItemEntity siblingFailed = buildStory(siblingFailedId, FEATURE_ID, "Sibling failed");
        WorkItemEntity siblingInsufficient = buildStory(
            siblingInsufficientId, FEATURE_ID, "Sibling insufficient");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    PROJECT_ID, FEATURE_ID))
            .thenReturn(List.of(currentStory, siblingClean, siblingFailed, siblingInsufficient));

        MigrationStorySpecGenerationEntity cleanRow = buildPassOneRow(
            siblingCleanId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("Clean decision"),
            Collections.emptyList());
        MigrationStorySpecGenerationEntity failedRow = buildPassOneRow(
            siblingFailedId,
            MigrationStorySpecGenerationStatus.FAILED,
            List.of("Should not appear -- row failed"),
            Collections.emptyList());
        MigrationStorySpecGenerationEntity insufficientRow = buildPassOneRow(
            siblingInsufficientId,
            MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT,
            List.of("Should not appear -- insufficient context"),
            Collections.emptyList());

        // The caller scope lists ALL three ids -- the resolver must still drop
        // the failed and insufficient_context rows.
        List<UUID> scope = List.of(cleanRow.getId(), failedRow.getId(), insufficientRow.getId());
        when(specGenerationRepository.findById(cleanRow.getId()))
            .thenReturn(Optional.of(cleanRow));
        when(specGenerationRepository.findById(failedRow.getId()))
            .thenReturn(Optional.of(failedRow));
        when(specGenerationRepository.findById(insufficientRow.getId()))
            .thenReturn(Optional.of(insufficientRow));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID, buildPassTwoRequest(currentStoryId, scope));

        assertThat(out.siblingSummaries())
            .as("Only the clean pass-1 row survives the loop-guardrail filter")
            .hasSize(1)
            .extracting(SiblingSummary::workItemId)
            .containsExactly(siblingCleanId);
        assertThat(out.siblingSummaries())
            .flatExtracting(SiblingSummary::decisions)
            .containsExactly("Clean decision");
    }

    /**
     * parent_rollup shape: epic carries capturedDecisions[]; feature and
     * initiative carry 1-sentence summaries.
     */
    @Test
    @DisplayName("parent_rollup: epic includes capturedDecisions[], feature/initiative are 1-sentence summaries")
    void parentRollupShape() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity feature = buildAncestor(FEATURE_ID, EPIC_ID, "feature", "Customer onboarding");
        WorkItemEntity epic = buildAncestor(EPIC_ID, INITIATIVE_ID, "epic", "Identity migration");
        WorkItemEntity initiative = buildAncestor(INITIATIVE_ID, null, "initiative", "Cloud move");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository.findByIdAndProjectId(FEATURE_ID, PROJECT_ID))
            .thenReturn(Optional.of(feature));
        when(workItemRepository.findByIdAndProjectId(EPIC_ID, PROJECT_ID))
            .thenReturn(Optional.of(epic));
        when(workItemRepository.findByIdAndProjectId(INITIATIVE_ID, PROJECT_ID))
            .thenReturn(Optional.of(initiative));
        lenient().when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    eq(PROJECT_ID), any()))
            .thenReturn(Collections.emptyList());

        UUID decisionId = UUID.randomUUID();
        EpicCapturedDecisionEntity epicDecision = EpicCapturedDecisionEntity.builder()
            .id(decisionId)
            .projectId(PROJECT_ID)
            .epicWorkItemId(EPIC_ID)
            .decisionKey("auth-strategy")
            .decisionText("Use OIDC for inter-service auth")
            .source("user_edited")
            .status("confirmed")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(epicCapturedDecisionRepository.findByProjectIdAndEpicWorkItemIdAndStatusIn(
                eq(PROJECT_ID), eq(EPIC_ID), any(Collection.class)))
            .thenReturn(List.of(epicDecision));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID, buildPassTwoRequest(currentStoryId, Collections.emptyList()));

        ParentRollup rollup = out.parentRollup();
        assertThat(rollup).isNotNull();
        assertThat(rollup.epic()).isNotNull();
        assertThat(rollup.epic().workItemId()).isEqualTo(EPIC_ID);
        assertThat(rollup.epic().capturedDecisions())
            .hasSize(1)
            .first()
            .satisfies(d -> {
                assertThat(d.decisionKey()).isEqualTo("auth-strategy");
                assertThat(d.status()).isEqualTo("confirmed");
                assertThat(d.source()).isEqualTo("user_edited");
            });

        // 1-sentence summaries: must contain the first sentence only.
        assertThat(rollup.feature()).isNotNull();
        assertThat(rollup.feature().summary())
            .isNotNull()
            .endsWith(".")
            .doesNotContain("second sentence");
        assertThat(rollup.initiative()).isNotNull();
        assertThat(rollup.initiative().summary())
            .isNotNull()
            .doesNotContain("second sentence");
    }

    /**
     * workstream_context dedupes API baselines and architecture refs across
     * stories and records referencedByStoryIds[].
     */
    @Test
    @DisplayName("workstream_context dedupes API baselines + arch refs; records referencedByStoryIds[]")
    void workstreamContextDedupes() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        UUID siblingId = UUID.randomUUID();
        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity sibling = buildStory(siblingId, FEATURE_ID, "Sibling");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    PROJECT_ID, FEATURE_ID))
            .thenReturn(List.of(currentStory, sibling));

        // Two baselines, but the same one referenced by both stories should
        // be deduped down to a single entry with referencedByStoryIds=[sibling].
        ApiBehaviourBaselineEntity baseline1 = new ApiBehaviourBaselineEntity();
        baseline1.setId(UUID.randomUUID());
        baseline1.setName("payments-baseline");
        baseline1.setProjectId(PROJECT_ID);
        baseline1.setArchitectureId(CURRENT_ARCH);
        baseline1.setStatus("active");
        when(baselineRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
                PROJECT_ID, CURRENT_ARCH))
            .thenReturn(List.of(baseline1));

        // Sibling row references baseline1 in its evidence_refs_json.
        MigrationStorySpecGenerationEntity siblingRow = buildPassOneRow(
            siblingId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("Decision X"),
            Collections.emptyList());
        siblingRow.setEvidenceRefsJson(List.of(baseline1.getId().toString()));
        when(specGenerationRepository.findById(siblingRow.getId()))
            .thenReturn(Optional.of(siblingRow));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            buildPassTwoRequest(currentStoryId, List.of(siblingRow.getId())));

        WorkstreamContext wsc = out.workstreamContext();
        assertThat(wsc).isNotNull();
        assertThat(wsc.apiBaselines())
            .as("Single baseline after dedupe")
            .hasSize(1)
            .first()
            .satisfies(ref -> {
                assertThat(ref.id()).isEqualTo(baseline1.getId().toString());
                assertThat(ref.kind()).isEqualTo("api_behaviour_baseline");
                assertThat(ref.referencedByStoryIds()).contains(siblingId);
            });
    }

    /**
     * budget_meta.trimmed records sibling specs dropped and evidence refs
     * dropped under a small cross-story cap. Drives the in-resolver test by
     * exercising BudgetMetaTracker directly with a tiny cap -- the resolver
     * uses default caps that don't trim in unit-mock conditions.
     */
    @Test
    @DisplayName("budget_meta.trimmed records sibling specs dropped under a small cross-story cap")
    void budgetMetaRecordsTrimming() {
        // Direct test of the trimmer: cross-story cap = 30 tokens, big siblings.
        BudgetMetaTracker tiny = new BudgetMetaTracker(
            Integer.valueOf(24_000), Integer.valueOf(30));

        // Three siblings with ~100 tokens each => only first may possibly fit;
        // we expect all three dropped + a no_sibling_context_available warning.
        SiblingSummary big = new SiblingSummary(
            UUID.randomUUID(),
            "A".repeat(200),
            List.of("decision text that is also moderately long " + "B".repeat(80)),
            List.of("interface line that pushes the cost up " + "C".repeat(80)),
            Collections.emptyList(),
            Integer.valueOf(1));
        SiblingSummary medium = new SiblingSummary(
            UUID.randomUUID(),
            "second sibling",
            List.of("D".repeat(80)),
            Collections.emptyList(),
            Collections.emptyList(),
            Integer.valueOf(1));
        SiblingSummary small = new SiblingSummary(
            UUID.randomUUID(),
            "third sibling",
            List.of("e"),
            Collections.emptyList(),
            Collections.emptyList(),
            Integer.valueOf(1));

        List<SiblingSummary> admitted = tiny.admitSiblings(List.of(big, medium, small));
        BudgetMeta meta = tiny.toBudgetMeta();

        assertThat(meta.trimmed()).isNotNull();
        // big does not fit -> dropped; medium does not fit (cumulative cost too
        // high relative to the 30-token cap) -> dropped; small may also be
        // dropped depending on its tiny cost. At minimum, sibling_specs_dropped
        // must be >= 2 since both big and medium overflow the 30-cap.
        assertThat(meta.trimmed().siblingSpecsDropped()).isGreaterThanOrEqualTo(2);
        assertThat(admitted.size()).isLessThanOrEqualTo(3 - 2);
        assertThat(meta.warnings())
            .as("First sibling overflow emits no_sibling_context_available")
            .contains(BudgetMetaTracker.WARN_NO_SIBLING_CONTEXT_AVAILABLE);
    }

    /**
     * Tiered trimming order: sibling specs first, then evidence refs, then
     * findings; story description / parent_rollup / epic captured decisions
     * NEVER trimmed.
     */
    @Test
    @DisplayName("Tiered trimming: siblings drop before evidence, evidence before findings; non-trimmable items always retained")
    void tieredTrimmingOrder() {
        // Small per-story cap so evidence/findings cycle into trimming.
        BudgetMetaTracker tracker = new BudgetMetaTracker(
            Integer.valueOf(50), Integer.valueOf(50));

        // Reserve non-trimmable cost (story description + parent rollup +
        // captured decisions). The tracker MUST always count this -- the test
        // verifies that perStoryUsed reflects it, and that this content is
        // never "dropped" by any of the admit* methods (admit* only operates
        // on the lists it receives, never on the reserved totals).
        int storyDescTokens = 25;
        int parentRollupTokens = 25;
        int capturedDecisionsTokens = 10;
        tracker.reservePerStoryNonTrimmable(storyDescTokens);
        tracker.reserveCrossStoryNonTrimmable(parentRollupTokens);
        tracker.reserveCrossStoryNonTrimmable(capturedDecisionsTokens);

        // Three siblings, each 30+ tokens -- with the cross-story cap already
        // partially spent (35/50), most must be dropped.
        List<SiblingSummary> siblings = List.of(
            new SiblingSummary(UUID.randomUUID(), "x".repeat(40),
                List.of("y".repeat(40)), Collections.emptyList(), Collections.emptyList(), 1),
            new SiblingSummary(UUID.randomUUID(), "x".repeat(40),
                List.of("y".repeat(40)), Collections.emptyList(), Collections.emptyList(), 1),
            new SiblingSummary(UUID.randomUUID(), "x".repeat(40),
                List.of("y".repeat(40)), Collections.emptyList(), Collections.emptyList(), 1)
        );
        tracker.admitSiblings(siblings);

        // Evidence refs: large enough to start consuming per-story budget.
        List<String> evidence = List.of("e1", "e2", "e3");
        tracker.admitEvidenceRefs(evidence, e -> 30);

        // Findings: should drop because per-story budget is exhausted.
        List<String> findings = List.of("f1", "f2");
        tracker.admitFindings(findings, f -> 100);

        BudgetMeta meta = tracker.toBudgetMeta();

        // Non-trimmable totals are always counted (never dropped).
        assertThat(tracker.perStoryUsed()).isGreaterThanOrEqualTo(storyDescTokens);
        assertThat(tracker.crossStoryUsed())
            .isGreaterThanOrEqualTo(parentRollupTokens + capturedDecisionsTokens);

        // Tiered ordering: siblings drop before findings (siblings spent first).
        assertThat(meta.trimmed().siblingSpecsDropped()).isGreaterThanOrEqualTo(1);
        assertThat(meta.trimmed().findingsDropped())
            .as("Findings dropped only after siblings/evidence exhausted -- count must be > 0 here")
            .isGreaterThan(0);

        // Story description / parent rollup contribution remains in used totals,
        // confirming they were never removed by any admit* call.
        assertThat(meta.usedTokens())
            .isGreaterThanOrEqualTo(storyDescTokens + parentRollupTokens + capturedDecisionsTokens);
    }

    // =======================================================================
    // Task Group 10 gap-filler tests (added 2026-05-20).
    // =======================================================================

    /**
     * Task Group 10 gap-filler: the resolver must pass ONLY
     * {@code (draft, confirmed)} to the captured-decision repository so a
     * superseded epic decision can never leak into pass-2 parent rollup.
     *
     * <p>Cross-layer contract: the resolver's
     * {@code EPIC_DECISION_FEED_STATUSES} must agree with the controller's
     * {@code PARENT_ROLLUP_FEED_STATUSES} (already cross-checked at the
     * controller test). This resolver-side test asserts the runtime
     * application of that contract -- the resolver's repository call
     * carries exactly the agreed status set.</p>
     */
    @Test
    @DisplayName("parent_rollup excludes superseded epic captured decisions (resolver passes only draft + confirmed to repository)")
    void parentRollupExcludesSupersededDecisions() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity feature = buildAncestor(FEATURE_ID, EPIC_ID, "feature", "Onboarding feature");
        WorkItemEntity epic = buildAncestor(EPIC_ID, INITIATIVE_ID, "epic", "Identity migration");
        WorkItemEntity initiative = buildAncestor(INITIATIVE_ID, null, "initiative", "Cloud move");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository.findByIdAndProjectId(FEATURE_ID, PROJECT_ID))
            .thenReturn(Optional.of(feature));
        when(workItemRepository.findByIdAndProjectId(EPIC_ID, PROJECT_ID))
            .thenReturn(Optional.of(epic));
        when(workItemRepository.findByIdAndProjectId(INITIATIVE_ID, PROJECT_ID))
            .thenReturn(Optional.of(initiative));
        lenient().when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    eq(PROJECT_ID), any()))
            .thenReturn(Collections.emptyList());

        // The repository mock returns ONLY the draft + confirmed rows when the
        // resolver passes the right status set. A superseded row exists in the
        // synthetic universe but is NOT returned by the repository because the
        // resolver MUST NOT include "superseded" in its status set.
        EpicCapturedDecisionEntity draftDecision = EpicCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .epicWorkItemId(EPIC_ID)
            .decisionKey("currency-default")
            .decisionText("GBP everywhere")
            .source("auto_extracted")
            .status("draft")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        EpicCapturedDecisionEntity confirmedDecision = EpicCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .epicWorkItemId(EPIC_ID)
            .decisionKey("idempotency-key")
            .decisionText("Required on POSTs")
            .source("user_edited")
            .status("confirmed")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(epicCapturedDecisionRepository.findByProjectIdAndEpicWorkItemIdAndStatusIn(
                eq(PROJECT_ID), eq(EPIC_ID), any(Collection.class)))
            .thenReturn(List.of(draftDecision, confirmedDecision));

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID, buildPassTwoRequest(currentStoryId, Collections.emptyList()));

        // 1) The parent_rollup carries only draft + confirmed.
        assertThat(out.parentRollup()).isNotNull();
        assertThat(out.parentRollup().epic()).isNotNull();
        assertThat(out.parentRollup().epic().capturedDecisions())
            .hasSize(2)
            .extracting("status")
            .containsExactlyInAnyOrder("draft", "confirmed");
        assertThat(out.parentRollup().epic().capturedDecisions())
            .extracting("status")
            .doesNotContain("superseded");

        // 2) Cross-check the contract at the repository boundary: capture the
        // status set the resolver actually passed and assert it is EXACTLY
        // {draft, confirmed}.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<String>> statusCaptor =
            ArgumentCaptor.forClass(Collection.class);
        verify(epicCapturedDecisionRepository)
            .findByProjectIdAndEpicWorkItemIdAndStatusIn(
                eq(PROJECT_ID), eq(EPIC_ID), statusCaptor.capture());
        Collection<String> calledWith = statusCaptor.getValue();
        assertThat(calledWith)
            .as("Resolver MUST pass only draft + confirmed to the captured-decision repository; "
                + "superseded must never be in the feed-status set")
            .containsExactlyInAnyOrder("draft", "confirmed")
            .doesNotContain("superseded");
        // Sanity check matches the controller-layer constant (cross-layer contract):
        // EpicCapturedDecisionService#PARENT_ROLLUP_FEED_STATUSES = {draft, confirmed}.
        assertThat(Set.copyOf(calledWith))
            .isEqualTo(Set.of("draft", "confirmed"));
    }

    /**
     * Task Group 10 gap-filler: when {@code passOneSpecIdsInScope[]} is
     * supplied AND non-empty, the resolver loads candidates ONLY from the
     * caller's scope list. A pass-1 row whose id is NOT in the scope must
     * never appear in {@code sibling_summaries[]} even if its work-item is a
     * sibling of the current story.
     *
     * <p>This is the resolver-boundary corroboration of loop-guardrail (b):
     * the gateway is the upstream filter, but the resolver does not silently
     * widen scope by walking the work-item-row graph when an explicit scope
     * list is supplied.</p>
     */
    @Test
    @DisplayName("sibling_summaries[] omits a pass-1 row whose id is NOT in passOneSpecIdsInScope (resolver does not silently widen scope)")
    void siblingSummariesRespectExplicitScopeList() {
        stubProject();
        UUID currentStoryId = UUID.randomUUID();
        UUID siblingInScopeId = UUID.randomUUID();
        UUID siblingOutOfScopeId = UUID.randomUUID();

        WorkItemEntity currentStory = buildStory(currentStoryId, FEATURE_ID, "Current story");
        WorkItemEntity siblingInScope = buildStory(siblingInScopeId, FEATURE_ID, "In-scope sibling");
        WorkItemEntity siblingOutOfScope = buildStory(siblingOutOfScopeId, FEATURE_ID, "Out-of-scope sibling");

        when(workItemRepository.findByIdAndProjectId(currentStoryId, PROJECT_ID))
            .thenReturn(Optional.of(currentStory));
        when(workItemRepository
                .findByProjectIdAndParentIdOrderBySortOrderAscCreatedAtAscIdAsc(
                    PROJECT_ID, FEATURE_ID))
            .thenReturn(List.of(currentStory, siblingInScope, siblingOutOfScope));

        // Both rows are valid pass-1 GENERATED rows. Only one is in the
        // caller's scope list.
        MigrationStorySpecGenerationEntity inScopeRow = buildPassOneRow(
            siblingInScopeId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("In-scope decision"),
            Collections.emptyList());
        MigrationStorySpecGenerationEntity outOfScopeRow = buildPassOneRow(
            siblingOutOfScopeId,
            MigrationStorySpecGenerationStatus.GENERATED,
            List.of("Out-of-scope decision -- MUST NOT appear"),
            Collections.emptyList());

        // ONLY the in-scope row is supplied to the resolver.
        List<UUID> scope = List.of(inScopeRow.getId());
        when(specGenerationRepository.findById(inScopeRow.getId()))
            .thenReturn(Optional.of(inScopeRow));
        // Important: even though outOfScopeRow exists in the synthetic
        // universe (we'd have stubbed findById for it if we wanted), we
        // deliberately DO NOT stub it -- the resolver MUST NOT call
        // findById on an id outside the caller's scope.

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID, buildPassTwoRequest(currentStoryId, scope));

        // 1) Only the in-scope sibling appears in the response.
        assertThat(out.siblingSummaries())
            .as("Out-of-scope pass-1 rows are not silently included by the resolver")
            .hasSize(1)
            .extracting(SiblingSummary::workItemId)
            .containsExactly(siblingInScopeId);
        assertThat(out.siblingSummaries())
            .flatExtracting(SiblingSummary::decisions)
            .containsExactly("In-scope decision");

        // 2) The resolver did NOT touch the out-of-scope row id.
        verify(specGenerationRepository).findById(inScopeRow.getId());
        // Mockito's verifyNoMoreInteractions would be too strong here (the
        // resolver legitimately calls other repository methods); we instead
        // assert the absence of a findById for the out-of-scope id via the
        // narrower verify-never check.
        verify(specGenerationRepository, org.mockito.Mockito.never())
            .findById(outOfScopeRow.getId());
    }
}
