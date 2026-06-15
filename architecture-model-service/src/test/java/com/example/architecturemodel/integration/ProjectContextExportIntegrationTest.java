package com.example.architecturemodel.integration;

import com.example.architecturemodel.model.dto.diagram.*;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
import com.example.architecturemodel.service.export.DiagramCanonicalizer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for Project Context Export feature.
 *
 * These tests verify:
 * 1. Deterministic canonicalization produces identical output for identical input
 * 2. JSON serialization preserves snake_case property names
 * 3. Nested typedContent is properly canonicalized
 * 4. Edge cases with null values are handled correctly
 * 5. Multiple invocations produce identical results (idempotency)
 * 6. Complex diagrams with all element types are canonicalized correctly
 */
class ProjectContextExportIntegrationTest {

    private DiagramCanonicalizer canonicalizer;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        canonicalizer = new DiagramCanonicalizer();
        objectMapper = new ObjectMapper();
    }

    @Test
    void canonicalization_isDeterministic_forIdenticalInput() throws Exception {
        // Arrange - create diagram with unsorted elements
        DiagramDto diagram = createDiagramWithUnsortedElements();

        // Act - canonicalize multiple times
        DiagramDto result1 = canonicalizer.canonicalize(diagram);
        DiagramDto result2 = canonicalizer.canonicalize(diagram);

        // Assert - both results should serialize to identical JSON
        String json1 = objectMapper.writeValueAsString(result1);
        String json2 = objectMapper.writeValueAsString(result2);

        assertEquals(json1, json2, "Canonicalization should be deterministic");
    }

    @Test
    void canonicalization_producesConsistentOutput_regardlessOfInputOrder() throws Exception {
        // Arrange - create two diagrams with same elements in different order
        DiagramNodeDto nodeA = createNode("node-a");
        DiagramNodeDto nodeZ = createNode("node-z");
        DiagramNodeDto nodeM = createNode("node-m");

        DiagramDto diagram1 = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            List.of(nodeA, nodeZ, nodeM),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        DiagramDto diagram2 = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            List.of(nodeZ, nodeA, nodeM),  // Different order
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        DiagramDto result1 = canonicalizer.canonicalize(diagram1);
        DiagramDto result2 = canonicalizer.canonicalize(diagram2);

        // Assert - both should produce same sorted order
        assertEquals(result1.diagramNodes().get(0).id(), result2.diagramNodes().get(0).id());
        assertEquals(result1.diagramNodes().get(1).id(), result2.diagramNodes().get(1).id());
        assertEquals(result1.diagramNodes().get(2).id(), result2.diagramNodes().get(2).id());
        assertEquals("node-a", result1.diagramNodes().get(0).id());
        assertEquals("node-m", result1.diagramNodes().get(1).id());
        assertEquals("node-z", result1.diagramNodes().get(2).id());
    }

    @Test
    void typedContent_keysAreSorted_inJsonOutput() throws Exception {
        // Arrange - create typedContent with unsorted keys
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("zebra", "z-value");
        content.put("alpha", "a-value");
        content.put("middle", "m-value");

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);
        typedContent.put("content", content);

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "Sequence", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            typedContent
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);
        String json = objectMapper.writeValueAsString(result.typedContent());

        // Assert - keys should appear in sorted order
        // The TreeMap ensures keys are sorted alphabetically
        assertTrue(result.typedContent() instanceof TreeMap);
        List<String> keys = new ArrayList<>(result.typedContent().keySet());
        assertEquals("content", keys.get(0));
        assertEquals("type", keys.get(1));
        assertEquals("version", keys.get(2));
    }

    @Test
    void projectContextPackageDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        ProjectContextPackageDto dto = new ProjectContextPackageDto(
            "test-project.json",
            null,
            Collections.emptyList()
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should use snake_case for project_id");
        assertTrue(json.contains("\"test-project.json\""));
    }

    @Test
    void canonicalDiagramExportDto_serializesWithSnakeCaseProperties() throws Exception {
        // Arrange
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        CanonicalDiagramExportDto dto = new CanonicalDiagramExportDto(
            "test-project.json",
            "diagram-1",
            "General",
            diagram
        );

        // Act
        String json = objectMapper.writeValueAsString(dto);

        // Assert
        assertTrue(json.contains("\"project_id\""), "Should use snake_case for project_id");
        assertTrue(json.contains("\"diagram_id\""), "Should use snake_case for diagram_id");
        assertTrue(json.contains("\"diagram_type\""), "Should use snake_case for diagram_type");
        assertTrue(json.contains("\"canonical\""));
    }

    @Test
    void complexDiagram_withAllElementTypes_isCanonicalized() {
        // Arrange
        List<DiagramNodeDto> nodes = List.of(
            createNode("node-z"),
            createNode("node-a"),
            createNode("node-m")
        );

        List<DiagramEdgeDto> edges = List.of(
            createEdge("edge-z"),
            createEdge("edge-a"),
            createEdge("edge-m")
        );

        List<DecorationDto> decorations = List.of(
            createDecoration("deco-z"),
            createDecoration("deco-a"),
            createDecoration("deco-m")
        );

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("zebra", "z-value");
        typedContent.put("alpha", "a-value");

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            nodes, edges, decorations, Collections.emptyList(), typedContent
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);

        // Assert - all collections should be sorted by id
        assertEquals("node-a", result.diagramNodes().get(0).id());
        assertEquals("node-m", result.diagramNodes().get(1).id());
        assertEquals("node-z", result.diagramNodes().get(2).id());

        assertEquals("edge-a", result.diagramEdges().get(0).id());
        assertEquals("edge-m", result.diagramEdges().get(1).id());
        assertEquals("edge-z", result.diagramEdges().get(2).id());

        assertEquals("deco-a", result.decorations().get(0).id());
        assertEquals("deco-m", result.decorations().get(1).id());
        assertEquals("deco-z", result.decorations().get(2).id());

        // typedContent keys should be sorted
        assertTrue(result.typedContent() instanceof TreeMap);
        List<String> keys = new ArrayList<>(result.typedContent().keySet());
        assertEquals("alpha", keys.get(0));
        assertEquals("zebra", keys.get(1));
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private DiagramDto createDiagramWithUnsortedElements() {
        List<DiagramNodeDto> nodes = List.of(
            createNode("node-z"),
            createNode("node-a"),
            createNode("node-m")
        );

        List<DiagramEdgeDto> edges = List.of(
            createEdge("edge-z"),
            createEdge("edge-a")
        );

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("zebra", "z");
        typedContent.put("alpha", "a");

        return new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            nodes, edges, Collections.emptyList(), Collections.emptyList(), typedContent
        );
    }

    private DiagramNodeDto createNode(String id) {
        return new DiagramNodeDto(
            id, "Application", null, 0.0, 0.0, 100.0, 50.0,
            true, 0, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null,
            null, null, null, null, null
        );
    }

    private DiagramEdgeDto createEdge(String id) {
        return new DiagramEdgeDto(
            id, "DataMovement", null, "source", "target",
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null
        );
    }

    private DecorationDto createDecoration(String id) {
        return new DecorationDto(
            id, "Text", "Label", null, null, null, null, null, null, null,
            null, 0, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null
        );
    }
}
