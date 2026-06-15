package com.example.archtool.service;

import com.example.archtool.model.dto.diagram.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DiagramExpansionService.
 */
class DiagramExpansionServiceTest {

    private DiagramExpansionService service;

    @BeforeEach
    void setUp() {
        service = new DiagramExpansionService();
    }

    /**
     * Helper to create a mock meta-model.
     */
    private Map<String, Object> createMockMetaModel() {
        Map<String, Object> metaModel = new HashMap<>();

        // Entities
        Map<String, Object> entities = new HashMap<>();

        // Applications
        entities.put("applications", List.of(
            Map.of("id", "app-1", "name", "Test Application")
        ));

        // App Components
        entities.put("app_components", List.of(
            Map.of("id", "ac-1", "name", "Component 1", "application_id", "app-1"),
            Map.of("id", "ac-2", "name", "Component 2", "application_id", "app-1")
        ));

        // Services
        entities.put("services", List.of(
            Map.of("id", "svc-1", "name", "Service 1", "application_id", "app-1", "app_component_id", "ac-1"),
            Map.of("id", "svc-2", "name", "Service 2", "application_id", "app-1")
        ));

        // Business Processes
        entities.put("business_processes", List.of(
            Map.of("id", "bp-1", "name", "Process 1")
        ));

        // Process Activities
        entities.put("process_activities", List.of(
            Map.of("id", "pa-1", "name", "Activity 1", "business_process_id", "bp-1"),
            Map.of("id", "pa-2", "name", "Activity 2", "business_process_id", "bp-1")
        ));

        metaModel.put("entities", entities);

        // Relationships
        Map<String, Object> relationships = new HashMap<>();
        relationships.put("application_point_business_processes", List.of());
        metaModel.put("relationships", relationships);

        return metaModel;
    }

    /**
     * Helper to create empty diagram data.
     */
    private Map<String, Object> createEmptyDiagramData() {
        Map<String, Object> diagramData = new HashMap<>();
        diagramData.put("diagram_nodes", List.of());
        diagramData.put("diagram_edges", List.of());
        return diagramData;
    }

    /**
     * Helper to create diagram data with existing nodes.
     */
    private Map<String, Object> createDiagramDataWithNodes(String... entityIds) {
        List<Map<String, Object>> nodes = new ArrayList<>();
        for (String entityId : entityIds) {
            nodes.add(Map.of("entity_id", entityId, "entity_type", "APPLICATION"));
        }
        Map<String, Object> diagramData = new HashMap<>();
        diagramData.put("diagram_nodes", nodes);
        diagramData.put("diagram_edges", List.of());
        return diagramData;
    }

    @Test
    void computeExpansion_shouldReturnRootEntityAsNode() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1", List.of()
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertNotNull(response);
        assertEquals(1, response.nodes().size());
        assertEquals("app-1", response.nodes().get(0).entityId());
        assertEquals("APPLICATION", response.nodes().get(0).entityType());
        assertEquals("Test Application", response.nodes().get(0).entityName());
        assertFalse(response.nodes().get(0).alreadyOnDiagram());
    }

    @Test
    void computeExpansion_shouldMarkExistingNodesAsAlreadyOnDiagram() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1", List.of()
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createDiagramDataWithNodes("app-1");

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertNotNull(response);
        assertEquals(1, response.nodes().size());
        assertTrue(response.nodes().get(0).alreadyOnDiagram());
    }

    @Test
    void computeExpansion_shouldAddSelectedChildEntities() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1",
            List.of(SelectionDescriptor.of("app_components", "CHILD", List.of("ac-1", "ac-2")))
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertNotNull(response);
        assertTrue(response.nodes().size() >= 3); // root + 2 components
        assertTrue(response.nodes().stream().anyMatch(n -> n.entityId().equals("ac-1")));
        assertTrue(response.nodes().stream().anyMatch(n -> n.entityId().equals("ac-2")));
    }

    @Test
    void computeExpansion_shouldSetParentIdForChildRelationships() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1",
            List.of(SelectionDescriptor.of("app_components", "CHILD", List.of("ac-1")))
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        NodeDescriptor acNode = response.nodes().stream()
            .filter(n -> n.entityId().equals("ac-1"))
            .findFirst()
            .orElse(null);
        assertNotNull(acNode);
        assertEquals("app-1", acNode.parentEntityId());
    }

    @Test
    void computeExpansion_shouldHandleProcessActivities() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "BUSINESS_PROCESS", "bp-1", "diag-1",
            List.of(SelectionDescriptor.of("process_activities", "CHILD", List.of("pa-1", "pa-2")))
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertTrue(response.nodes().stream().anyMatch(n -> n.entityId().equals("pa-1")));
        assertTrue(response.nodes().stream().anyMatch(n -> n.entityId().equals("pa-2")));
    }

    @Test
    void computeExpansion_shouldValidateRequest() {
        // Given - null rootEntityType
        AdvancedAddRequest invalidRequest = new AdvancedAddRequest(
            null, "app-1", "diag-1", List.of()
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When/Then
        assertThrows(IllegalArgumentException.class, () ->
            service.computeExpansion(invalidRequest, metaModel, diagramData)
        );
    }

    @Test
    void computeExpansion_shouldHandleEmptySelections() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1", List.of()
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertEquals(1, response.nodes().size()); // Only root
        assertEquals(0, response.edges().size());
    }

    @Test
    void computeExpansion_shouldHandleMissingEntity() {
        // Given - non-existent entity
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "non-existent", "diag-1", List.of()
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createEmptyDiagramData();

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then - should still return a node (with empty name)
        assertEquals(1, response.nodes().size());
        assertEquals("non-existent", response.nodes().get(0).entityId());
        assertEquals("", response.nodes().get(0).entityName());
    }

    @Test
    void computeExpansion_shouldReportNewItemCounts() {
        // Given
        AdvancedAddRequest request = new AdvancedAddRequest(
            "APPLICATION", "app-1", "diag-1",
            List.of(SelectionDescriptor.of("app_components", "CHILD", List.of("ac-1")))
        );
        Map<String, Object> metaModel = createMockMetaModel();
        Map<String, Object> diagramData = createDiagramDataWithNodes("app-1");

        // When
        AdvancedAddResponse response = service.computeExpansion(request, metaModel, diagramData);

        // Then
        assertTrue(response.hasNewItems());
        assertEquals(1, response.newNodeCount()); // ac-1 is new
    }
}
