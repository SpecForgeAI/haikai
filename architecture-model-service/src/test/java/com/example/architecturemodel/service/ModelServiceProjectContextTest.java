package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
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
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for ModelService export methods: loadProjectContext and exportCanonicalDiagram.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceProjectContextTest {

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
    // loadProjectContext Tests
    // ============================================================================

    @Test
    void loadProjectContext_returnsOnlyGeneralDiagrams_caseInsensitive() {
        // Arrange
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-project.json");

        // Create diagrams with different types
        DiagramEntity generalDiagram = createDiagramEntity("diagram-1", "General", modelFileId);
        DiagramEntity sequenceDiagram = createDiagramEntity("diagram-2", "Sequence", modelFileId);
        DiagramEntity generalLowercase = createDiagramEntity("diagram-3", "general", modelFileId);
        DiagramEntity activityDiagram = createDiagramEntity("diagram-4", "Activity", modelFileId);
        DiagramEntity generalMixedCase = createDiagramEntity("diagram-5", "GENERAL", modelFileId);

        when(modelFileRepository.findByFilenameIgnoreCase("test-project.json")).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(
            List.of(generalDiagram, sequenceDiagram, generalLowercase, activityDiagram, generalMixedCase)
        );
        setupEmptyRepositoryMocksExcludingDiagrams(modelFileId);
        // loadModel loads ALL diagrams, so we need to mock all 5
        setupEmptyDiagramDetailMocks("diagram-1", "diagram-2", "diagram-3", "diagram-4", "diagram-5");

        // Act
        ProjectContextPackageDto result = modelService.loadProjectContext("test-project.json");

        // Assert
        assertEquals("test-project.json", result.projectId());
        assertNotNull(result.metaModel());
        assertEquals(3, result.diagrams().size());
        assertTrue(result.diagrams().stream().allMatch(d ->
            d.diagramType().equalsIgnoreCase("General")));
    }

    @Test
    void loadProjectContext_canonicalizesEachReturnedDiagram() {
        // Arrange
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-project.json");

        DiagramEntity diagram = createDiagramEntity("diagram-1", "General", modelFileId);

        DiagramNodeEntity node1 = DiagramNodeEntity.builder().id("node-z").diagramId("diagram-1").modelFileId(modelFileId).build();
        DiagramNodeEntity node2 = DiagramNodeEntity.builder().id("node-a").diagramId("diagram-1").modelFileId(modelFileId).build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-project.json")).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(List.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(List.of(node1, node2));
        when(diagramEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramDecorationRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramInteractionEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        setupEmptyRepositoryMocksExcludingDiagrams(modelFileId);

        // Act
        ProjectContextPackageDto result = modelService.loadProjectContext("test-project.json");

        // Assert
        assertEquals(1, result.diagrams().size());
        DiagramDto resultDiagram = result.diagrams().get(0);
        // Nodes should be sorted by id (canonicalized)
        assertEquals("node-a", resultDiagram.diagramNodes().get(0).id());
        assertEquals("node-z", resultDiagram.diagramNodes().get(1).id());
    }

    @Test
    void loadProjectContext_throwsResourceNotFoundException_forMissingModelFile() {
        // Arrange
        when(modelFileRepository.findByFilenameIgnoreCase("nonexistent.json")).thenReturn(Optional.empty());

        // Act & Assert
        assertThrows(ResourceNotFoundException.class,
            () -> modelService.loadProjectContext("nonexistent.json"));
    }

    @Test
    void loadProjectContext_throwsIllegalArgumentException_forBlankFilename() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class,
            () -> modelService.loadProjectContext(""));
        assertThrows(IllegalArgumentException.class,
            () -> modelService.loadProjectContext("   "));
    }

    // ============================================================================
    // exportCanonicalDiagram Tests
    // ============================================================================

    @Test
    void exportCanonicalDiagram_returnsCanonicalized_diagramById() {
        // Arrange
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-project.json");

        DiagramEntity diagram = createDiagramEntity("diagram-1", "General", modelFileId);
        DiagramNodeEntity node1 = DiagramNodeEntity.builder().id("node-z").diagramId("diagram-1").modelFileId(modelFileId).build();
        DiagramNodeEntity node2 = DiagramNodeEntity.builder().id("node-a").diagramId("diagram-1").modelFileId(modelFileId).build();

        when(modelFileRepository.findByFilenameIgnoreCase("test-project.json")).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(List.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(List.of(node1, node2));
        when(diagramEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramDecorationRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramInteractionEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        setupEmptyRepositoryMocksExcludingDiagrams(modelFileId);

        // Act
        CanonicalDiagramExportDto result = modelService.exportCanonicalDiagram("test-project.json", "diagram-1");

        // Assert
        assertEquals("test-project.json", result.projectId());
        assertEquals("diagram-1", result.diagramId());
        assertEquals("General", result.diagramType());
        assertNotNull(result.canonical());
        // Verify canonicalization - nodes should be sorted
        assertEquals("node-a", result.canonical().diagramNodes().get(0).id());
        assertEquals("node-z", result.canonical().diagramNodes().get(1).id());
    }

    @Test
    void exportCanonicalDiagram_throwsResourceNotFoundException_whenDiagramNotFound() {
        // Arrange
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-project.json");

        DiagramEntity diagram = createDiagramEntity("diagram-1", "General", modelFileId);

        when(modelFileRepository.findByFilenameIgnoreCase("test-project.json")).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(List.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramDecorationRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        when(diagramInteractionEdgeRepository.findByDiagramId("diagram-1")).thenReturn(Collections.emptyList());
        setupEmptyRepositoryMocksExcludingDiagrams(modelFileId);

        // Act & Assert
        ResourceNotFoundException exception = assertThrows(ResourceNotFoundException.class,
            () -> modelService.exportCanonicalDiagram("test-project.json", "nonexistent-diagram"));
        assertTrue(exception.getMessage().contains("Diagram not found"));
    }

    @Test
    void exportCanonicalDiagram_throwsIllegalArgumentException_forBlankFilenameOrDiagramId() {
        // Act & Assert
        assertThrows(IllegalArgumentException.class,
            () -> modelService.exportCanonicalDiagram("", "diagram-1"));
        assertThrows(IllegalArgumentException.class,
            () -> modelService.exportCanonicalDiagram("test-project.json", ""));
        assertThrows(IllegalArgumentException.class,
            () -> modelService.exportCanonicalDiagram("   ", "diagram-1"));
        assertThrows(IllegalArgumentException.class,
            () -> modelService.exportCanonicalDiagram("test-project.json", "   "));
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

    private DiagramEntity createDiagramEntity(String id, String diagramType, String modelFileId) {
        return DiagramEntity.builder()
            .id(id)
            .modelFileId(modelFileId)
            .name("Test Diagram " + id)
            .diagramType(diagramType)
            .build();
    }

    private void setupEmptyDiagramDetailMocks(String... diagramIds) {
        for (String diagramId : diagramIds) {
            when(diagramNodeRepository.findByDiagramId(diagramId)).thenReturn(Collections.emptyList());
            when(diagramEdgeRepository.findByDiagramId(diagramId)).thenReturn(Collections.emptyList());
            when(diagramDecorationRepository.findByDiagramId(diagramId)).thenReturn(Collections.emptyList());
            when(diagramInteractionEdgeRepository.findByDiagramId(diagramId)).thenReturn(Collections.emptyList());
        }
    }

    private void setupEmptyRepositoryMocksExcludingDiagrams(String modelFileId) {
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
