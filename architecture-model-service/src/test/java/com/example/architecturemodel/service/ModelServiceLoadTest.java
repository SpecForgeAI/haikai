package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.ModelFileSummaryDto;
import com.example.architecturemodel.model.dto.relationship.LogicalDataEntityRelationshipDto;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.*;
import com.example.architecturemodel.repository.diagram.*;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.*;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceLoadTest {

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

    @BeforeEach
    void setUp() {
        // ModelService is wired via @InjectMocks. Override mapper/canonicalizer deps
        // with real instances since tests assert their behaviour.
        ReflectionTestUtils.setField(modelService, "entityMapper", new EntityMapper());
        ReflectionTestUtils.setField(modelService, "diagramMapper", new DiagramMapper());
        ReflectionTestUtils.setField(modelService, "diagramCanonicalizer", new DiagramCanonicalizer());
    }

    @Test
    void getModelFilenames_returnsAllFiles() {
        ModelFileEntity file1 = createModelFile("file1", "test-model");
        ModelFileEntity file2 = createModelFile("file2", "another-model");

        when(modelFileRepository.findAll()).thenReturn(List.of(file1, file2));

        List<ModelFileSummaryDto> result = modelService.getModelFilenames();

        assertEquals(2, result.size());
        assertEquals("test-model", result.get(0).filename());
        assertEquals("another-model", result.get(1).filename());
    }

    @Test
    void getModelFilenames_returnsEmptyListWhenNoFiles() {
        when(modelFileRepository.findAll()).thenReturn(Collections.emptyList());

        List<ModelFileSummaryDto> result = modelService.getModelFilenames();

        assertTrue(result.isEmpty());
    }

    @Test
    void loadModel_byFilename_returnsModel() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        setupEmptyRepositoryMocks(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        assertNotNull(result);
        assertNotNull(result.metaModel());
        assertNotNull(result.diagrams());
    }

    @Test
    void loadModel_notFound_throwsException() {
        when(modelFileRepository.findByFilenameIgnoreCase("nonexistent")).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class,
            () -> modelService.loadModel("nonexistent"));
    }

    @Test
    void loadModel_noFilename_loadsDefault() {
        String modelFileId = "mf-default";
        ModelFileEntity defaultFile = createModelFile(modelFileId, "default-model");
        defaultFile.setIsDefault(true);

        when(modelFileRepository.findByIsDefaultTrue()).thenReturn(Optional.of(defaultFile));
        setupEmptyRepositoryMocks(modelFileId);

        ArchitectureModelDto result = modelService.loadModel(null);

        assertNotNull(result);
        verify(modelFileRepository).findByIsDefaultTrue();
    }

    @Test
    void loadModel_withBusinessUsers_returnsPopulatedEntities() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        BusinessUserEntity user = BusinessUserEntity.builder()
            .id("user-1")
            .modelFileId(modelFileId)
            .name("Test User")
            .description("A test user")
            .tags("test")
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(List.of(user));
        setupOtherEmptyRepositoryMocks(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        assertEquals(1, result.metaModel().entities().businessUsers().size());
        assertEquals("user-1", result.metaModel().entities().businessUsers().get(0).id());
        assertEquals("Test User", result.metaModel().entities().businessUsers().get(0).name());
    }

    // ============================================================================
    // LogicalDataEntityRelationship Load Tests - Task Group 7
    // ============================================================================

    @Test
    void loadModel_withLogicalERRelationship_returnsAllFieldsMappedCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        LogicalDataEntityRelationshipEntity relationshipEntity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-1")
            .modelFileId(modelFileId)
            .fromDataEntityPointId("dep_log_entity-1")
            .toDataEntityPointId("dep_log_entity-2")
            .cardinality("ONE_TO_MANY")
            .relationship("COMPOSITION")
            .description("Test relationship")
            .tags("data,test")
            .validFrom("2024-Q1")
            .validTo("2025-Q4")
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId))
            .thenReturn(List.of(relationshipEntity));
        setupOtherEmptyRepositoryMocksExcludingLogicalER(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        assertNotNull(result.metaModel().relationships());
        List<LogicalDataEntityRelationshipDto> relationships =
            result.metaModel().relationships().logicalDataEntityRelationships();
        assertEquals(1, relationships.size());

        LogicalDataEntityRelationshipDto dto = relationships.get(0);
        assertEquals("rel-1", dto.id());
        assertEquals("dep_log_entity-1", dto.fromDataEntityPointId());
        assertEquals("dep_log_entity-2", dto.toDataEntityPointId());
        assertEquals("ONE_TO_MANY", dto.cardinality());
        assertEquals("COMPOSITION", dto.relationship());
        assertEquals("Test relationship", dto.description());
        assertEquals("data,test", dto.tags());
        assertEquals("2024-Q1", dto.validFrom());
        assertEquals("2025-Q4", dto.validTo());
    }

    @Test
    void loadModel_withLogicalERRelationship_nullableFieldsHandledCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        LogicalDataEntityRelationshipEntity relationshipEntity = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-nullable")
            .modelFileId(modelFileId)
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId))
            .thenReturn(List.of(relationshipEntity));
        setupOtherEmptyRepositoryMocksExcludingLogicalER(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        List<LogicalDataEntityRelationshipDto> relationships =
            result.metaModel().relationships().logicalDataEntityRelationships();
        assertEquals(1, relationships.size());

        LogicalDataEntityRelationshipDto dto = relationships.get(0);
        assertEquals("rel-nullable", dto.id());
        assertNull(dto.fromDataEntityPointId());
        assertNull(dto.toDataEntityPointId());
        assertNull(dto.cardinality());
        assertNull(dto.relationship());
        assertNull(dto.description());
    }

    @Test
    void loadModel_withMultipleLogicalERRelationships_returnsAll() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        LogicalDataEntityRelationshipEntity rel1 = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-1").modelFileId(modelFileId)
            .fromDataEntityPointId("dep_log_entity-a")
            .toDataEntityPointId("dep_log_entity-b")
            .cardinality("ONE_TO_ONE").relationship("ASSOCIATION")
            .build();

        LogicalDataEntityRelationshipEntity rel2 = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-2").modelFileId(modelFileId)
            .fromDataEntityPointId("dep_phy_physical-a")
            .toDataEntityPointId("dep_phy_physical-b")
            .cardinality("MANY_TO_MANY").relationship("AGGREGATION")
            .build();

        LogicalDataEntityRelationshipEntity rel3 = LogicalDataEntityRelationshipEntity.builder()
            .id("rel-3").modelFileId(modelFileId)
            .fromDataEntityPointId("dep_log_logical-x")
            .toDataEntityPointId("dep_phy_physical-y")
            .cardinality("ONE_TO_MANY").relationship("DEPENDENCY")
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId))
            .thenReturn(List.of(rel1, rel2, rel3));
        setupOtherEmptyRepositoryMocksExcludingLogicalER(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        List<LogicalDataEntityRelationshipDto> relationships =
            result.metaModel().relationships().logicalDataEntityRelationships();
        assertEquals(3, relationships.size());
        assertEquals("rel-1", relationships.get(0).id());
        assertEquals("rel-2", relationships.get(1).id());
        assertEquals("rel-3", relationships.get(2).id());
    }

    // ============================================================================
    // User Journey Meta-Model Foundation - Load Tests (Task Group 3)
    // ============================================================================

    @Test
    void loadModel_includesUserJourneysAndActivitySteps() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        UserJourneyEntity journey = UserJourneyEntity.builder()
            .id("uj-1")
            .modelFileId(modelFileId)
            .name("Customer Onboarding")
            .description("End-to-end onboarding flow")
            .tags("onboarding")
            .primaryBusinessUserId("bu-1")
            .parentBusinessProcessId("bp-1")
            .build();

        ActivityStepEntity step = ActivityStepEntity.builder()
            .id("as-1")
            .modelFileId(modelFileId)
            .userJourneyId("uj-1")
            .name("Fill Registration Form")
            .description("User fills out registration")
            .tags("registration")
            .sequenceOrder(1)
            .processActivityId("pa-1")
            .businessUserId("bu-1")
            .applicationId("app-1")
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(List.of(journey));
        when(activityStepRepository.findByModelFileId(modelFileId)).thenReturn(List.of(step));
        setupOtherEmptyRepositoryMocksExcludingUserJourney(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        // Verify user journeys loaded
        assertNotNull(result.metaModel().entities().userJourneys());
        assertEquals(1, result.metaModel().entities().userJourneys().size());
        assertEquals("uj-1", result.metaModel().entities().userJourneys().get(0).id());
        assertEquals("Customer Onboarding", result.metaModel().entities().userJourneys().get(0).name());
        assertEquals("bu-1", result.metaModel().entities().userJourneys().get(0).primaryBusinessUserId());
        assertEquals("bp-1", result.metaModel().entities().userJourneys().get(0).parentBusinessProcessId());

        // Verify activity steps loaded
        assertNotNull(result.metaModel().entities().activitySteps());
        assertEquals(1, result.metaModel().entities().activitySteps().size());
        assertEquals("as-1", result.metaModel().entities().activitySteps().get(0).id());
        assertEquals("uj-1", result.metaModel().entities().activitySteps().get(0).userJourneyId());
        assertEquals("Fill Registration Form", result.metaModel().entities().activitySteps().get(0).name());
        assertEquals(1, result.metaModel().entities().activitySteps().get(0).sequenceOrder());
        assertEquals("pa-1", result.metaModel().entities().activitySteps().get(0).processActivityId());
        assertEquals("bu-1", result.metaModel().entities().activitySteps().get(0).businessUserId());
        assertEquals("app-1", result.metaModel().entities().activitySteps().get(0).applicationId());
    }

    @Test
    void loadModel_handlesEmptyUserJourneysAndActivitySteps() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        setupEmptyRepositoryMocks(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        // Verify empty lists are returned, not null
        assertNotNull(result.metaModel().entities().userJourneys());
        assertTrue(result.metaModel().entities().userJourneys().isEmpty());
        assertNotNull(result.metaModel().entities().activitySteps());
        assertTrue(result.metaModel().entities().activitySteps().isEmpty());
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

    private void setupEmptyRepositoryMocks(String modelFileId) {
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        setupOtherEmptyRepositoryMocks(modelFileId);
    }

    private void setupOtherEmptyRepositoryMocks(String modelFileId) {
        when(businessProcessRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(processActivityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(endpointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(classRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(methodRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataEntityPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(appBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interactionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(eventRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateTransitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityFlowRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityPartitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiScreenRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiContractRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiActionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiCharacteristicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetDefaultRuleRepository.findByModelFileIdOrderByPriorityDesc(modelFileId)).thenReturn(Collections.emptyList());
        // User Journey Meta-Model Foundation
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityStepRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        // Relationship repositories
        when(businessUserBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataMovementRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceLogicalEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        // Diagram repositories
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
    }

    private void setupOtherEmptyRepositoryMocksExcludingLogicalER(String modelFileId) {
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessProcessRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(processActivityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(endpointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(classRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(methodRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataEntityPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(appBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interactionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(eventRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateTransitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityFlowRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityPartitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiScreenRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiContractRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiActionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiCharacteristicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetDefaultRuleRepository.findByModelFileIdOrderByPriorityDesc(modelFileId)).thenReturn(Collections.emptyList());
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityStepRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessUserBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        // Note: logicalDataEntityRelationshipRepository mock is set by the test
        when(logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataMovementRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceLogicalEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
    }

    private void setupOtherEmptyRepositoryMocksExcludingUserJourney(String modelFileId) {
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessProcessRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(processActivityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(endpointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(classRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(methodRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(physicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataEntityPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(appBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interactionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(eventRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateTransitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityFlowRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityPartitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiScreenRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiContractRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiComponentRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiActionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(uiCharacteristicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(packageSetDefaultRuleRepository.findByModelFileIdOrderByPriorityDesc(modelFileId)).thenReturn(Collections.emptyList());
        // Note: userJourneyRepository and activityStepRepository mocks are set by the test
        when(businessUserBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataMovementRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceLogicalEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessLogicRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
    }
}
