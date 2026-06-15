package com.example.archtool.service;

import com.example.archtool.exception.DiagramParsingException;
import com.example.archtool.model.dto.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.*;

/**
 * Unit tests for DrawioParser service.
 *
 * <p>These tests verify that the parser correctly extracts nodes, edges,
 * geometry, and styles from draw.io XML files. Test resources are located
 * in src/test/resources/test-diagrams/.</p>
 */
class DrawioParserTest {

    private DrawioParser parser;
    private DiagramSourceDto testSource;

    @BeforeEach
    void setUp() {
        parser = new DrawioParser();
        testSource = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            "page123",
            "att456",
            "test.drawio"
        );
    }

    // ========================================================================
    // Test 1: Parsing single-tab draw.io file extracts nodes correctly
    // ========================================================================
    @Test
    @DisplayName("Parsing single-tab draw.io file extracts nodes correctly")
    void parse_singleTabFile_extractsNodesCorrectly() throws IOException {
        // Given: A simple draw.io file with 3 nodes
        byte[] xmlContent = loadTestResource("test-diagrams/simple.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: One diagram is returned with correct nodes
        assertThat(diagrams).hasSize(1);
        DiagramGraphDto diagram = diagrams.get(0);

        assertThat(diagram.nodes()).hasSize(3);

        // Verify specific node content
        DiagramNodeDto flowPricing = findNodeById(diagram.nodes(), "n1");
        assertThat(flowPricing).isNotNull();
        assertThat(flowPricing.label()).isEqualTo("Flow Pricing");
        assertThat(flowPricing.parentId()).isEqualTo("1");

        DiagramNodeDto orderMgmt = findNodeById(diagram.nodes(), "n2");
        assertThat(orderMgmt).isNotNull();
        assertThat(orderMgmt.label()).isEqualTo("Order Management");

        DiagramNodeDto riskEngine = findNodeById(diagram.nodes(), "n3");
        assertThat(riskEngine).isNotNull();
        assertThat(riskEngine.label()).isEqualTo("Risk Engine");
    }

    // ========================================================================
    // Test 2: Parsing single-tab draw.io file extracts edges correctly
    // ========================================================================
    @Test
    @DisplayName("Parsing single-tab draw.io file extracts edges correctly")
    void parse_singleTabFile_extractsEdgesCorrectly() throws IOException {
        // Given: A simple draw.io file with 2 edges
        byte[] xmlContent = loadTestResource("test-diagrams/simple.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Edges are extracted correctly
        assertThat(diagrams).hasSize(1);
        DiagramGraphDto diagram = diagrams.get(0);

        assertThat(diagram.edges()).hasSize(2);

        // Verify first edge
        DiagramEdgeDto enquiryEdge = findEdgeById(diagram.edges(), "e1");
        assertThat(enquiryEdge).isNotNull();
        assertThat(enquiryEdge.sourceId()).isEqualTo("n1");
        assertThat(enquiryEdge.targetId()).isEqualTo("n2");
        assertThat(enquiryEdge.label()).isEqualTo("Enquiry");

        // Verify second edge
        DiagramEdgeDto riskEdge = findEdgeById(diagram.edges(), "e2");
        assertThat(riskEdge).isNotNull();
        assertThat(riskEdge.sourceId()).isEqualTo("n2");
        assertThat(riskEdge.targetId()).isEqualTo("n3");
        assertThat(riskEdge.label()).isEqualTo("Risk Check");
    }

    // ========================================================================
    // Test 3: Parsing multi-tab draw.io file returns separate DiagramGraphDto per tab
    // ========================================================================
    @Test
    @DisplayName("Parsing multi-tab draw.io file returns separate DiagramGraphDto per tab")
    void parse_multiTabFile_returnsSeparateDiagramsPerTab() throws IOException {
        // Given: A multi-tab draw.io file with 2 tabs
        byte[] xmlContent = loadTestResource("test-diagrams/multi-tab.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Two diagrams are returned
        assertThat(diagrams).hasSize(2);

        // First tab
        DiagramGraphDto tab1 = diagrams.get(0);
        assertThat(tab1.tabIndex()).isEqualTo(0);
        assertThat(tab1.tabName()).isEqualTo("Tab One");
        assertThat(tab1.diagramId()).isEqualTo("diag_page123_att456_0");
        assertThat(tab1.nodes()).hasSize(2);
        assertThat(tab1.edges()).hasSize(1);

        // Second tab
        DiagramGraphDto tab2 = diagrams.get(1);
        assertThat(tab2.tabIndex()).isEqualTo(1);
        assertThat(tab2.tabName()).isEqualTo("Tab Two");
        assertThat(tab2.diagramId()).isEqualTo("diag_page123_att456_1");
        assertThat(tab2.nodes()).hasSize(2);
        assertThat(tab2.edges()).isEmpty();
    }

    // ========================================================================
    // Test 4: Node geometry extraction (x, y, width, height)
    // ========================================================================
    @Test
    @DisplayName("Node geometry extraction (x, y, width, height)")
    void parse_extractsNodeGeometry() throws IOException {
        // Given: A draw.io file with nodes that have geometry
        byte[] xmlContent = loadTestResource("test-diagrams/simple.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Geometry is extracted correctly
        DiagramGraphDto diagram = diagrams.get(0);
        DiagramNodeDto flowPricing = findNodeById(diagram.nodes(), "n1");

        assertThat(flowPricing.geometry()).isNotNull();
        assertThat(flowPricing.geometry().x()).isEqualTo(100.0);
        assertThat(flowPricing.geometry().y()).isEqualTo(200.0);
        assertThat(flowPricing.geometry().width()).isEqualTo(120.0);
        assertThat(flowPricing.geometry().height()).isEqualTo(60.0);

        // Verify another node's geometry
        DiagramNodeDto riskEngine = findNodeById(diagram.nodes(), "n3");
        assertThat(riskEngine.geometry()).isNotNull();
        assertThat(riskEngine.geometry().x()).isEqualTo(200.0);
        assertThat(riskEngine.geometry().y()).isEqualTo(350.0);
        assertThat(riskEngine.geometry().width()).isEqualTo(100.0);
        assertThat(riskEngine.geometry().height()).isEqualTo(80.0);
    }

    // ========================================================================
    // Test 5: Edge points extraction (sourcePoint, targetPoint, intermediate points)
    // ========================================================================
    @Test
    @DisplayName("Edge points extraction (sourcePoint, targetPoint, intermediate points)")
    void parse_extractsEdgePoints() throws IOException {
        // Given: A draw.io file with edges that have points
        byte[] xmlContent = loadTestResource("test-diagrams/simple.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Edge points are extracted correctly
        DiagramGraphDto diagram = diagrams.get(0);

        // Edge e1 has sourcePoint and targetPoint
        DiagramEdgeDto e1 = findEdgeById(diagram.edges(), "e1");
        assertThat(e1.points()).hasSize(2);
        assertThat(e1.points().get(0).x()).isEqualTo(220.0);  // sourcePoint
        assertThat(e1.points().get(0).y()).isEqualTo(230.0);
        assertThat(e1.points().get(1).x()).isEqualTo(300.0);  // targetPoint
        assertThat(e1.points().get(1).y()).isEqualTo(230.0);

        // Edge e2 has sourcePoint, targetPoint, and intermediate points
        DiagramEdgeDto e2 = findEdgeById(diagram.edges(), "e2");
        assertThat(e2.points()).hasSizeGreaterThanOrEqualTo(2);
        // First should be sourcePoint (370, 260)
        assertThat(e2.points().get(0).x()).isEqualTo(370.0);
        assertThat(e2.points().get(0).y()).isEqualTo(260.0);
    }

    // ========================================================================
    // Test 6: Style string parsing extracts fillColor, strokeColor, shape, rounded
    // ========================================================================
    @Test
    @DisplayName("Style string parsing extracts fillColor, strokeColor, shape, rounded")
    void parse_extractsStyleProperties() throws IOException {
        // Given: A draw.io file with styled elements
        byte[] xmlContent = loadTestResource("test-diagrams/styled.drawio");

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Style properties are extracted correctly
        DiagramGraphDto diagram = diagrams.get(0);

        // Rectangle with basic styling
        DiagramNodeDto rect = findNodeById(diagram.nodes(), "rect1");
        assertThat(rect.style()).isNotNull();
        assertThat(rect.style().fillColor()).isEqualTo("#ffffff");
        assertThat(rect.style().strokeColor()).isEqualTo("#000000");
        assertThat(rect.style().fontColor()).isEqualTo("#000000");
        assertThat(rect.style().rounded()).isFalse();
        assertThat(rect.style().fontSize()).isEqualTo(14);
        assertThat(rect.style().fontFamily()).isEqualTo("Helvetica");

        // Rounded box
        DiagramNodeDto rounded = findNodeById(diagram.nodes(), "rounded1");
        assertThat(rounded.style().rounded()).isTrue();
        assertThat(rounded.style().fillColor()).isEqualTo("#e1d5e7");
        assertThat(rounded.style().strokeColor()).isEqualTo("#9673a6");

        // Ellipse shape
        DiagramNodeDto ellipse = findNodeById(diagram.nodes(), "ellipse1");
        assertThat(ellipse.style().shape()).isEqualTo("ellipse");
        assertThat(ellipse.style().fillColor()).isEqualTo("#f8cecc");

        // Rhombus shape
        DiagramNodeDto rhombus = findNodeById(diagram.nodes(), "rhombus1");
        assertThat(rhombus.style().shape()).isEqualTo("rhombus");

        // Dashed edge
        DiagramEdgeDto dashedEdge = findEdgeById(diagram.edges(), "edge_dashed");
        assertThat(dashedEdge.style().dashed()).isTrue();
        assertThat(dashedEdge.style().endArrow()).isEqualTo("block");
        assertThat(dashedEdge.style().startArrow()).isEqualTo("oval");
    }

    // ========================================================================
    // Test 7: Invalid XML throws DiagramParsingException
    // ========================================================================
    @Test
    @DisplayName("Invalid XML throws DiagramParsingException")
    void parse_invalidXml_throwsDiagramParsingException() {
        // Given: Invalid XML content
        byte[] invalidXml = "This is not valid XML <unclosed".getBytes(StandardCharsets.UTF_8);

        // When/Then: Parsing throws DiagramParsingException
        assertThatThrownBy(() -> parser.parse(invalidXml, testSource))
            .isInstanceOf(DiagramParsingException.class)
            .hasMessageContaining("Invalid XML");
    }

    // ========================================================================
    // Test 8: Missing geometry on node results in null geometry (not exception)
    // ========================================================================
    @Test
    @DisplayName("Missing geometry on node results in null geometry (not exception)")
    void parse_missingGeometry_resultsInNullGeometry() {
        // Given: XML with a node that has no mxGeometry child
        String xmlWithMissingGeometry = """
            <mxfile>
              <diagram id="test" name="Test">
                <mxGraphModel>
                  <root>
                    <mxCell id="0"/>
                    <mxCell id="1" parent="0"/>
                    <mxCell id="node_no_geom" value="No Geometry" style="rounded=1;" vertex="1" parent="1"/>
                  </root>
                </mxGraphModel>
              </diagram>
            </mxfile>
            """;
        byte[] xmlContent = xmlWithMissingGeometry.getBytes(StandardCharsets.UTF_8);

        // When: Parsing the file
        List<DiagramGraphDto> diagrams = parser.parse(xmlContent, testSource);

        // Then: Node is parsed with null geometry (no exception thrown)
        assertThat(diagrams).hasSize(1);
        DiagramGraphDto diagram = diagrams.get(0);
        assertThat(diagram.nodes()).hasSize(1);

        DiagramNodeDto node = diagram.nodes().get(0);
        assertThat(node.id()).isEqualTo("node_no_geom");
        assertThat(node.label()).isEqualTo("No Geometry");
        assertThat(node.geometry()).isNull();  // Missing geometry is handled gracefully
    }

    // ========================================================================
    // Helper methods
    // ========================================================================

    /**
     * Loads a test resource file from the classpath.
     *
     * @param resourcePath the path relative to src/test/resources
     * @return the file contents as bytes
     * @throws IOException if the file cannot be read
     */
    private byte[] loadTestResource(String resourcePath) throws IOException {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            if (is == null) {
                throw new IOException("Resource not found: " + resourcePath);
            }
            return is.readAllBytes();
        }
    }

    /**
     * Finds a node by ID in a list of nodes.
     *
     * @param nodes the list of nodes
     * @param id    the node ID to find
     * @return the node, or null if not found
     */
    private DiagramNodeDto findNodeById(List<DiagramNodeDto> nodes, String id) {
        return nodes.stream()
            .filter(n -> id.equals(n.id()))
            .findFirst()
            .orElse(null);
    }

    /**
     * Finds an edge by ID in a list of edges.
     *
     * @param edges the list of edges
     * @param id    the edge ID to find
     * @return the edge, or null if not found
     */
    private DiagramEdgeDto findEdgeById(List<DiagramEdgeDto> edges, String id) {
        return edges.stream()
            .filter(e -> id.equals(e.id()))
            .findFirst()
            .orElse(null);
    }
}
