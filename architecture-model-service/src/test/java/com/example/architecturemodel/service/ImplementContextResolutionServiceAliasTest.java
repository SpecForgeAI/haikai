package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

/**
 * Unit tests for Entity Type Alias Canonicalization in ImplementContextResolutionService.
 *
 * Spec: 2026-01-16 Fix Implement Context Resolution Entity Type Canonicalization
 *
 * Tests that snake_case entity type aliases resolve correctly to their camelCase
 * canonical equivalents, providing defense-in-depth alongside Gateway normalization.
 */
@ExtendWith(MockitoExtension.class)
class ImplementContextResolutionServiceAliasTest {

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private ServiceRepository serviceRepository;
    @Mock private ClassRepository classRepository;
    @Mock private MethodRepository methodRepository;
    @Mock private InterfaceRepository interfaceRepository;
    @Mock private ApplicationRepository applicationRepository;
    @Mock private ApplicationComponentRepository applicationComponentRepository;
    @Mock private EndpointRepository endpointRepository;
    @Mock private BusinessProcessRepository businessProcessRepository;
    @Mock private BusinessPointRepository businessPointRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private PhysicalDataEntityRepository physicalDataEntityRepository;
    @Mock private UIScreenRepository uiScreenRepository;
    @Mock private com.example.architecturemodel.repository.entity.PhysicalDataAttributeRepository physicalDataAttributeRepository;
    @Mock private DiagramRepository diagramRepository;
    @Mock private DiagramNodeRepository diagramNodeRepository;

    private ImplementContextResolutionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "model-file-123";

    @BeforeEach
    void setUp() {
        service = new ImplementContextResolutionService(
            modelFileRepository,
            serviceRepository,
            classRepository,
            methodRepository,
            interfaceRepository,
            applicationRepository,
            applicationComponentRepository,
            endpointRepository,
            businessProcessRepository,
            businessPointRepository,
            logicalDataEntityRepository,
            physicalDataEntityRepository,
            uiScreenRepository,
            physicalDataAttributeRepository,
            diagramRepository,
            diagramNodeRepository
        );
    }

    // ============================================================================
    // physical_data_entities Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_physicalDataEntitiesSnakeCase_resolvesCorrectly() {
        // Arrange
        PhysicalDataEntityEntity entity = new PhysicalDataEntityEntity();
        entity.setId("pde-123");
        entity.setName("users_table");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setDatabaseName("main_db");
        entity.setPhysicalType("TABLE");

        when(physicalDataEntityRepository.findById("pde-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("physical_data_entities::pde-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "physical_data_entities alias should resolve");
        assertEquals("pde-123", result.id());
        assertEquals("users_table", result.name());
        assertEquals("physicalDataEntities", result.entityType());
        assertEquals("data", result.category());
        assertEquals("main_db", result.relevantFields().get("database"));
        assertEquals("TABLE", result.relevantFields().get("physicalType"));
    }

    @Test
    void resolveEntity_physicalDataEntitiesCamelCase_resolvesCorrectly() {
        // Arrange
        PhysicalDataEntityEntity entity = new PhysicalDataEntityEntity();
        entity.setId("pde-456");
        entity.setName("orders_table");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setDatabaseName("orders_db");
        entity.setPhysicalType("TABLE");

        when(physicalDataEntityRepository.findById("pde-456")).thenReturn(Optional.of(entity));

        // Act - using canonical camelCase
        ResolvedEntitySummary result = service.resolveEntity("physicalDataEntities::pde-456", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "physicalDataEntities canonical form should continue to work");
        assertEquals("pde-456", result.id());
        assertEquals("orders_table", result.name());
        assertEquals("physicalDataEntities", result.entityType());
    }

    // ============================================================================
    // logical_data_entities Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_logicalDataEntitiesSnakeCase_resolvesCorrectly() {
        // Arrange
        LogicalDataEntityEntity entity = new LogicalDataEntityEntity();
        entity.setId("lde-123");
        entity.setName("Customer");
        entity.setModelFileId(MODEL_FILE_ID);

        when(logicalDataEntityRepository.findById("lde-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("logical_data_entities::lde-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "logical_data_entities alias should resolve");
        assertEquals("lde-123", result.id());
        assertEquals("Customer", result.name());
        assertEquals("logicalDataEntities", result.entityType());
        assertEquals("data", result.category());
    }

    @Test
    void resolveEntity_logicalDataEntitiesCamelCase_resolvesCorrectly() {
        // Arrange
        LogicalDataEntityEntity entity = new LogicalDataEntityEntity();
        entity.setId("lde-456");
        entity.setName("Product");
        entity.setModelFileId(MODEL_FILE_ID);

        when(logicalDataEntityRepository.findById("lde-456")).thenReturn(Optional.of(entity));

        // Act - using canonical camelCase
        ResolvedEntitySummary result = service.resolveEntity("logicalDataEntities::lde-456", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "logicalDataEntities canonical form should continue to work");
        assertEquals("lde-456", result.id());
        assertEquals("Product", result.name());
    }

    // ============================================================================
    // app_components Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_appComponentsSnakeCase_resolvesCorrectly() {
        // Arrange
        ApplicationComponentEntity entity = new ApplicationComponentEntity();
        entity.setId("ac-123");
        entity.setName("PaymentProcessor");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setApplicationId("app-1");

        when(applicationComponentRepository.findById("ac-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("app_components::ac-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "app_components alias should resolve");
        assertEquals("ac-123", result.id());
        assertEquals("PaymentProcessor", result.name());
        assertEquals("appComponents", result.entityType());
        assertEquals("application", result.category());
    }

    @Test
    void resolveEntity_appComponentsCamelCase_resolvesCorrectly() {
        // Arrange
        ApplicationComponentEntity entity = new ApplicationComponentEntity();
        entity.setId("ac-456");
        entity.setName("NotificationService");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setApplicationId("app-2");

        when(applicationComponentRepository.findById("ac-456")).thenReturn(Optional.of(entity));

        // Act - using canonical camelCase
        ResolvedEntitySummary result = service.resolveEntity("appComponents::ac-456", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "appComponents canonical form should continue to work");
        assertEquals("ac-456", result.id());
        assertEquals("NotificationService", result.name());
    }

    // ============================================================================
    // business_processes Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_businessProcessesSnakeCase_resolvesCorrectly() {
        // Arrange
        BusinessProcessEntity entity = new BusinessProcessEntity();
        entity.setId("bp-123");
        entity.setName("Order Fulfillment");
        entity.setModelFileId(MODEL_FILE_ID);

        when(businessProcessRepository.findById("bp-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("business_processes::bp-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "business_processes alias should resolve");
        assertEquals("bp-123", result.id());
        assertEquals("Order Fulfillment", result.name());
        assertEquals("businessProcesses", result.entityType());
        assertEquals("business", result.category());
    }

    // ============================================================================
    // business_points Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_businessPointsSnakeCase_resolvesCorrectly() {
        // Arrange
        BusinessPointEntity entity = new BusinessPointEntity();
        entity.setId("bpt-123");
        entity.setName("Validate Payment");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setBusinessProcessId("bp-1");
        entity.setKind("activity");

        when(businessPointRepository.findById("bpt-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("business_points::bpt-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "business_points alias should resolve");
        assertEquals("bpt-123", result.id());
        assertEquals("Validate Payment", result.name());
        assertEquals("businessPoints", result.entityType());
        assertEquals("business", result.category());
    }

    // ============================================================================
    // process_activities Alias Tests (special mapping to businessPoints)
    // ============================================================================

    @Test
    void resolveEntity_processActivitiesSnakeCase_resolvesAsBusinessPoints() {
        // Arrange
        BusinessPointEntity entity = new BusinessPointEntity();
        entity.setId("pa-123");
        entity.setName("Ship Order");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setBusinessProcessId("bp-2");
        entity.setKind("activity");

        when(businessPointRepository.findById("pa-123")).thenReturn(Optional.of(entity));

        // Act - using process_activities alias (maps to businessPoints)
        ResolvedEntitySummary result = service.resolveEntity("process_activities::pa-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "process_activities alias should resolve to businessPoints");
        assertEquals("pa-123", result.id());
        assertEquals("Ship Order", result.name());
        assertEquals("businessPoints", result.entityType());
        assertEquals("business", result.category());
    }

    // ============================================================================
    // ui_screens Alias Tests
    // ============================================================================

    @Test
    void resolveEntity_uiScreensSnakeCase_resolvesCorrectly() {
        // Arrange
        UIScreenEntity entity = new UIScreenEntity();
        entity.setId("ui-123");
        entity.setName("Dashboard");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setRoute("/dashboard");

        when(uiScreenRepository.findById("ui-123")).thenReturn(Optional.of(entity));

        // Act - using snake_case alias
        ResolvedEntitySummary result = service.resolveEntity("ui_screens::ui-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result, "ui_screens alias should resolve");
        assertEquals("ui-123", result.id());
        assertEquals("Dashboard", result.name());
        assertEquals("uiScreens", result.entityType());
        assertEquals("ui", result.category());
    }

    // ============================================================================
    // Canonical Types Continue to Work
    // ============================================================================

    @Test
    void resolveEntity_servicesCanonical_continuesToWork() {
        // Arrange
        ServiceEntity entity = new ServiceEntity();
        entity.setId("svc-123");
        entity.setName("UserService");
        entity.setModelFileId(MODEL_FILE_ID);

        when(serviceRepository.findById("svc-123")).thenReturn(Optional.of(entity));

        // Act
        ResolvedEntitySummary result = service.resolveEntity("services::svc-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result);
        assertEquals("svc-123", result.id());
        assertEquals("UserService", result.name());
        assertEquals("services", result.entityType());
    }

    // ============================================================================
    // Unknown Types - Safe Handling
    // ============================================================================

    @Test
    void resolveEntity_unknownType_returnsNullSafely() {
        // Act - unknown type should be logged and return null, not crash
        ResolvedEntitySummary result = service.resolveEntity("unknown_entity_type::id-123", MODEL_FILE_ID);

        // Assert
        assertNull(result, "Unknown entity types should return null safely");
    }

    @Test
    void resolveEntity_anotherUnknownType_returnsNullSafely() {
        // Act
        ResolvedEntitySummary result = service.resolveEntity("customType::custom-456", MODEL_FILE_ID);

        // Assert
        assertNull(result, "Custom/unmapped entity types should return null safely");
    }

    // ============================================================================
    // Full Context Resolution with Mixed Types
    // ============================================================================

    @Test
    void resolveContext_mixedSnakeCaseAndCamelCase_resolvesAll() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        PhysicalDataEntityEntity pde = new PhysicalDataEntityEntity();
        pde.setId("pde-111");
        pde.setName("customers_table");
        pde.setModelFileId(MODEL_FILE_ID);

        LogicalDataEntityEntity lde = new LogicalDataEntityEntity();
        lde.setId("lde-222");
        lde.setName("Order");
        lde.setModelFileId(MODEL_FILE_ID);

        ApplicationComponentEntity ac = new ApplicationComponentEntity();
        ac.setId("ac-333");
        ac.setName("AuthModule");
        ac.setModelFileId(MODEL_FILE_ID);

        ServiceEntity svc = new ServiceEntity();
        svc.setId("svc-444");
        svc.setName("PaymentService");
        svc.setModelFileId(MODEL_FILE_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(physicalDataEntityRepository.findById("pde-111")).thenReturn(Optional.of(pde));
        when(logicalDataEntityRepository.findById("lde-222")).thenReturn(Optional.of(lde));
        when(applicationComponentRepository.findById("ac-333")).thenReturn(Optional.of(ac));
        when(serviceRepository.findById("svc-444")).thenReturn(Optional.of(svc));

        // Act - mix of snake_case aliases and canonical camelCase
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of(
                "physical_data_entities::pde-111",  // snake_case alias
                "logical_data_entities::lde-222",   // snake_case alias
                "app_components::ac-333",           // snake_case alias
                "services::svc-444"                 // canonical (already works)
            ),
            List.of()
        );

        // Assert
        assertNotNull(result);
        assertEquals(4, result.resolvedEntities().size(), "All 4 entities should resolve");

        // Verify each entity was resolved
        assertTrue(result.resolvedEntities().stream()
            .anyMatch(e -> e.id().equals("pde-111") && e.name().equals("customers_table")),
            "Physical data entity should be resolved");
        assertTrue(result.resolvedEntities().stream()
            .anyMatch(e -> e.id().equals("lde-222") && e.name().equals("Order")),
            "Logical data entity should be resolved");
        assertTrue(result.resolvedEntities().stream()
            .anyMatch(e -> e.id().equals("ac-333") && e.name().equals("AuthModule")),
            "App component should be resolved");
        assertTrue(result.resolvedEntities().stream()
            .anyMatch(e -> e.id().equals("svc-444") && e.name().equals("PaymentService")),
            "Service should be resolved");
    }
}
