package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.*;
import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
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
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Integration tests for diagram type persistence through ModelService.
 *
 * These tests verify that the diagramType field is correctly preserved
 * during save and load operations, confirming the end-to-end flow works
 * after adding @JsonAlias annotation support to DiagramDto.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceDiagramTypePersistenceTest {

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
        // ModelService is wired via @InjectMocks. Override the three mapper/canonicalizer
        // dependencies with real instances since tests assert mapping behaviour.
        org.springframework.test.util.ReflectionTestUtils.setField(modelService, "entityMapper", new EntityMapper());
        org.springframework.test.util.ReflectionTestUtils.setField(modelService, "diagramMapper", new DiagramMapper());
        org.springframework.test.util.ReflectionTestUtils.setField(modelService, "diagramCanonicalizer", new DiagramCanonicalizer());
    }

    /**
     * Test that saving a model with a diagram containing diagramType="Sequence"
     * correctly persists the diagram type to the entity.
     *
     * This simulates the scenario where JSON deserialization (via @JsonAlias)
     * has already populated the diagramType field from an alternate field name.
     */
    @Test
    void saveModel_withSequenceDiagramType_persistsDiagramTypeCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Create a diagram with diagramType="Sequence"
        DiagramDto sequenceDiagram = new DiagramDto(
            "diagram-1",
            "Sequence Diagram",
            "A test sequence diagram",
            "Sequence",  // This is the key field being tested
            null,  // settings
            null,  // viewQuarter
            Collections.emptyList(),  // diagramNodes
            Collections.emptyList(),  // diagramEdges
            Collections.emptyList(),  // decorations
            Collections.emptyList(),  // interactionEdges
            null   // typedContent - will be auto-populated by processTypedContent
        );

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            List.of(sequenceDiagram)
        );

        modelService.saveModel("test-model", model);

        // Capture the saved diagram entity (ModelService uses save() for each diagram)
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertEquals("diagram-1", savedDiagram.getId());
        assertEquals("Sequence", savedDiagram.getDiagramType());
    }

    /**
     * Test that loading a model with a diagram containing diagramType="Sequence"
     * correctly returns the diagram type in the DTO.
     */
    @Test
    void loadModel_withSequenceDiagramType_returnsDiagramTypeCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        // Create a diagram entity with diagramType="Sequence"
        DiagramEntity sequenceDiagramEntity = DiagramEntity.builder()
            .id("diagram-1")
            .modelFileId(modelFileId)
            .name("Sequence Diagram")
            .description("A test sequence diagram")
            .diagramType("Sequence")
            .build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(List.of(sequenceDiagramEntity));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramDecorationRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramInteractionEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        setupEmptyEntityRepositoryMocks(modelFileId);

        ArchitectureModelDto result = modelService.loadModel("test-model");

        assertNotNull(result);
        assertEquals(1, result.diagrams().size());
        DiagramDto loadedDiagram = result.diagrams().get(0);
        assertEquals("diagram-1", loadedDiagram.id());
        assertEquals("Sequence Diagram", loadedDiagram.name());
        assertEquals("Sequence", loadedDiagram.diagramType());
    }

    /**
     * Test save for multiple diagram types.
     * Verifies that different diagram types (Sequence, ER, Activity, State, General)
     * are all preserved correctly through the persistence layer.
     */
    @Test
    void saveModel_multipleTypedDiagrams_preservesDiagramTypesCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        // Setup save mocks
        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Create diagrams with different types
        DiagramDto sequenceDiagram = createDiagramWithType("diagram-seq", "Sequence Diagram", "Sequence");
        DiagramDto erDiagram = createDiagramWithType("diagram-er", "ER Diagram", "ER");
        DiagramDto activityDiagram = createDiagramWithType("diagram-act", "Activity Diagram", "Activity");
        DiagramDto stateDiagram = createDiagramWithType("diagram-state", "State Diagram", "State");
        DiagramDto generalDiagram = createDiagramWithType("diagram-gen", "General Diagram", "General");

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            List.of(sequenceDiagram, erDiagram, activityDiagram, stateDiagram, generalDiagram)
        );

        modelService.saveModel("test-model", model);

        // Capture all saved diagram entities (ModelService uses save() for each diagram)
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository, times(5)).save(captor.capture());

        List<DiagramEntity> savedDiagrams = captor.getAllValues();
        assertEquals(5, savedDiagrams.size());

        // Verify each diagram type was preserved
        assertEquals("Sequence", findDiagramById(savedDiagrams, "diagram-seq").getDiagramType());
        assertEquals("ER", findDiagramById(savedDiagrams, "diagram-er").getDiagramType());
        assertEquals("Activity", findDiagramById(savedDiagrams, "diagram-act").getDiagramType());
        assertEquals("State", findDiagramById(savedDiagrams, "diagram-state").getDiagramType());
        assertEquals("General", findDiagramById(savedDiagrams, "diagram-gen").getDiagramType());
    }

    // ========== Helper Methods ==========

    private DiagramDto createDiagramWithType(String id, String name, String diagramType) {
        return new DiagramDto(
            id,
            name,
            "Description for " + name,
            diagramType,
            null,  // settings
            null,  // viewQuarter
            Collections.emptyList(),  // diagramNodes
            Collections.emptyList(),  // diagramEdges
            Collections.emptyList(),  // decorations
            Collections.emptyList(),  // interactionEdges
            null   // typedContent
        );
    }

    private DiagramEntity findDiagramById(List<DiagramEntity> diagrams, String id) {
        return diagrams.stream()
            .filter(d -> id.equals(d.getId()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("Diagram not found: " + id));
    }

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

    private void setupEmptyEntityRepositoryMocks(String modelFileId) {
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
        when(appBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interactionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(eventRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(stateTransitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityFlowRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(activityPartitionRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(businessUserBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(applicationPointBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(dataMovementRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
        when(interfaceLogicalEntityRepository.findByModelFileId(modelFileId)).thenReturn(Collections.emptyList());
    }
}
