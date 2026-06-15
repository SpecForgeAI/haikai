package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.*;
import com.example.architecturemodel.repository.diagram.*;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.*;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Gap-filling tests for ModelService user journey integration.
 *
 * Tests that were identified as coverage gaps in Task Group 5:
 * - Null userJourneys/activitySteps gracefully skipped during save (backward compat import)
 * - Delete ordering: activity_steps deleted before user_journeys
 * - createEmptyModel includes empty (not null) lists for new entity types
 *
 * Spec: User Journey Meta-Model Foundation (Task Group 5)
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceUserJourneyGapTest {

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

    // ============================================================================
    // Test 4: saveEntities with null userJourneys skips gracefully (backward compat)
    // ============================================================================

    @Test
    @DisplayName("saveModel with null userJourneys and activitySteps skips save gracefully")
    void saveEntities_nullUserJourneys_skipsGracefully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Create entities DTO with null userJourneys and activitySteps
        // This simulates importing a pre-feature snapshot where these fields are missing
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 1-6
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 7-12
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 13-18
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 19-24
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 25-30
            List.of(), List.of(), List.of(), List.of(),                       // 31-34
            null,  // userJourneys = null (missing from pre-feature snapshot)
            null,  // activitySteps = null (missing from pre-feature snapshot)
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of()
        );

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, createEmptyRelationships()),
            Collections.emptyList()
        );

        // Should not throw -- null entities should be skipped
        ModelFileSummaryDto result = modelService.saveModel("test-model", model);

        assertNotNull(result);
        // Verify that saveAll was never called on these repositories when fields are null
        verify(userJourneyRepository, never()).saveAll(anyList());
        verify(activityStepRepository, never()).saveAll(anyList());
    }

    // ============================================================================
    // Test 5: deleteAllDataForModelFile deletes activity_steps before user_journeys
    // ============================================================================

    @Test
    @DisplayName("deleteAllDataForModelFile deletes activitySteps before userJourneys and applications (child-first)")
    void deleteAllDataForModelFile_deletesActivityStepsBeforeUserJourneysAndApplications() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Trigger a save on an existing model, which calls deleteAllDataForModelFile first
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            Collections.emptyList()
        );

        modelService.saveModel("test-model", model);

        // Verify delete ordering: activitySteps must be deleted BEFORE userJourneys
        InOrder ujOrder = inOrder(activityStepRepository, userJourneyRepository);
        ujOrder.verify(activityStepRepository).deleteByModelFileId(modelFileId);
        ujOrder.verify(userJourneyRepository).deleteByModelFileId(modelFileId);

        // Verify delete ordering: activitySteps must be deleted BEFORE applications (FK: activity_steps.application_id)
        InOrder appOrder = inOrder(activityStepRepository, applicationRepository);
        appOrder.verify(activityStepRepository).deleteByModelFileId(modelFileId);
        appOrder.verify(applicationRepository).deleteByModelFileId(modelFileId);
    }

    // ============================================================================
    // Test 6: createEmptyModel includes empty (not null) userJourneys and activitySteps
    // ============================================================================

    @Test
    @DisplayName("loadModelByProjectId with no model file returns empty model with non-null userJourneys and activitySteps")
    void createEmptyModel_includesEmptyUserJourneysAndActivitySteps() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        // No model file exists for this project -- will trigger createEmptyModel()
        when(modelFileRepository.findByProjectIdAndArchitectureId(projectId, architectureId)).thenReturn(Optional.empty());

        ArchitectureModelDto result = modelService.loadModelByProjectIdAndArchitectureId(projectId, architectureId);

        // Verify the empty model has non-null empty lists for user journeys and activity steps
        assertNotNull(result);
        assertNotNull(result.metaModel());
        assertNotNull(result.metaModel().entities());
        assertNotNull(result.metaModel().entities().userJourneys(),
            "userJourneys should be an empty list, not null");
        assertTrue(result.metaModel().entities().userJourneys().isEmpty(),
            "userJourneys should be empty in a new model");
        assertNotNull(result.metaModel().entities().activitySteps(),
            "activitySteps should be an empty list, not null");
        assertTrue(result.metaModel().entities().activitySteps().isEmpty(),
            "activitySteps should be empty in a new model");
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

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
