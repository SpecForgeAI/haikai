package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.entity.EndpointEntity;
import com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
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
import java.util.UUID;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ContextBundleExpansionService interface expansion functionality.
 *
 * Tests interface bundle expansion rules including:
 * - interface_only: returns only the interface entity
 * - interface_with_endpoints: includes all endpoints via EndpointRepository.findByInterfaceId()
 * - interface_with_endpoints_and_schemas: includes endpoints AND data entities
 * - Data entity point ID parsing (dep_log_<id> and dep_phy_<id> formats)
 *
 * Spec: Context Bundles Backend Expansion - Task Group 4
 */
@ExtendWith(MockitoExtension.class)
class ContextBundleExpansionServiceInterfaceTest {

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
    private static final String INTERFACE_ID = "interface-001";

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
        modelFile.setFilename(PROJECT_ID.toString());
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
    }

    // ============================================================================
    // Test: interface_only returns only the interface entity
    // ============================================================================

    @Nested
    @DisplayName("interface_only expansion")
    class InterfaceOnlyExpansionTests {

        @Test
        @DisplayName("interface_only returns only the interface entity in canonical format")
        void interfaceOnly_returnsOnlyInterfaceEntity() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_only", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size(), "interface_only should return only the interface");
            assertEquals("interfaces::" + INTERFACE_ID, result.expandedEntityIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("interface_only does not query endpoint repository")
        void interfaceOnly_doesNotQueryEndpoints() {
            // Arrange
            setupModelFileRepository();
            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_only", null)
            );

            // Act
            service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert - endpoint repository should NOT be queried for interface_only
            verify(endpointRepository, never()).findByInterfaceId(anyString());
        }
    }

    // ============================================================================
    // Test: interface_with_endpoints includes all endpoints
    // ============================================================================

    @Nested
    @DisplayName("interface_with_endpoints expansion")
    class InterfaceWithEndpointsExpansionTests {

        @Test
        @DisplayName("interface_with_endpoints includes interface and all its endpoints")
        void interfaceWithEndpoints_includesAllEndpoints() {
            // Arrange
            setupModelFileRepository();

            // Create mock endpoints
            EndpointEntity endpoint1 = new EndpointEntity();
            endpoint1.setId("endpoint-001");
            endpoint1.setInterfaceId(INTERFACE_ID);
            endpoint1.setName("Get Users");

            EndpointEntity endpoint2 = new EndpointEntity();
            endpoint2.setId("endpoint-002");
            endpoint2.setInterfaceId(INTERFACE_ID);
            endpoint2.setName("Create User");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of(endpoint1, endpoint2));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 interface + 2 endpoints = 3 entities
            assertEquals(3, result.expandedEntityIds().size(), "Should include interface plus all endpoints");
            assertTrue(result.expandedEntityIds().contains("interfaces::" + INTERFACE_ID), "Should include the interface itself");
            assertTrue(result.expandedEntityIds().contains("endpoints::endpoint-001"), "Should include first endpoint");
            assertTrue(result.expandedEntityIds().contains("endpoints::endpoint-002"), "Should include second endpoint");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("interface_with_endpoints with no endpoints returns only interface")
        void interfaceWithEndpoints_noEndpoints_returnsOnlyInterface() {
            // Arrange
            setupModelFileRepository();
            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedEntityIds().size());
            assertEquals("interfaces::" + INTERFACE_ID, result.expandedEntityIds().get(0));
        }
    }

    // ============================================================================
    // Test: interface_with_endpoints_and_schemas includes endpoints AND data entities
    // ============================================================================

    @Nested
    @DisplayName("interface_with_endpoints_and_schemas expansion")
    class InterfaceWithEndpointsAndSchemasExpansionTests {

        @Test
        @DisplayName("interface_with_endpoints_and_schemas includes interface, endpoints, and data entities")
        void interfaceWithEndpointsAndSchemas_includesAll() {
            // Arrange
            setupModelFileRepository();

            // Create mock endpoints
            EndpointEntity endpoint1 = new EndpointEntity();
            endpoint1.setId("endpoint-001");
            endpoint1.setInterfaceId(INTERFACE_ID);
            endpoint1.setName("Get Users");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of(endpoint1));

            // Create mock interface-to-data-entity relationships
            InterfaceLogicalEntityEntity relation1 = new InterfaceLogicalEntityEntity();
            relation1.setId("ile-001");
            relation1.setInterfaceId(INTERFACE_ID);
            relation1.setDataEntityPointId("dep_log_user-entity-001");

            InterfaceLogicalEntityEntity relation2 = new InterfaceLogicalEntityEntity();
            relation2.setId("ile-002");
            relation2.setInterfaceId(INTERFACE_ID);
            relation2.setDataEntityPointId("dep_phy_user-table-001");

            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID))
                .thenReturn(List.of(relation1, relation2));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 interface + 1 endpoint + 2 data entities = 4 entities
            assertEquals(4, result.expandedEntityIds().size(), "Should include interface, endpoints, and data entities");
            assertTrue(result.expandedEntityIds().contains("interfaces::" + INTERFACE_ID), "Should include the interface");
            assertTrue(result.expandedEntityIds().contains("endpoints::endpoint-001"), "Should include the endpoint");
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::user-entity-001"), "Should include logical data entity");
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::user-table-001"), "Should include physical data entity");
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("interface_with_endpoints_and_schemas with no schemas returns interface and endpoints only")
        void interfaceWithEndpointsAndSchemas_noSchemas_returnsInterfaceAndEndpoints() {
            // Arrange
            setupModelFileRepository();

            EndpointEntity endpoint1 = new EndpointEntity();
            endpoint1.setId("endpoint-001");
            endpoint1.setInterfaceId(INTERFACE_ID);

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of(endpoint1));
            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertEquals(2, result.expandedEntityIds().size());
            assertTrue(result.expandedEntityIds().contains("interfaces::" + INTERFACE_ID));
            assertTrue(result.expandedEntityIds().contains("endpoints::endpoint-001"));
        }
    }

    // ============================================================================
    // Test: Data entity point ID parsing (dep_log_<id> and dep_phy_<id> formats)
    // ============================================================================

    @Nested
    @DisplayName("Data entity point ID parsing")
    class DataEntityPointIdParsingTests {

        @Test
        @DisplayName("dep_log_ prefix is parsed as logical data entity")
        void dataEntityPointId_logicalPrefix_parsedCorrectly() {
            // Arrange
            setupModelFileRepository();

            // Create mock interface-to-data-entity relationship with logical prefix
            InterfaceLogicalEntityEntity relation = new InterfaceLogicalEntityEntity();
            relation.setId("ile-001");
            relation.setInterfaceId(INTERFACE_ID);
            relation.setDataEntityPointId("dep_log_customer-entity-456");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());
            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of(relation));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::customer-entity-456"),
                "dep_log_ prefix should resolve to logicalDataEntities type");
        }

        @Test
        @DisplayName("dep_phy_ prefix is parsed as physical data entity")
        void dataEntityPointId_physicalPrefix_parsedCorrectly() {
            // Arrange
            setupModelFileRepository();

            // Create mock interface-to-data-entity relationship with physical prefix
            InterfaceLogicalEntityEntity relation = new InterfaceLogicalEntityEntity();
            relation.setId("ile-001");
            relation.setInterfaceId(INTERFACE_ID);
            relation.setDataEntityPointId("dep_phy_orders-table-789");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());
            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of(relation));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::orders-table-789"),
                "dep_phy_ prefix should resolve to physicalDataEntities type");
        }

        @Test
        @DisplayName("Mixed dep_log_ and dep_phy_ prefixes are parsed correctly")
        void dataEntityPointId_mixedPrefixes_parsedCorrectly() {
            // Arrange
            setupModelFileRepository();

            InterfaceLogicalEntityEntity relation1 = new InterfaceLogicalEntityEntity();
            relation1.setId("ile-001");
            relation1.setInterfaceId(INTERFACE_ID);
            relation1.setDataEntityPointId("dep_log_logical-entity-aaa");

            InterfaceLogicalEntityEntity relation2 = new InterfaceLogicalEntityEntity();
            relation2.setId("ile-002");
            relation2.setInterfaceId(INTERFACE_ID);
            relation2.setDataEntityPointId("dep_phy_physical-entity-bbb");

            InterfaceLogicalEntityEntity relation3 = new InterfaceLogicalEntityEntity();
            relation3.setId("ile-003");
            relation3.setInterfaceId(INTERFACE_ID);
            relation3.setDataEntityPointId("dep_log_another-logical-ccc");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());
            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID))
                .thenReturn(List.of(relation1, relation2, relation3));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert
            assertNotNull(result);
            // Should include: 1 interface + 2 logical entities + 1 physical entity = 4 entities
            assertEquals(4, result.expandedEntityIds().size());
            assertTrue(result.expandedEntityIds().contains("interfaces::" + INTERFACE_ID));
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::logical-entity-aaa"));
            assertTrue(result.expandedEntityIds().contains("physicalDataEntities::physical-entity-bbb"));
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::another-logical-ccc"));
        }

        @Test
        @DisplayName("Null or invalid dataEntityPointId is handled gracefully")
        void dataEntityPointId_nullOrInvalid_handledGracefully() {
            // Arrange
            setupModelFileRepository();

            // Create relation with null dataEntityPointId
            InterfaceLogicalEntityEntity relation1 = new InterfaceLogicalEntityEntity();
            relation1.setId("ile-001");
            relation1.setInterfaceId(INTERFACE_ID);
            relation1.setDataEntityPointId(null);

            // Create relation with invalid prefix
            InterfaceLogicalEntityEntity relation2 = new InterfaceLogicalEntityEntity();
            relation2.setId("ile-002");
            relation2.setInterfaceId(INTERFACE_ID);
            relation2.setDataEntityPointId("invalid_format_xyz");

            // Create valid relation
            InterfaceLogicalEntityEntity relation3 = new InterfaceLogicalEntityEntity();
            relation3.setId("ile-003");
            relation3.setInterfaceId(INTERFACE_ID);
            relation3.setDataEntityPointId("dep_log_valid-entity-123");

            when(endpointRepository.findByInterfaceId(INTERFACE_ID)).thenReturn(List.of());
            when(interfaceLogicalEntityRepository.findByInterfaceId(INTERFACE_ID))
                .thenReturn(List.of(relation1, relation2, relation3));

            List<EntityBundleSelection> selections = List.of(
                new EntityBundleSelection("interfaces", INTERFACE_ID, "interface_with_endpoints_and_schemas", null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

            // Assert - should not throw, should skip invalid entries
            assertNotNull(result);
            // Should include: 1 interface + 1 valid logical entity = 2 entities
            assertEquals(2, result.expandedEntityIds().size());
            assertTrue(result.expandedEntityIds().contains("interfaces::" + INTERFACE_ID));
            assertTrue(result.expandedEntityIds().contains("logicalDataEntities::valid-entity-123"));
        }
    }
}
