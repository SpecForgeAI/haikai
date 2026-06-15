package com.example.architecturemodel.service.export;

import com.example.architecturemodel.model.dto.diagram.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DiagramSvgRenderer.
 * Spec: Export Diagrams as SVG - Task Group 1
 *
 * Tests the SVG rendering functionality including:
 * - Valid SVG root element generation
 * - Node rendering as rect elements
 * - Edge rendering with arrow markers
 * - Empty diagram handling
 * - Canvas bounds calculation
 */
class DiagramSvgRendererTest {

    private DiagramSvgRenderer renderer;

    @BeforeEach
    void setUp() {
        renderer = new DiagramSvgRenderer();
    }

    @Test
    void renderToSvg_producesValidSvgRootElement() {
        // Arrange
        DiagramDto diagram = createDiagramWithNode("node-1", 100.0, 100.0, 200.0, 100.0);

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertNotNull(svg);
        assertTrue(svg.contains("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"),
            "Should have XML declaration");
        assertTrue(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\""),
            "Should have SVG root with xmlns");
        assertTrue(svg.contains("width="), "Should have width attribute");
        assertTrue(svg.contains("height="), "Should have height attribute");
        assertTrue(svg.contains("viewBox="), "Should have viewBox attribute");
        assertTrue(svg.contains("</svg>"), "Should have closing svg tag");
    }

    @Test
    void renderToSvg_rendersNodeAsRectWithPositionAndDimensions() {
        // Arrange
        DiagramDto diagram = createDiagramWithNode("node-1", 50.0, 75.0, 120.0, 80.0);

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertTrue(svg.contains("<rect"), "Should contain rect element");
        assertTrue(svg.contains("x=\"50\""), "Should have correct x position");
        assertTrue(svg.contains("y=\"75\""), "Should have correct y position");
        assertTrue(svg.contains("width=\"120\""), "Should have correct width");
        assertTrue(svg.contains("height=\"80\""), "Should have correct height");
    }

    @Test
    void renderToSvg_rendersNodeWithFillAndStrokeColors() {
        // Arrange
        DiagramNodeDto node = new DiagramNodeDto(
            "node-1", "Application", "entity-1",
            100.0, 100.0, 150.0, 75.0,
            false, 0, null, null, null, null, null,
            null, null, null, null,
            "#e3f2fd", "#1976d2", null, "#333333",  // backgroundColor, lineColor, lineWeight, textColor
            null, null, null, null, null, null, null, null
        );
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test Diagram", null, "General", null, null,
            List.of(node),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertTrue(svg.contains("fill=\"#e3f2fd\""), "Should have background color as fill");
        assertTrue(svg.contains("stroke=\"#1976d2\""), "Should have line color as stroke");
    }

    @Test
    void renderToSvg_rendersEdgeAsPolylineWithArrowMarkers() {
        // Arrange
        EdgePointDto point1 = new EdgePointDto("p1", 1, 100.0, 100.0);
        EdgePointDto point2 = new EdgePointDto("p2", 2, 200.0, 200.0);

        DiagramEdgeDto edge = new DiagramEdgeDto(
            "edge-1", "DataMovement", null,
            "node-1", "node-2",
            null, null, null, null, null, null,
            null, "arrow",  // arrowStart=null, arrowEnd="arrow"
            null, List.of(point1, point2),
            null, null, null, null, null, null,
            "#333333", null, null, null, null, null, null, null, null, null, null, null, null
        );

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test Diagram", null, "General", null, null,
            Collections.emptyList(),
            List.of(edge),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertTrue(svg.contains("<defs>"), "Should have defs section for markers");
        assertTrue(svg.contains("<marker id=\"arrow-end\""), "Should define arrow-end marker");
        assertTrue(svg.contains("<polyline"), "Should render edge as polyline");
        assertTrue(svg.contains("marker-end=\"url(#arrow-end)\""), "Should reference arrow marker");
    }

    @Test
    void renderToSvg_emptyDiagram_producesValidMinimalSvg() {
        // Arrange
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Empty Diagram", null, "General", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertNotNull(svg);
        assertTrue(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\""),
            "Should have valid SVG root");
        assertTrue(svg.contains("width=\"200\""), "Should have default minimum width");
        assertTrue(svg.contains("height=\"200\""), "Should have default minimum height");
        assertTrue(svg.contains("</svg>"), "Should be properly closed");
    }

    @Test
    void renderToSvg_nullDiagram_producesValidMinimalSvg() {
        // Act
        String svg = renderer.renderToSvg(null);

        // Assert
        assertNotNull(svg);
        assertTrue(svg.contains("<svg xmlns=\"http://www.w3.org/2000/svg\""),
            "Should have valid SVG root for null input");
        assertTrue(svg.contains("</svg>"), "Should be properly closed");
    }

    @Test
    void renderToSvg_calculatesCanvasBoundsWithPadding() {
        // Arrange - node at position (500, 500) with size 100x50
        DiagramDto diagram = createDiagramWithNode("node-1", 500.0, 500.0, 100.0, 50.0);

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert - viewBox should include padding around the node
        // Expected bounds: minX = 500-50 = 450, minY = 500-50 = 450
        //                  maxX = 500+100+50 = 650, maxY = 500+50+50 = 600
        //                  width = 200, height = 200 (min canvas size)
        assertTrue(svg.contains("viewBox=\"450"), "viewBox should start at padded minX");
        // The viewBox format is: viewBox="minX minY width height"
    }

    @Test
    void renderToSvg_rendersTextLabelForNodeWithEntityId() {
        // Arrange
        DiagramNodeDto node = new DiagramNodeDto(
            "node-1", "Application", "app-uuid-12345",
            100.0, 100.0, 150.0, 75.0,
            false, 0, null, null, null, null, null,
            null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null
        );
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test Diagram", null, "General", null, null,
            List.of(node),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        String svg = renderer.renderToSvg(diagram);

        // Assert
        assertTrue(svg.contains("<text"), "Should contain text element for label");
        assertTrue(svg.contains("</text>"), "Text element should be closed");
        // The renderer formats the entity type as label
        assertTrue(svg.contains("Application"), "Should contain formatted entity type as label");
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private DiagramDto createDiagramWithNode(String nodeId, Double posX, Double posY,
                                              Double width, Double height) {
        DiagramNodeDto node = new DiagramNodeDto(
            nodeId, "Application", "entity-1",
            posX, posY, width, height,
            false, 0, null, null, null, null, null,
            null, null, null, null,
            null, null, null, null, null, null, null, null, null, null,
            null, null
        );
        return new DiagramDto(
            "diagram-1", "Test Diagram", null, "General", null, null,
            List.of(node),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );
    }
}
