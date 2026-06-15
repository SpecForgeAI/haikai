package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.entity.InterfaceEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.EndpointRepository;
import com.example.architecturemodel.repository.entity.InterfaceRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataAttributeRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.repository.relationship.InterfaceLogicalEntityRepository;
import com.example.architecturemodel.repository.relationship.LogicalDataEntityRelationshipRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ContextBundleExpansionService service expansion functionality.
 *
 * Tests service bundle expansion rules including:
 * - service_only: returns only the service entity
 * - service_with_parents_and_children: includes Application and ApplicationComponent parents
 * - service_with_parents_and_children: includes child interfaces
 *
 * Spec: Context Bundles Backend Expansion - Task Group 5
 */
@ExtendWith(MockitoExtension.class)
class ContextBundleExpansionServiceServiceTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ImplementContextResolutionService resolutionService;
    @Mock private EndpointRepository endpointRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private PhysicalDataAttributeRepository physicalDataAttributeRepository;
    @Mock private LogicalDataEntityRelationshipRepository logicalDataEntityRelationshipRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;
    @Mock private DiagramRepository diagramRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private InterfaceLogicalEntityRepository interfaceLogicalEntityRepository;

    private ContextBundleExpansionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "model-file-123";
    private static final String SERVICE_ID = "service-001";

    @BeforeEach
    void setUp() {
        service = new ContextBundleExpansionService(
            modelFileRepository,
            resolutionService,
            endpointRepository,
            interfaceRepository,
            physicalDataAttributeRepository,
            logicalDataEntityRelationshipRepository,
            diagramNodeRepository,
            diagramRepository,
            serviceRepository,
            interfaceLogicalEntityRepository
        );
        // Set default configuration values via reflection
        ReflectionTestUtils.setField(service, "maxExpandedEntities", 250);
        ReflectionTestUtils.setField(service, "maxExpandedDiagrams", 50);
        ReflectionTestUtils.setField(service, "maxRelationships", 500);
    }

    private void setupModelFileRepository() {
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
    }

    // ============================================================================
    // Test: service_only returns only the service entity
    // ============================================================================

    @Nested
    @DisplayName("service_only expansion")
    class ServiceOnlyExpansionTests {

        @Test
        @DisplayName("service_only returns only the service entity in canonical format")
        void serviceOnly_returnsOnlyServiceEntity() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_only", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size(), "service_only should return only the service");
            assertEquals("services::" + SERVICE_ID, result.expandedEntityIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("service_only does not query service repository for parents")
        void serviceOnly_doesNotQueryServiceRepositoryForParents() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_only", null)
            );

            // Act
            service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert - service repository should NOT be queried for service_only
            verify(serviceRepository, never()).findById(anyString());
        }
    }

    // ============================================================================
    // Test: service_with_parents_and_children includes Application and ApplicationComponent parents
    // ============================================================================

    @Nested
    @DisplayName("service_with_parents_and_children expansion - parent relationships")
    class ServiceWithParentsExpansionTests {

        @Test
        @DisplayName("service_with_parents_and_children includes Application and ApplicationComponent parents")
        void serviceWithParentsAndChildren_includesParents() {
            // Arrange
            setupModelFileRepository();

            // Create mock service entity with parent references
            ServiceEntity serviceEntity = ServiceEntity.builder()
                .id(SERVICE_ID)
                .modelFileId(MODEL_FILE_ID)
                .name("User Service")
                .applicationId("app-001")
                .applicationComponentId("appcomp-001")
                .build();

            when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(serviceEntity));
            when(interfaceRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_with_parents_and_children", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 service + 1 application + 1 appComponent = 3 entities
            assertEquals(3, result.expandedEntityIds().size(), "Should include service and its parents");
            assertTrue(result.expandedEntityIds().contains("services::" + SERVICE_ID), "Should include the service itself");
            assertTrue(result.expandedEntityIds().contains("applications::app-001"), "Should include application parent");
            assertTrue(result.expandedEntityIds().contains("appComponents::appcomp-001"), "Should include appComponent parent");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("service_with_parents_and_children handles service with only applicationId (no applicationComponentId)")
        void serviceWithParentsAndChildren_onlyApplicationId() {
            // Arrange
            setupModelFileRepository();

            // Create mock service entity with only applicationId (no applicationComponentId)
            ServiceEntity serviceEntity = ServiceEntity.builder()
                .id(SERVICE_ID)
                .modelFileId(MODEL_FILE_ID)
                .name("Simple Service")
                .applicationId("app-002")
                .applicationComponentId(null)
                .build();

            when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(serviceEntity));
            when(interfaceRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_with_parents_and_children", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 service + 1 application = 2 entities (no appComponent)
            assertEquals(2, result.expandedEntityIds().size(), "Should include service and application only");
            assertTrue(result.expandedEntityIds().contains("services::" + SERVICE_ID), "Should include the service");
            assertTrue(result.expandedEntityIds().contains("applications::app-002"), "Should include application parent");
            assertFalse(result.expandedEntityIds().stream().anyMatch(id -> id.startsWith("appComponents::")),
                "Should NOT include any appComponent when applicationComponentId is null");
        }
    }

    // ============================================================================
    // Test: service_with_parents_and_children includes child interfaces
    // ============================================================================

    @Nested
    @DisplayName("service_with_parents_and_children expansion - child interfaces")
    class ServiceWithChildInterfacesExpansionTests {

        @Test
        @DisplayName("service_with_parents_and_children includes child interfaces")
        void serviceWithParentsAndChildren_includesChildInterfaces() {
            // Arrange
            setupModelFileRepository();

            // Create mock service entity
            ServiceEntity serviceEntity = ServiceEntity.builder()
                .id(SERVICE_ID)
                .modelFileId(MODEL_FILE_ID)
                .name("User Service")
                .applicationId("app-001")
                .applicationComponentId("appcomp-001")
                .build();

            // Create mock child interfaces
            InterfaceEntity interface1 = InterfaceEntity.builder()
                .id("interface-001")
                .modelFileId(MODEL_FILE_ID)
                .serviceId(SERVICE_ID)
                .name("User API")
                .build();

            InterfaceEntity interface2 = InterfaceEntity.builder()
                .id("interface-002")
                .modelFileId(MODEL_FILE_ID)
                .serviceId(SERVICE_ID)
                .name("Admin API")
                .build();

            // Create an interface belonging to a different service (should be excluded)
            InterfaceEntity otherServiceInterface = InterfaceEntity.builder()
                .id("interface-003")
                .modelFileId(MODEL_FILE_ID)
                .serviceId("other-service-999")
                .name("Other Service API")
                .build();

            when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(serviceEntity));
            when(interfaceRepository.findByModelFileId(MODEL_FILE_ID))
                .thenReturn(List.of(interface1, interface2, otherServiceInterface));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_with_parents_and_children", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 service + 1 application + 1 appComponent + 2 interfaces = 5 entities
            assertEquals(5, result.expandedEntityIds().size(), "Should include service, parents, and child interfaces");
            assertTrue(result.expandedEntityIds().contains("services::" + SERVICE_ID), "Should include the service");
            assertTrue(result.expandedEntityIds().contains("applications::app-001"), "Should include application parent");
            assertTrue(result.expandedEntityIds().contains("appComponents::appcomp-001"), "Should include appComponent parent");
            assertTrue(result.expandedEntityIds().contains("interfaces::interface-001"), "Should include first child interface");
            assertTrue(result.expandedEntityIds().contains("interfaces::interface-002"), "Should include second child interface");
            assertFalse(result.expandedEntityIds().contains("interfaces::interface-003"),
                "Should NOT include interface belonging to different service");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("service_with_parents_and_children with no child interfaces returns service and parents only")
        void serviceWithParentsAndChildren_noChildInterfaces() {
            // Arrange
            setupModelFileRepository();

            // Create mock service entity
            ServiceEntity serviceEntity = ServiceEntity.builder()
                .id(SERVICE_ID)
                .modelFileId(MODEL_FILE_ID)
                .name("Standalone Service")
                .applicationId("app-001")
                .applicationComponentId("appcomp-001")
                .build();

            when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.of(serviceEntity));
            when(interfaceRepository.findByModelFileId(MODEL_FILE_ID)).thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_with_parents_and_children", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 service + 1 application + 1 appComponent = 3 entities (no interfaces)
            assertEquals(3, result.expandedEntityIds().size(), "Should include service and parents only");
            assertTrue(result.expandedEntityIds().contains("services::" + SERVICE_ID));
            assertTrue(result.expandedEntityIds().contains("applications::app-001"));
            assertTrue(result.expandedEntityIds().contains("appComponents::appcomp-001"));
        }

        @Test
        @DisplayName("service_with_parents_and_children handles service not found gracefully")
        void serviceWithParentsAndChildren_serviceNotFound_returnsOnlyService() {
            // Arrange
            setupModelFileRepository();

            // Service not found in repository
            when(serviceRepository.findById(SERVICE_ID)).thenReturn(Optional.empty());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("services", SERVICE_ID, "service_with_parents_and_children", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert - should return just the service when service entity not found
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size(), "Should return only service when entity not found");
            assertEquals("services::" + SERVICE_ID, result.expandedEntityIds().get(0));
        }
    }
}
