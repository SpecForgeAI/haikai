package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.dto.migration.MigrationGapCodes;
import com.example.architecturemodel.model.dto.migration.ReadinessAssessmentDto;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
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
 * Service-level tests for {@link MigrationDiscoveryContextService}.
 *
 * <p>Uses Mockito to wire repository mocks directly (no Spring context) --
 * mirrors the standalone-JUnit pattern used by the pre-existing
 * {@code DiscoverySummaryServiceTest} and
 * {@code DiscoveryFindingStatusTransitionTest}, which is the AMS-recommended
 * approach when the broader Spring-test compile chain has unrelated failures
 * (per CLAUDE.md memory + prior specs in this area).</p>
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task
 * Group 1.1. 12 focused tests covering the critical behaviours listed in the
 * task brief.</p>
 *
 * <p>Spec: Capture Coverage Gates (2026-05-30) -- the coverage-gate
 * collaborators are wired as {@code null} here (this class predates them and
 * exercises only the non-coverage build path; coverage computation has its own
 * focused tests in {@code MigrationCaptureCoverageReadinessTest}). The service
 * tolerates {@code null} coverage collaborators and simply skips those
 * dimensions, exactly as it already tolerates a {@code null}
 * {@code MetaModelSummaryService}.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDiscoveryContextServiceTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID TARGET_ARCH_ID = UUID.randomUUID();

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

    @BeforeEach
    void setUp() {
        // Pass a null MetaModelSummaryService -- the service tolerates this and
        // surfaces zero-count architecture summaries with hasModel == false.
        //
        // The eight coverage-gate collaborators (Spec: Capture Coverage Gates,
        // 2026-05-30) are likewise passed null: this pre-existing suite covers
        // the non-coverage build path only, and the service skips a coverage
        // dimension whose collaborator is absent (no gap code emitted).
        service = new MigrationDiscoveryContextService(
            projectRepository,
            architectureRepository,
            discoveryRunRepository,
            discoveryFindingRepository,
            discoveryFindingLinkRepository,
            discoveryCandidateRepository,
            discoveryEvidenceRepository,
            discoveryDecisionTaskRepository,
            apiBehaviourBaselineRepository,
            architectureElementMappingRepository,
            null, // ApiBehaviourOperationRepository  (coverage A/C)
            null, // ApiBehaviourCaptureRepository    (coverage A)
            null, // ApiBehaviourDiffRepository       (coverage A, informational)
            null, // ApiBehaviourDiffItemRepository   (coverage A, informational)
            null, // ModelFileRepository              (coverage B/C)
            null, // EndpointRepository               (coverage B/C)
            null, // EndpointDataEffectRepository     (coverage B REST bar)
            null, // InterfaceLogicalEntityRepository (coverage B SOAP bar)
            null,
            null /* TargetStateCapturedDecisionService -- tested in MigrationDiscoveryContextAggregationTest */,
            null, // DbMigrationPackRepository            (Spec 2026-07-02-a)
            null, // DbMigrationPackDecisionRepository    (Spec 2026-07-02-a)
            null  // DbMigrationPackTranslationRepository (Spec 2026-07-02-a)
        );
    }

    // -----------------------------------------------------------------------
    // Test 1: current-architecture-only request returns a context
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: builds context with current architecture only")
    void buildsContextWithCurrentArchitectureOnly() {
        stubProjectAndArchs(true, false);
        stubLatestRuns(Collections.emptyList());
        stubBaselines(Collections.emptyList());

        MigrationDiscoveryContextRequestDto request = newRequest(CURRENT_ARCH_ID, null);
        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, request);

        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.currentArchitectureId()).isEqualTo(CURRENT_ARCH_ID);
        assertThat(result.targetArchitectureId()).isNull();
        assertThat(result.currentArchitectureSummary()).isNotNull();
        assertThat(result.targetArchitectureSummary()).isNull();
        assertThat(result.readinessAssessment()).isNotNull();
    }

    // -----------------------------------------------------------------------
    // Test 2: current + target both summarised
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: builds context with current + target architectures")
    void buildsContextWithCurrentAndTarget() {
        stubProjectAndArchs(true, true);
        stubLatestRuns(Collections.emptyList());
        stubBaselines(Collections.emptyList());
        when(architectureElementMappingRepository
            .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                PROJECT_ID, CURRENT_ARCH_ID, TARGET_ARCH_ID))
            .thenReturn(Collections.emptyList());

        MigrationDiscoveryContextRequestDto request = newRequest(CURRENT_ARCH_ID, TARGET_ARCH_ID);
        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, request);

        assertThat(result.targetArchitectureId()).isEqualTo(TARGET_ARCH_ID);
        assertThat(result.targetArchitectureSummary()).isNotNull();
        assertThat(result.targetArchitectureSummary().architectureId()).isEqualTo(TARGET_ARCH_ID);
    }

    // -----------------------------------------------------------------------
    // Test 3: prioritisation order applies (critical+high first; then pending_review/deferred; then category)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: findings prioritised by severity > status > category before truncation")
    void prioritisesHighSeverityAndNeedsReview() {
        DiscoveryFindingEntity criticalNeedsReview =
            finding("critical", "deferred", "migration_risk", Instant.now().minusSeconds(10));
        DiscoveryFindingEntity highAccepted =
            finding("high", "approved", "migration_risk", Instant.now().minusSeconds(20));
        DiscoveryFindingEntity mediumNew =
            finding("medium", "pending_review", "data_quality", Instant.now().minusSeconds(30));
        DiscoveryFindingEntity lowAccepted =
            finding("low", "approved", "sample_data", Instant.now().minusSeconds(40));

        List<DiscoveryFindingEntity> all = List.of(lowAccepted, mediumNew, highAccepted, criticalNeedsReview);
        List<DiscoveryFindingEntity> sorted =
            MigrationDiscoveryContextService.prioritiseAndCapForTest(all, 10);

        assertThat(sorted).extracting(DiscoveryFindingEntity::getSeverity)
            .containsExactly("critical", "high", "medium", "low");
    }

    // -----------------------------------------------------------------------
    // Test 4: maxFindings truncation applied AFTER priority sort
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 4: maxFindings cap applies after priority sort")
    void appliesMaxFindingsLimitAfterPrioritisation() {
        DiscoveryFindingEntity critical =
            finding("critical", "deferred", "migration_risk", Instant.now());
        DiscoveryFindingEntity high =
            finding("high", "approved", "migration_risk", Instant.now());
        DiscoveryFindingEntity medium =
            finding("medium", "pending_review", "data_quality", Instant.now());

        List<DiscoveryFindingEntity> all = List.of(medium, high, critical);
        List<DiscoveryFindingEntity> capped =
            MigrationDiscoveryContextService.prioritiseAndCapForTest(all, 2);

        assertThat(capped).hasSize(2);
        assertThat(capped).extracting(DiscoveryFindingEntity::getSeverity)
            .containsExactly("critical", "high");
    }

    // -----------------------------------------------------------------------
    // Test 5: linked evidence is loaded for high-priority findings (capped)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 5: includes linked evidence highlights with maxEvidenceItems cap")
    void includesEvidenceHighlightsForFindings() {
        stubProjectAndArchs(true, false);
        UUID runId = UUID.randomUUID();
        DiscoveryRunEntity run = buildRun(runId, CURRENT_ARCH_ID, "COMPLETED");
        stubLatestRuns(List.of(run));
        stubBaselines(Collections.emptyList());

        UUID findingId = UUID.randomUUID();
        DiscoveryFindingEntity f = finding("critical", "deferred", "migration_risk", Instant.now());
        f.setId(findingId);
        f.setRunId(runId);
        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(runId, PROJECT_ID, CURRENT_ARCH_ID, "rejected"))
            .thenReturn(List.of(f));

        UUID evidenceId1 = UUID.randomUUID();
        UUID evidenceId2 = UUID.randomUUID();
        DiscoveryFindingLinkEntity link1 = buildEvidenceLink(findingId, evidenceId1);
        DiscoveryFindingLinkEntity link2 = buildEvidenceLink(findingId, evidenceId2);
        when(discoveryFindingLinkRepository.findByFindingId(findingId))
            .thenReturn(List.of(link1, link2));

        DiscoveryEvidenceEntity e1 = buildEvidence(evidenceId1, runId, "symbol", "src/Service.java");
        DiscoveryEvidenceEntity e2 = buildEvidence(evidenceId2, runId, "string_pattern", "src/Other.java");
        when(discoveryEvidenceRepository.findById(evidenceId1)).thenReturn(Optional.of(e1));
        lenient().when(discoveryEvidenceRepository.findById(evidenceId2)).thenReturn(Optional.of(e2));

        MigrationDiscoveryContextRequestDto request = new MigrationDiscoveryContextRequestDto(
            CURRENT_ARCH_ID, null, null, null,
            true, true, true, true, true,
            100, 1 /* cap evidence at 1 */, null);

        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, request);

        assertThat(result.evidenceHighlights()).hasSize(1);
        assertThat(result.evidenceHighlights().get(0).evidenceId()).isEqualTo(evidenceId1);
        assertThat(result.evidenceHighlights().get(0).linkedFindingIds()).containsExactly(findingId);
    }

    // -----------------------------------------------------------------------
    // Test 6: unresolved decision tasks surfaced; resolved ones filtered out
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 6: includes only unresolved decision tasks (pending / needs_review)")
    void includesUnresolvedDecisionTasksOnly() {
        stubProjectAndArchs(true, false);
        UUID runId = UUID.randomUUID();
        stubLatestRuns(List.of(buildRun(runId, CURRENT_ARCH_ID, "COMPLETED")));
        stubBaselines(Collections.emptyList());
        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(runId, PROJECT_ID, CURRENT_ARCH_ID, "rejected"))
            .thenReturn(Collections.emptyList());

        DiscoveryDecisionTaskEntity pending = buildDecisionTask(runId, "confirm_relationship", "pending");
        DiscoveryDecisionTaskEntity needsReview = buildDecisionTask(runId, "resolve_competing_relationships", "needs_review");
        DiscoveryDecisionTaskEntity resolved = buildDecisionTask(runId, "confirm_relationship", "resolved");
        when(discoveryDecisionTaskRepository.findByRunId(runId))
            .thenReturn(List.of(pending, needsReview, resolved));

        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));

        assertThat(result.unresolvedDecisionTasks()).hasSize(2);
        assertThat(result.unresolvedDecisionTasks())
            .extracting(MigrationDiscoveryContextDto.DecisionTaskHighlight::status)
            .containsExactlyInAnyOrder("pending", "needs_review");
    }

    // -----------------------------------------------------------------------
    // Test 7: db_discovery_pack source findings surfaced via databaseDiscoverySummary
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 7: counts db_discovery_pack findings into databaseDiscoverySummary")
    void countsDatabaseDiscoveryFindings() {
        stubProjectAndArchs(true, false);
        UUID runId = UUID.randomUUID();
        stubLatestRuns(List.of(buildRun(runId, CURRENT_ARCH_ID, "COMPLETED")));
        stubBaselines(Collections.emptyList());

        DiscoveryFindingEntity dbPg = finding("medium", "pending_review", "data_quality", Instant.now());
        dbPg.setSource("db_discovery_pack");
        // Real DB profiler sample-data hint shape: findingType='sample_data_hint',
        // category='data_quality', source='db_discovery_pack' (discovery-service
        // postgres/sybase *Findings.ts). It is the findingType -- NOT a
        // 'sample_data' category -- that the summary counts.
        DiscoveryFindingEntity dbSybase = finding("low", "pending_review", "data_quality", Instant.now());
        dbSybase.setSource("db_discovery_pack");
        dbSybase.setFindingType("sample_data_hint");
        DiscoveryFindingEntity codePack = finding("low", "pending_review", "business_logic", Instant.now());
        codePack.setSource("java-spring-pack");

        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(runId, PROJECT_ID, CURRENT_ARCH_ID, "rejected"))
            .thenReturn(List.of(dbPg, dbSybase, codePack));

        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));

        assertThat(result.databaseDiscoverySummary()).isNotNull();
        assertThat(result.databaseDiscoverySummary().databaseFindingCount()).isEqualTo(2);
        assertThat(result.databaseDiscoverySummary().sampleDataHintCount()).isEqualTo(1);
        assertThat(result.databaseDiscoverySummary().hasDatabaseDiscovery()).isTrue();
    }

    // -----------------------------------------------------------------------
    // Test 7b: a real sample_data_hint finding clears the no_sample_data_hints gap
    // Regression guard: the counter must key off findingType, NOT a phantom
    // 'sample_data' category. The DB discovery profiler emits
    // findingType='sample_data_hint', category='data_quality',
    // source='db_discovery_pack' -- so this is the exact shape that was
    // previously uncounted, leaving the migration plan stuck on "No sample data
    // hints" even after a deep DB scan.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 7b: a sample_data_hint finding counts and clears the NO_SAMPLE_DATA_HINTS gap")
    void sampleDataHintFindingClearsGap() {
        stubProjectAndArchs(true, false);
        UUID runId = UUID.randomUUID();
        stubLatestRuns(List.of(buildRun(runId, CURRENT_ARCH_ID, "COMPLETED")));
        stubBaselines(Collections.emptyList());

        DiscoveryFindingEntity sampleHint =
            finding("info", "pending_review", "data_quality", Instant.now());
        sampleHint.setFindingType("sample_data_hint");
        sampleHint.setSource("db_discovery_pack");

        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(runId, PROJECT_ID, CURRENT_ARCH_ID, "rejected"))
            .thenReturn(List.of(sampleHint));

        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));

        assertThat(result.databaseDiscoverySummary().sampleDataHintCount()).isEqualTo(1);
        assertThat(result.readinessAssessment().gaps())
            .doesNotContain(MigrationGapCodes.NO_SAMPLE_DATA_HINTS);
    }

    // -----------------------------------------------------------------------
    // Test 8: API Behaviour Baseline summary populated from repo
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 8: apiBehaviourBaselineSummary counts active vs draft and exposes durable IDs")
    void includesApiBehaviourBaselineSummary() {
        stubProjectAndArchs(true, false);
        stubLatestRuns(Collections.emptyList());

        UUID b1 = UUID.randomUUID();
        UUID b2 = UUID.randomUUID();
        UUID b3 = UUID.randomUUID();
        ApiBehaviourBaselineEntity active = buildBaseline(b1, "active");
        ApiBehaviourBaselineEntity draft1 = buildBaseline(b2, "draft");
        ApiBehaviourBaselineEntity draft2 = buildBaseline(b3, "draft");
        when(apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(List.of(active, draft1, draft2));

        MigrationDiscoveryContextDto result = service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));

        assertThat(result.apiBehaviourBaselineSummary().totalBaselines()).isEqualTo(3);
        assertThat(result.apiBehaviourBaselineSummary().activeBaselineCount()).isEqualTo(1);
        assertThat(result.apiBehaviourBaselineSummary().draftBaselineCount()).isEqualTo(2);
        assertThat(result.apiBehaviourBaselineSummary().baselines())
            .extracting(MigrationDiscoveryContextDto.BaselineHighlight::baselineId)
            .containsExactlyInAnyOrder(b1, b2, b3);
    }

    // -----------------------------------------------------------------------
    // Test 9: ArchitectureElementMapping summary with type rollups
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 9: architectureMappingsSummary groups by source/target/mapping type")
    void includesArchitectureMappingSummary() {
        stubProjectAndArchs(true, true);
        stubLatestRuns(Collections.emptyList());
        stubBaselines(Collections.emptyList());

        ArchitectureElementMappingEntity m1 = mapping("Service", "Service", "equivalent");
        ArchitectureElementMappingEntity m2 = mapping("Service", "Service", "renamed");
        ArchitectureElementMappingEntity m3 = mapping("Interface", "Service", "replaced_by");
        when(architectureElementMappingRepository
            .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                PROJECT_ID, CURRENT_ARCH_ID, TARGET_ARCH_ID))
            .thenReturn(List.of(m1, m2, m3));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, TARGET_ARCH_ID));

        assertThat(result.architectureMappingsSummary().totalMappings()).isEqualTo(3);
        assertThat(result.architectureMappingsSummary().countsBySourceType())
            .containsEntry("service", 2)
            .containsEntry("interface", 1);
        assertThat(result.architectureMappingsSummary().countsByMappingType())
            .containsEntry("equivalent", 1)
            .containsEntry("renamed", 1)
            .containsEntry("replaced_by", 1);
    }

    // -----------------------------------------------------------------------
    // Test 10: readiness assessment emits expected gap codes when inputs missing
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 10: readiness emits expected gaps when inputs are missing")
    void readinessEmitsGapsForMissingInputs() {
        stubProjectAndArchs(true, false);
        // No runs, no baselines, no mappings, no findings, no decision tasks.
        stubLatestRuns(Collections.emptyList());
        stubBaselines(Collections.emptyList());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));
        ReadinessAssessmentDto readiness = result.readinessAssessment();

        assertThat(readiness.overallStatus()).isEqualTo(MigrationGapCodes.STATUS_INSUFFICIENT);
        assertThat(readiness.discoveryReadiness()).isEqualTo(MigrationGapCodes.STATUS_INSUFFICIENT);
        assertThat(readiness.mappingReadiness()).isEqualTo(MigrationGapCodes.STATUS_INSUFFICIENT);
        assertThat(readiness.baselineReadiness()).isEqualTo(MigrationGapCodes.STATUS_INSUFFICIENT);
        assertThat(readiness.gaps()).contains(
            MigrationGapCodes.MISSING_CURRENT_TO_TARGET_MAPPINGS,
            MigrationGapCodes.INSUFFICIENT_RUNTIME_EVIDENCE,
            MigrationGapCodes.NO_SAMPLE_DATA_HINTS
        );
    }

    // -----------------------------------------------------------------------
    // Test 11: project/architecture mismatch is rejected
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 11: rejects architecture that does not belong to the project (404)")
    void rejectsArchitectureNotInProject() {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        // Architecture exists but belongs to a different project.
        ArchitectureEntity foreign = ArchitectureEntity.builder()
            .id(CURRENT_ARCH_ID)
            .projectId(UUID.randomUUID()) // different project
            .name("foreign")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findById(CURRENT_ARCH_ID)).thenReturn(Optional.of(foreign));

        assertThatThrownBy(() ->
                service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null)))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("does not belong to project");
    }

    // -----------------------------------------------------------------------
    // Test 12: latest-completed-run resolution when discoveryRunIds omitted
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 12: resolves latest COMPLETED runs when discoveryRunIds is omitted")
    void resolvesLatestCompletedRunsWhenRunIdsOmitted() {
        stubProjectAndArchs(true, false);
        stubBaselines(Collections.emptyList());

        UUID runOldId = UUID.randomUUID();
        UUID runNewCompletedId = UUID.randomUUID();
        UUID runRunningId = UUID.randomUUID();

        DiscoveryRunEntity runOld = buildRun(runOldId, CURRENT_ARCH_ID, "COMPLETED");
        runOld.setCreatedAt(Instant.now().minusSeconds(7200));
        DiscoveryRunEntity runRunning = buildRun(runRunningId, CURRENT_ARCH_ID, "RUNNING");
        runRunning.setCreatedAt(Instant.now().minusSeconds(60));
        DiscoveryRunEntity runNewCompleted = buildRun(runNewCompletedId, CURRENT_ARCH_ID, "COMPLETED");
        runNewCompleted.setCreatedAt(Instant.now());

        // Repository returns newest-first (matches the repo method name).
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(List.of(runNewCompleted, runRunning, runOld));

        lenient().when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(any(), any(), any(), any()))
            .thenReturn(Collections.emptyList());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null));

        // RUNNING run is filtered out; both completed runs are selected, newest first.
        assertThat(result.discoveryRunIds()).containsExactly(runNewCompletedId, runOldId);
        assertThat(result.discoveryRunsSummary().completedRuns()).isEqualTo(2);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void stubProjectAndArchs(boolean current, boolean target) {
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        if (current) {
            when(architectureRepository.findById(CURRENT_ARCH_ID))
                .thenReturn(Optional.of(architecture(CURRENT_ARCH_ID, "Current")));
        }
        if (target) {
            when(architectureRepository.findById(TARGET_ARCH_ID))
                .thenReturn(Optional.of(architecture(TARGET_ARCH_ID, "Target")));
        }
    }

    private void stubLatestRuns(List<DiscoveryRunEntity> runs) {
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(runs);
        // Unused when there are no runs; lenient prevents UnnecessaryStubbing.
        lenient().when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(any(), any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryCandidateRepository.findByRunIdAndReviewStatusNot(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryEvidenceRepository.findByRunId(any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryDecisionTaskRepository.findByRunId(any()))
            .thenReturn(Collections.emptyList());
    }

    private void stubBaselines(List<ApiBehaviourBaselineEntity> baselines) {
        when(apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(baselines);
    }

    private static MigrationDiscoveryContextRequestDto newRequest(UUID current, UUID target) {
        return new MigrationDiscoveryContextRequestDto(
            current, target, null, null,
            null, null, null, null, null,
            null, null, null);
    }

    private static ArchitectureEntity architecture(UUID id, String name) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .name(name)
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private static DiscoveryRunEntity buildRun(UUID id, UUID architectureId, String status) {
        DiscoveryRunEntity r = DiscoveryRunEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .architectureId(architectureId)
            .status(status)
            .discoveryKind("code")
            .build();
        r.setCreatedAt(Instant.now());
        r.setUpdatedAt(Instant.now());
        return r;
    }

    private static DiscoveryFindingEntity finding(
            String severity, String status, String category, Instant createdAt) {
        DiscoveryFindingEntity f = DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .findingType("low_confidence_candidate")
            .category(category)
            .severity(severity)
            .reviewStatus(status)
            .title("Test finding")
            .build();
        f.setCreatedAt(createdAt);
        f.setUpdatedAt(createdAt);
        return f;
    }

    private static DiscoveryFindingLinkEntity buildEvidenceLink(UUID findingId, UUID evidenceId) {
        return DiscoveryFindingLinkEntity.builder()
            .id(UUID.randomUUID())
            .findingId(findingId)
            .linkType("evidence")
            .targetType("discovery_evidence")
            .targetId(evidenceId.toString())
            .build();
    }

    private static DiscoveryEvidenceEntity buildEvidence(
            UUID id, UUID runId, String type, String filePath) {
        DiscoveryEvidenceEntity e = DiscoveryEvidenceEntity.builder()
            .id(id)
            .runId(runId)
            .repoUrl("https://example.com/repo")
            .filePath(filePath)
            .type(type)
            .data(new java.util.HashMap<>())
            .extractedAt(Instant.now())
            .source("code")
            .build();
        return e;
    }

    private static DiscoveryDecisionTaskEntity buildDecisionTask(
            UUID runId, String taskType, String status) {
        return DiscoveryDecisionTaskEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .taskType(taskType)
            .status(status)
            .inputData(new java.util.HashMap<>())
            .createdAt(Instant.now())
            .build();
    }

    private static ApiBehaviourBaselineEntity buildBaseline(UUID id, String status) {
        return ApiBehaviourBaselineEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .sessionId(UUID.randomUUID())
            .name("Baseline " + status)
            .status(status)
            .acceptedCaptureCount(0)
            .operationCount(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private static ArchitectureElementMappingEntity mapping(
            String sourceType, String targetType, String mappingType) {
        return ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .sourceArchitectureId(CURRENT_ARCH_ID)
            .targetArchitectureId(TARGET_ARCH_ID)
            .sourceElementType(sourceType)
            .sourceElementId(UUID.randomUUID().toString())
            .targetElementType(targetType)
            .targetElementId(UUID.randomUUID().toString())
            .mappingType(mappingType)
            .status("active")
            .createdByTask("test")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
