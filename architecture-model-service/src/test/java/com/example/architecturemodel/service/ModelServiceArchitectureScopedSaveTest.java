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
import org.junit.jupiter.api.BeforeEach;
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
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Regression tests for the cross-architecture save bug.
 *
 * <p>Spec: Cross-Architecture Save Bug Fix (Spec 2026-05-01).</p>
 *
 * <p>Background: spec #6 / changeset 096 relaxed
 * {@code model_files.filename} from a global UNIQUE to a composite
 * {@code (architecture_id, filename)} UNIQUE INDEX so a clone can copy a
 * model file under a new architecture without colliding with the source.
 * The save flow originally called {@code findByFilename(filename)} which is
 * non-deterministic when two rows share the filename across architectures
 * -- saves landed on whichever row PostgreSQL handed back first, corrupting
 * the wrong architecture.</p>
 *
 * <p>The fix introduces {@code findByFilenameAndArchitectureId} on the
 * repository and an architecture-scoped
 * {@code saveModel(filename, projectId, architectureId, model)} overload on
 * the service. These tests verify that the new overload uses the scoped
 * lookup and writes to the correct row.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceArchitectureScopedSaveTest {

    // Shared fixture constants used across all four cross-architecture save tests.
    // Declared per the AMS test infrastructure cleanup spec (2026-05-25), Group 2,
    // Finding 3 in planning/requirements.md -- the existing tests referenced these
    // four names but their declarations were never added when the class was first
    // written. Not a record-constructor-drift fix.
    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCH_A = UUID.randomUUID();
    private static final UUID ARCH_B = UUID.randomUUID();
    private static final String FILENAME = "test-filename";

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
     * Test 1 (the bug B regression): After a clone, two model_files rows
     * share the same filename across two architectures. When the architecture-aware
     * saveModel overload is called for ARCH_B, it must look up the row by
     * (filename, ARCH_B) -- NOT by filename alone -- so it writes to the
     * correct row instead of the source row that ARCH_A owns.
     */
    @Test
    void saveModel_architectureAware_resolvesByFilenameAndArchitecture_notFilenameAlone() {
        ModelFileEntity rowForArchB = ModelFileEntity.builder()
            .id("mf-row-for-arch-b")
            .filename(FILENAME)
            .projectId(PROJECT_ID)
            .architectureId(ARCH_B)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();

        when(modelFileRepository.findByFilenameAndArchitectureId(FILENAME, ARCH_B))
            .thenReturn(Optional.of(rowForArchB));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        ArchitectureModelDto model = createEmptyModel();
        ModelFileSummaryDto result = modelService.saveModel(FILENAME, PROJECT_ID, ARCH_B, model);

        assertNotNull(result);
        assertEquals(FILENAME, result.filename());
        // Confirm it found the row via the architecture-scoped lookup, NOT
        // the legacy global findByFilename. This is the critical regression
        // assertion: pre-fix the call was findByFilename(FILENAME), which
        // post-clone could return ARCH_A's row by mistake.
        verify(modelFileRepository, times(1)).findByFilenameAndArchitectureId(FILENAME, ARCH_B);
        verify(modelFileRepository, never()).findByFilename(FILENAME);

        // The cascade-delete + save target the correct (ARCH_B) row.
        verify(diagramDecorationRepository).deleteByModelFileId(rowForArchB.getId());
        ArgumentCaptor<ModelFileEntity> savedCaptor = ArgumentCaptor.forClass(ModelFileEntity.class);
        verify(modelFileRepository).save(savedCaptor.capture());
        assertEquals(rowForArchB.getId(), savedCaptor.getValue().getId());
        assertEquals(ARCH_B, savedCaptor.getValue().getArchitectureId());
    }

    /**
     * Test 2: When no row exists for (filename, architectureId) -- the
     * "fresh save under a new architecture" path -- a new row is created
     * with both projectId and architectureId already populated (no need for
     * the post-save self-healing branch).
     */
    @Test
    void saveModel_architectureAware_freshSave_createsRowWithProjectAndArchitectureIds() {
        when(modelFileRepository.findByFilenameAndArchitectureId(FILENAME, ARCH_A))
            .thenReturn(Optional.empty());
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        ArchitectureModelDto model = createEmptyModel();
        modelService.saveModel(FILENAME, PROJECT_ID, ARCH_A, model);

        // Two saves: one to create the new row (synchronous) + one to update
        // its updatedAt timestamp at the end of saveModelInternal.
        ArgumentCaptor<ModelFileEntity> captor = ArgumentCaptor.forClass(ModelFileEntity.class);
        verify(modelFileRepository, times(2)).save(captor.capture());
        ModelFileEntity created = captor.getAllValues().get(0);
        assertEquals(FILENAME, created.getFilename());
        assertEquals(PROJECT_ID, created.getProjectId());
        assertEquals(ARCH_A, created.getArchitectureId());
    }

    /**
     * Test 3: The architecture-aware saveModel rejects a null
     * architectureId argument. We use the new overload precisely because
     * the architecture context is required; passing null undoes the fix.
     */
    @Test
    void saveModel_architectureAware_rejectsNullArchitectureId() {
        ArchitectureModelDto model = createEmptyModel();
        assertThrows(IllegalArgumentException.class,
            () -> modelService.saveModel(FILENAME, PROJECT_ID, null, model));
        verify(modelFileRepository, never()).findByFilenameAndArchitectureId(any(), any());
    }

    /**
     * Test 4: The legacy single-arg saveModel(filename, model) overload also
     * uses the architecture-scoped lookup when an active project + Default
     * architecture can be resolved. This covers the existing
     * PUT /api/model?filename=... callers (the Save / Save As buttons in the
     * frontend) so they too become safe post-clone -- without requiring
     * every call site to switch endpoints.
     */
    @Test
    void saveModel_legacyOverload_resolvesActiveProjectArchitectureAndDelegates() {
        ProjectEntity activeProject = ProjectEntity.builder()
            .id(PROJECT_ID)
            .name("test-project")
            .isActive(true)
            .build();
        ArchitectureEntity defaultArch = ArchitectureEntity.builder()
            .id(ARCH_A)
            .projectId(PROJECT_ID)
            .name("Default")
            .archived(false)
            .build();
        ModelFileEntity rowForArchA = ModelFileEntity.builder()
            .id("mf-row-for-arch-a")
            .filename(FILENAME)
            .projectId(PROJECT_ID)
            .architectureId(ARCH_A)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .build();

        when(projectRepository.findByIsActiveTrue()).thenReturn(Optional.of(activeProject));
        when(architectureRepository.findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(PROJECT_ID))
            .thenReturn(Optional.of(defaultArch));
        when(modelFileRepository.findByFilenameAndArchitectureId(FILENAME, ARCH_A))
            .thenReturn(Optional.of(rowForArchA));
        when(modelFileRepository.save(any(ModelFileEntity.class))).thenAnswer(inv -> inv.getArgument(0));

        ArchitectureModelDto model = createEmptyModel();
        ModelFileSummaryDto result = modelService.saveModel(FILENAME, model);

        assertNotNull(result);
        // CRITICAL: the legacy overload must NOT use the global findByFilename
        // lookup, because that is the lookup that breaks post-clone.
        verify(modelFileRepository, never()).findByFilename(FILENAME);
        // Instead it must delegate to the architecture-scoped lookup.
        verify(modelFileRepository).findByFilenameAndArchitectureId(FILENAME, ARCH_A);
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    private ArchitectureModelDto createEmptyModel() {
        return new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), createEmptyRelationships()),
            Collections.emptyList()
        );
    }

    private MetaModelEntitiesDto createEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
