package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourBaselineEntity;
import com.example.architecturemodel.model.entity.apibehaviour.ApiBehaviourOperationEntity;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourOperationRepository;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;

/**
 * Focused tests for the {@code scenarioSeeds} block computed-on-read by
 * {@link MigrationDiscoveryContextService} (Spec: capture-scenario-seeding,
 * 2026-05-30).
 *
 * <p>Uses Mockito to wire repository mocks directly (no Spring context) --
 * mirrors the standalone-JUnit pattern of {@code MigrationDiscoveryContextServiceTest}.
 * The constructor signature is UNCHANGED: the collaborators this spec exercises
 * (operation / baseline / model-file / endpoint / data-effect repositories) are
 * mocked; every other collaborator is passed {@code null}, exactly as the
 * pre-existing suite does for the coverage gates.</p>
 *
 * <p>Scenario-seed contract under test:</p>
 * <ul>
 *   <li>(a) a REST GET op with read-only data effects -> happy_path seed,
 *       {@code safeToExecute == true};</li>
 *   <li>(b) a POST op with a write access_mode -> {@code safeToExecute == false}
 *       on the set and every seed;</li>
 *   <li>(c) an endpoint whose response_contract documents a 404 error response
 *       and 401 auth -> an {@code error_404} seed and an {@code auth_missing_token}
 *       seed both appear;</li>
 *   <li>(d) graceful: null/empty collaborators or no matched endpoint never throw
 *       (verb-fallback happy_path or empty list).</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDiscoveryContextScenarioSeedsTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID BASELINE_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "model-file-1";

    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;
    @Mock private DiscoveryRunRepository discoveryRunRepository;
    @Mock private ApiBehaviourBaselineRepository apiBehaviourBaselineRepository;
    @Mock private ApiBehaviourOperationRepository apiBehaviourOperationRepository;
    @Mock private ModelFileRepository modelFileRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private EndpointDataEffectRepository endpointDataEffectRepository;

    private MigrationDiscoveryContextService service;

    @BeforeEach
    void setUp() {
        // Mirror the constructor argument order of the production constructor
        // EXACTLY (signature unchanged by this spec). Only the collaborators the
        // scenario-seed path reads are mocked; the rest are null -- the service
        // tolerates null collaborators by skipping the dependent computation.
        service = new MigrationDiscoveryContextService(
            projectRepository,
            architectureRepository,
            discoveryRunRepository, // DiscoveryRunRepository
            null, // DiscoveryFindingRepository
            null, // DiscoveryFindingLinkRepository
            null, // DiscoveryCandidateRepository
            null, // DiscoveryEvidenceRepository
            null, // DiscoveryDecisionTaskRepository
            apiBehaviourBaselineRepository,
            null, // ArchitectureElementMappingRepository
            apiBehaviourOperationRepository,
            null, // ApiBehaviourCaptureRepository
            null, // ApiBehaviourDiffRepository
            null, // ApiBehaviourDiffItemRepository
            modelFileRepository,
            endpointRepository,
            endpointDataEffectRepository,
            null, // InterfaceLogicalEntityRepository
            null, // MetaModelSummaryService
            null, // TargetStateCapturedDecisionService
            null, // DbMigrationPackRepository            (Spec 2026-07-02-a)
            null, // DbMigrationPackDecisionRepository    (Spec 2026-07-02-a)
            null  // DbMigrationPackTranslationRepository (Spec 2026-07-02-a)
        );
    }

    // -----------------------------------------------------------------------
    // (a) REST GET + read-only effects -> happy_path, safeToExecute == true
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("GET op with read-only data effects yields a safe happy_path seed")
    void getOpWithReadEffectsIsSafe() {
        stubScope();
        stubSingleBaseline();

        ApiBehaviourOperationEntity op = operation("GET", "/orders/{id}", true);
        stubOperations(op);

        EndpointEntity ep = restEndpoint("ep-1", "GET", "/orders/{id}", null);
        stubModelEndpoints(ep);
        when(endpointDataEffectRepository.findByEndpointId("ep-1"))
            .thenReturn(List.of(effect("ep-1", "read", "Order")));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        List<MigrationDiscoveryContextDto.ScenarioSeedSetDto> seeds = result.scenarioSeeds();
        assertThat(seeds).hasSize(1);
        MigrationDiscoveryContextDto.ScenarioSeedSetDto set = seeds.get(0);
        assertThat(set.operationKey()).isEqualTo("GET /orders/{id}");
        assertThat(set.method()).isEqualTo("GET");
        assertThat(set.safeToExecute()).isTrue();

        MigrationDiscoveryContextDto.ScenarioSeedDto happy = set.seeds().get(0);
        assertThat(happy.scenarioName()).isEqualTo("happy_path");
        assertThat(happy.safeToExecute()).isTrue();
        assertThat(happy.expectedStatus()).isEqualTo(200);
        assertThat(happy.provenance()).isEqualTo("access_mode");
        assertThat(happy.preconditions()).contains("data for Order must pre-exist");
    }

    // -----------------------------------------------------------------------
    // (b) POST + write effect -> safeToExecute == false everywhere
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("POST op with a write access_mode is marked unsafe on the set and seeds")
    void postOpWithWriteEffectIsUnsafe() {
        stubScope();
        stubSingleBaseline();

        ApiBehaviourOperationEntity op = operation("POST", "/orders", true);
        stubOperations(op);

        EndpointEntity ep = restEndpoint("ep-2", "POST", "/orders", null);
        stubModelEndpoints(ep);
        when(endpointDataEffectRepository.findByEndpointId("ep-2"))
            .thenReturn(List.of(effect("ep-2", "write", "Order")));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        MigrationDiscoveryContextDto.ScenarioSeedSetDto set = result.scenarioSeeds().get(0);
        assertThat(set.safeToExecute()).isFalse();
        assertThat(set.seeds()).isNotEmpty();
        assertThat(set.seeds()).allSatisfy(seed -> assertThat(seed.safeToExecute()).isFalse());

        MigrationDiscoveryContextDto.ScenarioSeedDto happy = set.seeds().get(0);
        assertThat(happy.scenarioName()).isEqualTo("happy_path");
        // POST + unsafe -> 201 Created.
        assertThat(happy.expectedStatus()).isEqualTo(201);
    }

    // -----------------------------------------------------------------------
    // (c) response_contract with a 404 error + 401 auth -> error_404 + auth seed
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("response_contract error_responses + auth produce error_404 and auth_missing_token seeds")
    void responseContractDrivesErrorAndAuthSeeds() {
        stubScope();
        stubSingleBaseline();

        ApiBehaviourOperationEntity op = operation("GET", "/orders/{id}", true);
        stubOperations(op);

        Map<String, Object> contract = new LinkedHashMap<>();
        contract.put("error_responses", List.of(
            Map.of("status", 404, "body", Map.of("message", "not found")),
            Map.of("status", 401, "body", Map.of("message", "unauthorized"))));
        contract.put("auth", Map.of("required", true, "scheme", "bearer"));

        EndpointEntity ep = restEndpoint("ep-3", "GET", "/orders/{id}", contract);
        stubModelEndpoints(ep);
        when(endpointDataEffectRepository.findByEndpointId("ep-3"))
            .thenReturn(List.of(effect("ep-3", "read", "Order")));

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        MigrationDiscoveryContextDto.ScenarioSeedSetDto set = result.scenarioSeeds().get(0);
        List<String> names = set.seeds().stream()
            .map(MigrationDiscoveryContextDto.ScenarioSeedDto::scenarioName)
            .toList();

        assertThat(names).contains("happy_path", "error_404", "auth_missing_token");

        MigrationDiscoveryContextDto.ScenarioSeedDto error404 = seedNamed(set, "error_404");
        assertThat(error404.expectedStatus()).isEqualTo(404);
        assertThat(error404.scenarioType()).isEqualTo("error");
        assertThat(error404.provenance()).isEqualTo("response_contract");

        MigrationDiscoveryContextDto.ScenarioSeedDto auth = seedNamed(set, "auth_missing_token");
        // 401 is documented, so the auth seed prefers 401 over 403.
        assertThat(auth.expectedStatus()).isEqualTo(401);
        assertThat(auth.scenarioType()).isEqualTo("auth");
    }

    // -----------------------------------------------------------------------
    // (d) graceful degradation
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("No matched endpoint still yields a verb-fallback happy_path seed without throwing")
    void unmatchedEndpointFallsBackToVerb() {
        stubScope();
        stubSingleBaseline();

        ApiBehaviourOperationEntity op = operation("GET", "/no-such-endpoint", true);
        stubOperations(op);

        // No model file -> no endpoints to match against.
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Optional.empty());

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        MigrationDiscoveryContextDto.ScenarioSeedSetDto set = result.scenarioSeeds().get(0);
        // GET is read-only -> safe by verb fallback; happy_path always present.
        assertThat(set.safeToExecute()).isTrue();
        MigrationDiscoveryContextDto.ScenarioSeedDto happy = set.seeds().get(0);
        assertThat(happy.scenarioName()).isEqualTo("happy_path");
        assertThat(happy.provenance()).isEqualTo("verb_fallback");
        assertThat(happy.preconditions()).isEmpty();
    }

    @Test
    @DisplayName("No included operations yields an empty (non-null) scenarioSeeds list")
    void noIncludedOperationsYieldsEmptyList() {
        stubScope();
        stubSingleBaseline();

        // Only an EXCLUDED op exists -> filtered out, empty seed list.
        ApiBehaviourOperationEntity excluded = operation("GET", "/orders", false);
        stubOperations(excluded);

        MigrationDiscoveryContextDto result =
            service.build(PROJECT_ID, newRequest());

        assertThat(result.scenarioSeeds()).isNotNull().isEmpty();
    }

    // -----------------------------------------------------------------------
    // Stub + builder helpers
    // -----------------------------------------------------------------------

    private void stubScope() {
        lenient().when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        lenient().when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(architecture(CURRENT_ARCH_ID)));
    }

    private void stubSingleBaseline() {
        lenient().when(apiBehaviourBaselineRepository
                .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(List.of(baseline(BASELINE_ID, SESSION_ID)));
    }

    private void stubOperations(ApiBehaviourOperationEntity... ops) {
        lenient().when(apiBehaviourOperationRepository
                .findBySessionIdOrderByCreatedAtAsc(SESSION_ID))
            .thenReturn(List.of(ops));
    }

    private void stubModelEndpoints(EndpointEntity... endpoints) {
        lenient().when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Optional.of(modelFile(MODEL_FILE_ID)));
        lenient().when(endpointRepository.findByModelFileId(MODEL_FILE_ID))
            .thenReturn(List.of(endpoints));
    }

    private static MigrationDiscoveryContextDto.ScenarioSeedDto seedNamed(
            MigrationDiscoveryContextDto.ScenarioSeedSetDto set, String name) {
        return set.seeds().stream()
            .filter(s -> name.equals(s.scenarioName()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("seed not found: " + name));
    }

    private static MigrationDiscoveryContextRequestDto newRequest() {
        // 12 components: currentArchitectureId, targetArchitectureId, discoveryRunIds,
        // apiBehaviourBaselineIds, includeFindings, includeEvidence,
        // includeRuntimeEvidence, includeDbFindings, includeMappings, maxFindings,
        // maxEvidenceItems, includeTargetStateDecisions.
        return new MigrationDiscoveryContextRequestDto(
            CURRENT_ARCH_ID, null, null, null,
            null, null, null, null, null,
            null, null, null);
    }

    private static ArchitectureEntity architecture(UUID id) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .name("Current")
            .build();
    }

    private static ApiBehaviourBaselineEntity baseline(UUID id, UUID sessionId) {
        return ApiBehaviourBaselineEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .sessionId(sessionId)
            .name("baseline")
            .status("active")
            .build();
    }

    private static ApiBehaviourOperationEntity operation(String method, String path, boolean included) {
        ApiBehaviourOperationEntity op = new ApiBehaviourOperationEntity();
        op.setId(UUID.randomUUID());
        op.setSessionId(SESSION_ID);
        op.setMethod(method);
        op.setPath(path);
        op.setIncluded(included);
        return op;
    }

    private static EndpointEntity restEndpoint(
            String id, String verb, String pathOrAddress, Map<String, Object> responseContract) {
        EndpointEntity ep = new EndpointEntity();
        ep.setId(id);
        ep.setModelFileId(MODEL_FILE_ID);
        ep.setProtocol("REST");
        ep.setEndpointType("rest");
        ep.setOperationVerb(verb);
        ep.setPathOrAddress(pathOrAddress);
        if (responseContract != null) {
            ep.setResponseContract(responseContract);
        }
        return ep;
    }

    private static EndpointDataEffectEntity effect(String endpointId, String accessMode, String target) {
        EndpointDataEffectEntity e = new EndpointDataEffectEntity();
        e.setEndpointId(endpointId);
        e.setAccessMode(accessMode);
        e.setDataEntityPointId(target);
        return e;
    }

    private static ModelFileEntity modelFile(String id) {
        ModelFileEntity mf = new ModelFileEntity();
        mf.setId(id);
        return mf;
    }

    // Static import shim so the lenient stubs above read naturally.
    private static <T> org.mockito.stubbing.OngoingStubbing<T> when(T methodCall) {
        return org.mockito.Mockito.when(methodCall);
    }
}
