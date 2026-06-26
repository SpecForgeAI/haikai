package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.DiagramMapper;
import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.*;
import com.example.architecturemodel.model.dto.relationship.*;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.*;
import com.example.architecturemodel.repository.diagram.*;
import com.example.architecturemodel.repository.entity.*;
import com.example.architecturemodel.repository.relationship.*;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.repository.targetmanifest.TargetManifestArtifactRepository;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

/**
 * Wiring tests for {@link ModelService} integration with the 16 new
 * Infrastructure Domain repositories injected by Task Group 7.
 *
 * <p>Verifies that:
 * <ul>
 *   <li>{@code saveEntities}/{@code saveRelationships} invoke {@code saveAll}
 *       on each of the 16 new repositories when the relevant DTO list is
 *       populated.</li>
 *   <li>{@code loadModelByFileId} invokes {@code findByModelFileId} on each
 *       of the 13 entity repos and 3 relationship repos.</li>
 *   <li>{@code deleteAllDataForModelFile} invokes {@code deleteByModelFileId}
 *       on the 16 new repos in dependency-safe order: the 3 relationships
 *       first, then {@code infrastructure_points}, then the 12 entity tables
 *       in reverse-dependency order.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-04-infrastructure-domain-backend-foundation -- Task Group 7.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ModelServiceInfrastructureWiringTest {

    // Core infrastructure repositories
    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;

    // Pre-existing entity repositories (full set required by ModelService constructor)
    @Mock private BusinessUserRepository businessUserRepository;
    @Mock private BusinessProcessRepository businessProcessRepository;
    @Mock private ProcessActivityRepository processActivityRepository;
    @Mock private BusinessPointRepository businessPointRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private ApplicationComponentRepository applicationComponentRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private TargetManifestArtifactRepository targetManifestArtifactRepository;
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

    // Infrastructure Domain entity repositories (Task Group 7 - the 13 under test)
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

    // Pre-existing relationship repositories
    @Mock private BusinessUserBusinessPointRepository businessUserBusinessPointRepository;
    @Mock private ApplicationPointBusinessPointRepository applicationPointBusinessPointRepository;
    @Mock private LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    @Mock private LogicalDataEntityPhysicalDataEntityRepository logicalDataEntityPhysicalDataEntityRepository;
    @Mock private LogicalDataAttributePhysicalDataAttributeRepository logicalDataAttributePhysicalDataAttributeRepository;
    @Mock private DataMovementRepository dataMovementRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;
    @Mock private EndpointDataEffectRepository endpointDataEffectRepository;
    @Mock private ApplicationPointBusinessLogicRepository applicationPointBusinessLogicRepository;
    @Mock private UserJourneyLinkRepository userJourneyLinkRepository;

    // Infrastructure Domain relationship repositories (Task Group 7 - the 3 under test)
    @Mock private ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    @Mock private DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    @Mock private LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;

    // Infrastructure Cross-Domain + IaC + Library + Discovery (post-2026-05-04 additions to ModelService ctor)
    @Mock private ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    @Mock private DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    @Mock private ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    @Mock private ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;
    @Mock private IaCSourceRepository iacSourceRepository;
    @Mock private IaCResourceBindingRepository iacResourceBindingRepository;
    @Mock private LibraryRepository libraryRepository;
    @Mock private CodeUnitDependencyRepository codeUnitDependencyRepository;
    @Mock private com.example.architecturemodel.repository.entity.DiscoveryRunRepository discoveryRunRepository;

    // Diagram repositories
    @Mock private DiagramRepository diagramRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;
    @Mock private DiagramEdgeRepository diagramEdgeRepository;
    @Mock private DiagramInteractionEdgeRepository diagramInteractionEdgeRepository;
    @Mock private DiagramDecorationRepository diagramDecorationRepository;

    // Service dependencies
    @Mock private DiagramSvgRenderer diagramSvgRenderer;
    @Mock private ProjectService projectService;
    @Mock private DataEntityPointEnsureService dataEntityPointEnsureService;

    private ModelService modelService;

    @BeforeEach
    void setUp() {
        EntityMapper entityMapper = new EntityMapper();
        DiagramMapper diagramMapper = new DiagramMapper();
        DiagramCanonicalizer diagramCanonicalizer = new DiagramCanonicalizer();

        modelService = new ModelService(
            modelFileRepository,
            projectRepository,
            architectureRepository,
            // Existing entity repositories
            businessUserRepository, businessProcessRepository, processActivityRepository,
            businessPointRepository, applicationRepository, applicationComponentRepository,
            serviceRepository, targetManifestArtifactRepository, interfaceRepository, endpointRepository,
            classRepository, methodRepository,
            applicationPointRepository,
            logicalDataEntityRepository, logicalDataAttributeRepository,
            physicalDataEntityRepository, physicalDataAttributeRepository,
            appBusinessPointRepository, interactionRepository,
            eventRepository, stateRepository, stateTransitionRepository,
            activityRepository, activityFlowRepository, activityPartitionRepository,
            uiScreenRepository, uiWorkflowTransitionRepository,
            uiContractRepository, uiComponentRepository, uiActionRepository,
            uiCharacteristicRepository,
            businessLogicRepository,
            packageSetRepository, packageRepository,
            packageSetDefaultRuleRepository,
            dataEntityPointRepository,
            userJourneyRepository, activityStepRepository,
            // Infrastructure Domain entity repositories (13 - Task Group 7)
            environmentRepository, cloudAccountRepository, locationRepository,
            networkRepository, subnetRepository, computeClusterRepository,
            computeResourceRepository, deploymentUnitRepository,
            loadBalancerRepository, listenerRepository, dataStoreInstanceRepository,
            infrastructureResourceRepository, infrastructurePointRepository,
            // Existing relationship repositories
            businessUserBusinessPointRepository, applicationPointBusinessPointRepository,
            logicalDataEntityRelationshipRepository, logicalDataEntityPhysicalDataEntityRepository,
            logicalDataAttributePhysicalDataAttributeRepository, dataMovementRepository,
            interfaceLogicalEntityRepository,
            endpointDataEffectRepository,
            applicationPointBusinessLogicRepository,
            userJourneyLinkRepository,
            // Infrastructure Domain relationship repositories (3 - Task Group 7)
            resourceSubnetHostingRepository,
            deploymentUnitComputeResourceRepository,
            loadBalancerResourceRouteRepository,
            // Infrastructure Cross-Domain relationships (Spec 2026-05-05)
            applicationComputeDeploymentRepository,
            dataEntityDataStoreHostingRepository,
            applicationInfrastructureResourceUseRepository,
            applicationLoadBalancerExposureRepository,
            // IaC + Library (Spec 2026-05-05)
            iacSourceRepository, iacResourceBindingRepository,
            libraryRepository, codeUnitDependencyRepository,
            // DiscoveryRunRepository (changeset 126)
            discoveryRunRepository,
            // Diagram repositories
            diagramRepository, diagramNodeRepository, diagramEdgeRepository,
            diagramInteractionEdgeRepository, diagramDecorationRepository,
            // Mappers and utilities
            entityMapper, diagramMapper, diagramCanonicalizer, diagramSvgRenderer,
            projectService, dataEntityPointEnsureService
        );
    }

    // ========================================================================
    // saveModel - verifies saveAll is invoked on each of the 16 new repos when
    // the corresponding DTO list is populated.
    // ========================================================================

    @Test
    void saveModel_populatesAllInfrastructureLists_invokesAllSixteenSaveAll() {
        String modelFileId = "mf-infra-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "infra-model");

        when(modelFileRepository.findByFilename("infra-model"))
            .thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class)))
            .thenReturn(modelFile);

        ArchitectureModelDto model = buildModelWithAllInfrastructurePopulated();
        modelService.saveModel("infra-model", model);

        // 13 entity saveAll invocations
        verify(environmentRepository).saveAll(anyList());
        verify(cloudAccountRepository).saveAll(anyList());
        verify(locationRepository).saveAll(anyList());
        verify(networkRepository).saveAll(anyList());
        verify(subnetRepository).saveAll(anyList());
        verify(computeClusterRepository).saveAll(anyList());
        verify(computeResourceRepository).saveAll(anyList());
        verify(deploymentUnitRepository).saveAll(anyList());
        verify(loadBalancerRepository).saveAll(anyList());
        verify(listenerRepository).saveAll(anyList());
        verify(dataStoreInstanceRepository).saveAll(anyList());
        verify(infrastructureResourceRepository).saveAll(anyList());
        verify(infrastructurePointRepository).saveAll(anyList());

        // 3 relationship saveAll invocations
        verify(resourceSubnetHostingRepository).saveAll(anyList());
        verify(deploymentUnitComputeResourceRepository).saveAll(anyList());
        verify(loadBalancerResourceRouteRepository).saveAll(anyList());
    }

    // ========================================================================
    // loadModelByFileId - verifies findByModelFileId is invoked on each of the
    // 13 entity repos and 3 relationship repos.
    // ========================================================================

    @Test
    void loadModel_invokesFindByModelFileIdOnAllSixteenInfrastructureRepos() {
        String modelFileId = "mf-infra-2";
        ModelFileEntity modelFile = createModelFile(modelFileId, "infra-model");

        when(modelFileRepository.findByFilenameIgnoreCase("infra-model"))
            .thenReturn(Optional.of(modelFile));

        ArchitectureModelDto result = modelService.loadModel("infra-model");

        // 13 entity findByModelFileId invocations
        verify(environmentRepository).findByModelFileId(modelFileId);
        verify(cloudAccountRepository).findByModelFileId(modelFileId);
        verify(locationRepository).findByModelFileId(modelFileId);
        verify(networkRepository).findByModelFileId(modelFileId);
        verify(subnetRepository).findByModelFileId(modelFileId);
        verify(computeClusterRepository).findByModelFileId(modelFileId);
        verify(computeResourceRepository).findByModelFileId(modelFileId);
        verify(deploymentUnitRepository).findByModelFileId(modelFileId);
        verify(loadBalancerRepository).findByModelFileId(modelFileId);
        verify(listenerRepository).findByModelFileId(modelFileId);
        verify(dataStoreInstanceRepository).findByModelFileId(modelFileId);
        verify(infrastructureResourceRepository).findByModelFileId(modelFileId);
        verify(infrastructurePointRepository).findByModelFileId(modelFileId);

        // 3 relationship findByModelFileId invocations
        verify(resourceSubnetHostingRepository).findByModelFileId(modelFileId);
        verify(deploymentUnitComputeResourceRepository).findByModelFileId(modelFileId);
        verify(loadBalancerResourceRouteRepository).findByModelFileId(modelFileId);

        // Returned model exposes all 13 entity lists and 3 relationship lists as
        // empty (not null) when the mocked repos return empty lists.
        assertNotNull(result);
        assertNotNull(result.metaModel().entities().environments());
        assertNotNull(result.metaModel().entities().cloudAccounts());
        assertNotNull(result.metaModel().entities().locations());
        assertNotNull(result.metaModel().entities().networks());
        assertNotNull(result.metaModel().entities().subnets());
        assertNotNull(result.metaModel().entities().computeClusters());
        assertNotNull(result.metaModel().entities().computeResources());
        assertNotNull(result.metaModel().entities().deploymentUnits());
        assertNotNull(result.metaModel().entities().loadBalancers());
        assertNotNull(result.metaModel().entities().listeners());
        assertNotNull(result.metaModel().entities().dataStoreInstances());
        assertNotNull(result.metaModel().entities().infrastructureResources());
        assertNotNull(result.metaModel().entities().infrastructurePoints());
        assertNotNull(result.metaModel().relationships().resourceSubnetHostings());
        assertNotNull(result.metaModel().relationships().deploymentUnitComputeResources());
        assertNotNull(result.metaModel().relationships().loadBalancerResourceRoutes());
    }

    // ========================================================================
    // deleteAllDataForModelFile (exercised via saveModel on an existing file) -
    // verifies deleteByModelFileId is invoked on the 16 new repos in
    // dependency-safe order.
    // ========================================================================

    @Test
    void saveModel_existingFile_deletesInfrastructureInDependencySafeOrder() {
        String modelFileId = "mf-infra-3";
        ModelFileEntity modelFile = createModelFile(modelFileId, "infra-model");

        when(modelFileRepository.findByFilename("infra-model"))
            .thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class)))
            .thenReturn(modelFile);

        ArchitectureModelDto emptyModel = buildEmptyModel();
        modelService.saveModel("infra-model", emptyModel);

        // Verify each of the 16 new repos was asked to delete by modelFileId.
        verify(loadBalancerResourceRouteRepository).deleteByModelFileId(modelFileId);
        verify(deploymentUnitComputeResourceRepository).deleteByModelFileId(modelFileId);
        verify(resourceSubnetHostingRepository).deleteByModelFileId(modelFileId);
        verify(infrastructurePointRepository).deleteByModelFileId(modelFileId);
        verify(infrastructureResourceRepository).deleteByModelFileId(modelFileId);
        verify(dataStoreInstanceRepository).deleteByModelFileId(modelFileId);
        verify(listenerRepository).deleteByModelFileId(modelFileId);
        verify(loadBalancerRepository).deleteByModelFileId(modelFileId);
        verify(deploymentUnitRepository).deleteByModelFileId(modelFileId);
        verify(computeResourceRepository).deleteByModelFileId(modelFileId);
        verify(computeClusterRepository).deleteByModelFileId(modelFileId);
        verify(subnetRepository).deleteByModelFileId(modelFileId);
        verify(networkRepository).deleteByModelFileId(modelFileId);
        verify(locationRepository).deleteByModelFileId(modelFileId);
        verify(cloudAccountRepository).deleteByModelFileId(modelFileId);
        verify(environmentRepository).deleteByModelFileId(modelFileId);

        // Dependency-safe order: relationships first, then infrastructure_points,
        // then 12 entity tables in reverse-dependency order.
        InOrder order = inOrder(
            loadBalancerResourceRouteRepository,
            deploymentUnitComputeResourceRepository,
            resourceSubnetHostingRepository,
            infrastructurePointRepository,
            infrastructureResourceRepository,
            dataStoreInstanceRepository,
            listenerRepository,
            loadBalancerRepository,
            deploymentUnitRepository,
            computeResourceRepository,
            computeClusterRepository,
            subnetRepository,
            networkRepository,
            locationRepository,
            cloudAccountRepository,
            environmentRepository
        );
        order.verify(loadBalancerResourceRouteRepository).deleteByModelFileId(modelFileId);
        order.verify(deploymentUnitComputeResourceRepository).deleteByModelFileId(modelFileId);
        order.verify(resourceSubnetHostingRepository).deleteByModelFileId(modelFileId);
        order.verify(infrastructurePointRepository).deleteByModelFileId(modelFileId);
        order.verify(infrastructureResourceRepository).deleteByModelFileId(modelFileId);
        order.verify(dataStoreInstanceRepository).deleteByModelFileId(modelFileId);
        order.verify(listenerRepository).deleteByModelFileId(modelFileId);
        order.verify(loadBalancerRepository).deleteByModelFileId(modelFileId);
        order.verify(deploymentUnitRepository).deleteByModelFileId(modelFileId);
        order.verify(computeResourceRepository).deleteByModelFileId(modelFileId);
        order.verify(computeClusterRepository).deleteByModelFileId(modelFileId);
        order.verify(subnetRepository).deleteByModelFileId(modelFileId);
        order.verify(networkRepository).deleteByModelFileId(modelFileId);
        order.verify(locationRepository).deleteByModelFileId(modelFileId);
        order.verify(cloudAccountRepository).deleteByModelFileId(modelFileId);
        order.verify(environmentRepository).deleteByModelFileId(modelFileId);
    }

    // ========================================================================
    // saveEntities - verifies parents-first FK-safe save ordering across the 13
    // infrastructure entity repositories.
    // ========================================================================

    @Test
    void saveModel_persistsInfrastructureEntitiesInParentsFirstOrder() {
        String modelFileId = "mf-infra-4";
        ModelFileEntity modelFile = createModelFile(modelFileId, "infra-model");

        when(modelFileRepository.findByFilename("infra-model"))
            .thenReturn(Optional.of(modelFile));
        when(modelFileRepository.save(any(ModelFileEntity.class)))
            .thenReturn(modelFile);

        ArchitectureModelDto model = buildModelWithAllInfrastructurePopulated();
        modelService.saveModel("infra-model", model);

        // Parents-first: environments -> cloud_accounts -> locations -> networks
        // -> subnets -> compute_clusters -> compute_resources -> deployment_units
        // -> load_balancers -> listeners -> data_store_instances ->
        // infrastructure_resources -> infrastructure_points.
        InOrder order = inOrder(
            environmentRepository, cloudAccountRepository, locationRepository,
            networkRepository, subnetRepository, computeClusterRepository,
            computeResourceRepository, deploymentUnitRepository,
            loadBalancerRepository, listenerRepository, dataStoreInstanceRepository,
            infrastructureResourceRepository, infrastructurePointRepository,
            resourceSubnetHostingRepository, deploymentUnitComputeResourceRepository,
            loadBalancerResourceRouteRepository
        );
        order.verify(environmentRepository).saveAll(anyList());
        order.verify(cloudAccountRepository).saveAll(anyList());
        order.verify(locationRepository).saveAll(anyList());
        order.verify(networkRepository).saveAll(anyList());
        order.verify(subnetRepository).saveAll(anyList());
        order.verify(computeClusterRepository).saveAll(anyList());
        order.verify(computeResourceRepository).saveAll(anyList());
        order.verify(deploymentUnitRepository).saveAll(anyList());
        order.verify(loadBalancerRepository).saveAll(anyList());
        order.verify(listenerRepository).saveAll(anyList());
        order.verify(dataStoreInstanceRepository).saveAll(anyList());
        order.verify(infrastructureResourceRepository).saveAll(anyList());
        order.verify(infrastructurePointRepository).saveAll(anyList());
        // Relationships saved after entities (saveRelationships runs after saveEntities)
        order.verify(resourceSubnetHostingRepository).saveAll(anyList());
        order.verify(deploymentUnitComputeResourceRepository).saveAll(anyList());
        order.verify(loadBalancerResourceRouteRepository).saveAll(anyList());
    }

    // ========================================================================
    // Helpers
    // ========================================================================

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

    private ArchitectureModelDto buildEmptyModel() {
        MetaModelEntitiesDto entities = buildEmptyEntities();
        MetaModelRelationshipsDto rels = buildEmptyRelationships();
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), Collections.emptyList());
    }

    private ArchitectureModelDto buildModelWithAllInfrastructurePopulated() {
        MetaModelEntitiesDto entities = new MetaModelEntitiesDto(
            // Pre-existing domain lists -- empty, only the 13 infra lists are populated.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(),
            // Infrastructure domain - 13 single-element lists.
            List.of(buildEnvironment()),
            List.of(buildCloudAccount()),
            List.of(buildLocation()),
            List.of(buildNetwork()),
            List.of(buildSubnet()),
            List.of(buildComputeCluster()),
            List.of(buildComputeResource()),
            List.of(buildDeploymentUnit()),
            List.of(buildLoadBalancer()),
            List.of(buildListener()),
            List.of(buildDataStoreInstance()),
            List.of(buildInfrastructureResource()),
            List.of(buildInfrastructurePoint()),
            // iacSources, libraries
            List.of(), List.of()
        );
        MetaModelRelationshipsDto rels = new MetaModelRelationshipsDto(
            // Pre-existing relationship lists.
            List.of(), List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            // Infrastructure relationships -- 3 single-element lists.
            List.of(buildResourceSubnetHosting()),
            List.of(buildDeploymentUnitComputeResource()),
            List.of(buildLoadBalancerResourceRoute()),
            // Cross-domain (4) + iacResourceBindings + codeUnitDependencies
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
        return new ArchitectureModelDto(new MetaModelDto(entities, rels), Collections.emptyList());
    }

    private MetaModelEntitiesDto buildEmptyEntities() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyEntities();
    }

    private MetaModelRelationshipsDto buildEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }

    // ------------------------------------------------------------------------
    // Minimal infrastructure DTO builders. Only id and the most essential
    // fields are populated; remaining fields are null / default.
    // ------------------------------------------------------------------------

    private EnvironmentDto buildEnvironment() {
        return new EnvironmentDto(
            "env-1", "Prod", null, null, null, null,
            "PRODUCTION", "RUNNING", true, false, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private CloudAccountDto buildCloudAccount() {
        return new CloudAccountDto(
            "ca-1", "Acct", null, null, null, null,
            "env-1", "AWS", null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private LocationDto buildLocation() {
        return new LocationDto(
            "loc-1", "Loc", null, null, null, null,
            "env-1", null, "REGION", "AWS",
            "us-east-1", "us-east-1a", null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private NetworkDto buildNetwork() {
        return new NetworkDto(
            "net-1", "Net", null, null, null, null,
            "env-1", null, null,
            "VPC", "AWS", "10.0.0.0/16", null, false, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private SubnetDto buildSubnet() {
        return new SubnetDto(
            "sub-1", "Subnet", null, null, null, null,
            "env-1", "net-1", null,
            "10.0.1.0/24", "PUBLIC", "PUBLIC",
            "us-east-1", "us-east-1a", null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private ComputeClusterDto buildComputeCluster() {
        return new ComputeClusterDto(
            "cc-1", "Cluster", null, null, null, null,
            "env-1", null, null, null,
            "EKS", "AWS", "1.27", null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private ComputeResourceDto buildComputeResource() {
        return new ComputeResourceDto(
            "cr-1", "Compute", null, null, null, null,
            "env-1", null, null, null,
            "EC2", "AWS", null, null, null, null,
            "linux", null, "t3.medium", null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private DeploymentUnitDto buildDeploymentUnit() {
        return new DeploymentUnitDto(
            "du-1", "Deploy", null, null, null, null,
            null, "CONTAINER", "1.0", null, null, null,
            null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private LoadBalancerDto buildLoadBalancer() {
        return new LoadBalancerDto(
            "lb-1", "LB", null, null, null, null,
            "env-1", null, null, null,
            "ALB", "AWS", "PUBLIC", "internet-facing", null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private ListenerDto buildListener() {
        return new ListenerDto(
            "lst-1", "Listener", null, null, null, null,
            "env-1", "lb-1", null,
            "HTTPS", 443, null, null, "PUBLIC", true, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private DataStoreInstanceDto buildDataStoreInstance() {
        return new DataStoreInstanceDto(
            "ds-1", "DB", null, null, null, null,
            "env-1", null, null,
            "RDS", "POSTGRES", "15", "AWS",
            null, 5432, null, null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private InfrastructureResourceDto buildInfrastructureResource() {
        return new InfrastructureResourceDto(
            "ir-1", "Resource", null, null, null, null,
            "env-1", null, null,
            "QUEUE", "AWS", "AWS::SQS::Queue", null, null, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private InfrastructurePointDto buildInfrastructurePoint() {
        return new InfrastructurePointDto(
            "ip-1", "COMPUTE_RESOURCE",
            null, null, null, null, null, null,
            "cr-1",
            null, null, null, null, null
        );
    }

    private ResourceSubnetHostingDto buildResourceSubnetHosting() {
        return new ResourceSubnetHostingDto(
            "rsh-1", "ip-1", "sub-1", "env-1",
            null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
    }

    private DeploymentUnitComputeResourceDto buildDeploymentUnitComputeResource() {
        return new DeploymentUnitComputeResourceDto(
            "ducr-1", "du-1", "ip-1", "env-1",
            null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
    }

    private LoadBalancerResourceRouteDto buildLoadBalancerResourceRoute() {
        return new LoadBalancerResourceRouteDto(
            "lbrr-1", "lb-1", null, "ip-1", "env-1",
            null, null, null, null, null, null, null, null,
            null, null, null, null, null, null
        );
    }
}
