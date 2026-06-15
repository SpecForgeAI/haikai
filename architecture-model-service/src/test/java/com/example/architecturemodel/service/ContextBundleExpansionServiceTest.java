package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DiagramBundleSelection;
import com.example.architecturemodel.model.dto.EntityBundleSelection;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ContextBundleExpansionService core functionality.
 *
 * Tests core expansion service structure including:
 * - Empty input handling
 * - De-duplication of expanded entity IDs
 * - Deterministic ordering of output
 * - Truncation at configured limits
 *
 * Spec: Context Bundles Backend Expansion - Task Group 3
 */
@ExtendWith(MockitoExtension.class)
class ContextBundleExpansionServiceTest {

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

    // ============================================================================
    // Test: Empty input arrays return empty output
    // ============================================================================

    @Test
    void expandAndResolve_emptyInputArrays_returnsEmptyOutput() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(
            PROJECT_ID,
            List.of(),
            List.of()
        );

        // Assert
        assertNotNull(result);
        assertTrue(result.expandedEntityIds().isEmpty(), "Expanded entity IDs should be empty");
        assertTrue(result.expandedDiagramIds().isEmpty(), "Expanded diagram IDs should be empty");
        assertTrue(result.resolvedEntities().isEmpty(), "Resolved entities should be empty");
        assertTrue(result.resolvedDiagrams().isEmpty(), "Resolved diagrams should be empty");
        assertFalse(result.truncated(), "Truncated flag should be false");
        assertNull(result.truncationReason(), "Truncation reason should be null");
    }

    @Test
    void expandAndResolve_nullInputArrays_returnsEmptyOutput() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, null, null);

        // Assert
        assertNotNull(result);
        assertTrue(result.expandedEntityIds().isEmpty(), "Expanded entity IDs should be empty");
        assertTrue(result.expandedDiagramIds().isEmpty(), "Expanded diagram IDs should be empty");
        assertFalse(result.truncated(), "Truncated flag should be false");
    }

    // ============================================================================
    // Test: De-duplication of expanded entity IDs
    // ============================================================================

    @Test
    void expandAndResolve_duplicateEntityIds_deduplicatesOutput() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Same entity selected twice with different bundle types (should be de-duplicated)
        List<EntityBundleSelection> selections = List.of(
            new EntityBundleSelection("services", "svc-123", "service_only", null),
            new EntityBundleSelection("services", "svc-123", "service_only", null),
            new EntityBundleSelection("interfaces", "int-456", "interface_only", null)
        );

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

        // Assert
        assertNotNull(result);
        // Should have 2 unique entities, not 3
        assertEquals(2, result.expandedEntityIds().size(), "Should de-duplicate entity IDs");
        assertTrue(result.expandedEntityIds().contains("services::svc-123"));
        assertTrue(result.expandedEntityIds().contains("interfaces::int-456"));
    }

    // ============================================================================
    // Test: Deterministic ordering of output (sorted by entityType then entityId)
    // ============================================================================

    @Test
    void expandAndResolve_multipleEntityTypes_returnsInDeterministicOrder() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Entities in random order
        List<EntityBundleSelection> selections = List.of(
            new EntityBundleSelection("services", "svc-002", "service_only", null),
            new EntityBundleSelection("applications", "app-001", "entity_only", null),
            new EntityBundleSelection("services", "svc-001", "service_only", null),
            new EntityBundleSelection("interfaces", "int-001", "interface_only", null)
        );

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

        // Assert
        assertNotNull(result);
        List<String> expandedIds = result.expandedEntityIds();
        assertEquals(4, expandedIds.size());

        // Should be sorted alphabetically by entityType, then by entityId
        // Expected order: applications::app-001, interfaces::int-001, services::svc-001, services::svc-002
        assertEquals("applications::app-001", expandedIds.get(0), "First should be applications (alphabetically)");
        assertEquals("interfaces::int-001", expandedIds.get(1), "Second should be interfaces");
        assertEquals("services::svc-001", expandedIds.get(2), "Third should be services (svc-001 before svc-002)");
        assertEquals("services::svc-002", expandedIds.get(3), "Fourth should be services (svc-002)");
    }

    // ============================================================================
    // Test: Truncation at maxExpandedEntities limit (default 250)
    // ============================================================================

    @Test
    void expandAndResolve_exceedsEntityLimit_truncatesAndSetsTruncatedFlag() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Set a small limit for testing
        ReflectionTestUtils.setField(service, "maxExpandedEntities", 3);

        // Create 5 selections (more than the limit of 3)
        List<EntityBundleSelection> selections = List.of(
            new EntityBundleSelection("services", "svc-001", "service_only", null),
            new EntityBundleSelection("services", "svc-002", "service_only", null),
            new EntityBundleSelection("services", "svc-003", "service_only", null),
            new EntityBundleSelection("services", "svc-004", "service_only", null),
            new EntityBundleSelection("services", "svc-005", "service_only", null)
        );

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, selections, List.of());

        // Assert
        assertNotNull(result);
        assertTrue(result.truncated(), "Truncated flag should be true when limit exceeded");
        assertNotNull(result.truncationReason(), "Truncation reason should be set");
        assertTrue(result.truncationReason().contains("entities"), "Reason should mention entities");
        assertEquals(3, result.expandedEntityIds().size(), "Should truncate to maxExpandedEntities limit");
    }

    @Test
    void expandAndResolve_exceedsDiagramLimit_truncatesAndSetsTruncatedFlag() {
        // Arrange
        ModelFileEntity modelFile = new ModelFileEntity();
        modelFile.setId(MODEL_FILE_ID);
        modelFile.setProjectId(PROJECT_ID);
        when(modelFileRepository.findByProjectId(PROJECT_ID)).thenReturn(Optional.of(modelFile));

        // Set a small limit for testing
        ReflectionTestUtils.setField(service, "maxExpandedDiagrams", 2);

        // Create 4 diagram selections (more than the limit of 2)
        List<DiagramBundleSelection> diagramSelections = List.of(
            new DiagramBundleSelection("diag-001", "diagram_only"),
            new DiagramBundleSelection("diag-002", "diagram_only"),
            new DiagramBundleSelection("diag-003", "diagram_only"),
            new DiagramBundleSelection("diag-004", "diagram_only")
        );

        // Act
        ExpandResolveResponseDto result = service.expandAndResolve(PROJECT_ID, List.of(), diagramSelections);

        // Assert
        assertNotNull(result);
        assertTrue(result.truncated(), "Truncated flag should be true when diagram limit exceeded");
        assertNotNull(result.truncationReason(), "Truncation reason should be set");
        assertTrue(result.truncationReason().contains("diagrams"), "Reason should mention diagrams");
        assertEquals(2, result.expandedDiagramIds().size(), "Should truncate to maxExpandedDiagrams limit");
    }

    // ============================================================================
    // Test: Project not found throws exception
    // ============================================================================

    @Test
    void expandAndResolve_projectNotFound_throwsResourceNotFoundException() {
        // Arrange
        UUID unknownProjectId = UUID.randomUUID();
        when(modelFileRepository.findByProjectId(unknownProjectId)).thenReturn(Optional.empty());

        // Act & Assert
        assertThrows(ResourceNotFoundException.class, () ->
            service.expandAndResolve(unknownProjectId, List.of(), List.of())
        );
    }
}
