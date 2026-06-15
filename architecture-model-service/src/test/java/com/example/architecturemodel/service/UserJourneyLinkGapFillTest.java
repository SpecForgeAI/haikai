package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.*;
import com.example.architecturemodel.repository.diagram.*;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.*;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Gap-fill tests for User Journey Links Meta-Model Foundation.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 4)
 *
 * Tests added:
 * 1. MetaModelRelationshipsDto JSON serialization includes "user_journey_links" key
 * 2. Delete ordering during saveModel: user_journey_links deleted before user_journeys
 * 3. All 5 valid relationship_type enum values are accepted during save
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UserJourneyLinkGapFillTest {

        // ModelService dependencies in declaration order.
    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;
    @Mock private BusinessUserRepository businessUserRepository;
    @Mock private BusinessProcessRepository businessProcessRepository;
    @Mock private ProcessActivityRepository processActivityRepository;
    @Mock private BusinessPointRepository businessPointRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private ApplicationComponentRepository applicationComponentRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private ClassRepository classRepository;
    @Mock private MethodRepository methodRepository;
    @Mock private ApplicationPointRepository applicationPointRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private LogicalDataAttributeRepository logicalDataAttributeRepository;
    @Mock private PhysicalDataEntityRepository physicalDataEntityRepository;
    @Mock private PhysicalDataAttributeRepository physicalDataAttributeRepository;
    @Mock private AppBusinessPointRepository appBusinessPointRepository;
    @Mock private InteractionRepository interactionRepository;
    @Mock private EventRepository eventRepository;
    @Mock private StateRepository stateRepository;
    @Mock private StateTransitionRepository stateTransitionRepository;
    @Mock private ActivityRepository activityRepository;
    @Mock private ActivityFlowRepository activityFlowRepository;
    @Mock private ActivityPartitionRepository activityPartitionRepository;
    @Mock private UIScreenRepository uiScreenRepository;
    @Mock private UIWorkflowTransitionRepository uiWorkflowTransitionRepository;
    @Mock private UIContractRepository uiContractRepository;
    @Mock private UIComponentRepository uiComponentRepository;
    @Mock private UIActionRepository uiActionRepository;
    @Mock private UICharacteristicRepository uiCharacteristicRepository;
    @Mock private BusinessLogicRepository businessLogicRepository;
    @Mock private PackageSetRepository packageSetRepository;
    @Mock private PackageRepository packageRepository;
    @Mock private PackageSetDefaultRuleRepository packageSetDefaultRuleRepository;
    @Mock private DataEntityPointRepository dataEntityPointRepository;
    @Mock private UserJourneyRepository userJourneyRepository;
    @Mock private ActivityStepRepository activityStepRepository;
    @Mock private EnvironmentRepository environmentRepository;
    @Mock private CloudAccountRepository cloudAccountRepository;
    @Mock private LocationRepository locationRepository;
    @Mock private NetworkRepository networkRepository;
    @Mock private SubnetRepository subnetRepository;
    @Mock private ComputeClusterRepository computeClusterRepository;
    @Mock private ComputeResourceRepository computeResourceRepository;
    @Mock private DeploymentUnitRepository deploymentUnitRepository;
    @Mock private LoadBalancerRepository loadBalancerRepository;
    @Mock private ListenerRepository listenerRepository;
    @Mock private DataStoreInstanceRepository dataStoreInstanceRepository;
    @Mock private InfrastructureResourceRepository infrastructureResourceRepository;
    @Mock private InfrastructurePointRepository infrastructurePointRepository;
    @Mock private BusinessUserBusinessPointRepository businessUserBusinessPointRepository;
    @Mock private ApplicationPointBusinessPointRepository applicationPointBusinessPointRepository;
    @Mock private LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    @Mock private LogicalDataEntityPhysicalDataEntityRepository logicalDataEntityPhysicalDataEntityRepository;
    @Mock private LogicalDataAttributePhysicalDataAttributeRepository logicalDataAttributePhysicalDataAttributeRepository;
    @Mock private DataMovementRepository dataMovementRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    @Mock private com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository endpointDataEffectRepository;
    @Mock private ApplicationPointBusinessLogicRepository applicationPointBusinessLogicRepository;
    @Mock private UserJourneyLinkRepository userJourneyLinkRepository;
    @Mock private ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    @Mock private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    @Mock private LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;
    @Mock private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    @Mock private DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    @Mock private ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    @Mock private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;
    @Mock private IaCSourceRepository iacSourceRepository;
    @Mock private IaCResourceBindingRepository iacResourceBindingRepository;
    @Mock private LibraryRepository libraryRepository;
    @Mock private CodeUnitDependencyRepository codeUnitDependencyRepository;
    @Mock private DiscoveryRunRepository discoveryRunRepository;
    @Mock private DiagramRepository diagramRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;
    @Mock private DiagramEdgeRepository diagramEdgeRepository;
    @Mock private DiagramInteractionEdgeRepository diagramInteractionEdgeRepository;
    @Mock private DiagramDecorationRepository diagramDecorationRepository;
    @Mock private EntityMapper entityMapper;
    @Mock private DiagramMapper diagramMapper;
    @Mock private DiagramCanonicalizer diagramCanonicalizer;
    @Mock private DiagramSvgRenderer diagramSvgRenderer;
    @Mock private ProjectService projectService;
    @Mock private DataEntityPointEnsureService dataEntityPointEnsureService;

    @InjectMocks
    private ModelService modelService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        // ModelService is wired via @InjectMocks. Override mapper/canonicalizer deps
        // with real instances since tests assert their behaviour.
        ReflectionTestUtils.setField(modelService, "entityMapper", new EntityMapper());
        ReflectionTestUtils.setField(modelService, "diagramMapper", new DiagramMapper());
        ReflectionTestUtils.setField(modelService, "diagramCanonicalizer", new DiagramCanonicalizer());
    }

    // ============================================================================
    // Gap 1: MetaModelRelationshipsDto JSON serialization includes "user_journey_links" key
    // ============================================================================

    @Test
    @DisplayName("MetaModelRelationshipsDto serializes with 'user_journey_links' JSON key when populated")
    void metaModelRelationshipsDto_jsonSerialization_includesUserJourneyLinksKey() throws Exception {
        UserJourneyLinkDto link = new UserJourneyLinkDto(
            "ujl-001",
            "uj-onboarding",
            "uj-checkout",
            "PRECEDES",
            "after onboarding",
            "Onboarding precedes checkout",
            "domain:customer"
        );

        MetaModelRelationshipsDto dto = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(link), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        String json = objectMapper.writeValueAsString(dto);

        // Verify the top-level key is snake_case
        assertThat(json).contains("\"user_journey_links\"");
        // Verify it does NOT appear as camelCase
        assertThat(json).doesNotContain("\"userJourneyLinks\"");

        // Verify the nested link data is present with snake_case keys
        assertThat(json).contains("\"source_user_journey_id\":\"uj-onboarding\"");
        assertThat(json).contains("\"target_user_journey_id\":\"uj-checkout\"");
        assertThat(json).contains("\"relationship_type\":\"PRECEDES\"");

        // Verify round-trip: deserialize back and check user_journey_links list
        MetaModelRelationshipsDto deserialized = objectMapper.readValue(json, MetaModelRelationshipsDto.class);
        assertThat(deserialized.userJourneyLinks()).hasSize(1);
        assertThat(deserialized.userJourneyLinks().get(0).id()).isEqualTo("ujl-001");
        assertThat(deserialized.userJourneyLinks().get(0).sourceUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(deserialized.userJourneyLinks().get(0).relationshipType()).isEqualTo("PRECEDES");
    }

    // ============================================================================
    // Gap 2: Delete ordering during saveModel -- user_journey_links deleted before user_journeys
    //
    // saveModel calls deleteAllDataForModelFile (truncate & re-insert strategy),
    // which must delete user_journey_links BEFORE user_journeys to respect the FK constraint.
    // ============================================================================

    @Test
    @DisplayName("saveModel truncate phase deletes user_journey_links before user_journeys (FK ordering)")
    void saveModel_deletesUserJourneyLinksBeforeUserJourneys() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));

        // Build a minimal model with empty entities and empty relationships
        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),  // empty user_journey_links
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        // When: save the model (which calls deleteAllDataForModelFile first)
        modelService.saveModel("test-model", model);

        // Then: verify user_journey_links is deleted BEFORE user_journeys during the truncate phase
        InOrder inOrder = inOrder(userJourneyLinkRepository, userJourneyRepository);
        inOrder.verify(userJourneyLinkRepository).deleteByModelFileId(modelFileId);
        inOrder.verify(userJourneyRepository).deleteByModelFileId(modelFileId);
    }

    // ============================================================================
    // Gap 3: All 5 valid relationship_type values are accepted during save
    // ============================================================================

    @ParameterizedTest(name = "saveModel accepts relationship_type = {0}")
    @ValueSource(strings = {"RELATES_TO", "PRECEDES", "DEPENDS_ON", "OPTIONALLY_LEADS_TO", "TRIGGERS"})
    @DisplayName("saveModel accepts all valid relationship_type enum values")
    void saveModel_acceptsAllValidRelationshipTypes(String relType) {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));

        UserJourneyLinkDto link = new UserJourneyLinkDto(
            "ujl-" + relType.toLowerCase(),
            "uj-source",
            "uj-target",
            relType,
            null,
            null,
            null
        );

        MetaModelRelationshipsDto relationships = new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(link), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        // When / Then: should NOT throw
        assertDoesNotThrow(() -> modelService.saveModel("test-model", model));

        // Verify saveAll was called (link was persisted)
        verify(userJourneyLinkRepository).saveAll(anyList());
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private ModelFileEntity createModelFile(String id, String filename) {
        return ModelFileEntity.builder()
            .id(id)
            .filename(filename)
            .description("Test model")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();
    }

    private MetaModelEntitiesDto createEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }
}
