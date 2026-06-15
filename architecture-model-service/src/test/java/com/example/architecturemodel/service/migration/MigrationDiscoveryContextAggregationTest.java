package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.dto.targetstate.TargetStateDecisionsSummaryDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
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
import com.example.architecturemodel.service.TargetStateCapturedDecisionService;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the {@code targetStateDecisionsSummary} block on
 * {@link MigrationDiscoveryContextDto}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 4.1.</p>
 *
 * <p>Kept in a separate test class from {@link MigrationDiscoveryContextServiceTest}
 * so the existing 12-test suite stays focused on the pre-Spec-4 behaviours; the
 * new aggregation block has its own focused 4-test contract here:</p>
 * <ol>
 *   <li><b>Test 1 (empty default):</b> project with an active target architecture
 *       but zero captured decisions -- the new block returns the canonical
 *       {@code TargetStateDecisionsSummaryDto.empty()} shape (empty lists,
 *       count=0, lastDecisionAt=null).</li>
 *   <li><b>Test 2 (populated):</b> mix of architecture-wide and service-scoped
 *       decisions -- the new block partitions correctly, counts everything, and
 *       sets {@code lastDecisionAt} to the max createdAt.</li>
 *   <li><b>Test 3 (regression guard):</b> existing fields on the DTO are
 *       byte-identical for a project with no decisions (the spec contract is
 *       "additive change only").</li>
 *   <li><b>Test 4 (suppression flag):</b> request body
 *       {@code includeTargetStateDecisions=false} suppresses the captured-
 *       decisions service call entirely and returns the empty default block,
 *       preserving the consistent shape contract.</li>
 * </ol>
 *
 * <p>Mockito wires repositories + the new
 * {@link TargetStateCapturedDecisionService} directly; no Spring context is
 * needed (mirrors the standalone-JUnit pattern used by
 * {@link MigrationDiscoveryContextServiceTest}).</p>
 *
 * <p>Spec: Capture Coverage Gates (2026-05-30) -- the eight coverage-gate
 * collaborators are wired {@code null} here (this suite exercises only the
 * target-state-decisions block); the service skips coverage dimensions whose
 * collaborators are absent.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDiscoveryContextAggregationTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID ACTIVE_TARGET_ARCH_ID = UUID.randomUUID();

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
    @Mock private TargetStateCapturedDecisionService targetStateCapturedDecisionService;

    private MigrationDiscoveryContextService service;

    @BeforeEach
    void setUp() {
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
            null /* MetaModelSummaryService -- not exercised here */,
            targetStateCapturedDecisionService
        );

        // Shared stubs used across all four tests. Lenient because Test 4
        // (suppression) intentionally never calls the captured-decisions service.
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(architecture(CURRENT_ARCH_ID, "Current")));
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Collections.emptyList());
        when(apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(any(), any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    // -----------------------------------------------------------------------
    // Test 1: empty default shape when no decisions exist
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: project with active target but zero decisions returns the empty default shape")
    void emptyDefaultShapeWhenNoDecisions() {
        // Active target architecture exists for the project ...
        ArchitectureEntity activeTarget = architecture(ACTIVE_TARGET_ARCH_ID, "Active Target");
        when(architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(activeTarget));
        // ... but the captured-decisions service returns zero rows.
        when(targetStateCapturedDecisionService
            .listLatestDecisions(PROJECT_ID, ACTIVE_TARGET_ARCH_ID))
            .thenReturn(Collections.emptyList());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null, null));

        TargetStateDecisionsSummaryDto block = result.targetStateDecisionsSummary();
        assertThat(block).as("block must always be populated, never null").isNotNull();
        assertThat(block.architectureWideDecisions()).isEmpty();
        assertThat(block.scopedOverrides()).isEmpty();
        assertThat(block.totalDecisionCount()).isEqualTo(0);
        assertThat(block.lastDecisionAt()).isNull();
    }

    // -----------------------------------------------------------------------
    // Test 2: populated shape with architecture-wide + scoped overrides
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: populated decisions partition into architecture-wide and scoped overrides with lastDecisionAt set")
    void populatedShapePartitionsCorrectly() {
        ArchitectureEntity activeTarget = architecture(ACTIVE_TARGET_ARCH_ID, "Active Target");
        when(architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.of(activeTarget));

        Instant t1 = Instant.parse("2026-05-22T10:00:00Z");
        Instant t2 = Instant.parse("2026-05-22T11:00:00Z");
        Instant t3 = Instant.parse("2026-05-22T12:00:00Z");

        // Two architecture-wide decisions (no scope_ref_id) ...
        TargetStateCapturedDecisionEntity archWide1 = decision(
            "db.engine", "architecture", null, "Postgres 16", "standards.db.engine.v3", t1);
        TargetStateCapturedDecisionEntity archWide2 = decision(
            "api.protocol", "architecture", null, "gRPC", null, t2);
        // ... and one service-scoped override.
        TargetStateCapturedDecisionEntity scoped = decision(
            "service.runtime", "service", UUID.randomUUID().toString(),
            "Quarkus native", "standards.runtime.v1", t3);

        when(targetStateCapturedDecisionService
            .listLatestDecisions(PROJECT_ID, ACTIVE_TARGET_ARCH_ID))
            .thenReturn(List.of(archWide1, archWide2, scoped));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null, null));

        TargetStateDecisionsSummaryDto block = result.targetStateDecisionsSummary();
        assertThat(block).isNotNull();
        assertThat(block.architectureWideDecisions()).hasSize(2);
        assertThat(block.architectureWideDecisions())
            .extracting("decisionCode")
            .containsExactly("db.engine", "api.protocol");
        assertThat(block.scopedOverrides()).hasSize(1);
        assertThat(block.scopedOverrides().get(0).decisionCode()).isEqualTo("service.runtime");
        assertThat(block.scopedOverrides().get(0).answerSummary()).isEqualTo("Quarkus native");
        assertThat(block.scopedOverrides().get(0).standardsLookupRef()).isEqualTo("standards.runtime.v1");
        assertThat(block.totalDecisionCount()).isEqualTo(3);
        assertThat(block.lastDecisionAt()).isEqualTo(t3);
    }

    // -----------------------------------------------------------------------
    // Test 3: regression guard -- existing fields untouched on a project with no decisions
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: existing top-level DTO fields are byte-identical to pre-spec on a project with no decisions")
    void existingFieldsByteIdenticalWhenNoDecisions() {
        // No active target architecture exists -- captured-decisions service is never called.
        when(architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                PROJECT_ID, "target", "active"))
            .thenReturn(Optional.empty());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null, null));

        // Existing fields preserved (the additive contract from spec.md).
        assertThat(result.projectId()).isEqualTo(PROJECT_ID);
        assertThat(result.currentArchitectureId()).isEqualTo(CURRENT_ARCH_ID);
        assertThat(result.targetArchitectureId()).isNull();
        assertThat(result.discoveryRunIds()).isEmpty();
        assertThat(result.apiBehaviourBaselineIds()).isEmpty();
        assertThat(result.currentArchitectureSummary()).isNotNull();
        assertThat(result.targetArchitectureSummary()).isNull();
        assertThat(result.discoveryRunsSummary()).isNotNull();
        assertThat(result.findingsSummary()).isNotNull();
        assertThat(result.readinessAssessment()).isNotNull();
        assertThat(result.contextWarnings()).contains("no_discovery_runs_selected");

        // New field is present with the empty default shape (never null) so existing
        // consumers see a consistent shape, and the captured-decisions service was
        // never called because no active target architecture exists.
        TargetStateDecisionsSummaryDto block = result.targetStateDecisionsSummary();
        assertThat(block).isNotNull();
        assertThat(block.totalDecisionCount()).isEqualTo(0);
        assertThat(block.architectureWideDecisions()).isEmpty();
        assertThat(block.scopedOverrides()).isEmpty();
        assertThat(block.lastDecisionAt()).isNull();
        verify(targetStateCapturedDecisionService, never())
            .listLatestDecisions(any(), any());
    }

    // -----------------------------------------------------------------------
    // Test 4: includeTargetStateDecisions=false suppresses the block call
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 4: includeTargetStateDecisions=false returns the empty default and skips the service call")
    void suppressionFlagReturnsEmptyDefault() {
        // The captured-decisions service is wired but the flag is explicitly false.
        // We assert the service is NEVER called and the block returns empty.
        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest(CURRENT_ARCH_ID, null, Boolean.FALSE));

        TargetStateDecisionsSummaryDto block = result.targetStateDecisionsSummary();
        assertThat(block).isNotNull();
        assertThat(block.totalDecisionCount()).isEqualTo(0);
        assertThat(block.architectureWideDecisions()).isEmpty();
        assertThat(block.scopedOverrides()).isEmpty();
        assertThat(block.lastDecisionAt()).isNull();

        // Suppression must short-circuit BEFORE the active-target lookup as well --
        // false is a complete opt-out, not just a "zero the populated lists" knob.
        verify(architectureRepository, never())
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                any(), any(), any());
        verify(targetStateCapturedDecisionService, never())
            .listLatestDecisions(any(), any());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static MigrationDiscoveryContextRequestDto newRequest(
            UUID current, UUID target, Boolean includeTargetStateDecisions) {
        return new MigrationDiscoveryContextRequestDto(
            current, target, null, null,
            null, null, null, null, null,
            null, null, includeTargetStateDecisions);
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

    private static TargetStateCapturedDecisionEntity decision(
            String decisionCode,
            String scopeKind,
            String scopeRefId,
            String answerSummary,
            String standardsLookupRef,
            Instant createdAt) {
        // The scope_ref_type is NOT NULL only for scope_kind='element' (per the
        // DB CHECK constraint mirrored on the entity). For service / interface
        // scopes scope_ref_type stays null; scope_ref_id carries the element id.
        return TargetStateCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .targetArchitectureId(ACTIVE_TARGET_ARCH_ID)
            .decisionCode(decisionCode)
            .scopeKind(scopeKind)
            .scopeRefType(null)
            .scopeRefId(scopeRefId)
            .answerValue("{\"value\":\"" + answerSummary + "\"}")
            .answerSummary(answerSummary)
            .standardsLookupRef(standardsLookupRef)
            .createdByTask("architect-persona-conversation")
            .createdAt(createdAt)
            .supersededById(null)
            .build();
    }
}
