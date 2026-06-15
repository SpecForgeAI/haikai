package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextRequestDto;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;
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
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the 7th migration spec-context type
 * ({@code operational_capability}) added to {@link MigrationSpecContextResolver}
 * by D3 (the keystone spec of the 6-spec discovery-completeness + net_new
 * program, 2026-06-14).
 *
 * <p>Same Mockito (no Spring context) pattern as
 * {@link MigrationSpecContextResolverTest}. The block resolves from a D2
 * {@code discovery_capability} (PREFERRED, by {@code source_capability_id}) or a
 * behaviour-bearing {@code operational_artifact} {@code discovery_findings} row
 * (FALLBACK). A thin capability (zero members / no behaviour signal) emits
 * block-level {@code missingInputs[]} aggregated into the DTO top-level list, so
 * the gateway's pre-LLM {@code insufficient_context} short-circuit (D6) fires.</p>
 *
 * <p>Focused plan (no exhaustive per-field coverage):</p>
 * <ol>
 *   <li>PREFERRED capability source → populated block (topology / invocations /
 *       members + kinds / schedule / IO / side-effects / external systems /
 *       name+kind+summary / behaviourBearing).</li>
 *   <li>FALLBACK finding source → populated block when no capability resolves.</li>
 *   <li>Thin capability (zero members) → block + top-level missingInputs.</li>
 *   <li>NO-REGRESSION: the 6 existing context types still resolve unchanged.</li>
 * </ol>
 *
 * <p>Spec: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14, Spec 3 of 6) — Task Group 1.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationSpecContextResolverOperationalCapabilityTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH = UUID.randomUUID();
    private static final UUID TARGET_ARCH = UUID.randomUUID();
    private static final UUID BOOK_OF_WORK_ID = UUID.randomUUID();
    private static final UUID WORK_ITEM_ID = UUID.randomUUID();
    private static final UUID CAPABILITY_ID = UUID.randomUUID();

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
            .title("Modernise Daily Risk Hierarchy Load Pipeline")
            .status("PLANNED")
            .sortOrder(0)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        lenient().when(workItemRepository.findByIdAndProjectId(WORK_ITEM_ID, PROJECT_ID))
            .thenReturn(Optional.of(wi));
        lenient().when(mappingRepository
                .findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(any(), any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(baselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(any(), any(), any()))
            .thenReturn(Collections.emptyList());
    }

    /** Request with a {@code sourceCapabilityId} (the capability-story path). */
    private MigrationSpecContextRequestDto capabilityRequest(UUID sourceCapabilityId) {
        return new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID,
            "bi-cap",
            WORK_ITEM_ID,
            CURRENT_ARCH,
            TARGET_ARCH,
            List.of(MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY),
            null, null, null,
            null, null,
            sourceCapabilityId
        );
    }

    private DiscoveryCapabilityEntity capability(Map<String, Object> detailJson) {
        return DiscoveryCapabilityEntity.builder()
            .id(CAPABILITY_ID)
            .runId(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH)
            .name("Daily Risk Hierarchy Load Pipeline")
            .kind("batch_pipeline")
            .summary("Autosys JIL job chain that loads the risk hierarchy nightly.")
            .reviewStatus("approved")
            .confidence(0.82)
            .detailJson(detailJson)
            .source("jil_dag_closure")
            .createdByStage("capability_synthesis")
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    private DiscoveryCapabilityMemberEntity member(String memberType) {
        return DiscoveryCapabilityMemberEntity.builder()
            .id(UUID.randomUUID())
            .capabilityId(CAPABILITY_ID)
            .memberType(memberType)
            .memberId(UUID.randomUUID())
            .createdAt(Instant.now())
            .build();
    }

    private DiscoveryFindingEntity operationalArtifactFinding(Map<String, Object> detailJson) {
        DiscoveryFindingEntity f = new DiscoveryFindingEntity();
        f.setId(UUID.randomUUID());
        f.setRunId(UUID.randomUUID());
        f.setProjectId(PROJECT_ID);
        f.setArchitectureId(CURRENT_ARCH);
        f.setFindingType("operational_artifact");
        f.setCategory("operational");
        f.setSeverity("medium");
        f.setReviewStatus("approved");
        f.setTitle("daily_risk_load.jil");
        f.setSummary("CA Autosys JIL job that triggers the nightly risk load.");
        f.setDetailJson(detailJson);
        f.setSource("operational_artifact_summariser");
        f.setCreatedAt(Instant.now());
        return f;
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("PREFERRED: 7th type resolves an operational_capability block from a discovery_capability")
    void resolvesFromCapabilitySource() {
        stubScope();
        Map<String, Object> detail = Map.of(
            "topology", Map.of("kind", "jil_dag"),
            "invocations", List.of(
                Map.of("from", "daily_risk_load.jil", "to", "load_risk.sh", "edgeType", "jil_to_shell"),
                Map.of("from", "load_risk.sh", "to", "RiskLoadMain", "edgeType", "shell_to_java")),
            "schedule", Map.of("trigger", "calendar", "cron", "0 2 * * *"),
            "inputs", List.of("risk_feed.csv"),
            "outputs", List.of("RISK_HIERARCHY"),
            "sideEffects", List.of("truncate+reload RISK_HIERARCHY"),
            "externalSystems", List.of("Autosys", "Sybase"),
            "behaviourBearing", Boolean.TRUE
        );
        when(capabilityRepository.findById(CAPABILITY_ID)).thenReturn(Optional.of(capability(detail)));
        when(capabilityMemberRepository.findByCapabilityIdOrderByCreatedAtAsc(CAPABILITY_ID))
            .thenReturn(List.of(member("discovery_finding"), member("architecture_element")));

        MigrationSpecContextDto out = resolver.resolve(PROJECT_ID, capabilityRequest(CAPABILITY_ID));

        assertThat(out.operationalCapability()).isNotNull();
        MigrationSpecContextDto.OperationalCapabilityContextBlock block = out.operationalCapability();
        assertThat(block.capabilityId()).isEqualTo(CAPABILITY_ID.toString());
        assertThat(block.name()).isEqualTo("Daily Risk Hierarchy Load Pipeline");
        assertThat(block.kind()).isEqualTo("batch_pipeline");
        assertThat(block.summary()).isNotBlank();
        assertThat(block.source()).isEqualTo("capability");
        assertThat(block.behaviourBearing()).isTrue();
        // Topology / invocation / schedule / IO / side-effects / external-systems
        // ride detailJson verbatim.
        assertThat(block.detailJson()).containsKeys(
            "topology", "invocations", "schedule", "inputs", "outputs", "sideEffects", "externalSystems");
        // Members + kinds.
        assertThat(block.members()).hasSize(2);
        assertThat(block.memberKinds()).contains("discovery_finding", "architecture_element");
        // Behaviour signal present + members present => no blockers.
        assertThat(block.missingInputs()).isEmpty();
        assertThat(out.missingInputs()).isEmpty();
        assertThat(out.returnedContextTypes())
            .containsExactly(MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY);
    }

    @Test
    @DisplayName("FALLBACK: 7th type resolves a block from a behaviour-bearing operational_artifact finding when no capability resolves")
    void resolvesFromFindingFallback() {
        stubScope();
        // No sourceCapabilityId on the request => capability lookup is skipped; the
        // resolver falls back to a behaviour-bearing operational_artifact finding.
        Map<String, Object> findingDetail = Map.of(
            "purpose", "Trigger the nightly risk load",
            "artifactKind", "autosys_jil",
            "invokes", List.of("load_risk.sh"),
            "inputs", List.of("risk_feed.csv"),
            "outputs", List.of("RISK_HIERARCHY"),
            "sideEffects", List.of("truncate+reload RISK_HIERARCHY"),
            "externalSystems", List.of("Autosys"),
            "behaviourBearing", Boolean.TRUE
        );
        when(findingRepository.findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
                PROJECT_ID, CURRENT_ARCH, "rejected"))
            .thenReturn(List.of(operationalArtifactFinding(findingDetail)));

        MigrationSpecContextRequestDto request = new MigrationSpecContextRequestDto(
            BOOK_OF_WORK_ID, "bi-cap", WORK_ITEM_ID, CURRENT_ARCH, TARGET_ARCH,
            List.of(MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY),
            null, null, null, null, null, null);

        MigrationSpecContextDto out = resolver.resolve(PROJECT_ID, request);

        MigrationSpecContextDto.OperationalCapabilityContextBlock block = out.operationalCapability();
        assertThat(block).isNotNull();
        assertThat(block.source()).isEqualTo("finding");
        assertThat(block.behaviourBearing()).isTrue();
        assertThat(block.name()).isEqualTo("daily_risk_load.jil");
        assertThat(block.kind()).isEqualTo("autosys_jil");
        assertThat(block.detailJson()).containsKey("invokes");
        // A behaviour-bearing finding => no blockers.
        assertThat(block.missingInputs()).isEmpty();
        assertThat(out.missingInputs()).isEmpty();
    }

    @Test
    @DisplayName("Thin capability (zero members) emits block-level + top-level missingInputs (D6 short-circuit)")
    void thinCapabilityEmitsMissingInputs() {
        stubScope();
        // Capability resolves but has NO members and NO behaviour signal.
        Map<String, Object> detail = Map.of(
            "topology", Map.of("kind", "jil_dag"),
            "behaviourBearing", Boolean.FALSE
        );
        when(capabilityRepository.findById(CAPABILITY_ID)).thenReturn(Optional.of(capability(detail)));
        when(capabilityMemberRepository.findByCapabilityIdOrderByCreatedAtAsc(CAPABILITY_ID))
            .thenReturn(Collections.emptyList());

        MigrationSpecContextDto out = resolver.resolve(PROJECT_ID, capabilityRequest(CAPABILITY_ID));

        MigrationSpecContextDto.OperationalCapabilityContextBlock block = out.operationalCapability();
        assertThat(block).isNotNull();
        assertThat(block.members()).isEmpty();
        assertThat(block.missingInputs())
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("capability_members"))
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("capability_behaviour"));
        // Aggregated into the DTO top-level list so the gateway short-circuits.
        assertThat(out.missingInputs())
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("capability_members"))
            .anySatisfy(mi -> assertThat(mi.kind()).isEqualTo("capability_behaviour"));
    }

    @Test
    @DisplayName("NO-REGRESSION: the 6 existing context types still resolve unchanged alongside the new type")
    void existingSixTypesStillResolve() {
        stubScope();

        MigrationSpecContextDto out = resolver.resolve(
            PROJECT_ID,
            new MigrationSpecContextRequestDto(
                BOOK_OF_WORK_ID, "bi-1", WORK_ITEM_ID, CURRENT_ARCH, TARGET_ARCH,
                List.of(
                    MigrationSpecContextRequestDto.CTX_SERVICE,
                    MigrationSpecContextRequestDto.CTX_API,
                    MigrationSpecContextRequestDto.CTX_SOAP,
                    MigrationSpecContextRequestDto.CTX_DATA,
                    MigrationSpecContextRequestDto.CTX_INFRASTRUCTURE,
                    MigrationSpecContextRequestDto.CTX_TEST_PACK),
                null, null, null, null, null, null));

        assertThat(out.service()).isNotNull();
        assertThat(out.api()).isNotNull();
        assertThat(out.soap()).isNotNull();
        assertThat(out.data()).isNotNull();
        assertThat(out.infrastructure()).isNotNull();
        assertThat(out.testPack()).isNotNull();
        // The new block is absent when the type is not requested.
        assertThat(out.operationalCapability()).isNull();
        assertThat(out.returnedContextTypes()).hasSize(6);
        assertThat(MigrationSpecContextResolver.knownContextTypes())
            .contains(MigrationSpecContextRequestDto.CTX_OPERATIONAL_CAPABILITY);
    }
}
