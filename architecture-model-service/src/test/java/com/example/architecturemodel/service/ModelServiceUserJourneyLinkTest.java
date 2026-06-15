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
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.example.architecturemodel.service.export.DiagramSvgRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Tests for ModelService user_journey_links integration.
 *
 * Tests loadRelationships, saveRelationships (with validation), and deleteAllDataForModelFile
 * for the user_journey_links relationship type.
 *
 * Spec: User Journey Links Meta-Model Foundation (Task Group 2, Tests 3-5)
 */
@ExtendWith(MockitoExtension.class)
class ModelServiceUserJourneyLinkTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;

    // Entity repositories
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

    // Relationship repositories
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

    // Infrastructure Domain entity repositories (13)
    @Mock private com.example.architecturemodel.repository.entity.EnvironmentRepository environmentRepository;
    @Mock private com.example.architecturemodel.repository.entity.CloudAccountRepository cloudAccountRepository;
    @Mock private com.example.architecturemodel.repository.entity.LocationRepository locationRepository;
    @Mock private com.example.architecturemodel.repository.entity.NetworkRepository networkRepository;
    @Mock private com.example.architecturemodel.repository.entity.SubnetRepository subnetRepository;
    @Mock private com.example.architecturemodel.repository.entity.ComputeClusterRepository computeClusterRepository;
    @Mock private com.example.architecturemodel.repository.entity.ComputeResourceRepository computeResourceRepository;
    @Mock private com.example.architecturemodel.repository.entity.DeploymentUnitRepository deploymentUnitRepository;
    @Mock private com.example.architecturemodel.repository.entity.LoadBalancerRepository loadBalancerRepository;
    @Mock private com.example.architecturemodel.repository.entity.ListenerRepository listenerRepository;
    @Mock private com.example.architecturemodel.repository.entity.DataStoreInstanceRepository dataStoreInstanceRepository;
    @Mock private com.example.architecturemodel.repository.entity.InfrastructureResourceRepository infrastructureResourceRepository;
    @Mock private com.example.architecturemodel.repository.entity.InfrastructurePointRepository infrastructurePointRepository;

    // Infrastructure Domain relationship repositories (3)
    @Mock private com.example.architecturemodel.repository.relationship.ResourceSubnetHostingRepository resourceSubnetHostingRepository;
    @Mock private com.example.architecturemodel.repository.relationship.DeploymentUnitComputeResourceRepository deploymentUnitComputeResourceRepository;
    @Mock private com.example.architecturemodel.repository.relationship.LoadBalancerResourceRouteRepository loadBalancerResourceRouteRepository;

    // Infrastructure Cross-Domain + IaC + Library + Discovery
    @Mock private com.example.architecturemodel.repository.relationship.ApplicationComputeDeploymentRepository applicationComputeDeploymentRepository;
    @Mock private com.example.architecturemodel.repository.relationship.DataEntityDataStoreHostingRepository dataEntityDataStoreHostingRepository;
    @Mock private com.example.architecturemodel.repository.relationship.ApplicationInfrastructureResourceUseRepository applicationInfrastructureResourceUseRepository;
    @Mock private com.example.architecturemodel.repository.relationship.ApplicationLoadBalancerExposureRepository applicationLoadBalancerExposureRepository;
    @Mock private com.example.architecturemodel.repository.entity.IaCSourceRepository iacSourceRepository;
    @Mock private com.example.architecturemodel.repository.relationship.IaCResourceBindingRepository iacResourceBindingRepository;
    @Mock private com.example.architecturemodel.repository.entity.LibraryRepository libraryRepository;
    @Mock private com.example.architecturemodel.repository.relationship.CodeUnitDependencyRepository codeUnitDependencyRepository;
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
            // Entity repositories
            businessUserRepository, businessProcessRepository, processActivityRepository,
            businessPointRepository, applicationRepository, applicationComponentRepository,
            serviceRepository, interfaceRepository, endpointRepository,
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
            // User Journey Meta-Model Foundation
            userJourneyRepository, activityStepRepository,
            // Infrastructure Domain entity repositories (13)
            environmentRepository, cloudAccountRepository, locationRepository,
            networkRepository, subnetRepository, computeClusterRepository,
            computeResourceRepository, deploymentUnitRepository,
            loadBalancerRepository, listenerRepository, dataStoreInstanceRepository,
            infrastructureResourceRepository, infrastructurePointRepository,
            // Relationship repositories
            businessUserBusinessPointRepository, applicationPointBusinessPointRepository,
            logicalDataEntityRelationshipRepository, logicalDataEntityPhysicalDataEntityRepository,
            logicalDataAttributePhysicalDataAttributeRepository, dataMovementRepository,
            interfaceLogicalEntityRepository,
            endpointDataEffectRepository,
            applicationPointBusinessLogicRepository,
            userJourneyLinkRepository,
            // Infrastructure Domain relationship repositories (3)
            resourceSubnetHostingRepository,
            deploymentUnitComputeResourceRepository,
            loadBalancerResourceRouteRepository,
            // Infrastructure Cross-Domain (4)
            applicationComputeDeploymentRepository,
            dataEntityDataStoreHostingRepository,
            applicationInfrastructureResourceUseRepository,
            applicationLoadBalancerExposureRepository,
            // IaC + Library
            iacSourceRepository, iacResourceBindingRepository,
            libraryRepository, codeUnitDependencyRepository,
            // DiscoveryRun
            discoveryRunRepository,
            // Diagram repositories
            diagramRepository, diagramNodeRepository, diagramEdgeRepository,
            diagramInteractionEdgeRepository, diagramDecorationRepository,
            // Mappers and utilities
            entityMapper, diagramMapper, diagramCanonicalizer, diagramSvgRenderer,
            projectService, dataEntityPointEnsureService
        );
    }

    // ============================================================================
    // Test 3: loadRelationships includes userJourneyLinks list
    // ============================================================================

    @Test
    @DisplayName("loadModel includes userJourneyLinks in MetaModelRelationshipsDto")
    void loadModel_includesUserJourneyLinks() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilenameIgnoreCase("test-model")).thenReturn(Optional.of(modelFile));

        // Stub all relationship repos to return empty lists
        when(businessUserBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(applicationPointBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(logicalDataEntityRelationshipRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(logicalDataEntityPhysicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(logicalDataAttributePhysicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(dataMovementRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(interfaceLogicalEntityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiWorkflowTransitionRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(applicationPointBusinessLogicRepository.findByModelFileId(modelFileId)).thenReturn(List.of());

        // Stub all entity repos to return empty lists
        when(businessUserRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(businessProcessRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(processActivityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(businessPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(applicationRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(applicationComponentRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(serviceRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(interfaceRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(endpointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(classRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(methodRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(applicationPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(logicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(logicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(physicalDataEntityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(physicalDataAttributeRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(dataEntityPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(interactionRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(appBusinessPointRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(eventRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(stateRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(stateTransitionRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(activityRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(activityFlowRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(activityPartitionRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiScreenRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiContractRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiComponentRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiActionRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(uiCharacteristicRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(businessLogicRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(packageSetRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(packageRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(packageSetDefaultRuleRepository.findByModelFileIdOrderByPriorityDesc(modelFileId)).thenReturn(List.of());
        when(userJourneyRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(activityStepRepository.findByModelFileId(modelFileId)).thenReturn(List.of());
        when(diagramRepository.findByModelFileId(modelFileId)).thenReturn(List.of());

        // Return actual user journey link entities
        UserJourneyLinkEntity link1 = UserJourneyLinkEntity.builder()
            .id("ujl-001")
            .modelFileId(modelFileId)
            .sourceUserJourneyId("uj-onboarding")
            .targetUserJourneyId("uj-checkout")
            .relationshipType("PRECEDES")
            .label("after onboarding")
            .description("Onboarding precedes checkout")
            .tags("domain:customer")
            .build();

        when(userJourneyLinkRepository.findByModelFileId(modelFileId))
            .thenReturn(List.of(link1));

        // When
        ArchitectureModelDto result = modelService.loadModel("test-model");

        // Then
        assertNotNull(result);
        assertNotNull(result.metaModel().relationships().userJourneyLinks());
        assertThat(result.metaModel().relationships().userJourneyLinks()).hasSize(1);

        UserJourneyLinkDto dto = result.metaModel().relationships().userJourneyLinks().get(0);
        assertThat(dto.id()).isEqualTo("ujl-001");
        assertThat(dto.sourceUserJourneyId()).isEqualTo("uj-onboarding");
        assertThat(dto.targetUserJourneyId()).isEqualTo("uj-checkout");
        assertThat(dto.relationshipType()).isEqualTo("PRECEDES");
        assertThat(dto.label()).isEqualTo("after onboarding");
    }

    // ============================================================================
    // Test 4: saveRelationships persists valid user_journey_links
    // ============================================================================

    @Test
    @DisplayName("saveModel persists valid user_journey_links with allowed relationship_type")
    void saveModel_persistsValidUserJourneyLinks() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));

        UserJourneyLinkDto link = new UserJourneyLinkDto(
            "ujl-001",
            "uj-onboarding",
            "uj-checkout",
            "PRECEDES",
            "after onboarding",
            "Onboarding precedes checkout",
            "domain:customer"
        );

        MetaModelRelationshipsDto relationships = createEmptyRelationshipsWithLinks(List.of(link));

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        // When
        ModelFileSummaryDto result = modelService.saveModel("test-model", model);

        // Then
        assertNotNull(result);
        verify(userJourneyLinkRepository).saveAll(anyList());
    }

    // ============================================================================
    // Test 5: saveRelationships rejects invalid relationship_type
    // ============================================================================

    @Test
    @DisplayName("saveModel rejects user_journey_link with invalid relationship_type")
    void saveModel_rejectsInvalidRelationshipType() {
        String modelFileId = "mf-1";
        ModelFileEntity modelFile = createModelFile(modelFileId, "test-model");

        when(modelFileRepository.findByFilename("test-model")).thenReturn(Optional.of(modelFile));

        UserJourneyLinkDto invalidLink = new UserJourneyLinkDto(
            "ujl-bad",
            "uj-onboarding",
            "uj-checkout",
            "INVALID_TYPE",  // Not in the allowed enum
            null,
            null,
            null
        );

        MetaModelRelationshipsDto relationships = createEmptyRelationshipsWithLinks(List.of(invalidLink));

        ArchitectureModelDto model = new ArchitectureModelDto(
            new MetaModelDto(createEmptyEntities(), relationships),
            Collections.emptyList()
        );

        // When / Then
        com.example.architecturemodel.exception.ValidationException ex =
            assertThrows(com.example.architecturemodel.exception.ValidationException.class, () -> {
            modelService.saveModel("test-model", model);
        });

        assertThat(ex.getMessage()).contains("INVALID_TYPE");
        assertThat(ex.getMessage()).contains("ujl-bad");
        verify(userJourneyLinkRepository, never()).saveAll(anyList());
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

    private MetaModelRelationshipsDto createEmptyRelationshipsWithLinks(List<UserJourneyLinkDto> links) {
        return new MetaModelRelationshipsDto(
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), List.of(),
            links,
            // Infrastructure (3) + Cross-Domain (4) + IaC (1) + Library (1) = 9
            List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of()
        );
    }
}
