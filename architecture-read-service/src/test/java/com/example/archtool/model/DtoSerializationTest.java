package com.example.archtool.model;

import com.example.archtool.model.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for DTO construction and JSON serialization.
 *
 * <p>These tests verify that DTOs are properly constructed, serialize to
 * expected JSON structure, and handle nullable fields appropriately.</p>
 */
class DtoSerializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("DiagramNodeDto serializes to JSON with all fields including nested geometry and style")
    void diagramNodeDto_serializesWithAllFields() throws Exception {
        // Given: A node with geometry, style, and parent
        DiagramGeometryDto geometry = new DiagramGeometryDto(100.0, 200.0, 120.0, 60.0);
        DiagramStyleDto style = new DiagramStyleDto(
            "rounded=1;fillColor=#aaffaa;strokeColor=#000000;",
            "#aaffaa",
            "#000000",
            "#333333",
            "rectangle",
            true,
            false,
            null,
            null,
            12,
            "Arial"
        );
        DiagramNodeDto node = new DiagramNodeDto("n1", "Flow Pricing", geometry, style, "group1");

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(node);

        // Then: JSON contains all expected fields
        assertThat(json).contains("\"id\":\"n1\"");
        assertThat(json).contains("\"label\":\"Flow Pricing\"");
        assertThat(json).contains("\"parentId\":\"group1\"");
        assertThat(json).contains("\"x\":100.0");
        assertThat(json).contains("\"y\":200.0");
        assertThat(json).contains("\"width\":120.0");
        assertThat(json).contains("\"height\":60.0");
        assertThat(json).contains("\"fillColor\":\"#aaffaa\"");
        assertThat(json).contains("\"strokeColor\":\"#000000\"");
        assertThat(json).contains("\"shape\":\"rectangle\"");
        assertThat(json).contains("\"rounded\":true");
    }

    @Test
    @DisplayName("DiagramEdgeDto serializes to JSON with points list")
    void diagramEdgeDto_serializesWithPointsList() throws Exception {
        // Given: An edge with multiple points
        List<DiagramPointDto> points = List.of(
            new DiagramPointDto(160.0, 230.0),
            new DiagramPointDto(220.0, 250.0),
            new DiagramPointDto(300.0, 230.0)
        );
        DiagramStyleDto style = new DiagramStyleDto(
            "endArrow=classic;dashed=1;strokeColor=#666666;",
            null,
            "#666666",
            null,
            null,
            null,
            true,
            null,
            "classic",
            null,
            null
        );
        DiagramEdgeDto edge = new DiagramEdgeDto("e1", "n1", "n2", "Enquiry", points, style);

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(edge);

        // Then: JSON contains edge fields and points array
        assertThat(json).contains("\"id\":\"e1\"");
        assertThat(json).contains("\"sourceId\":\"n1\"");
        assertThat(json).contains("\"targetId\":\"n2\"");
        assertThat(json).contains("\"label\":\"Enquiry\"");
        assertThat(json).contains("\"points\":[");
        assertThat(json).contains("\"x\":160.0");
        assertThat(json).contains("\"y\":230.0");
        assertThat(json).contains("\"x\":300.0");
        assertThat(json).contains("\"endArrow\":\"classic\"");
        assertThat(json).contains("\"dashed\":true");
    }

    @Test
    @DisplayName("DiagramStyleDto parses style string correctly and preserves raw style")
    void diagramStyleDto_parsesStyleStringCorrectly() throws Exception {
        // Given: A style DTO with various properties
        String rawStyle = "rounded=1;fillColor=#aaffaa;strokeColor=#000000;fontColor=#333333;shape=rectangle;dashed=0;startArrow=none;endArrow=classic;fontSize=12;fontFamily=Arial;";
        DiagramStyleDto style = new DiagramStyleDto(
            rawStyle,
            "#aaffaa",
            "#000000",
            "#333333",
            "rectangle",
            true,
            false,
            "none",
            "classic",
            12,
            "Arial"
        );

        // When: Serialize to JSON and verify round-trip
        String json = objectMapper.writeValueAsString(style);
        DiagramStyleDto deserialized = objectMapper.readValue(json, DiagramStyleDto.class);

        // Then: All properties are preserved correctly
        assertThat(deserialized.rawStyle()).isEqualTo(rawStyle);
        assertThat(deserialized.fillColor()).isEqualTo("#aaffaa");
        assertThat(deserialized.strokeColor()).isEqualTo("#000000");
        assertThat(deserialized.fontColor()).isEqualTo("#333333");
        assertThat(deserialized.shape()).isEqualTo("rectangle");
        assertThat(deserialized.rounded()).isTrue();
        assertThat(deserialized.dashed()).isFalse();
        assertThat(deserialized.startArrow()).isEqualTo("none");
        assertThat(deserialized.endArrow()).isEqualTo("classic");
        assertThat(deserialized.fontSize()).isEqualTo(12);
        assertThat(deserialized.fontFamily()).isEqualTo("Arial");
    }

    @Test
    @DisplayName("ConfluenceDiagramResponse calculates summary with correct totals")
    void confluenceDiagramResponse_calculatesSummaryCorrectly() throws Exception {
        // Given: A response with pages, diagrams, nodes, and edges
        DiagramGeometryDto geometry = new DiagramGeometryDto(100.0, 100.0, 80.0, 40.0);
        DiagramNodeDto node1 = new DiagramNodeDto("n1", "Node1", geometry, null, null);
        DiagramNodeDto node2 = new DiagramNodeDto("n2", "Node2", geometry, null, null);
        DiagramEdgeDto edge1 = new DiagramEdgeDto("e1", "n1", "n2", "Link", List.of(), null);

        DiagramSourceDto source = new DiagramSourceDto(
            "CONFLUENCE_DRAWIO_ATTACHMENT", "page1", "att1", "diagram.drawio"
        );
        DiagramGraphDto diagram = new DiagramGraphDto(
            "diag_page1_att1_0", "Main Diagram", 0, "Overview",
            source, List.of(node1, node2), List.of(edge1)
        );

        ConfluencePageDiagramsDto page1 = new ConfluencePageDiagramsDto(
            "page1", "Test Page 1", List.of(diagram)
        );
        ConfluencePageDiagramsDto page2 = new ConfluencePageDiagramsDto(
            "page2", "Test Page 2", List.of(diagram, diagram)
        );

        List<String> warnings = List.of("Page 123: Missing attachment");
        ResponseSummaryDto summary = new ResponseSummaryDto(2, 3, 6, 3, warnings);

        ConfluenceDiagramResponse response = new ConfluenceDiagramResponse(
            "rootPage", "Root Page Title", true, 10,
            List.of(page1, page2), summary
        );

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(response);

        // Then: Summary fields are correctly serialized
        assertThat(json).contains("\"rootPageId\":\"rootPage\"");
        assertThat(json).contains("\"rootPageTitle\":\"Root Page Title\"");
        assertThat(json).contains("\"includeAllChildPages\":true");
        assertThat(json).contains("\"maxDepth\":10");
        assertThat(json).contains("\"totalPages\":2");
        assertThat(json).contains("\"totalDiagrams\":3");
        assertThat(json).contains("\"totalNodes\":6");
        assertThat(json).contains("\"totalEdges\":3");
        assertThat(json).contains("\"warnings\":[\"Page 123: Missing attachment\"]");
    }

    @Test
    @DisplayName("DiagramGeometryDto handles null values gracefully")
    void diagramGeometryDto_handlesNullValuesGracefully() throws Exception {
        // Given: A geometry with some null values (common when geometry is partially specified)
        DiagramGeometryDto geometry = new DiagramGeometryDto(100.0, null, 80.0, null);

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(geometry);

        // Then: JSON contains non-null values and represents nulls appropriately
        assertThat(json).contains("\"x\":100.0");
        assertThat(json).contains("\"width\":80.0");
        // Null values should be serialized as null
        assertThat(json).contains("\"y\":null");
        assertThat(json).contains("\"height\":null");

        // And: Deserialization preserves null values
        DiagramGeometryDto deserialized = objectMapper.readValue(json, DiagramGeometryDto.class);
        assertThat(deserialized.x()).isEqualTo(100.0);
        assertThat(deserialized.y()).isNull();
        assertThat(deserialized.width()).isEqualTo(80.0);
        assertThat(deserialized.height()).isNull();
    }
}
