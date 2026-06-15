package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DiagramDto deserialization with various JSON field name variants.
 *
 * Tests that the @JsonAlias annotation allows deserialization from:
 * - "diagram_type" (canonical field name via @JsonProperty)
 * - "type" (alias)
 * - "diagramType" (alias)
 */
class DiagramDtoDeserializationTest {

    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
    }

    /**
     * Test deserialization with canonical "diagram_type" field name.
     * This is the primary field name specified by @JsonProperty("diagram_type").
     */
    @Test
    void deserialize_withDiagramTypeSnakeCase_resolvesCorrectly() throws Exception {
        String json = """
            {
                "id": "diagram-1",
                "name": "Test Diagram",
                "diagram_type": "Sequence",
                "diagram_nodes": [],
                "diagram_edges": [],
                "decorations": [],
                "interaction_edges": []
            }
            """;

        DiagramDto dto = objectMapper.readValue(json, DiagramDto.class);

        assertNotNull(dto);
        assertEquals("diagram-1", dto.id());
        assertEquals("Test Diagram", dto.name());
        assertEquals("Sequence", dto.diagramType());
    }

    /**
     * Test deserialization with alternate "type" field name.
     * This tests the @JsonAlias annotation accepting "type" as an input field name.
     */
    @Test
    void deserialize_withTypeFieldName_resolvesCorrectly() throws Exception {
        String json = """
            {
                "id": "diagram-2",
                "name": "Test Diagram with type",
                "type": "Sequence",
                "diagram_nodes": [],
                "diagram_edges": [],
                "decorations": [],
                "interaction_edges": []
            }
            """;

        DiagramDto dto = objectMapper.readValue(json, DiagramDto.class);

        assertNotNull(dto);
        assertEquals("diagram-2", dto.id());
        assertEquals("Test Diagram with type", dto.name());
        assertEquals("Sequence", dto.diagramType());
    }

    /**
     * Test deserialization with alternate "diagramType" field name (camelCase).
     * This tests the @JsonAlias annotation accepting "diagramType" as an input field name.
     */
    @Test
    void deserialize_withDiagramTypeCamelCase_resolvesCorrectly() throws Exception {
        String json = """
            {
                "id": "diagram-3",
                "name": "Test Diagram with diagramType",
                "diagramType": "Sequence",
                "diagram_nodes": [],
                "diagram_edges": [],
                "decorations": [],
                "interaction_edges": []
            }
            """;

        DiagramDto dto = objectMapper.readValue(json, DiagramDto.class);

        assertNotNull(dto);
        assertEquals("diagram-3", dto.id());
        assertEquals("Test Diagram with diagramType", dto.name());
        assertEquals("Sequence", dto.diagramType());
    }
}
