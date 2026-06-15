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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
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
 * Tests for Task Group 3: Diagram Create and Save Flow Updates.
 *
 * These tests verify:
 * 1. Create Sequence diagram auto-populates default typedContent
 * 2. Create ER diagram auto-populates default typedContent
 * 3. Create General diagram has NULL typedContent
 * 4. Save diagram with typedContent persists correctly
 * 5. Save with type mismatch (typedContent.type != diagram.diagram_type) returns 400
 * 6. Save with invalid version returns 400
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class TypedContentCreateSaveFlowTest {

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

    /**
     * Test 1: Create Sequence diagram auto-populates default typedContent.
     *
     * When a diagram with type "Sequence" is saved without typedContent,
     * the service should auto-populate it with the default Sequence structure.
     */
    @Test
    @DisplayName("Test 1: Create Sequence diagram auto-populates default typedContent")
    void testCreateSequenceDiagramAutoPopulatesTypedContent() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create Sequence diagram without typedContent (should be auto-populated)
        DiagramDto sequenceDiagram = new DiagramDto(
            "seq-diagram-1",
            "Sequence Diagram",
            "Test sequence diagram",
            "Sequence",
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null  // No typedContent provided - should be auto-populated
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(sequenceDiagram));
        modelService.saveModel("test-model", model);

        // Capture the saved diagram entity
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson(), "Sequence diagram should have typedContentJson");

        Map<String, Object> typedContent = savedDiagram.getTypedContentJson();
        assertEquals("Sequence", typedContent.get("type"), "Type should be Sequence");
        assertEquals(1, typedContent.get("version"), "Version should be 1");

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        assertNotNull(content, "Content should not be null");
        assertTrue(content.containsKey("participants"), "Should have participants array");
        assertTrue(content.containsKey("messages"), "Should have messages array");
        assertTrue(content.containsKey("fragments"), "Should have fragments array");
        assertTrue(content.containsKey("operands"), "Should have operands array");
        assertTrue(content.containsKey("sequenceNodes"), "Should have sequenceNodes array");
    }

    /**
     * Test 2: Create ER diagram auto-populates default typedContent.
     *
     * When a diagram with type "ER" is saved without typedContent,
     * the service should auto-populate it with the default ER structure.
     */
    @Test
    @DisplayName("Test 2: Create ER diagram auto-populates default typedContent")
    void testCreateERDiagramAutoPopulatesTypedContent() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create ER diagram without typedContent (should be auto-populated)
        DiagramDto erDiagram = new DiagramDto(
            "er-diagram-1",
            "ER Diagram",
            "Test ER diagram",
            "ER",
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null  // No typedContent provided - should be auto-populated
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(erDiagram));
        modelService.saveModel("test-model", model);

        // Capture the saved diagram entity
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson(), "ER diagram should have typedContentJson");

        Map<String, Object> typedContent = savedDiagram.getTypedContentJson();
        assertEquals("ER", typedContent.get("type"), "Type should be ER");
        assertEquals(1, typedContent.get("version"), "Version should be 1");

        @SuppressWarnings("unchecked")
        Map<String, Object> content = (Map<String, Object>) typedContent.get("content");
        assertNotNull(content, "Content should not be null");
        assertTrue(content.containsKey("entityRefs"), "Should have entityRefs array");
        assertTrue(content.containsKey("relationshipRefs"), "Should have relationshipRefs array");
    }

    /**
     * Test 3: Create General diagram has NULL typedContent.
     *
     * When a diagram with type "General" is saved, the typedContent
     * should remain NULL.
     */
    @Test
    @DisplayName("Test 3: Create General diagram has NULL typedContent")
    void testCreateGeneralDiagramHasNullTypedContent() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create General diagram (typedContent should remain null)
        DiagramDto generalDiagram = new DiagramDto(
            "general-diagram-1",
            "General Diagram",
            "Test general diagram",
            "General",
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null  // Should remain null for General diagrams
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(generalDiagram));
        modelService.saveModel("test-model", model);

        // Capture the saved diagram entity
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNull(savedDiagram.getTypedContentJson(), "General diagram should have null typedContentJson");
    }

    /**
     * Test 4: Save diagram with typedContent persists correctly.
     *
     * When a diagram is saved with existing typedContent, it should
     * be persisted without modification (assuming validation passes).
     */
    @Test
    @DisplayName("Test 4: Save diagram with typedContent persists correctly")
    void testSaveDiagramWithTypedContentPersistsCorrectly() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(diagramRepository.save(any(DiagramEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        // Create typedContent with some data
        Map<String, Object> content = new LinkedHashMap<>();
        List<Map<String, Object>> participants = new ArrayList<>();
        Map<String, Object> participant = new LinkedHashMap<>();
        participant.put("id", "part-1");
        participant.put("refKind", "Application");
        participant.put("refId", "app-1");
        participant.put("orderIndex", 0);
        participants.add(participant);
        content.put("participants", participants);
        content.put("messages", new ArrayList<>());
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);
        typedContent.put("content", content);

        // Create Sequence diagram with existing typedContent
        DiagramDto sequenceDiagram = new DiagramDto(
            "seq-diagram-1",
            "Sequence Diagram",
            "Test sequence diagram",
            "Sequence",
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            typedContent  // Existing typedContent
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(sequenceDiagram));
        modelService.saveModel("test-model", model);

        // Capture the saved diagram entity
        ArgumentCaptor<DiagramEntity> captor = ArgumentCaptor.forClass(DiagramEntity.class);
        verify(diagramRepository).save(captor.capture());

        DiagramEntity savedDiagram = captor.getValue();
        assertNotNull(savedDiagram.getTypedContentJson(), "typedContentJson should not be null");

        Map<String, Object> savedTypedContent = savedDiagram.getTypedContentJson();
        assertEquals("Sequence", savedTypedContent.get("type"));
        assertEquals(1, savedTypedContent.get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> savedContent = (Map<String, Object>) savedTypedContent.get("content");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> savedParticipants = (List<Map<String, Object>>) savedContent.get("participants");
        assertEquals(1, savedParticipants.size(), "Should have 1 participant");
        assertEquals("part-1", savedParticipants.get(0).get("id"));
    }

    /**
     * Test 5: Save with type mismatch (typedContent.type != diagram.diagram_type) returns 400.
     *
     * When typedContent.type does not match diagram.diagram_type,
     * the save should throw an IllegalArgumentException (translated to 400).
     */
    @Test
    @DisplayName("Test 5: Save with type mismatch returns validation error")
    void testSaveWithTypeMismatchThrowsError() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Create typedContent with mismatched type
        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("type", "ER");  // Mismatch: typedContent says ER
        typedContent.put("version", 1);
        typedContent.put("content", new LinkedHashMap<>());

        // Create diagram with type "Sequence" but typedContent.type "ER"
        DiagramDto mismatchedDiagram = new DiagramDto(
            "seq-diagram-1",
            "Sequence Diagram",
            "Test sequence diagram",
            "Sequence",  // Diagram type is Sequence
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            typedContent  // But typedContent.type is ER
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(mismatchedDiagram));

        // Should throw IllegalArgumentException for type mismatch
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> modelService.saveModel("test-model", model)
        );

        assertTrue(exception.getMessage().contains("type mismatch") ||
                   exception.getMessage().contains("does not match"),
            "Error message should indicate type mismatch");
    }

    /**
     * Test 6: Save with invalid version returns 400.
     *
     * When typedContent.version is not present or not equal to 1,
     * the save should throw an IllegalArgumentException (translated to 400).
     */
    @Test
    @DisplayName("Test 6: Save with invalid version returns validation error")
    void testSaveWithInvalidVersionThrowsError() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        // Create typedContent with invalid version (version 2 instead of 1)
        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 2);  // Invalid: must be 1

        Map<String, Object> content = new LinkedHashMap<>();
        content.put("participants", new ArrayList<>());
        content.put("messages", new ArrayList<>());
        content.put("fragments", new ArrayList<>());
        content.put("operands", new ArrayList<>());
        content.put("sequenceNodes", new ArrayList<>());
        typedContent.put("content", content);

        // Create diagram with invalid version in typedContent
        DiagramDto invalidVersionDiagram = new DiagramDto(
            "seq-diagram-1",
            "Sequence Diagram",
            "Test sequence diagram",
            "Sequence",
            null,
            null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            typedContent  // Has version 2 instead of 1
        );

        ArchitectureModelDto model = createModelWithDiagrams(List.of(invalidVersionDiagram));

        // Should throw IllegalArgumentException for invalid version
        IllegalArgumentException exception = assertThrows(
            IllegalArgumentException.class,
            () -> modelService.saveModel("test-model", model)
        );

        assertTrue(exception.getMessage().contains("version") ||
                   exception.getMessage().contains("Version"),
            "Error message should indicate version issue");
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

    private ArchitectureModelDto createModelWithDiagrams(List<DiagramDto> diagrams) {
        return new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            diagrams
        );
    }

    private MetaModelEntitiesDto createEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
