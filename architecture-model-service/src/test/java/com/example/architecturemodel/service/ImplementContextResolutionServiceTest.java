package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ImplementContextResolutionService.
 *
 * Spec: Implement Context Resolution - Iteration 3
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ImplementContextResolutionServiceTest {

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

    @InjectMocks
    private ImplementContextResolutionService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final String MODEL_FILE_ID = "model-file-123";

    @BeforeEach
    void setUp() {
        // service is wired via @InjectMocks
    }

    // ============================================================================
    // Entity ID Parsing Tests
    // ============================================================================

    @Test
    void parseEntityId_validFormat_extractsTypeAndId() {
        // Act
        var result = service.parseEntityId("services::svc-123");

        // Assert
        assertNotNull(result);
        assertEquals("services", result.entityType());
        assertEquals("svc-123", result.entityId());
    }

    @Test
    void parseEntityId_nullInput_returnsNull() {
        // Act
        var result = service.parseEntityId(null);

        // Assert
        assertNull(result);
    }

    @Test
    void parseEntityId_blankInput_returnsNull() {
        // Act
        var result = service.parseEntityId("   ");

        // Assert
        assertNull(result);
    }

    @Test
    void parseEntityId_noDelimiter_returnsNull() {
        // Act
        var result = service.parseEntityId("services-svc-123");

        // Assert
        assertNull(result);
    }

    @Test
    void parseEntityId_emptyTypePart_returnsNull() {
        // Act
        var result = service.parseEntityId("::svc-123");

        // Assert
        assertNull(result);
    }

    @Test
    void parseEntityId_emptyIdPart_returnsNull() {
        // Act
        var result = service.parseEntityId("services::");

        // Assert
        assertNull(result);
    }

    // ============================================================================
    // Entity Resolution Tests
    // ============================================================================

    @Test
    void resolveEntity_knownService_returnsCorrectSummary() {
        // Arrange
        ServiceEntity entity = new ServiceEntity();
        entity.setId("svc-123");
        entity.setName("UserService");
        entity.setModelFileId(MODEL_FILE_ID);
        entity.setApplicationId("app-1");
        entity.setServiceType("REST");

        when(serviceRepository.findById("svc-123")).thenReturn(Optional.of(entity));

        // Act
        ResolvedEntitySummary result = service.resolveEntity("services::svc-123", MODEL_FILE_ID);

        // Assert
        assertNotNull(result);
        assertEquals("svc-123", result.id());
        assertEquals("UserService", result.name());
        assertEquals("services", result.entityType());
        assertEquals("application", result.category());
        assertEquals("app-1", result.relevantFields().get("applicationId"));
        assertEquals("REST", result.relevantFields().get("serviceType"));
    }

    @Test
    void resolveEntity_unknownEntityType_returnsNull() {
        // Act
        ResolvedEntitySummary result = service.resolveEntity("unknownType::id-123", MODEL_FILE_ID);

        // Assert
        assertNull(result);
    }

    @Test
    void resolveEntity_entityNotFound_returnsNull() {
        // Arrange
        when(serviceRepository.findById("svc-999")).thenReturn(Optional.empty());

        // Act
        ResolvedEntitySummary result = service.resolveEntity("services::svc-999", MODEL_FILE_ID);

        // Assert
        assertNull(result);
    }

    @Test
    void resolveEntity_entityWrongModelFile_returnsNull() {
        // Arrange
        ServiceEntity entity = new ServiceEntity();
        entity.setId("svc-123");
        entity.setName("UserService");
        entity.setModelFileId("different-model-file");

        when(serviceRepository.findById("svc-123")).thenReturn(Optional.of(entity));

        // Act
        ResolvedEntitySummary result = service.resolveEntity("services::svc-123", MODEL_FILE_ID);

        // Assert
        assertNull(result);
    }

    // ============================================================================
    // Diagram Resolution Tests
    // ============================================================================

    @Test
    void resolveDiagram_existingDiagram_returnsCorrectSummary() {
        // Arrange
        DiagramEntity diagram = new DiagramEntity();
        diagram.setId("diagram-1");
        diagram.setName("System Overview");
        diagram.setDiagramType("General");
        diagram.setModelFileId(MODEL_FILE_ID);

        DiagramNodeEntity node1 = new DiagramNodeEntity();
        node1.setEntityId("svc-123");
        DiagramNodeEntity node2 = new DiagramNodeEntity();
        node2.setEntityId("app-1");
        DiagramNodeEntity node3 = new DiagramNodeEntity();
        node3.setEntityId(null); // Should be filtered out

        when(diagramRepository.findById("diagram-1")).thenReturn(Optional.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(List.of(node1, node2, node3));

        // Act
        ResolvedDiagramSummary result = service.resolveDiagram("diagram-1", MODEL_FILE_ID);

        // Assert
        assertNotNull(result);
        assertEquals("diagram-1", result.id());
        assertEquals("System Overview", result.name());
        assertEquals("General", result.diagramType());
        assertEquals(2, result.referencedEntityIds().size());
        assertTrue(result.referencedEntityIds().contains("svc-123"));
        assertTrue(result.referencedEntityIds().contains("app-1"));
    }

    @Test
    void resolveDiagram_notFound_returnsNull() {
        // Arrange
        when(diagramRepository.findById("diagram-999")).thenReturn(Optional.empty());

        // Act
        ResolvedDiagramSummary result = service.resolveDiagram("diagram-999", MODEL_FILE_ID);

        // Assert
        assertNull(result);
    }

    @Test
    void resolveDiagram_wrongModelFile_returnsNull() {
        // Arrange
        DiagramEntity diagram = new DiagramEntity();
        diagram.setId("diagram-1");
        diagram.setName("System Overview");
        diagram.setModelFileId("different-model-file");

        when(diagramRepository.findById("diagram-1")).thenReturn(Optional.of(diagram));

        // Act
        ResolvedDiagramSummary result = service.resolveDiagram("diagram-1", MODEL_FILE_ID);

        // Assert
        assertNull(result);
    }

    // ============================================================================
    // Full Context Resolution Tests
    // ============================================================================

    @Test
    void resolveContext_multipleEntitiesAndDiagrams_resolvesAll() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        ServiceEntity serviceEntity = new ServiceEntity();
        serviceEntity.setId("svc-123");
        serviceEntity.setName("UserService");
        serviceEntity.setModelFileId(MODEL_FILE_ID);
        serviceEntity.setApplicationId("app-1");

        ClassEntity classEntity = new ClassEntity();
        classEntity.setId("cls-456");
        classEntity.setName("UserController");
        classEntity.setModelFileId(MODEL_FILE_ID);
        classEntity.setNamespace("com.example");

        DiagramEntity diagram = new DiagramEntity();
        diagram.setId("diagram-1");
        diagram.setName("Overview");
        diagram.setDiagramType("General");
        diagram.setModelFileId(MODEL_FILE_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
        when(serviceRepository.findById("svc-123")).thenReturn(Optional.of(serviceEntity));
        when(classRepository.findById("cls-456")).thenReturn(Optional.of(classEntity));
        when(diagramRepository.findById("diagram-1")).thenReturn(Optional.of(diagram));
        when(diagramNodeRepository.findByDiagramId("diagram-1")).thenReturn(List.of());

        // Act
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of("services::svc-123", "classes::cls-456"),
            List.of("diagram-1")
        );

        // Assert
        assertNotNull(result);
        assertEquals(2, result.resolvedEntities().size());
        assertEquals(1, result.resolvedDiagrams().size());
    }

    @Test
    void resolveContext_projectNotFound_throwsResourceNotFoundException() {
        // Arrange
        UUID unknownProjectId = UUID.fromString("99999999-9999-9999-9999-999999999999");
        when(modelFileRepository.findByProjectId(unknownProjectId)).thenReturn(Optional.empty());

        // Act & Assert
        assertThrows(ResourceNotFoundException.class, () ->
            service.resolveContext(unknownProjectId, List.of(), List.of())
        );
    }

    @Test
    void resolveContext_mixedValidAndInvalidIds_onlyResolvesValid() {
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
        when(serviceRepository.findById("svc-999")).thenReturn(Optional.empty());

        // Act
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of("services::svc-123", "services::svc-999", "invalid-format"),
            List.of()
        );

        // Assert
        assertNotNull(result);
        assertEquals(1, result.resolvedEntities().size());
        assertEquals("svc-123", result.resolvedEntities().get(0).id());
    }

    @Test
    void resolveContext_emptyLists_returnsEmptyResults() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Act
        ResolvedImplementContextDto result = service.resolveContext(
            PROJECT_ID,
            List.of(),
            List.of()
        );

        // Assert
        assertNotNull(result);
        assertTrue(result.resolvedEntities().isEmpty());
        assertTrue(result.resolvedDiagrams().isEmpty());
    }

    @Test
    void resolveContext_nullLists_handledGracefully() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Act
        ResolvedImplementContextDto result = service.resolveContext(PROJECT_ID, null, null);

        // Assert
        assertNotNull(result);
        assertTrue(result.resolvedEntities().isEmpty());
        assertTrue(result.resolvedDiagrams().isEmpty());
    }
}
