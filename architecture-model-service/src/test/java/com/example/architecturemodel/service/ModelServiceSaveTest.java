package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
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
import org.springframework.test.util.ReflectionTestUtils;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Save / delete tests for {@link ModelService}.
 *
 * <p>Refactored 2026-05-25 per the AMS test infrastructure cleanup spec
 * (Group 2 long-pole) from a direct {@code new ModelService(...)} call with
 * ~17+ stale repository arguments to {@code @InjectMocks} + Lombok's
 * generated {@code @RequiredArgsConstructor}. The Mockito wiring matches
 * {@link ModelServiceArchitectureScopedSaveTest}, which already uses the same
 * pattern. The refactor immunises the file against future infrastructure-domain
 * specs that add more repository arguments to {@link ModelService}.</p>
 */
@ExtendWith(MockitoExtension.class)
class ModelServiceSaveTest {

    // ModelService dependencies in declaration order (mirrors
    // ModelServiceArchitectureScopedSaveTest so the two files stay aligned
    // when new repositories land).
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
        // Override the mocked mapper / canonicalizer fields with real instances
        // because the existing tests assert on entity-mapping and diagram-
        // canonicalization behaviour. This matches the setUp pattern in
        // ModelServiceArchitectureScopedSaveTest.
        ReflectionTestUtils.setField(modelService, "entityMapper", new EntityMapper());
        ReflectionTestUtils.setField(modelService, "diagramMapper", new DiagramMapper());
        ReflectionTestUtils.setField(modelService, "diagramCanonicalizer", new DiagramCanonicalizer());
    }

    @Test
    void saveModel_newFile_createsAndSaves() {
        when(modelFileRepository.findByFilename("new-model")).thenReturn(Optional.empty());
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenAnswer(invocation -> {
            ModelFileEntity entity = invocation.getArgument(0);
            return entity;
        });

        ArchitectureModelDto model = createEmptyModel();
        ModelFileSummaryDto result = modelService.saveModel("new-model", model);

        assertNotNull(result);
        assertEquals("new-model", result.filename());
        verify(modelFileRepository, times(2)).save(any(ModelFileEntity.class));
    }

    @Test
    void saveModel_existingFile_truncatesAndInserts() {
        String modelFileId = "mf-existing";
        ModelFileEntity existingFile = createModelFile(modelFileId, "existing-model");

        when(modelFileRepository.findByFilename("existing-model")).thenReturn(Optional.of(existingFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(existingFile);

        ArchitectureModelDto model = createEmptyModel();
        ModelFileSummaryDto result = modelService.saveModel("existing-model", model);

        assertNotNull(result);
        verify(diagramDecorationRepository).deleteByModelFileId(modelFileId);
        verify(businessUserRepository).deleteByModelFileId(modelFileId);
    }

    @Test
    void saveModel_withBusinessUsers_savesEntities() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(businessUserRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        BusinessUserDto user = new BusinessUserDto("user-1", "Test User", "Description", "tags", null);
        MetaModelEntitiesDto entities = createEntitiesWithBusinessUsers(List.of(user));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, createEmptyRelationships()),
            Collections.emptyList()
        );

        modelService.saveModel("test-model", model);

        ArgumentCaptor<List<BusinessUserEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(businessUserRepository).saveAll(captor.capture());

        List<BusinessUserEntity> saved = captor.getValue();
        assertEquals(1, saved.size());
        assertEquals("user-1", saved.get(0).getId());
        assertEquals("Test User", saved.get(0).getName());
    }

    @Test
    void deleteModel_existingFile_deletesSuccessfully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));

        modelService.deleteModel("test-model");

        verify(modelFileRepository).delete(modelFile);
    }

    @Test
    void deleteModel_notFound_throwsException() {
        when(modelFileRepository.findByFilename("nonexistent")).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class,
            () -> modelService.deleteModel("nonexistent"));
    }

    @Test
    void saveModel_preservesIds() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(applicationRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        ApplicationDto app = new ApplicationDto(
            "app-custom-id", "Test App", "Description", "WEB", "ACTIVE", "tags", "2024-Q1", "2025-Q4", true, null
        );
        MetaModelEntitiesDto entities = createEntitiesWithApplications(List.of(app));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, createEmptyRelationships()),
            Collections.emptyList()
        );

        modelService.saveModel("test-model", model);

        ArgumentCaptor<List<ApplicationEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(applicationRepository).saveAll(captor.capture());

        List<ApplicationEntity> saved = captor.getValue();
        assertEquals("app-custom-id", saved.get(0).getId());
    }

    // ============================================================================
    // LogicalDataEntityRelationship Tests - Task Group 7
    // ============================================================================

    @Test
    void saveModel_withLogicalERRelationship_validEndpoints_savesSuccessfully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(logicalDataEntityRelationshipRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        LogicalDataEntityRelationshipDto relationship = new LogicalDataEntityRelationshipDto(
            "rel-1", "dep_log_entity-1", "dep_log_entity-2",
            "ONE_TO_MANY", "ASSOCIATION", "Test relationship", "data,test", "2024-Q1", "2025-Q4",
            null
        );

        MetaModelRelationshipsDto relationships = createRelationshipsWithLogicalER(List.of(relationship));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        ModelFileSummaryDto result = modelService.saveModel("test-model", model);

        assertNotNull(result);

        ArgumentCaptor<List<LogicalDataEntityRelationshipEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(logicalDataEntityRelationshipRepository).saveAll(captor.capture());

        List<LogicalDataEntityRelationshipEntity> saved = captor.getValue();
        assertEquals(1, saved.size());
        assertEquals("rel-1", saved.get(0).getId());
        assertEquals("dep_log_entity-1", saved.get(0).getFromDataEntityPointId());
        assertEquals("dep_log_entity-2", saved.get(0).getToDataEntityPointId());
    }

    @Test
    void saveModel_withLogicalERRelationship_crossDomainEndpoints_savesSuccessfully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(logicalDataEntityRelationshipRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        LogicalDataEntityRelationshipDto relationship = new LogicalDataEntityRelationshipDto(
            "rel-cross-domain", "dep_log_entity-1", "dep_phy_entity-1",
            "MANY_TO_ONE", "GENERALIZATION", "Cross-domain relationship",
            null, null, null,
            null
        );

        MetaModelRelationshipsDto relationships = createRelationshipsWithLogicalER(List.of(relationship));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        ModelFileSummaryDto result = modelService.saveModel("test-model", model);

        assertNotNull(result);
        verify(logicalDataEntityRelationshipRepository).saveAll(anyList());
    }

    @Test
    void saveModel_withLogicalERRelationship_nullEndpoints_rejectsWithValidation() {
        // Legacy-field-removal hardening: from/to data-entity-point ids are now
        // REQUIRED on logical ER relationships; a null-endpoint relationship is
        // rejected with a structured ValidationException before any save.
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);

        LogicalDataEntityRelationshipDto relationship = new LogicalDataEntityRelationshipDto(
            "rel-null-endpoints", null, null,
            null, null, "Partial relationship", null, null, null,
            null
        );

        MetaModelRelationshipsDto relationships = createRelationshipsWithLogicalER(List.of(relationship));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        com.example.architecturemodel.exception.ValidationException ex = org.junit.jupiter.api.Assertions.assertThrows(
            com.example.architecturemodel.exception.ValidationException.class,
            () -> modelService.saveModel("test-model", model));
        org.assertj.core.api.Assertions.assertThat(ex.getMessage()).contains("fromDataEntityPointId is required");
        verify(logicalDataEntityRelationshipRepository, never()).saveAll(anyList());
    }

    @Test
    void saveModel_withLogicalERRelationship_allCardinalityValues_savesSuccessfully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(logicalDataEntityRelationshipRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        List<String> cardinalityValues = List.of("ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY");
        List<LogicalDataEntityRelationshipDto> relationships = new java.util.ArrayList<>();

        for (int i = 0; i < cardinalityValues.size(); i++) {
            relationships.add(new LogicalDataEntityRelationshipDto(
                "rel-cardinality-" + i, "dep_log_from-" + i, "dep_log_to-" + i,
                cardinalityValues.get(i), "ASSOCIATION", null, null, null, null,
                null
            ));
        }

        MetaModelRelationshipsDto relationshipsDto = createRelationshipsWithLogicalER(relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationshipsDto),
            Collections.emptyList()
        );

        ModelFileSummaryDto result = modelService.saveModel("test-model", model);
        assertNotNull(result);
        verify(logicalDataEntityRelationshipRepository).saveAll(anyList());
    }

    @Test
    void saveModel_withLogicalERRelationship_allRelationshipValues_savesSuccessfully() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(logicalDataEntityRelationshipRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        List<String> relationshipValues = List.of(
            "GENERALIZATION", "REALIZATION", "COMPOSITION", "AGGREGATION", "ASSOCIATION", "DEPENDENCY"
        );
        List<LogicalDataEntityRelationshipDto> relationships = new java.util.ArrayList<>();

        for (int i = 0; i < relationshipValues.size(); i++) {
            relationships.add(new LogicalDataEntityRelationshipDto(
                "rel-type-" + i, "dep_log_from-" + i, "dep_log_to-" + i,
                "ONE_TO_ONE", relationshipValues.get(i), null, null, null, null,
                null
            ));
        }

        MetaModelRelationshipsDto relationshipsDto = createRelationshipsWithLogicalER(relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationshipsDto),
            Collections.emptyList()
        );

        ModelFileSummaryDto result = modelService.saveModel("test-model", model);
        assertNotNull(result);
        verify(logicalDataEntityRelationshipRepository).saveAll(anyList());
    }

    // ============================================================================
    // User Journey Meta-Model Foundation - Save Tests (Task Group 3)
    // ============================================================================

    @Test
    void saveModel_persistsUserJourneys() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(userJourneyRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        UserJourneyDto journey = new UserJourneyDto(
            "uj-1", "Customer Onboarding", "End-to-end onboarding flow",
            "onboarding", "bu-1", "bp-1"
        );

        MetaModelEntitiesDto entities = createEntitiesWithUserJourneys(List.of(journey));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, createEmptyRelationships()),
            Collections.emptyList()
        );

        modelService.saveModel("test-model", model);

        ArgumentCaptor<List<UserJourneyEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(userJourneyRepository).saveAll(captor.capture());

        List<UserJourneyEntity> saved = captor.getValue();
        assertEquals(1, saved.size());
        assertEquals("uj-1", saved.get(0).getId());
        assertEquals("Customer Onboarding", saved.get(0).getName());
        assertEquals("End-to-end onboarding flow", saved.get(0).getDescription());
        assertEquals("onboarding", saved.get(0).getTags());
        assertEquals("bu-1", saved.get(0).getPrimaryBusinessUserId());
        assertEquals("bp-1", saved.get(0).getParentBusinessProcessId());
        assertEquals(modelFileId, saved.get(0).getModelFileId());
    }

    @Test
    void saveModel_persistsActivitySteps() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenReturn(modelFile);
        when(activityStepRepository.saveAll(anyList())).thenReturn(Collections.emptyList());

        ActivityStepDto step = new ActivityStepDto(
            "as-1", "uj-1", "Fill Registration Form", "User fills out registration",
            "registration", 1, "pa-1", "bu-1", "app-1", null, null, null
        );

        MetaModelEntitiesDto entities = createEntitiesWithActivitySteps(List.of(step));
        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(entities, createEmptyRelationships()),
            Collections.emptyList()
        );

        modelService.saveModel("test-model", model);

        ArgumentCaptor<List<ActivityStepEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(activityStepRepository).saveAll(captor.capture());

        List<ActivityStepEntity> saved = captor.getValue();
        assertEquals(1, saved.size());
        assertEquals("as-1", saved.get(0).getId());
        assertEquals("uj-1", saved.get(0).getUserJourneyId());
        assertEquals("Fill Registration Form", saved.get(0).getName());
        assertEquals(1, saved.get(0).getSequenceOrder());
        assertEquals("pa-1", saved.get(0).getProcessActivityId());
        assertEquals("bu-1", saved.get(0).getBusinessUserId());
        assertEquals("app-1", saved.get(0).getApplicationId());
        assertEquals(modelFileId, saved.get(0).getModelFileId());
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

    private ArchitectureModelDto createEmptyModel() {
        return new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            Collections.emptyList()
        );
    }

    // 36 fields total in MetaModelEntitiesDto
    private MetaModelEntitiesDto createEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }

    // businessUsers (pos 1) = users; remaining 35 positions = List.of()
    private MetaModelEntitiesDto createEntitiesWithBusinessUsers(List<BusinessUserDto> users) {
        return new MetaModelEntitiesDto(
            users,                                                            // 1
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 2-7
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 8-13
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 14-19
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 20-25
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 26-31
            List.of(), List.of(), List.of(), List.of(), List.of(),             // 32-36
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    // applications (pos 5) = apps; 4 before + 31 after = 35 List.of()
    private MetaModelEntitiesDto createEntitiesWithApplications(List<ApplicationDto> apps) {
        return new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(),                       // 1-4
            apps,                                                             // 5
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 6-11
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 12-17
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 18-23
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 24-29
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 30-35
            List.of(),                                                         // 36
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    // userJourneys (pos 35) = journeys; 34 before + 1 after = 35 List.of()
    private MetaModelEntitiesDto createEntitiesWithUserJourneys(List<UserJourneyDto> journeys) {
        return new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 1-6
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 7-12
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 13-18
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 19-24
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 25-30
            List.of(), List.of(), List.of(), List.of(),                       // 31-34
            journeys,                                                         // 35
            List.of(),                                                         // 36
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    // activitySteps (pos 36) = steps; 35 before = 35 List.of()
    private MetaModelEntitiesDto createEntitiesWithActivitySteps(List<ActivityStepDto> steps) {
        return new MetaModelEntitiesDto(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 1-6
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 7-12
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 13-18
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 19-24
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), // 25-30
            List.of(), List.of(), List.of(), List.of(), List.of(),            // 31-35
            steps,                                                             // 36
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }

    private MetaModelRelationshipsDto createRelationshipsWithLogicalER(
            List<LogicalDataEntityRelationshipDto> logicalERRelationships) {
        return new MetaModelRelationshipsDto(
            List.of(),                         // businessUserBusinessPoints
            List.of(),                         // applicationPointBusinessPoints
            logicalERRelationships,            // logicalDataEntityRelationships
            List.of(),                         // logicalDataEntityPhysicalDataEntities
            List.of(),                         // logicalDataAttributePhysicalDataAttributes
            List.of(),                         // dataMovements
            List.of(),                         // interfaceLogicalEntities
            List.of(),                         // uiWorkflowTransitions
            List.of(),                          // applicationPointBusinessLogics
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }
}
