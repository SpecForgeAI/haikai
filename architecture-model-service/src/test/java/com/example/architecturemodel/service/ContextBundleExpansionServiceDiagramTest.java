package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.entity.DiagramNodeEntity;
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
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ContextBundleExpansionService diagram expansion functionality.
 *
 * Tests diagram bundle expansion rules including:
 * - diagram_only: returns only the diagram ID
 * - Diagram node references are NOT auto-expanded beyond direct nodes
 *
 * Spec: Context Bundles Backend Expansion - Task Group 7
 */
@ExtendWith(MockitoExtension.class)
class ContextBundleExpansionServiceDiagramTest {

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
    private static final String DIAGRAM_ID = "diagram-001";

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
    // Test: diagram_only returns only the diagram ID
    // ============================================================================

    @Nested
    @DisplayName("diagram_only expansion")
    class DiagramOnlyExpansionTests {

        @Test
        @DisplayName("diagram_only returns only the diagram ID")
        void diagramOnly_returnsOnlyDiagramId() {
            // Arrange
            setupModelFileRepository();
            List<DiagramBundleSelection> diagramSelections = List.of(
                new DiagramBundleSelection(DIAGRAM_ID, "diagram_only")
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedDiagramIds().size(), "diagram_only should return only the diagram");
            assertEquals(DIAGRAM_ID, result.expandedDiagramIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("diagram_only with null bundle type defaults to returning only diagram ID")
        void diagramOnly_nullBundleType_returnsOnlyDiagramId() {
            // Arrange
            setupModelFileRepository();
            List<DiagramBundleSelection> diagramSelections = List.of(
                new DiagramBundleSelection(DIAGRAM_ID, null)
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedDiagramIds().size(), "null bundle type should default to diagram_only behavior");
            assertEquals(DIAGRAM_ID, result.expandedDiagramIds().get(0));
            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("diagram_only with unknown bundle type defaults to returning only diagram ID")
        void diagramOnly_unknownBundleType_returnsOnlyDiagramId() {
            // Arrange
            setupModelFileRepository();
            List<DiagramBundleSelection> diagramSelections = List.of(
                new DiagramBundleSelection(DIAGRAM_ID, "unknown_bundle_type")
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

            // Assert
            assertNotNull(result);
            assertEquals(1, result.expandedDiagramIds().size(), "unknown bundle type should default to diagram_only behavior");
            assertEquals(DIAGRAM_ID, result.expandedDiagramIds().get(0));
            assertFalse(result.truncated());
        }
    }

    // ============================================================================
    // Test: Diagram node references are NOT auto-expanded beyond direct nodes
    // ============================================================================

    @Nested
    @DisplayName("Diagram does not auto-expand beyond direct nodes")
    class DiagramNoAutoExpandTests {

        @Test
        @DisplayName("diagram_only does NOT auto-expand diagram node entity references to expanded entity IDs")
        void diagramOnly_doesNotAutoExpandNodeReferences() {
            // Arrange
            setupModelFileRepository();

            // Create mock diagram nodes that reference various entities
            // These nodes exist in the diagram, but should NOT be auto-expanded
            DiagramNodeEntity node1 = DiagramNodeEntity.builder()
                .id("node-001")
                .diagramId(DIAGRAM_ID)
                .modelFileId(MODEL_FILE_ID)
                .entityType("services")
                .entityId("svc-123")
                .posX(100.0)
                .posY(100.0)
                .build();

            DiagramNodeEntity node2 = DiagramNodeEntity.builder()
                .id("node-002")
                .diagramId(DIAGRAM_ID)
                .modelFileId(MODEL_FILE_ID)
                .entityType("interfaces")
                .entityId("int-456")
                .posX(200.0)
                .posY(200.0)
                .build();

            DiagramNodeEntity node3 = DiagramNodeEntity.builder()
                .id("node-003")
                .diagramId(DIAGRAM_ID)
                .modelFileId(MODEL_FILE_ID)
                .entityType("applications")
                .entityId("app-789")
                .posX(300.0)
                .posY(300.0)
                .build();

            // Mock the DiagramNodeRepository to return these nodes if queried
            // (verifying we are NOT expanding them). Lenient: under strict stubs an
            // intentionally-unused trap stub would otherwise fail the test.
            lenient().when(diagramNodeRepository.findByDiagramId(DIAGRAM_ID))
                .thenReturn(List.of(node1, node2, node3));

            List<DiagramBundleSelection> diagramSelections = List.of(
                new DiagramBundleSelection(DIAGRAM_ID, "diagram_only")
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

            // Assert
            assertNotNull(result);

            // The diagram ID should be returned
            assertEquals(1, result.expandedDiagramIds().size(), "Should return only the diagram ID");
            assertEquals(DIAGRAM_ID, result.expandedDiagramIds().get(0));

            // The expanded ENTITY IDs should be empty - we do NOT auto-expand node references
            assertTrue(result.expandedEntityIds().isEmpty(),
                "diagram_only should NOT auto-expand node references to entity IDs");

            // Verify that we did NOT add the referenced entities
            assertFalse(result.expandedEntityIds().contains("services::svc-123"),
                "Should NOT include service entity from diagram node");
            assertFalse(result.expandedEntityIds().contains("interfaces::int-456"),
                "Should NOT include interface entity from diagram node");
            assertFalse(result.expandedEntityIds().contains("applications::app-789"),
                "Should NOT include application entity from diagram node");

            assertFalse(result.truncated());
        }

        @Test
        @DisplayName("Multiple diagrams with diagram_only each return only their diagram IDs")
        void multipleDiagrams_diagramOnly_returnsOnlyDiagramIds() {
            // Arrange
            setupModelFileRepository();

            List<DiagramBundleSelection> diagramSelections = List.of(
                new DiagramBundleSelection("diagram-001", "diagram_only"),
                new DiagramBundleSelection("diagram-002", "diagram_only"),
                new DiagramBundleSelection("diagram-003", "diagram_only")
            );

            // Act
            ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

            // Assert
            assertNotNull(result);
            assertEquals(3, result.expandedDiagramIds().size(), "Should return all 3 diagram IDs");
            assertTrue(result.expandedDiagramIds().contains("diagram-001"));
            assertTrue(result.expandedDiagramIds().contains("diagram-002"));
            assertTrue(result.expandedDiagramIds().contains("diagram-003"));

            // Entity IDs should still be empty
            assertTrue(result.expandedEntityIds().isEmpty(),
                "diagram_only should NOT expand any entities from diagrams");

            assertFalse(result.truncated());
        }
    }
}
