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

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Edge case tests for ImplementContextResolutionService.
 *
 * Covers malformed inputs and boundary conditions.
 *
 * Spec: Implement Context Resolution - Iteration 3 (Task Group 5)
 */
@ExtendWith(MockitoExtension.class)
class ImplementContextResolutionServiceEdgeCaseTest {

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

    private static final java.util.UUID PROJECT_ID = java.util.UUID.randomUUID();
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

    @Test
    void parseEntityId_multipleDelimiters_handlesCorrectly() {
        // Entity ID with multiple "::" - should split on first occurrence
        var result = service.parseEntityId("services::svc-123::extra");

        // parseEntityId only splits on first "::, so svc-123::extra is the entityId
        assertNotNull(result);
        assertEquals("services", result.entityType());
        assertEquals("svc-123::extra", result.entityId());
    }

    @Test
    void parseEntityId_delimiterAtEnd_returnsNull() {
        // Entity ID ending with "::" has empty ID part
        var result = service.parseEntityId("services::");

        assertNull(result);
    }

    @Test
    void parseEntityId_delimiterAtStart_returnsNull() {
        // Entity ID starting with "::" has empty type part
        var result = service.parseEntityId("::svc-123");

        assertNull(result);
    }

    @Test
    void parseEntityId_onlyDelimiter_returnsNull() {
        // Just "::" with no type or ID
        var result = service.parseEntityId("::");

        assertNull(result);
    }

    @Test
    void resolveContext_onlyEntitiesNoDigrams_resolvesCorrectly() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        ServiceEntity serviceEntity = new ServiceEntity();
        serviceEntity.setId("svc-123");
        serviceEntity.setName("UserService");
        serviceEntity.setModelFileId(MODEL_FILE_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(serviceRepository.findById("svc-123")).thenReturn(Optional.of(serviceEntity));

        // Act - only entities, no diagrams
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of("services::svc-123"),
            List.of()  // No diagrams
        );

        // Assert
        assertNotNull(result);
        assertEquals(1, result.resolvedEntities().size());
        assertTrue(result.resolvedDiagrams().isEmpty());
    }

    @Test
    void resolveContext_onlyDiagramsNoEntities_resolvesCorrectly() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        DiagramEntity diagram = new DiagramEntity();
        diagram.setId("diagram-1");
        diagram.setName("Overview");
        diagram.setDiagramType("General");
        diagram.setModelFileId(MODEL_FILE_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(diagramRepository.findById("diagram-1")).thenReturn(Optional.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(List.of());

        // Act - only diagrams, no entities
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of(),  // No entities
            List.of("diagram-1")
        );

        // Assert
        assertNotNull(result);
        assertTrue(result.resolvedEntities().isEmpty());
        assertEquals(1, result.resolvedDiagrams().size());
    }

    @Test
    void resolveEntity_verifyCorrectCategoryForEachType() {
        // Set up model file
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        // Create entities for each type
        ServiceEntity service = new ServiceEntity();
        service.setId("svc-1");
        service.setName("TestService");
        service.setModelFileId(MODEL_FILE_ID);

        BusinessProcessEntity process = new BusinessProcessEntity();
        process.setId("bp-1");
        process.setName("TestProcess");
        process.setModelFileId(MODEL_FILE_ID);

        LogicalDataEntityEntity data = new LogicalDataEntityEntity();
        data.setId("lde-1");
        data.setName("TestEntity");
        data.setModelFileId(MODEL_FILE_ID);

        UIScreenEntity screen = new UIScreenEntity();
        screen.setId("ui-1");
        screen.setName("TestScreen");
        screen.setRoute("/test");
        screen.setModelFileId(MODEL_FILE_ID);

        // Mocks
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(serviceRepository.findById("svc-1")).thenReturn(Optional.of(service));
        when(businessProcessRepository.findById("bp-1")).thenReturn(Optional.of(process));
        when(logicalDataEntityRepository.findById("lde-1")).thenReturn(Optional.of(data));
        when(uiScreenRepository.findById("ui-1")).thenReturn(Optional.of(screen));

        // Act
        ResolvedImplementContextDto result = this.service.resolveContext(
            PROJECT_ID,
            List.of("services::svc-1", "businessProcesses::bp-1", "logicalDataEntities::lde-1", "uiScreens::ui-1"),
            List.of()
        );

        // Assert categories
        assertEquals(4, result.resolvedEntities().size());

        // Find each entity and verify category
        ResolvedEntitySummary svcSummary = result.resolvedEntities().stream()
            .filter(e -> e.id().equals("svc-1")).findFirst().orElse(null);
        ResolvedEntitySummary bpSummary = result.resolvedEntities().stream()
            .filter(e -> e.id().equals("bp-1")).findFirst().orElse(null);
        ResolvedEntitySummary ldeSummary = result.resolvedEntities().stream()
            .filter(e -> e.id().equals("lde-1")).findFirst().orElse(null);
        ResolvedEntitySummary uiSummary = result.resolvedEntities().stream()
            .filter(e -> e.id().equals("ui-1")).findFirst().orElse(null);

        assertNotNull(svcSummary);
        assertEquals("application", svcSummary.category());

        assertNotNull(bpSummary);
        assertEquals("business", bpSummary.category());

        assertNotNull(ldeSummary);
        assertEquals("data", ldeSummary.category());

        assertNotNull(uiSummary);
        assertEquals("ui", uiSummary.category());
    }

    @Test
    void resolveEntity_endpointWithRelevantFields_extractsCorrectly() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        EndpointEntity endpoint = new EndpointEntity();
        endpoint.setId("ep-1");
        endpoint.setName("getUser");
        endpoint.setModelFileId(MODEL_FILE_ID);
        endpoint.setInterfaceId("iface-1");
        endpoint.setOperationVerb("GET");
        endpoint.setPathOrAddress("/api/users/{id}");

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(endpointRepository.findById("ep-1")).thenReturn(Optional.of(endpoint));

        // Act
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of("endpoints::ep-1"),
            List.of()
        );

        // Assert
        assertEquals(1, result.resolvedEntities().size());
        ResolvedEntitySummary summary = result.resolvedEntities().get(0);

        assertEquals("ep-1", summary.id());
        assertEquals("getUser", summary.name());
        assertEquals("endpoints", summary.entityType());
        assertEquals("application", summary.category());

        // Verify relevant fields extraction
        assertEquals("iface-1", summary.relevantFields().get("interfaceId"));
        assertEquals("GET", summary.relevantFields().get("httpMethod"));
        assertEquals("/api/users/{id}", summary.relevantFields().get("path"));
    }
}
