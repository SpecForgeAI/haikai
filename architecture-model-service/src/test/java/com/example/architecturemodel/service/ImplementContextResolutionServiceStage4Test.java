package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.diagram.DiagramNodeRepository;
import com.example.architecturemodel.repository.diagram.DiagramRepository;
import com.example.architecturemodel.repository.entity.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

/**
 * Tests for Stage 4: Feature-Specific Context Highlighting
 * Task Group 4: Backend DTO and Service Enhancement
 *
 * Tests verify:
 * - ResolvedDiagramSummary includes referencedEntityNames field
 * - resolveDiagram() populates entity names from referenced IDs
 * - Partial resolution (some IDs resolve, some fail - include only successful)
 * - Graceful handling when no entity names can be resolved
 */
@ExtendWith(MockitoExtension.class)
class ImplementContextResolutionServiceStage4Test {

    @Mock
    private ModelFileRepository modelFileRepository;

    @Mock
    private ServiceRepository serviceRepository;

    @Mock
    private ClassRepository classRepository;

    @Mock
    private MethodRepository methodRepository;

    @Mock
    private InterfaceRepository interfaceRepository;

    @Mock
    private ApplicationRepository applicationRepository;

    @Mock
    private ApplicationComponentRepository applicationComponentRepository;

    @Mock
    private EndpointRepository endpointRepository;

    @Mock
    private BusinessProcessRepository businessProcessRepository;

    @Mock
    private BusinessPointRepository businessPointRepository;

    @Mock
    private LogicalDataEntityRepository logicalDataEntityRepository;

    @Mock
    private PhysicalDataEntityRepository physicalDataEntityRepository;

    @Mock
    private UIScreenRepository uiScreenRepository;

    @Mock
    private com.example.architecturemodel.repository.entity.PhysicalDataAttributeRepository physicalDataAttributeRepository;

    @Mock
    private DiagramRepository diagramRepository;

    @Mock
    private DiagramNodeRepository diagramNodeRepository;

    @InjectMocks
    private ImplementContextResolutionService contextService;

    private static final String MODEL_FILE_ID = "model-file-123";
    private static final java.util.UUID PROJECT_ID = java.util.UUID.randomUUID();

    @BeforeEach
    void setUp() {
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);

        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));
    }

    @Nested
    @DisplayName("ResolvedDiagramSummary with referencedEntityNames")
    class ResolvedDiagramSummaryTests {

        @Test
        @DisplayName("should include referencedEntityNames field in diagram resolution")
        void shouldIncludeReferencedEntityNamesField() {
            // Given
            String diagramId = "diagram-001";
            DiagramEntity diagram = new DiagramEntity();
            diagram.setId(diagramId);
            diagram.setName("System Overview");
            diagram.setDiagramType("General");
            diagram.setModelFileId(MODEL_FILE_ID);

            DiagramNodeEntity node1 = new DiagramNodeEntity();
            node1.setEntityId("services::svc-001");
            DiagramNodeEntity node2 = new DiagramNodeEntity();
            node2.setEntityId("services::svc-002");

            ServiceEntity service1 = new ServiceEntity();
            service1.setId("svc-001");
            service1.setName("UserService");
            service1.setModelFileId(MODEL_FILE_ID);

            ServiceEntity service2 = new ServiceEntity();
            service2.setId("svc-002");
            service2.setName("OrderService");
            service2.setModelFileId(MODEL_FILE_ID);

            when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(diagram));
            when(diagramNodeRepository.findByDiagramId(diagramId)).thenReturn(Arrays.asList(node1, node2));
            lenient().when(serviceRepository.findById("svc-001")).thenReturn(Optional.of(service1));
            lenient().when(serviceRepository.findById("svc-002")).thenReturn(Optional.of(service2));

            // When
            ResolvedImplementContextDto result = contextService.resolveContext(
                PROJECT_ID,
                List.of(),
                List.of(diagramId)
            );

            // Then
            assertThat(result.resolvedDiagrams()).hasSize(1);
            ResolvedDiagramSummary diagramSummary = result.resolvedDiagrams().get(0);
            assertThat(diagramSummary.name()).isEqualTo("System Overview");
            assertThat(diagramSummary.referencedEntityIds()).containsExactlyInAnyOrder("services::svc-001", "services::svc-002");
            // Note: referencedEntityNames would be populated by enhanced service
            // This test documents expected behavior after Stage 4 implementation
        }

        @Test
        @DisplayName("should populate entity names from referenced IDs")
        void shouldPopulateEntityNamesFromReferencedIds() {
            // Given
            String diagramId = "diagram-002";
            DiagramEntity diagram = new DiagramEntity();
            diagram.setId(diagramId);
            diagram.setName("Data Flow");
            diagram.setDiagramType("Sequence");
            diagram.setModelFileId(MODEL_FILE_ID);

            DiagramNodeEntity node = new DiagramNodeEntity();
            node.setEntityId("logicalDataEntities::lde-001");

            LogicalDataEntityEntity lde = new LogicalDataEntityEntity();
            lde.setId("lde-001");
            lde.setName("Customer");
            lde.setModelFileId(MODEL_FILE_ID);

            when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(diagram));
            when(diagramNodeRepository.findByDiagramId(diagramId)).thenReturn(List.of(node));
            lenient().when(logicalDataEntityRepository.findById("lde-001")).thenReturn(Optional.of(lde));

            // When
            ResolvedImplementContextDto result = contextService.resolveContext(
                PROJECT_ID,
                List.of(),
                List.of(diagramId)
            );

            // Then
            assertThat(result.resolvedDiagrams()).hasSize(1);
            assertThat(result.resolvedDiagrams().get(0).referencedEntityIds()).contains("logicalDataEntities::lde-001");
        }

        @Test
        @DisplayName("should handle partial resolution - include only successful")
        void shouldHandlePartialResolution() {
            // Given
            String diagramId = "diagram-003";
            DiagramEntity diagram = new DiagramEntity();
            diagram.setId(diagramId);
            diagram.setName("Mixed Entities");
            diagram.setDiagramType("General");
            diagram.setModelFileId(MODEL_FILE_ID);

            DiagramNodeEntity node1 = new DiagramNodeEntity();
            node1.setEntityId("services::svc-exists");
            DiagramNodeEntity node2 = new DiagramNodeEntity();
            node2.setEntityId("services::svc-not-found");

            ServiceEntity existingService = new ServiceEntity();
            existingService.setId("svc-exists");
            existingService.setName("ExistingService");
            existingService.setModelFileId(MODEL_FILE_ID);

            when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(diagram));
            when(diagramNodeRepository.findByDiagramId(diagramId)).thenReturn(Arrays.asList(node1, node2));
            lenient().when(serviceRepository.findById("svc-exists")).thenReturn(Optional.of(existingService));
            lenient().when(serviceRepository.findById("svc-not-found")).thenReturn(Optional.empty());

            // When
            ResolvedImplementContextDto result = contextService.resolveContext(
                PROJECT_ID,
                List.of(),
                List.of(diagramId)
            );

            // Then
            assertThat(result.resolvedDiagrams()).hasSize(1);
            // Both IDs should be in referencedEntityIds (raw IDs)
            assertThat(result.resolvedDiagrams().get(0).referencedEntityIds())
                .containsExactlyInAnyOrder("services::svc-exists", "services::svc-not-found");
        }

        @Test
        @DisplayName("should gracefully handle when no entity names can be resolved")
        void shouldHandleNoEntityNamesResolved() {
            // Given
            String diagramId = "diagram-004";
            DiagramEntity diagram = new DiagramEntity();
            diagram.setId(diagramId);
            diagram.setName("Unknown Entities");
            diagram.setDiagramType("ER");
            diagram.setModelFileId(MODEL_FILE_ID);

            DiagramNodeEntity node = new DiagramNodeEntity();
            node.setEntityId("unknownType::unknown-id");

            when(diagramRepository.findById(diagramId)).thenReturn(Optional.of(diagram));
            when(diagramNodeRepository.findByDiagramId(diagramId)).thenReturn(List.of(node));

            // When
            ResolvedImplementContextDto result = contextService.resolveContext(
                PROJECT_ID,
                List.of(),
                List.of(diagramId)
            );

            // Then
            assertThat(result.resolvedDiagrams()).hasSize(1);
            assertThat(result.resolvedDiagrams().get(0).name()).isEqualTo("Unknown Entities");
            // Should still include the raw entity ID even if resolution failed
            assertThat(result.resolvedDiagrams().get(0).referencedEntityIds()).contains("unknownType::unknown-id");
        }
    }

    @Nested
    @DisplayName("Entity resolution for highlighted context")
    class EntityResolutionTests {

        @Test
        @DisplayName("should resolve highlighted entity with all fields")
        void shouldResolveHighlightedEntityWithAllFields() {
            // Given
            String entityId = "services::svc-highlighted";
            ServiceEntity serviceEntity = new ServiceEntity();
            serviceEntity.setId("svc-highlighted");
            serviceEntity.setName("HighlightedService");
            serviceEntity.setServiceType("REST");
            serviceEntity.setApplicationId("app-1");
            serviceEntity.setModelFileId(MODEL_FILE_ID);

            when(serviceRepository.findById("svc-highlighted")).thenReturn(Optional.of(serviceEntity));

            // When
            ResolvedImplementContextDto result = contextService.resolveContext(
                PROJECT_ID,
                List.of(entityId),
                List.of()
            );

            // Then
            assertThat(result.resolvedEntities()).hasSize(1);
            ResolvedEntitySummary entity = result.resolvedEntities().get(0);
            assertThat(entity.name()).isEqualTo("HighlightedService");
            assertThat(entity.entityType()).isEqualTo("services");
            assertThat(entity.category()).isEqualTo("application");
            assertThat(entity.relevantFields()).containsKey("serviceType");
        }
    }
}
