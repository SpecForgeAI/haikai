package com.example.architecturemodel.service.export;

import com.example.architecturemodel.model.dto.diagram.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DiagramCanonicalizer.
 * Verifies deterministic ordering of diagram elements and canonicalization of typed content.
 */
class DiagramCanonicalizerTest {

    private DiagramCanonicalizer canonicalizer;

    @BeforeEach
    void setUp() {
        canonicalizer = new DiagramCanonicalizer();
    }

    @Test
    void canonicalize_sortsDiagramNodesById() {
        // Arrange
        DiagramNodeDto node1 = createNode("node-z");
        DiagramNodeDto node2 = createNode("node-a");
        DiagramNodeDto node3 = createNode("node-m");

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            List.of(node1, node2, node3),
            Collections.emptyList(),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);

        // Assert
        assertEquals(3, result.diagramNodes().size());
        assertEquals("node-a", result.diagramNodes().get(0).id());
        assertEquals("node-m", result.diagramNodes().get(1).id());
        assertEquals("node-z", result.diagramNodes().get(2).id());
    }

    @Test
    void canonicalize_sortsDiagramEdgesById() {
        // Arrange
        DiagramEdgeDto edge1 = createEdge("edge-z");
        DiagramEdgeDto edge2 = createEdge("edge-a");
        DiagramEdgeDto edge3 = createEdge("edge-m");

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            Collections.emptyList(),
            List.of(edge1, edge2, edge3),
            Collections.emptyList(),
            Collections.emptyList(),
            null
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);

        // Assert
        assertEquals(3, result.diagramEdges().size());
        assertEquals("edge-a", result.diagramEdges().get(0).id());
        assertEquals("edge-m", result.diagramEdges().get(1).id());
        assertEquals("edge-z", result.diagramEdges().get(2).id());
    }

    @Test
    void canonicalize_sortsDecorationsById() {
        // Arrange
        DecorationDto deco1 = createDecoration("deco-z");
        DecorationDto deco2 = createDecoration("deco-a");
        DecorationDto deco3 = createDecoration("deco-m");

        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            Collections.emptyList(),
            Collections.emptyList(),
            List.of(deco1, deco2, deco3),
            Collections.emptyList(),
            null
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);

        // Assert
        assertEquals(3, result.decorations().size());
        assertEquals("deco-a", result.decorations().get(0).id());
        assertEquals("deco-m", result.decorations().get(1).id());
        assertEquals("deco-z", result.decorations().get(2).id());
    }

    @Test
    void canonicalizeJson_convertsMapToTreeMapWithSortedKeys() {
        // Arrange - create a LinkedHashMap with unsorted keys
        Map<String, Object> unsortedMap = new LinkedHashMap<>();
        unsortedMap.put("zebra", "z-value");
        unsortedMap.put("alpha", "a-value");
        unsortedMap.put("middle", "m-value");

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("type", "Sequence");
        typedContent.put("version", 1);
        typedContent.put("content", unsortedMap);

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

        // Assert
        assertNotNull(result.typedContent());
        assertTrue(result.typedContent() instanceof TreeMap, "Top-level should be TreeMap");

        @SuppressWarnings("unchecked")
        Map<String, Object> resultContent = (Map<String, Object>) result.typedContent().get("content");
        assertTrue(resultContent instanceof TreeMap, "Nested content should be TreeMap");

        // Verify sorted order by iterating keys
        List<String> keys = new ArrayList<>(resultContent.keySet());
        assertEquals("alpha", keys.get(0));
        assertEquals("middle", keys.get(1));
        assertEquals("zebra", keys.get(2));
    }

    @Test
    void canonicalizeJson_preservesListOrderButCanonicalizesElements() {
        // Arrange - create a list with map elements
        Map<String, Object> item1 = new LinkedHashMap<>();
        item1.put("zebra", "z");
        item1.put("alpha", "a");

        Map<String, Object> item2 = new LinkedHashMap<>();
        item2.put("delta", "d");
        item2.put("beta", "b");

        List<Map<String, Object>> listContent = new ArrayList<>();
        listContent.add(item1);
        listContent.add(item2);

        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("messages", listContent);

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

        // Assert
        assertNotNull(result.typedContent());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> resultList = (List<Map<String, Object>>) result.typedContent().get("messages");

        // List order preserved
        assertEquals(2, resultList.size());

        // First item keys are sorted
        List<String> keys1 = new ArrayList<>(resultList.get(0).keySet());
        assertEquals("alpha", keys1.get(0));
        assertEquals("zebra", keys1.get(1));

        // Second item keys are sorted
        List<String> keys2 = new ArrayList<>(resultList.get(1).keySet());
        assertEquals("beta", keys2.get(0));
        assertEquals("delta", keys2.get(1));
    }

    @Test
    void canonicalizeJson_returnsPrimitivesUnchanged() {
        // Arrange
        Map<String, Object> typedContent = new LinkedHashMap<>();
        typedContent.put("stringValue", "hello");
        typedContent.put("intValue", 42);
        typedContent.put("boolValue", true);
        typedContent.put("doubleValue", 3.14);
        typedContent.put("nullValue", null);

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

        // Assert
        assertNotNull(result.typedContent());
        assertEquals("hello", result.typedContent().get("stringValue"));
        assertEquals(42, result.typedContent().get("intValue"));
        assertEquals(true, result.typedContent().get("boolValue"));
        assertEquals(3.14, result.typedContent().get("doubleValue"));
        assertNull(result.typedContent().get("nullValue"));
    }

    @Test
    void canonicalize_handlesNullCollectionsGracefully() {
        // Arrange
        DiagramDto diagram = new DiagramDto(
            "diagram-1", "Test", null, "General", null, null,
            null,  // null nodes
            null,  // null edges
            null,  // null decorations
            null,  // null interaction edges
            null   // null typedContent
        );

        // Act
        DiagramDto result = canonicalizer.canonicalize(diagram);

        // Assert
        assertNull(result.diagramNodes());
        assertNull(result.diagramEdges());
        assertNull(result.decorations());
        assertNull(result.interactionEdges());
        assertNull(result.typedContent());
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    /**
     * DiagramNodeDto has 28 fields:
     * id, entityType, entityId, posX, posY, width, height, autoSize, zIndex, parentNodeId,
     * styleOverride, textHAlign, textVAlign, textAreaWidth, textFontSize, textFontWeight,
     * textFontStyle, textTextDecoration, backgroundColor, lineColor, textColor, renderStyle,
     * embeddedAttributeIds, selectedAttributeIds, embeddedEndpointIds, embeddedEntityIds,
     * validFrom, validTo
     */
    private DiagramNodeDto createNode(String id) {
        return new DiagramNodeDto(
            id,              // id
            "Application",   // entityType
            null,            // entityId
            0.0,             // posX
            0.0,             // posY
            100.0,           // width
            50.0,            // height
            true,            // autoSize
            0,               // zIndex
            null,            // parentNodeId
            null,            // styleOverride
            null,            // textHAlign
            null,            // textVAlign
            null,            // textAreaWidth
            null,            // textFontSize
            null,            // textFontWeight
            null,            // textFontStyle
            null,            // textTextDecoration
            null,            // backgroundColor
            null,            // lineColor
            null,            // lineWeight
            null,            // textColor
            null,            // renderStyle
            null,            // embeddedAttributeIds
            null,            // selectedAttributeIds
            null,            // embeddedEndpointIds
            null,            // embeddedEntityIds
            null,            // validFrom
            null,            // validTo
            null             // linkedDiagramId
        );
    }

    /**
     * DiagramEdgeDto has 33 fields:
     * id, relationshipType, relationshipId, sourceNodeId, targetNodeId, labelText,
     * labelPosX, labelPosY, lineWeight, lineType, lineDashes, arrowStart, arrowEnd,
     * styleOverride, edgePoints, labelFontSize, labelFontWeight, labelFontStyle,
     * labelTextDecoration, labelHAlign, labelVAlign, lineColor, textColor, subType,
     * sourceLabelText, sourceLabelPosX, sourceLabelPosY, targetLabelText, targetLabelPosX,
     * targetLabelPosY, zIndex, validFrom, validTo
     */
    private DiagramEdgeDto createEdge(String id) {
        return new DiagramEdgeDto(
            id,              // id
            "DataMovement",  // relationshipType
            null,            // relationshipId
            "source",        // sourceNodeId
            "target",        // targetNodeId
            null,            // labelText
            null,            // labelPosX
            null,            // labelPosY
            null,            // lineWeight
            null,            // lineType
            null,            // lineDashes
            null,            // arrowStart
            null,            // arrowEnd
            null,            // styleOverride
            null,            // edgePoints
            null,            // labelFontSize
            null,            // labelFontWeight
            null,            // labelFontStyle
            null,            // labelTextDecoration
            null,            // labelHAlign
            null,            // labelVAlign
            null,            // lineColor
            null,            // textColor
            null,            // subType
            null,            // sourceLabelText
            null,            // sourceLabelPosX
            null,            // sourceLabelPosY
            null,            // targetLabelText
            null,            // targetLabelPosX
            null,            // targetLabelPosY
            null,            // zIndex
            null,            // validFrom
            null,            // validTo
            null             // linkedDiagramId
        );
    }

    /**
     * DecorationDto has 26 fields:
     * id, type, text, textFontSize, textFontWeight, textFontStyle, textColor, lineColor,
     * lineStyle, lineWeight, zIndex, validFrom, validTo, posX, posY, width, height,
     * textHAlign, textVAlign, backgroundColor, autoSize, linePoints, labelPosX, labelPosY,
     * arrowStart, arrowEnd
     */
    private DecorationDto createDecoration(String id) {
        return new DecorationDto(
            id,              // id
            "Text",          // type
            "Label",         // text
            null,            // textFontSize
            null,            // textFontWeight
            null,            // textFontStyle
            null,            // textTextDecoration
            null,            // textColor
            null,            // lineColor
            null,            // lineStyle
            null,            // lineWeight
            0,               // zIndex
            null,            // validFrom
            null,            // validTo
            null,            // posX
            null,            // posY
            null,            // width
            null,            // height
            null,            // textHAlign
            null,            // textVAlign
            null,            // backgroundColor
            null,            // backgroundOpacity
            null,            // borderOpacity
            null,            // autoSize
            null,            // linePoints
            null,            // labelPosX
            null,            // labelPosY
            null,            // arrowStart
            null,            // arrowEnd
            null             // linkedDiagramId
        );
    }
}
